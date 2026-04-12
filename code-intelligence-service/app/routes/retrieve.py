import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from app.auth import require_auth
from app.db.models import RetrieveResponse
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
    auth: dict = Depends(require_auth),
):
    """
    Semantic search across indexed code chunks.
    Called by the optimizer before prompt construction.
    """
    user_id = auth.get("sub")

    project = queries.get_project(project_id, user_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.get("index_status") == "indexing":
        raise HTTPException(
            status_code=409,
            detail="Project is currently indexing. Please wait.",
        )

    logger.info(
        f"Retrieve: project={project_id}, query_len={len(query)}, "
        f"branch={branch}, limit={limit}"
    )

    try:
        result = await retrieve_context(
            project_id=project_id,
            user_id=user_id,
            query=query,
            branch=branch,
            limit=limit,
        )
        logger.info(
            f"Retrieved {len(result.ranked_chunks)} ranked + "
            f"{len(result.related_chunks)} related chunks"
        )
        return result

    except Exception as e:
        logger.error(f"Retrieval failed: {e}")
        raise HTTPException(status_code=500, detail="Retrieval failed")
