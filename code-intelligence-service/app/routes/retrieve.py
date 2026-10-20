import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from app.auth import require_auth
from app.db.models import ModeEnum, RetrieveResponse
from app.db import queries
from app.services.search import retrieve_context
from app.config import RETRIEVAL_DEFAULT_LIMIT, RETRIEVAL_MAX_LIMIT

logger = logging.getLogger("code-intel.routes.retrieve")
router = APIRouter(tags=["retrieve"])


@router.get("/retrieve", response_model=RetrieveResponse)
async def retrieve(
    project_id: str = Query(...),
    query: str = Query(..., min_length=1, max_length=10_000),
    branch: str | None = Query(default=None),
    limit: int = Query(default=RETRIEVAL_DEFAULT_LIMIT, ge=1, le=RETRIEVAL_MAX_LIMIT),
    mode: ModeEnum = Query(default=ModeEnum.BUG),
    variant: str | None = Query(default=None, description="Named pipeline variant for A/B testing (e.g. 'no_refine', 'deep_graph')"),
    auth: dict = Depends(require_auth),
):
    """
    Hybrid semantic + keyword search across indexed code chunks.
    Returns ranked chunks with code bodies, related graph-expanded
    chunks, and branch context.  Called by the optimizer before prompt
    construction.
    """
    user_id = auth.get("sub")

    project = queries.get_project(project_id, user_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.get("index_status") == "indexing":
        logger.info(
            f"Retrieve blocked: project {project_id} is still indexing "
            f"(user={user_id})"
        )
        raise HTTPException(
            status_code=409,
            detail="Project is currently indexing. Please wait.",
        )

    logger.info(
        f"Retrieve request: project={project_id}, user={user_id}, "
        f"query={query[:80]!r}, branch={branch}, limit={limit}, "
        f"variant={variant}, index_status={project.get('index_status')}"
    )

    try:
        result = await retrieve_context(
            project_id=project_id,
            user_id=user_id,
            query=query,
            branch=branch,
            limit=limit,
            mode=mode,
            variant=variant,
        )

        bodies_count = sum(1 for c in result.ranked_chunks if c.code_body)
        concepts_count = sum(1 for c in result.ranked_chunks if c.concepts)
        logger.info(
            f"Retrieve response: project={project_id}, "
            f"{len(result.ranked_chunks)} ranked ({bodies_count} with code, "
            f"{concepts_count} with concepts) + "
            f"{len(result.related_chunks)} related"
        )
        return result

    except Exception as e:
        logger.error(f"Retrieval failed for project {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Retrieval failed")
