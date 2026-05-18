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

from app.config import GRAPH_BUILDER_ENABLED, SUMMARIZER_BATCH_SIZE, SUMMARIZER_CONCURRENCY
from app.db.models import ChunkInput, ChunkKey
from app.db.queries import (
    cleanup_stale_chunks,
    cleanup_stale_chunks_for_files,
    get_all_project_chunk_ids,
    get_all_project_relationships,
    get_existing_chunk_hashes,
    update_chunks_graph_data,
    update_project_status,
    update_relationship_embeddings,
    upsert_chunks_batch,
    upsert_communities,
)
from app.services import cache as _cache
from app.services.community import invalidate_community_cache
from app.services.context_builder import EnrichedChunk, build_enriched_chunks
from app.services.embedding import embed_structure_texts, embed_texts
from app.services.graph_builder import run_graph_pipeline
from app.services.project_summary import generate_project_summary
from app.services.summarizer import ChunkSummaryInput, SummaryResult, summarize_chunk_batch

logger = logging.getLogger("code-intel.worker.index")


def _filter_unchanged(project_id: str, chunks: list[ChunkInput]) -> list[ChunkInput]:
    existing = get_existing_chunk_hashes(project_id)
    new: list[ChunkInput] = []
    for chunk in chunks:
        cached = existing.get((chunk.file_path, chunk.name, chunk.chunk_type.value))
        if cached and cached["content_hash"] == chunk.content_hash:
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
        _cache.invalidate(f"project_summary:{project_id}")
        logger.info(
            f"[project={project_id}] Ingest complete: all unchanged, skipped={skipped}, stale={stale_count}"
        )
        # Graph pipeline still needs to run if it hasn't produced community data yet,
        # or if the graph builder was just enabled. Pass empty summaries/rows — PageRank
        # and Leiden operate on the full DB snapshot, concept phrases are just skipped.
        if GRAPH_BUILDER_ENABLED:
            logger.info(
                "[GRAPH_PIPELINE] All chunks unchanged — running graph pipeline on existing "
                "DB data to ensure PageRank/communities are populated."
            )
            await _run_graph_pipeline(project_id, [], [])
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

    # ── Graph pipeline (PageRank + Leiden + community reports + concept embeddings)
    if GRAPH_BUILDER_ENABLED:
        await _run_graph_pipeline(project_id, summaries, rows)

    stale_count = _cleanup_if_project_snapshot(project_id, cleanup_scope, cleanup_keys)
    logger.info(
        f"[project={project_id}] Stale cleanup complete: "
        f"scope={cleanup_scope}, stale={stale_count}"
    )

    _generate_summary(project_id, language_map or {}, [*chunks])

    final_status = "error" if processed == 0 and errors else "partial" if errors else "ready"
    now = datetime.now(timezone.utc).isoformat()
    update_project_status(project_id, final_status, last_indexed_at=now)
    if final_status == "ready":
        _cache.invalidate(f"project_summary:{project_id}")
    logger.info(
        f"[project={project_id}] Ingest complete: status={final_status}, "
        f"processed={processed}, skipped={skipped}, errors={errors}, stale={stale_count}, "
        f"elapsed={time.perf_counter() - t_start:.1f}s"
    )


