import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from app.auth import require_auth
from app.db.models import IngestRequest
from app.db import queries
from app.db.local_store import warmup_local_store
from app import llm
from app.runtime_state import is_service_ready, set_service_ready
from app.workers.index_worker import process_ingest_batch
from app.config import MAX_CHUNKS_PER_INGEST

logger = logging.getLogger("code-intel.routes.ingest")
router = APIRouter(tags=["ingest"])
_INGEST_WARMUP_ATTEMPTS = 3
_INGEST_WARMUP_RETRY_DELAY_SEC = 0.4


@router.post("/index/ingest", status_code=202)
async def ingest_skeleton(
    body: IngestRequest,
    background_tasks: BackgroundTasks,
    auth: dict = Depends(require_auth),
):
    """
    Receive a structural skeleton from Electron.
    Returns 202 immediately; indexing runs async in the background.
    """
    user_id = auth.get("sub")

    if not is_service_ready():
        ready_now = False
        for attempt in range(1, _INGEST_WARMUP_ATTEMPTS + 1):
            ready_now = warmup_local_store()
            set_service_ready(ready_now)
            if ready_now:
                break
            if attempt < _INGEST_WARMUP_ATTEMPTS:
                await asyncio.sleep(_INGEST_WARMUP_RETRY_DELAY_SEC)
        if not ready_now:
            raise HTTPException(
                status_code=503,
                detail="Code intelligence service is warming up. Retry indexing in a few seconds.",
            )

    project = queries.get_project(body.project_id, user_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if len(body.chunks) > MAX_CHUNKS_PER_INGEST:
        raise HTTPException(
            status_code=400,
            detail=f"Too many chunks ({len(body.chunks)}). Maximum is {MAX_CHUNKS_PER_INGEST}.",
        )

    has_bodies = sum(1 for c in body.chunks if c.code_body)
    languages = body.language_map
    logger.info(
        f"Ingest received: project={body.project_id}, user={user_id}, "
        f"chunks={len(body.chunks)} ({has_bodies} with code bodies), "
        f"edges={len(body.call_graph)}, languages={languages}, "
        f"branch={body.branch}, cleanup_scope={body.cleanup_scope}, "
        f"cleanup_keys={len(body.cleanup_keys)}"
    )

    if body.branch:
        queries.update_project_status(body.project_id, "indexing")
        queries.set_current_branch(body.project_id, body.branch)

    background_tasks.add_task(
        _run_ingest,
        project_id=body.project_id,
        user_id=user_id,
        body=body,
        llm_settings=llm.current_settings(),
    )
    logger.info(f"Ingest queued for project {body.project_id}")

    return {
        "status": "accepted",
        "project_id": body.project_id,
        "chunks_queued": len(body.chunks),
        "edges_queued": len(body.call_graph),
        "queue": "background",
    }


async def _run_ingest(
    project_id: str,
    user_id: str,
    body: IngestRequest,
    llm_settings: llm.LLMSettings,
):
    """Background task that processes all chunks and call graph edges.

    Runs after the response is sent, so the request's LLM settings (used for
    chunk summaries) are re-applied explicitly.
    """
    token = llm.use_settings(llm_settings)
    try:
        await process_ingest_batch(
            project_id=project_id,
            user_id=user_id,
            chunks=body.chunks,
            branch=body.branch,
            language_map=body.language_map,
            cleanup_scope=body.cleanup_scope,
            cleanup_keys=body.cleanup_keys,
            call_graph=body.call_graph or [],
        )

        logger.info(f"Background ingest task complete for project {project_id}")

    except Exception as e:
        logger.error(f"Ingest background task failed for project {project_id}: {e}", exc_info=True)
        # Avoid regressing to "stale" on transient first-run/startup failures.
        # "partial" preserves user trust and signals retryable degradation.
        queries.update_project_status(project_id, "partial")
    finally:
        llm.reset_settings(token)
