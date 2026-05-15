import logging
import sentry_sdk
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from app.auth import require_auth
from app.db.models import IngestRequest
from app.db import queries
from app.workers.index_worker import process_ingest_batch
from app.services.graph import process_call_graph
from app.config import MAX_CHUNKS_PER_INGEST, REDIS_URL

logger = logging.getLogger("code-intel.routes.ingest")
router = APIRouter(tags=["ingest"])


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
        try:
            from app.db.supabase_client import get_client
            client = get_client()
            client.table("projects").update(
                {"current_branch": body.branch}
            ).eq("id", body.project_id).execute()
            logger.info(f"Updated current_branch to {body.branch} for project {body.project_id}")
        except Exception as e:
            sentry_sdk.capture_exception(e)
            logger.warning(f"Failed to update current_branch: {e}")

    use_arq = bool(REDIS_URL and REDIS_URL != "redis://localhost:6379")
    if use_arq:
        try:
            from app.workers.arq_worker import enqueue_ingest
            chunks_data = [c.model_dump() for c in body.chunks]
            graph_data = [e.model_dump() for e in body.call_graph]
            job_id = await enqueue_ingest(
                body.project_id,
                user_id,
                chunks_data,
                graph_data,
                body.branch,
                body.language_map,
                body.cleanup_scope,
                [key.model_dump() for key in body.cleanup_keys],
            )
            logger.info(f"Ingest enqueued via arq: job_id={job_id}")
        except Exception as e:
            sentry_sdk.capture_exception(e)
            logger.warning(f"arq enqueue failed, falling back to background task: {e}")
            use_arq = False

    if not use_arq:
        background_tasks.add_task(
            _run_ingest,
            project_id=body.project_id,
            user_id=user_id,
            body=body,
        )
        logger.info(f"Ingest queued via FastAPI BackgroundTasks for project {body.project_id}")

    return {
        "status": "accepted",
        "project_id": body.project_id,
        "chunks_queued": len(body.chunks),
        "edges_queued": len(body.call_graph),
        "queue": "arq" if use_arq else "background",
    }


async def _run_ingest(project_id: str, user_id: str, body: IngestRequest):
    """Background task that processes all chunks and call graph edges."""
    try:
        await process_ingest_batch(
            project_id=project_id,
            user_id=user_id,
            chunks=body.chunks,
            branch=body.branch,
            language_map=body.language_map,
            cleanup_scope=body.cleanup_scope,
            cleanup_keys=body.cleanup_keys,
        )

        if body.call_graph:
            logger.info(f"Processing {len(body.call_graph)} call graph edges for project {project_id}")
            process_call_graph(project_id, body.call_graph)

        logger.info(f"Background ingest task complete for project {project_id}")

    except Exception as e:
        sentry_sdk.capture_exception(e)
        logger.error(f"Ingest background task failed for project {project_id}: {e}", exc_info=True)
        queries.update_project_status(project_id, "stale")