async def _run_graph_pipeline(
    project_id: str,
    summaries: list[SummaryResult],
    upserted_rows: list[dict],
) -> None:
    """
    Run the full knowledge-graph pipeline after a successful chunk upsert.

    Steps:
      1. Fetch ALL current project chunks + relationships from DB (not just new ones)
         so PageRank and Leiden see the full graph.
      2. Run graph_builder.run_graph_pipeline() → PageRank + Leiden + LLM reports.
      3. Embed community reports.
      4. Embed relationship summaries.
      5. Embed concept phrases from summaries (3 per chunk).
      6. Write everything back to the DB.
      7. Invalidate community cache.
    """
    t0 = time.perf_counter()
    logger.info("[GRAPH_PIPELINE] Starting graph pipeline for project=%s", project_id)

    try:
        # ── Step 1: Load full project graph from DB ───────────────────────────
        t_step = time.perf_counter()
        chunk_rows = get_all_project_chunk_ids(project_id)
        relationship_rows = get_all_project_relationships(project_id)
        logger.info(
            "[GRAPH_PIPELINE] ► Step 1/9 — DB load: %d chunks + %d relationships (%.2fms)",
            len(chunk_rows), len(relationship_rows),
            (time.perf_counter() - t_step) * 1000,
        )

        # ── Step 2: Run graph pipeline (igraph + PageRank + Leiden + LLM) ─────
        t_step = time.perf_counter()
        pipeline_result = await run_graph_pipeline(project_id, chunk_rows, relationship_rows)
        logger.info(
            "[GRAPH_PIPELINE] ► Step 2/9 — Graph pipeline: communities=%d chunk_data=%d "
            "rel_summaries=%d (%.2fs)",
            len(pipeline_result.communities),
            len(pipeline_result.chunk_graph_data),
            len(pipeline_result.relationship_data),
            time.perf_counter() - t_step,
        )

        # ── Step 3: Embed community reports ───────────────────────────────────
        t_step = time.perf_counter()
        community_texts = [c.summary for c in pipeline_result.communities]
        if community_texts:
            try:
                community_embeddings = await embed_texts(community_texts)
                for i, comm in enumerate(pipeline_result.communities):
                    if i < len(community_embeddings):
                        comm.summary_embedding = community_embeddings[i]
                logger.info(
                    "[GRAPH_PIPELINE] ► Step 3/9 — Community embeddings: %d vectors (%.2fms)",
                    len(community_embeddings), (time.perf_counter() - t_step) * 1000,
                )
            except Exception as e:
                logger.warning("[GRAPH_PIPELINE] Community embedding failed: %s", e)
                sentry_sdk.capture_exception(e)
        else:
            logger.info("[GRAPH_PIPELINE] ► Step 3/9 — No community reports to embed")

        # ── Step 4: Upsert communities to DB ──────────────────────────────────
        t_step = time.perf_counter()
        community_db_rows = []
        for comm in pipeline_result.communities:
            community_db_rows.append({
                "project_id": project_id,
                "label": comm.label,
                "summary": comm.summary,
                "summary_embedding": comm.summary_embedding or None,
                "member_count": len(comm.member_chunk_ids),
                "level": comm.level,
            })

        label_to_uuid: dict[str, str] = {}
        if community_db_rows:
            label_to_uuid = upsert_communities(project_id, community_db_rows)
            logger.info(
                "[GRAPH_PIPELINE] ► Step 4/9 — Communities upserted: %d rows → %d UUIDs resolved (%.2fms)",
                len(community_db_rows), len(label_to_uuid),
                (time.perf_counter() - t_step) * 1000,
            )
            # Log each community label
            for comm in pipeline_result.communities:
                uid = label_to_uuid.get(comm.label, "NOT_RESOLVED")
                logger.info(
                    "[GRAPH_PIPELINE]   community label=%r members=%d uuid=%s",
                    comm.label, len(comm.member_chunk_ids), uid,
                )
        else:
            logger.info("[GRAPH_PIPELINE] ► Step 4/9 — No communities to upsert")

        # ── Step 5: Embed relationship summaries ──────────────────────────────
        t_step = time.perf_counter()
        rel_texts = [r.summary for r in pipeline_result.relationship_data if r.summary]
        if rel_texts:
            try:
                rel_embeddings = await embed_texts(rel_texts)
                rel_idx = 0
                for rel in pipeline_result.relationship_data:
                    if rel.summary and rel_idx < len(rel_embeddings):
                        rel.embedding = rel_embeddings[rel_idx]
                        rel_idx += 1
                logger.info(
                    "[GRAPH_PIPELINE] ► Step 5/9 — Relationship embeddings: %d vectors (%.2fms)",
                    rel_idx, (time.perf_counter() - t_step) * 1000,
                )
            except Exception as e:
                logger.warning("[GRAPH_PIPELINE] Relationship embedding failed: %s", e)
                sentry_sdk.capture_exception(e)
        else:
            logger.info("[GRAPH_PIPELINE] ► Step 5/9 — No relationship summaries to embed")

        # ── Step 6: Build concept phrase → embedding mappings ─────────────────
        t_step = time.perf_counter()
        chunk_id_lookup: dict[tuple[str, str], str] = {
            (r.get("name", ""), r.get("file_path", "")): str(r["id"])
            for r in chunk_rows
            if r.get("name") and r.get("file_path")
        }

        phrases_to_embed: list[str] = []
        phrase_chunk_mapping: list[tuple[str, int]] = []  # (chunk_id, slot 0/1/2)

        chunks_with_phrases = 0
        for i, summary in enumerate(summaries):
            if not summary.concept_phrases:
                continue
            if i >= len(upserted_rows):
                continue
            row = upserted_rows[i]
            cid = chunk_id_lookup.get((row.get("name", ""), row.get("file_path", "")))
            if not cid:
                continue
            chunks_with_phrases += 1
            for slot, phrase in enumerate(summary.concept_phrases[:3]):
                if phrase:
                    phrases_to_embed.append(phrase)
                    phrase_chunk_mapping.append((cid, slot))

        logger.info(
            "[GRAPH_PIPELINE] ► Step 6/9 — Concept phrases: %d chunks → %d phrases to embed",
            chunks_with_phrases, len(phrases_to_embed),
        )
        # Log a sample of concept phrases for the first 3 chunks
        for i, summary in enumerate(summaries[:3]):
            if summary.concept_phrases:
                logger.info(
                    "[GRAPH_PIPELINE]   sample chunk[%d] concept_phrases=%s",
                    i, summary.concept_phrases,
                )

        concept_embeddings_map: dict[str, list[list[float] | None]] = {}
        if phrases_to_embed:
            try:
                phrase_vecs = await embed_texts(phrases_to_embed)
                for (cid, slot), vec in zip(phrase_chunk_mapping, phrase_vecs):
                    if cid not in concept_embeddings_map:
                        concept_embeddings_map[cid] = [None, None, None]
                    concept_embeddings_map[cid][slot] = vec
                logger.info(
                    "[GRAPH_PIPELINE]   Concept phrase embedding done: %d vectors in %.2fms",
                    len(phrase_vecs), (time.perf_counter() - t_step) * 1000,
                )
            except Exception as e:
                logger.warning("[GRAPH_PIPELINE] Concept phrase embedding failed: %s", e)
                sentry_sdk.capture_exception(e)

        # ── Step 7: Build and write chunk graph data rows ─────────────────────
        t_step = time.perf_counter()
        chunk_graph_write_rows: list[dict] = []
        chunks_with_community = 0
        chunks_with_concept_vecs = 0
        for cgd in pipeline_result.chunk_graph_data:
            community_uuid = label_to_uuid.get(cgd.community_label)
            concept_vecs = concept_embeddings_map.get(cgd.chunk_id, [None, None, None])
            row: dict = {
                "id": cgd.chunk_id,
                "pagerank_score": cgd.pagerank_score,
                "centrality_score": cgd.centrality_score,
            }
            if community_uuid:
                row["community_id"] = community_uuid
                chunks_with_community += 1
            if concept_vecs[0] is not None:
                row["concept_embedding_1"] = concept_vecs[0]
                chunks_with_concept_vecs += 1
            if len(concept_vecs) > 1 and concept_vecs[1] is not None:
                row["concept_embedding_2"] = concept_vecs[1]
            if len(concept_vecs) > 2 and concept_vecs[2] is not None:
                row["concept_embedding_3"] = concept_vecs[2]
            chunk_graph_write_rows.append(row)

        logger.info(
            "[GRAPH_PIPELINE] ► Step 7/9 — Chunk writeback prep: total=%d "
            "with_community=%d with_concept_vecs=%d",
            len(chunk_graph_write_rows), chunks_with_community, chunks_with_concept_vecs,
        )
        update_chunks_graph_data(chunk_graph_write_rows)
        logger.info(
            "[GRAPH_PIPELINE]   Chunk graph data written in %.2fms",
            (time.perf_counter() - t_step) * 1000,
        )

        # ── Step 8: Write relationship embeddings ─────────────────────────────
        t_step = time.perf_counter()
        rel_write_rows = [
            {
                "from_chunk_id": r.from_chunk_id,
                "to_chunk_id": r.to_chunk_id,
                "relationship_type": r.relationship_type,
                "relationship_summary": r.summary,
                "relationship_embedding": r.embedding,
            }
            for r in pipeline_result.relationship_data
            if r.embedding
        ]
        if rel_write_rows:
            update_relationship_embeddings(rel_write_rows)
            logger.info(
                "[GRAPH_PIPELINE] ► Step 8/9 — Relationship embeddings written: %d rows in %.2fms",
                len(rel_write_rows), (time.perf_counter() - t_step) * 1000,
            )
        else:
            logger.info("[GRAPH_PIPELINE] ► Step 8/9 — No relationship embeddings to write")

        # ── Step 9: Invalidate community cache ────────────────────────────────
        invalidate_community_cache(project_id)
        logger.info("[GRAPH_PIPELINE] ► Step 9/9 — Community cache invalidated")

        logger.info(
            "[GRAPH_PIPELINE] ═══ COMPLETE: project=%s communities=%d chunks_with_pagerank=%d "
            "chunks_with_community=%d concept_vecs=%d rel_embeddings=%d total_elapsed=%.2fs ═══",
            project_id,
            len(pipeline_result.communities),
            len(chunk_graph_write_rows),
            chunks_with_community,
            chunks_with_concept_vecs,
            len(rel_write_rows),
            time.perf_counter() - t0,
        )

    except Exception as e:
        sentry_sdk.capture_exception(e)
        logger.error("[GRAPH_PIPELINE] Pipeline failed (non-fatal): %s", e, exc_info=True)


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
