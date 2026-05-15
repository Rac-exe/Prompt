"""
POST /api/context — probable-location retrieval.
Returns a ranked list of probable files and line ranges (with code bodies)
that may be relevant to the user's query. No diagnosis, no hedged prose.
The downstream LLM decides what's broken.
"""

import logging
import time
from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_auth
from app.db import queries
from app.db.models import (
    ContextRequest,
    ContextResponse,
    ProbableLocation,
    RetrievedChunk,
)
from app.services.search import retrieve_context_full
from app.services.query_preprocessor import preprocess_query

logger = logging.getLogger("code-intel.routes.context")
router = APIRouter(tags=["context"])


def _to_probable(chunk: RetrievedChunk) -> ProbableLocation:
    return ProbableLocation(
        file_path=chunk.file_path,
        start_line=chunk.start_line,
        end_line=chunk.end_line,
        chunk_type=chunk.chunk_type,
        name=chunk.name,
        signature=chunk.signature,
        language=chunk.language,
        semantic_summary=chunk.semantic_summary,
        summary_purpose=chunk.summary_purpose,
        code_body=chunk.code_body,
        concepts=chunk.concepts or [],
        confidence_score=chunk.similarity_score,
        is_exported=False,
        branch=chunk.branch,
        branch_diverged=chunk.branch_diverged,
        relevance_reasoning=chunk.relevance_reasoning,
        probable_issue=chunk.probable_issue,
    )


@router.post("/context", response_model=ContextResponse)
async def get_context(
    request: ContextRequest,
    auth: dict = Depends(require_auth),
):
    """
    Probable-location retrieval.
    Runs query preprocessing + hybrid retrieval, then returns the ranked
    chunks as structured ProbableLocation entries. No LLM analysis layer.
    """
    t_start = time.perf_counter()
    user_id = auth.get("sub")

    project = queries.get_project(request.project_id, user_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.get("index_status") == "indexing":
        raise HTTPException(
            status_code=409,
            detail="Project is currently indexing. Please wait.",
        )

    logger.info(
        f"Context request: project={request.project_id}, user={user_id}, "
        f"query={request.query[:80]!r}, mode={request.mode.value}, "
        f"branch={request.branch}, limit={request.limit}, "
        f"index_status={project.get('index_status')}"
    )

    try:
        t_step = time.perf_counter()
        signals = preprocess_query(request.query)
        logger.info(
            f"[CONTEXT] Step 1 — Preprocess: {time.perf_counter() - t_step:.3f}s"
        )

        project_summary = queries.get_project_summary(request.project_id)

        t_step = time.perf_counter()
        result = await retrieve_context_full(
            project_id=request.project_id,
            user_id=user_id,
            query=request.query,
            branch=request.branch,
            limit=request.limit,
            signals=signals,
            mode=request.mode,
            project_summary=project_summary,
        )
        logger.info(
            f"[CONTEXT] Step 2 — Retrieval: {time.perf_counter() - t_step:.3f}s, "
            f"{len(result.ranked_chunks)} ranked + {len(result.related_chunks)} related"
        )

        logger.info(
            f"[CONTEXT] Step 3 — Project summary: "
            f"{'present (' + str(len(project_summary)) + ' chars)' if project_summary else 'not found'}"
        )

        from app.services.search import _to_retrieved_chunk
        probable_locations = [_to_probable(_to_retrieved_chunk(c)) for c in result.ranked_chunks]
        related_locations = [_to_probable(_to_retrieved_chunk(c, score=0.0)) for c in result.related_chunks]
        sources = [loc for loc in probable_locations if result.source_ids and loc.name]
        if result.source_ids:
            source_paths = {
                c.get("file_path") for c in result.ranked_chunks
                if str(c.get("id")) in set(result.source_ids)
            }
            sources = [loc for loc in probable_locations if loc.file_path in source_paths]

        elapsed = time.perf_counter() - t_start
        logger.info(
            f"[CONTEXT] Done: project={request.project_id}, "
            f"{len(probable_locations)} probable + {len(related_locations)} related, "
            f"intent={result.query_intent}, concepts={result.query_concepts}, mode={result.mode}, "
            f"total_elapsed={elapsed:.2f}s"
        )

        return ContextResponse(
            mode=result.mode,
            probable_locations=probable_locations,
            related_locations=related_locations,
            answer=result.answer,
            sources=sources,
            intent=result.query_intent or "general",
            concepts=result.query_concepts or [],
            project_summary=project_summary,
            branch_context=result.branch_context,
            search_id=result.search_id,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Context retrieval failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Context retrieval failed")
