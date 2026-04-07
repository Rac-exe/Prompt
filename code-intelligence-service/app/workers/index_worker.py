"""
Async indexing worker — processes chunks from the ingest queue.
Pipeline: validate hash -> summarize (LLM) -> embed -> upsert to pgvector
"""

import logging
from datetime import datetime, timezone
from app.db.models import ChunkInput
from app.db.queries import get_chunk_by_hash, upsert_chunk, update_project_status
from app.services.summarizer import summarize_chunk
from app.services.embedding import embed_text

logger = logging.getLogger("code-intel.worker.index")


async def process_chunk(
    project_id: str,
    user_id: str,
    chunk: ChunkInput,
    branch: str | None = None,
) -> bool:
    """
    Process a single code chunk: summarize, embed, and upsert.
    Returns True if the chunk was processed, False if skipped (unchanged).
    """
    existing = get_chunk_by_hash(
        project_id=project_id,
        file_path=chunk.file_path,
        name=chunk.name,
        content_hash=chunk.content_hash,
    )
    if existing:
        logger.debug(f"Skipping unchanged chunk: {chunk.name} in {chunk.file_path}")
        return False

    summary = summarize_chunk(
        name=chunk.name,
        signature=chunk.signature,
        callees=chunk.callees,
        docstring=chunk.docstring,
        language=chunk.language,
    )

    embedding = embed_text(summary)

    upsert_chunk(
        project_id=project_id,
        user_id=user_id,
        file_path=chunk.file_path,
        start_line=chunk.start_line,
        end_line=chunk.end_line,
        chunk_type=chunk.chunk_type.value,
        name=chunk.name,
        signature=chunk.signature,
        language=chunk.language,
        semantic_summary=summary,
        embedding=embedding,
        content_hash=chunk.content_hash,
        branch=branch,
    )

    logger.debug(f"Indexed chunk: {chunk.name} in {chunk.file_path}")
    return True


async def process_ingest_batch(
    project_id: str,
    user_id: str,
    chunks: list[ChunkInput],
    branch: str | None = None,
):
    """Process a full ingest batch, updating project status along the way."""
    update_project_status(project_id, "indexing")

    processed = 0
    skipped = 0
    errors = 0

    for chunk in chunks:
        try:
            was_processed = await process_chunk(project_id, user_id, chunk, branch)
            if was_processed:
                processed += 1
            else:
                skipped += 1
        except Exception as e:
            logger.error(f"Failed to process chunk {chunk.name}: {e}")
            errors += 1

    now = datetime.now(timezone.utc).isoformat()
    update_project_status(project_id, "ready", last_indexed_at=now)

    logger.info(
        f"Ingest complete for project {project_id}: "
        f"{processed} processed, {skipped} skipped, {errors} errors"
    )
