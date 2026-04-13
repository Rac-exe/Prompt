"""
Phase 2: arq-based async worker pool for indexing tasks.
Decouples heavy indexing from the API request path using Redis.

Run with: arq app.workers.arq_worker.WorkerSettings
"""

import logging
from arq import create_pool
from arq.connections import RedisSettings
from app.config import REDIS_URL
from app.db.models import ChunkInput, CallGraphEdge
from app.workers.index_worker import process_ingest_batch
from app.services.graph import process_call_graph
from app.db.queries import update_project_status
from datetime import datetime, timezone

logger = logging.getLogger("code-intel.arq")


def parse_redis_url(url: str) -> RedisSettings:
    """Parse a Redis URL into arq RedisSettings."""
    if not url:
        return RedisSettings()

    from urllib.parse import urlparse
    parsed = urlparse(url)
    return RedisSettings(
        host=parsed.hostname or "localhost",
        port=parsed.port or 6379,
        password=parsed.password or None,
        database=int(parsed.path.lstrip("/") or "0"),
    )


async def index_chunks_task(
    ctx: dict,
    project_id: str,
    user_id: str,
    chunks_data: list[dict],
    call_graph_data: list[dict],
    branch: str | None = None,
):
    """
    arq task: process a batch of code chunks for indexing.
    Deserializes chunk data, runs the summarize->embed->upsert pipeline,
    then processes call graph edges.
    """
    logger.info(f"[arq] Processing {len(chunks_data)} chunks for project {project_id}")

    chunks = [ChunkInput(**c) for c in chunks_data]
    call_graph = [CallGraphEdge(**e) for e in call_graph_data]

    await process_ingest_batch(
        project_id=project_id,
        user_id=user_id,
        chunks=chunks,
        branch=branch,
    )

    if call_graph:
        process_call_graph(project_id, call_graph)

    logger.info(f"[arq] Completed indexing for project {project_id}")


async def sync_project_task(ctx: dict, project_id: str, payload: dict):
    """arq task: process a webhook-triggered sync."""
    from app.workers.sync_worker import process_push_webhook
    await process_push_webhook(project_id, payload)


async def startup(ctx: dict):
    logger.info("[arq] Worker starting up")


async def shutdown(ctx: dict):
    logger.info("[arq] Worker shutting down")


class WorkerSettings:
    """arq worker configuration."""
    redis_settings = parse_redis_url(REDIS_URL)
    functions = [index_chunks_task, sync_project_task]
    on_startup = startup
    on_shutdown = shutdown
    max_jobs = 10
    job_timeout = 600
    max_tries = 3
    health_check_interval = 30


_pool = None


async def get_pool():
    """Get or create a shared arq connection pool for enqueuing jobs."""
    global _pool
    if _pool is None:
        _pool = await create_pool(parse_redis_url(REDIS_URL))
    return _pool


async def enqueue_ingest(
    project_id: str,
    user_id: str,
    chunks_data: list[dict],
    call_graph_data: list[dict],
    branch: str | None = None,
):
    """Enqueue an indexing job to the Redis-backed arq queue."""
    pool = await get_pool()
    job = await pool.enqueue_job(
        "index_chunks_task",
        project_id,
        user_id,
        chunks_data,
        call_graph_data,
        branch,
    )
    logger.info(f"[arq] Enqueued ingest job {job.job_id} for project {project_id}")
    return job.job_id


async def enqueue_sync(project_id: str, payload: dict):
    """Enqueue a webhook sync job."""
    pool = await get_pool()
    job = await pool.enqueue_job("sync_project_task", project_id, payload)
    logger.info(f"[arq] Enqueued sync job {job.job_id} for project {project_id}")
    return job.job_id
