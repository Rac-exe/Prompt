"""
Async indexing worker — processes chunks from the ingest queue.
Pipeline: filter unchanged → batch summarize → batch embed → batch upsert
"""

import asyncio
import time
import logging
from datetime import datetime, timezone
from app.db.models import ChunkInput
from app.db.queries import (
    get_existing_chunk_hashes, upsert_chunks_batch,
    update_project_status, cleanup_stale_chunks,
)
from app.services.summarizer import (
    summarize_chunk_batch, ChunkSummaryInput, SummaryResult,
)
from app.services.embedding import embed_texts
from app.config import SUMMARIZER_CONCURRENCY, MAX_CODE_BODY_LEN, SUMMARIZER_BATCH_SIZE

logger = logging.getLogger("code-intel.worker.index")

EMBED_BODY_LIMIT = 600


def _build_embedding_text(chunk: ChunkInput, summary: SummaryResult) -> str:
    """Build embedding input with semantic signal first, reduced code body."""
    parts = [summary.summary]
    if summary.concepts:
        parts.append(f"Concepts: {', '.join(summary.concepts)}")
    parts.append(chunk.name)
    if chunk.signature:
        parts.append(chunk.signature)
    if chunk.code_body:
        parts.append(chunk.code_body[:EMBED_BODY_LIMIT])
    return "\n".join(parts)


def _filter_unchanged(
    project_id: str,
    chunks: list[ChunkInput],
) -> list[ChunkInput]:
    """Return only chunks whose content_hash differs from the DB copy."""
    existing = get_existing_chunk_hashes(project_id)
    new: list[ChunkInput] = []
    for chunk in chunks:
        cached = existing.get((chunk.file_path, chunk.name))
        if cached and cached["content_hash"] == chunk.content_hash and cached.get("embedding") is not None:
            continue
        new.append(chunk)
    return new


async def _summarize_batched(chunks: list[ChunkInput]) -> list[SummaryResult]:
    """Run LLM summarization in batches of SUMMARIZER_BATCH_SIZE, with concurrency control."""
    sem = asyncio.Semaphore(SUMMARIZER_CONCURRENCY)
    batch_size = SUMMARIZER_BATCH_SIZE

    inputs = [
        ChunkSummaryInput(
            name=c.name, signature=c.signature, callees=c.callees,
            docstring=c.docstring, language=c.language, code_body=c.code_body,
        )
        for c in chunks
    ]

    batches = [inputs[i:i + batch_size] for i in range(0, len(inputs), batch_size)]
    logger.info(
        f"Starting batch summarization: {len(chunks)} chunks in {len(batches)} batches "
        f"(batch_size={batch_size}, concurrency={SUMMARIZER_CONCURRENCY})"
    )

    async def _one_batch(batch: list[ChunkSummaryInput]) -> list[SummaryResult]:
        async with sem:
            return await asyncio.to_thread(summarize_chunk_batch, batch)

    t0 = time.perf_counter()
    batch_results = await asyncio.gather(
        *[_one_batch(b) for b in batches],
        return_exceptions=True,
    )

    final: list[SummaryResult] = []
    failures = 0
    for i, result in enumerate(batch_results):
        if isinstance(result, BaseException):
            logger.error(f"Batch {i} summarization failed: {result}")
            failures += len(batches[i])
            final.extend(
                SummaryResult(summary=c.name, concepts=[]) for c in batches[i]
            )
        else:
            final.extend(result)

    elapsed = time.perf_counter() - t0
    with_concepts = sum(1 for s in final if s.concepts)
    logger.info(
        f"Summarization complete: {len(chunks)} chunks in {elapsed:.1f}s "
        f"({failures} failures, {with_concepts} with concepts, "
        f"{len(batches)} LLM calls instead of {len(chunks)})"
    )
    return final


async def process_ingest_batch(
    project_id: str,
    user_id: str,
    chunks: list[ChunkInput],
    branch: str | None = None,
):
    """Process a full ingest batch with batch summarization, batch embedding, and batch upsert."""
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
        valid_keys = {(c.file_path, c.name, c.chunk_type.value) for c in chunks}
        stale_count = cleanup_stale_chunks(project_id, valid_keys)
        if stale_count:
            logger.info(f"[project={project_id}] Cleaned up {stale_count} stale chunks")

        now = datetime.now(timezone.utc).isoformat()
        update_project_status(project_id, "ready", last_indexed_at=now)
        logger.info(
            f"[project={project_id}] Ingest complete: "
            f"0 processed, {skipped} skipped (all unchanged), "
            f"{stale_count} stale removed, took {time.perf_counter() - t_start:.1f}s"
        )
        return

    summaries = await _summarize_batched(new_chunks)

    for i, (c, s) in enumerate(zip(new_chunks[:3], summaries[:3])):
        logger.info(
            f"[project={project_id}] [SAMPLE SUMMARY {i+1}] "
            f"{c.name} → \"{s.summary[:80]}\" concepts={s.concepts}"
        )
    if len(new_chunks) > 3:
        logger.info(
            f"[project={project_id}] ... and {len(new_chunks) - 3} more summaries"
        )

    embed_inputs = [_build_embedding_text(c, s) for c, s in zip(new_chunks, summaries)]
    avg_len = sum(len(e) for e in embed_inputs) // max(len(embed_inputs), 1)
    logger.info(
        f"[project={project_id}] Starting batch embedding for {len(embed_inputs)} chunks "
        f"(avg embed text={avg_len} chars)"
    )
    t_embed = time.perf_counter()
    try:
        embeddings = await embed_texts(embed_inputs)
        logger.info(
            f"[project={project_id}] Batch embedding complete: "
            f"{len(embeddings)} vectors in {time.perf_counter() - t_embed:.1f}s"
        )
    except Exception as e:
        logger.error(
            f"[project={project_id}] Batch embedding failed: {e}",
            exc_info=True,
        )
        now = datetime.now(timezone.utc).isoformat()
        update_project_status(project_id, "error", last_indexed_at=now)
        return

    rows = []
    for chunk, summary_result, embedding in zip(new_chunks, summaries, embeddings):
        rows.append({
            "project_id": project_id,
            "user_id": user_id,
            "file_path": chunk.file_path,
            "start_line": chunk.start_line,
            "end_line": chunk.end_line,
            "chunk_type": chunk.chunk_type.value,
            "name": chunk.name,
            "signature": chunk.signature,
            "language": chunk.language,
            "semantic_summary": summary_result.summary,
            "embedding": embedding,
            "content_hash": chunk.content_hash,
            "branch": branch,
            "branch_diverged": False,
            "code_body": chunk.code_body,
            "concepts": summary_result.concepts,
            "is_exported": chunk.is_exported,
        })

    t_upsert = time.perf_counter()
    processed = upsert_chunks_batch(rows)
    errors = len(rows) - processed
    logger.info(
        f"[project={project_id}] Batch upsert complete: "
        f"{processed} upserted, {errors} errors, took {time.perf_counter() - t_upsert:.1f}s"
    )

    valid_keys = {(c.file_path, c.name, c.chunk_type.value) for c in chunks}
    stale_count = cleanup_stale_chunks(project_id, valid_keys)
    if stale_count:
        logger.info(f"[project={project_id}] Cleaned up {stale_count} stale chunks")

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
        f"{stale_count} stale removed, took {total_elapsed:.1f}s total"
    )
