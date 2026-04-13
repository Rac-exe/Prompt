"""
Async indexing worker — processes chunks from the ingest queue.
Pipeline: filter unchanged → parallel summarize → batch embed → upsert
"""

import asyncio
import time
import logging
from datetime import datetime, timezone
from app.db.models import ChunkInput
from app.db.queries import get_chunk_by_hash, upsert_chunk, update_project_status
from app.services.summarizer import summarize_chunk, SummaryResult
from app.services.embedding import embed_texts
from app.config import SUMMARIZER_CONCURRENCY

logger = logging.getLogger("code-intel.worker.index")


def _filter_unchanged(
    project_id: str,
    chunks: list[ChunkInput],
) -> list[ChunkInput]:
    """Return only chunks whose content_hash differs from the DB copy."""
    new: list[ChunkInput] = []
    for chunk in chunks:
        existing = get_chunk_by_hash(
            project_id=project_id,
            file_path=chunk.file_path,
            name=chunk.name,
            content_hash=chunk.content_hash,
        )
        if existing:
            logger.debug(f"Skipping unchanged chunk: {chunk.name} in {chunk.file_path}")
        else:
            new.append(chunk)
    return new


async def _summarize_parallel(
    chunks: list[ChunkInput],
) -> list[SummaryResult]:
    """Run LLM summarization concurrently with a bounded semaphore."""
    sem = asyncio.Semaphore(SUMMARIZER_CONCURRENCY)
    logger.info(
        f"Starting parallel summarization: {len(chunks)} chunks, "
        f"concurrency={SUMMARIZER_CONCURRENCY}"
    )

    async def _one(chunk: ChunkInput) -> SummaryResult:
        async with sem:
            return await asyncio.to_thread(
                summarize_chunk,
                name=chunk.name,
                signature=chunk.signature,
                callees=chunk.callees,
                docstring=chunk.docstring,
                language=chunk.language,
                code_body=chunk.code_body,
            )

    t0 = time.perf_counter()
    results = await asyncio.gather(
        *[_one(c) for c in chunks],
        return_exceptions=True,
    )
    elapsed = time.perf_counter() - t0

    final: list[SummaryResult] = []
    failures = 0
    for i, r in enumerate(results):
        if isinstance(r, BaseException):
            logger.error(f"Summarization failed for {chunks[i].name}: {r}")
            final.append(SummaryResult(summary=chunks[i].name, concepts=[]))
            failures += 1
        else:
            final.append(r)

    with_concepts = sum(1 for s in final if s.concepts)
    logger.info(
        f"Summarization complete: {len(chunks)} chunks in {elapsed:.1f}s "
        f"({failures} failures, {with_concepts} with concepts)"
    )
    return final


async def process_ingest_batch(
    project_id: str,
    user_id: str,
    chunks: list[ChunkInput],
    branch: str | None = None,
):
    """Process a full ingest batch with parallel summarization and batch embedding."""
    t_start = time.perf_counter()
    update_project_status(project_id, "indexing")

    has_bodies = sum(1 for c in chunks if c.code_body)
    logger.info(
        f"[project={project_id}] Ingest started: {len(chunks)} chunks received "
        f"({has_bodies} with code bodies), branch={branch}"
    )

    new_chunks = _filter_unchanged(project_id, chunks)
    skipped = len(chunks) - len(new_chunks)
    logger.info(
        f"[project={project_id}] Hash filter: {len(new_chunks)} new, {skipped} unchanged"
    )

    if not new_chunks:
        now = datetime.now(timezone.utc).isoformat()
        update_project_status(project_id, "ready", last_indexed_at=now)
        logger.info(
            f"[project={project_id}] Ingest complete: "
            f"0 processed, {skipped} skipped (all unchanged), "
            f"took {time.perf_counter() - t_start:.1f}s"
        )
        return

    summaries = await _summarize_parallel(new_chunks)

    summary_texts = [s.summary for s in summaries]
    logger.info(
        f"[project={project_id}] Starting batch embedding for {len(summary_texts)} summaries"
    )
    t_embed = time.perf_counter()
    try:
        embeddings = await embed_texts(summary_texts)
        logger.info(
            f"[project={project_id}] Batch embedding complete: "
            f"{len(embeddings)} vectors in {time.perf_counter() - t_embed:.1f}s"
        )
    except Exception as e:
        logger.error(
            f"[project={project_id}] Batch embedding failed after "
            f"{time.perf_counter() - t_embed:.1f}s: {e}",
            exc_info=True,
        )
        now = datetime.now(timezone.utc).isoformat()
        update_project_status(project_id, "error", last_indexed_at=now)
        return

    processed = 0
    errors = 0

    for chunk, summary_result, embedding in zip(new_chunks, summaries, embeddings):
        try:
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
                semantic_summary=summary_result.summary,
                embedding=embedding,
                content_hash=chunk.content_hash,
                branch=branch,
                code_body=chunk.code_body,
                concepts=summary_result.concepts,
            )
            processed += 1
        except Exception as e:
            logger.error(f"[project={project_id}] Failed to upsert chunk {chunk.name}: {e}")
            errors += 1

    now = datetime.now(timezone.utc).isoformat()
    if errors > 0 and processed == 0:
        final_status = "error"
    elif errors > 0:
        final_status = "partial"
    else:
        final_status = "ready"

    update_project_status(project_id, final_status, last_indexed_at=now)
    total_elapsed = time.perf_counter() - t_start

    logger.info(
        f"[project={project_id}] Ingest complete: status={final_status}, "
        f"{processed} processed, {skipped} skipped, {errors} errors, "
        f"took {total_elapsed:.1f}s total"
    )
