"""
Async indexing worker.

Pipeline: filter unchanged -> enrich context -> batch summarize -> multi-vector
embed -> batch upsert -> stale cleanup -> project summary.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone

import sentry_sdk

from app.config import SUMMARIZER_BATCH_SIZE, SUMMARIZER_CONCURRENCY
from app.db.models import ChunkInput, ChunkKey
from app.db.queries import (
    cleanup_stale_chunks,
    cleanup_stale_chunks_for_files,
    get_existing_chunk_hashes,
    update_project_status,
    upsert_chunks_batch,
)
from app.services.context_builder import EnrichedChunk, build_enriched_chunks
from app.services.embedding import embed_structure_texts, embed_texts
from app.services.project_summary import generate_project_summary
from app.services.summarizer import ChunkSummaryInput, SummaryResult, summarize_chunk_batch

logger = logging.getLogger("code-intel.worker.index")


def _filter_unchanged(project_id: str, chunks: list[ChunkInput]) -> list[ChunkInput]:
    existing = get_existing_chunk_hashes(project_id)
    new: list[ChunkInput] = []
    for chunk in chunks:
        cached = existing.get((chunk.file_path, chunk.name))
        has_new_embedding = bool(cached and (cached.get("embedding_summary") or cached.get("embedding")))
        if cached and cached["content_hash"] == chunk.content_hash and has_new_embedding:
            continue
        new.append(chunk)
    return new


async def _summarize_batched(enriched: list[EnrichedChunk]) -> list[SummaryResult]:
    sem = asyncio.Semaphore(SUMMARIZER_CONCURRENCY)
    inputs = [
        ChunkSummaryInput(
            name=item.chunk.name,
            signature=item.chunk.signature,
            callees=item.chunk.callees,
            docstring=item.chunk.docstring,
            language=item.chunk.language,
            code_body=item.chunk.code_body,
            context_header=item.context_header,
            context_before=item.context_before,
            context_after=item.context_after,
            parent_summary=item.parent_summary,
            sibling_names=item.sibling_names,
        )
        for item in enriched
    ]
    batches = [inputs[i:i + SUMMARIZER_BATCH_SIZE] for i in range(0, len(inputs), SUMMARIZER_BATCH_SIZE)]

    async def _one(batch: list[ChunkSummaryInput]) -> list[SummaryResult]:
        async with sem:
            return await asyncio.to_thread(summarize_chunk_batch, batch)

    results = await asyncio.gather(*[_one(batch) for batch in batches], return_exceptions=True)
    final: list[SummaryResult] = []
    for i, result in enumerate(results):
        if isinstance(result, BaseException):
            logger.error(f"Summarizer batch {i} failed: {result}")
            final.extend(SummaryResult(summary_code=c.name) for c in batches[i])
        else:
            final.extend(result)
    return final


def _summary_embedding_text(chunk: ChunkInput, summary: SummaryResult) -> str:
    parts = [summary.summary_code]
    if summary.summary_purpose:
        parts.append(f"Purpose: {summary.summary_purpose}")
    if summary.concepts:
        parts.append(f"Concepts: {', '.join(summary.concepts)}")
    return "\n".join(parts)


def _structure_embedding_text(item: EnrichedChunk, summary: SummaryResult) -> str:
    chunk = item.chunk
    parts = [
        chunk.file_path,
        chunk.name,
        chunk.chunk_type.value,
        chunk.language,
    ]
    if chunk.signature:
        parts.append(chunk.signature)
    if chunk.parent_scope_name:
        parts.append(f"Parent: {chunk.parent_scope_name}")
    if item.context_header:
        parts.append(f"Imports/context: {item.context_header[:1000]}")
    if item.sibling_names:
        parts.append(f"Siblings: {', '.join(item.sibling_names[:20])}")
    if summary.concepts:
        parts.append(f"Concepts: {', '.join(summary.concepts)}")
    return "\n".join(parts)


async def process_ingest_batch(
    project_id: str,
    user_id: str,
    chunks: list[ChunkInput],
    branch: str | None = None,
    language_map: dict[str, int] | None = None,
    cleanup_scope: str = "none",
    cleanup_keys: list[ChunkKey] | None = None,
):
    t_start = time.perf_counter()
    update_project_status(project_id, "indexing")

    logger.info(
        f"[project={project_id}] Ingest started: chunks={len(chunks)}, branch={branch}, "
        f"languages={language_map or {}}, cleanup_scope={cleanup_scope}, "
        f"cleanup_keys={len(cleanup_keys or [])}"
    )

    new_chunks = _filter_unchanged(project_id, chunks)
    skipped = len(chunks) - len(new_chunks)
    logger.info(
        f"[project={project_id}] Hash filter: new={len(new_chunks)}, skipped={skipped}"
    )
    if not new_chunks:
        stale_count = _cleanup_if_project_snapshot(project_id, cleanup_scope, cleanup_keys)
        _generate_summary(project_id, language_map or {}, chunks)
        now = datetime.now(timezone.utc).isoformat()
        update_project_status(project_id, "ready", last_indexed_at=now)
        logger.info(
            f"[project={project_id}] Ingest complete: all unchanged, skipped={skipped}, stale={stale_count}"
        )
        return

    enriched = build_enriched_chunks(new_chunks)
    logger.info(
        f"[project={project_id}] Context enrichment: enriched={len(enriched)}, "
        f"with_headers={sum(1 for e in enriched if e.context_header)}, "
        f"with_siblings={sum(1 for e in enriched if e.sibling_names)}"
    )
    summaries = await _summarize_batched(enriched)
    logger.info(
        f"[project={project_id}] Summaries generated: count={len(summaries)}, "
        f"with_purpose={sum(1 for s in summaries if s.summary_purpose)}, "
        f"with_concepts={sum(1 for s in summaries if s.concepts)}"
    )

    summary_texts = [
        _summary_embedding_text(item.chunk, summary)
        for item, summary in zip(enriched, summaries)
    ]
    structure_texts = [
        _structure_embedding_text(item, summary)
        for item, summary in zip(enriched, summaries)
    ]

    try:
        logger.info(
            f"[project={project_id}] Embedding start: summary_texts={len(summary_texts)}, "
            f"structure_texts={len(structure_texts)}"
        )
        embedding_summary = await embed_texts(summary_texts)
        embedding_structure = await embed_structure_texts(structure_texts)
        logger.info(
            f"[project={project_id}] Embedding complete: summary_vectors={len(embedding_summary)}, "
            f"structure_vectors={len(embedding_structure)}"
        )
    except Exception as e:
        sentry_sdk.capture_exception(e)
        logger.error(f"[project={project_id}] Embedding failed: {e}", exc_info=True)
        update_project_status(project_id, "error", last_indexed_at=datetime.now(timezone.utc).isoformat())
        return

    rows = []
    for item, summary, summary_vec, structure_vec in zip(
        enriched, summaries, embedding_summary, embedding_structure
    ):
        chunk = item.chunk
        rows.append({
            "project_id": project_id,
            "user_id": user_id,
            "file_path": chunk.file_path,
            "start_line": chunk.start_line,
            "end_line": chunk.end_line,
            "chunk_type": chunk.chunk_type.value,
            "scope_type": chunk.scope_type or chunk.chunk_type.value,
            "chunk_index": chunk.chunk_index,
            "parent_scope_name": chunk.parent_scope_name,
            "name": chunk.name,
            "signature": chunk.signature,
            "language": chunk.language,
            "semantic_summary": summary.summary_code,
            "summary_code": summary.summary_code,
            "summary_purpose": summary.summary_purpose,
            "embedding_summary": summary_vec,
            "embedding_structure": structure_vec,
            # Keep legacy embedding populated for old RPCs/fallbacks until fully retired.
            "embedding": summary_vec,
            "content_hash": chunk.content_hash,
            "branch": branch,
            "branch_diverged": False,
            "code_body": chunk.code_body,
            "concepts": summary.concepts,
            "is_exported": chunk.is_exported,
            "context_header": item.context_header,
            "context_before": item.context_before,
            "context_after": item.context_after,
            "parent_summary": item.parent_summary,
        })

    processed = upsert_chunks_batch(rows)
    errors = len(rows) - processed
    logger.info(
        f"[project={project_id}] Upsert complete: rows={len(rows)}, processed={processed}, errors={errors}"
    )
    stale_count = _cleanup_if_project_snapshot(project_id, cleanup_scope, cleanup_keys)
    logger.info(
        f"[project={project_id}] Stale cleanup complete: "
        f"scope={cleanup_scope}, stale={stale_count}"
    )

    _generate_summary(project_id, language_map or {}, [*chunks])

    final_status = "error" if processed == 0 and errors else "partial" if errors else "ready"
    now = datetime.now(timezone.utc).isoformat()
    update_project_status(project_id, final_status, last_indexed_at=now)
    logger.info(
        f"[project={project_id}] Ingest complete: status={final_status}, "
        f"processed={processed}, skipped={skipped}, errors={errors}, stale={stale_count}, "
        f"elapsed={time.perf_counter() - t_start:.1f}s"
    )


def _generate_summary(project_id: str, language_map: dict[str, int], chunks: list[ChunkInput]):
    try:
        generate_project_summary(
            project_id,
            language_map,
            [c.model_dump() for c in chunks],
        )
    except Exception as e:
        logger.warning(f"[project={project_id}] Project summary generation failed: {e}")


def _cleanup_if_project_snapshot(
    project_id: str,
    cleanup_scope: str,
    cleanup_keys: list[ChunkKey] | None,
) -> int:
    if cleanup_scope == "file":
        if not cleanup_keys:
            logger.warning(
                f"[project={project_id}] File stale cleanup skipped: missing cleanup_keys"
            )
            return 0
        valid_keys = {
            (key.file_path, key.name, key.chunk_type.value)
            for key in cleanup_keys
        }
        file_paths = {key.file_path for key in cleanup_keys}
        return cleanup_stale_chunks_for_files(project_id, file_paths, valid_keys)

    if cleanup_scope != "project":
        logger.info(
            f"[project={project_id}] Stale cleanup skipped: cleanup_scope={cleanup_scope}"
        )
        return 0
    if not cleanup_keys:
        logger.warning(
            f"[project={project_id}] Stale cleanup skipped: project snapshot missing cleanup_keys"
        )
        return 0

    valid_keys = {
        (key.file_path, key.name, key.chunk_type.value)
        for key in cleanup_keys
    }
    return cleanup_stale_chunks(project_id, valid_keys)
