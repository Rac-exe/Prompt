"""
Mode-aware retrieval engine.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

import litellm
import sentry_sdk

from app.config import (
    FIND_BOOST_BODY,
    FIND_BOOST_CONCEPT,
    FIND_BOOST_LEXICAL,
    FIND_BOOST_PATH,
    FIND_BOOST_SIGNAL,
    FIND_BOOST_SIGNATURE,
    FIND_DOMAIN_SIGNAL_TERMS,
    FIND_MIN_SCORE,
    FIND_PAGERANK_WEIGHT,
    FIND_PENALTY_MISS,
    GRAPH_BUILDER_ENABLED,
    ITERATIVE_REFINEMENT_THRESHOLD,
    MAX_ITERATIONS,
    OPENROUTER_API_KEY,
    PIPELINE_TAG,
    QUERY_REFINER_MODEL,
    STRUCTURE_SIMILARITY_WEIGHT,
)
from app.db.models import ModeEnum, RetrievedChunk, RetrieveResponse
from app.db.queries import (
    concept_search,
    file_path_search,
    get_branch_context,
    get_chunk_structure_embeddings,
    get_community_members_ranked,
    get_related_chunks_multihop,
    hydrate_chunks_by_ids,
    increment_observation_counts,
    match_community_reports,
    match_concept_embeddings,
    text_search,
    vector_search,
)
from app.services.community import format_community_context, get_cached_community_reports, set_cached_community_reports
from app.services.answer_generator import generate_answer
from app.services.concepts import CONCEPT_KEYWORDS, detect_concepts_from_query
from app.services.embedding import embed_structure_texts, embed_texts
from app.services.feedback import record_search
from app.services.mode_router import ModeConfig, get_mode_config
from app.services.query_analyzer import QueryAnalysis, decompose_query
from app.services.query_preprocessor import QuerySignals, build_file_patterns, preprocess_query
from app.services.reranker import rerank_chunks
from app.services import prmpt_ai_client

logger = logging.getLogger("code-intel.search")

MIN_RESPONSE_RELEVANCE = 0.10
_FIND_MIN_RESULTS_FLOOR = 8
# Drop tail candidates whose raw composite score is below this fraction of the
# top match, but only after the recall floor is met (noise suppression).
_FIND_TAIL_FRACTION = float(os.environ.get("FIND_TAIL_FRACTION", "0.45"))
# Allow very strong same-file matches past per-file cap (prevents exact routes
# from being dropped when other symbols from the same file rank first).
_FIND_STRONG_FRACTION = float(os.environ.get("FIND_STRONG_FRACTION", "0.60"))

_FIND_STOP_WORDS = {
    "where", "what", "which", "when", "why", "how", "find", "show",
    "list", "happening", "happen", "happens", "used", "using", "usage",
    "workflow", "workflows", "code", "base", "codebase", "there", "here",
    "the", "and", "or", "is", "are", "can", "could", "would", "should",
    "i", "me", "my", "a", "an", "to", "of", "in", "on", "for", "with",
    "section", "sections", "exist", "exists", "locate", "located", "show",
}

_FIND_GENERIC_CONCEPTS = {"search"}


@dataclass
class FullSearchResult:
    ranked_chunks: list[dict]
    related_chunks: list[dict]
    branch_context: Optional[dict]
    query_intent: str = "general"
    query_concepts: list[str] = field(default_factory=list)
    mode: ModeEnum = ModeEnum.BUG
    answer: str | None = None
    source_ids: list[str] = field(default_factory=list)
    search_id: str | None = None


@dataclass(frozen=True)
class FindQueryPlan:
    scope_all: bool
    wants_route_handlers: bool
    http_methods: set[str]
    domain_terms: set[str]
    explicit_generic_symbols: set[str]

    @property
    def has_constraints(self) -> bool:
        return bool(self.wants_route_handlers or self.http_methods or self.domain_terms)


async def retrieve_context(
    project_id: str,
    user_id: str,
    query: str,
    branch: Optional[str] = None,
    limit: int = 10,
    signals: Optional[QuerySignals] = None,
    mode: ModeEnum | str = ModeEnum.BUG,
    variant: str | None = None,
) -> RetrieveResponse:
    full = await retrieve_context_full(project_id, user_id, query, branch, limit, signals, mode, variant=variant)
    return RetrieveResponse(
        ranked_chunks=[_to_retrieved_chunk(c) for c in full.ranked_chunks],
        related_chunks=[_to_retrieved_chunk(c, score=0.0) for c in full.related_chunks],
        branch_context=full.branch_context,
        query_intent=full.query_intent,
        query_concepts=full.query_concepts,
    )


async def retrieve_context_full(
    project_id: str,
    user_id: str,
    query: str,
    branch: Optional[str] = None,
    limit: int = 10,
    signals: Optional[QuerySignals] = None,
    mode: ModeEnum | str = ModeEnum.BUG,
    project_summary: str | None = None,
    variant: str | None = None,
) -> FullSearchResult:
    mode_enum = mode if isinstance(mode, ModeEnum) else ModeEnum(mode)
    config = get_mode_config(mode_enum, variant)
    signals = signals or preprocess_query(query)
    logger.info(
        "[RETRIEVE] start project=%s mode=%s limit=%s branch=%s vector=%s rerank=%s refine=%s graph=%s",
        project_id,
        mode_enum.value,
        limit,
        branch,
        config.vector_search,
        config.rerank,
        config.refine,
        config.graph_expand,
    )
    analysis = QueryAnalysis(intent=mode_enum.value, sub_queries=[query], concepts=_detect_concepts(query))
    concepts = analysis.concepts or _detect_concepts(query)
    if mode_enum == ModeEnum.FIND:
        concepts = _normalize_find_concepts(query, concepts)
    sub_queries = analysis.sub_queries or [query]

    # ── Graph-aware retrieval paths (GRAPH_BUILDER_ENABLED=true) ─────────────
    if GRAPH_BUILDER_ENABLED and config.search_path != "flat":
        try:
            graph_result = await _dispatch_graph_search(
                project_id=project_id,
                query=query,
                mode_enum=mode_enum,
                config=config,
                concepts=concepts,
                limit=limit,
                branch=branch,
                signals=signals,
                user_id=user_id,
                project_summary=project_summary,
                variant=variant,
                analysis=analysis,
            )
            if graph_result is not None:
                return graph_result
            # Fall through to flat retrieval if graph search returned nothing
            logger.info("[RETRIEVE] Graph search returned no results, falling back to flat")
        except Exception as e:
            sentry_sdk.capture_exception(e)
            logger.warning(
                "[RETRIEVE] Graph search failed (%s), falling back to flat retrieval", e
            )

    decompose_task: asyncio.Task[QueryAnalysis] | None = None
    if _should_run_decompose(query, config):
        decompose_task = asyncio.create_task(decompose_query(query))
        logger.info("[RETRIEVE] decompose started in parallel with first-pass recall")

    logger.info(
        "[RETRIEVE] analysis intent=%s sub_queries=%s concepts=%s",
        analysis.intent,
        sub_queries,
        concepts,
    )
    candidates, query_embedding = await _broad_recall(
        project_id, user_id, query, sub_queries, concepts, signals, branch, config
    )
    logger.info(
        "[RETRIEVE] broad_recall lists=%d candidates=%d query_embedding=%s",
        len(candidates),
        sum(len(c) for c in candidates),
        "yes" if query_embedding else "no",
    )

    ranked = await _rank_candidates(candidates, query, mode_enum, config, limit, project_id, user_id, concepts)
    ranked = _filter_response_relevance(ranked)
    logger.info(
        "[RETRIEVE] ranked_after_first_pass=%d top=%s score=%.4f min_response_relevance=%.2f",
        len(ranked),
        ranked[0].get("name") if ranked else None,
        _score(ranked[0]) if ranked else 0.0,
        MIN_RESPONSE_RELEVANCE,
    )

    # FIND mode: if first-pass lexical/path recall is too thin, run one bounded
    # vector fallback pass to recover missed but semantically related symbols.
    if mode_enum == ModeEnum.FIND and len(ranked) < _find_target_count(limit):
        fallback_lists, fallback_embedding = await _find_vector_fallback_recall(
            project_id=project_id,
            user_id=user_id,
            query=query,
            branch=branch,
            broad_limit=max(limit * 3, 24),
        )
        if fallback_lists:
            ranked = await _rank_candidates(
                [[*ranked], *fallback_lists],
                query,
                mode_enum,
                config,
                limit,
                project_id,
                user_id,
                concepts,
            )
            ranked = _filter_response_relevance(ranked)
            if query_embedding is None and fallback_embedding is not None:
                query_embedding = fallback_embedding
            logger.info(
                "[RETRIEVE] find vector fallback applied: ranked_now=%d fallback_lists=%d",
                len(ranked),
                len(fallback_lists),
            )

    top_score = _score(ranked[0]) if ranked else 0.0
    decompose_second_pass_ran = False
    if decompose_task and top_score < ITERATIVE_REFINEMENT_THRESHOLD:
        try:
            decompose_analysis = await decompose_task
            decompose_sub_queries = decompose_analysis.sub_queries or [query]
            decompose_concepts = decompose_analysis.concepts or concepts
            if mode_enum == ModeEnum.FIND:
                decompose_concepts = _normalize_find_concepts(query, decompose_concepts)
            if (
                decompose_sub_queries != sub_queries
                or set(decompose_concepts) != set(concepts)
            ):
                logger.info(
                    "[RETRIEVE] decompose second-pass triggered: top_score=%.3f threshold=%.3f sub_queries=%s",
                    top_score,
                    ITERATIVE_REFINEMENT_THRESHOLD,
                    decompose_sub_queries,
                )
                decomposed_candidates, _ = await _broad_recall(
                    project_id,
                    user_id,
                    query,
                    decompose_sub_queries,
                    decompose_concepts,
                    signals,
                    branch,
                    config,
                )
                ranked = await _rank_candidates(
                    [[*ranked], *decomposed_candidates],
                    query,
                    mode_enum,
                    config,
                    limit,
                    project_id,
                    user_id,
                    decompose_concepts,
                )
                ranked = _filter_response_relevance(ranked)
                analysis = decompose_analysis
                concepts = decompose_concepts
                decompose_second_pass_ran = True
        except Exception as e:
            logger.warning("[RETRIEVE] decompose second-pass failed: %s", e)
            sentry_sdk.capture_exception(e)
    elif decompose_task:
        if not decompose_task.done():
            decompose_task.cancel()
        logger.info(
            "[RETRIEVE] decompose skipped second-pass: top_score=%.3f threshold=%.3f",
            top_score,
            ITERATIVE_REFINEMENT_THRESHOLD,
        )

    if decompose_second_pass_ran and config.refine:
        # The decompose second-pass already executed a full sub-query recall + rerank.
        # Running the refine round immediately after is largely redundant work and is
        # the single biggest avoidable latency cost in Ask/Bug. Skip it.
        logger.info("[REFINE] skipped: decompose second-pass already ran (avoids double recall)")
    if config.refine and not decompose_second_pass_ran and _should_refine(query, ranked, mode_enum):
        refined_queries = await _refine_sub_queries(query, ranked[:3], mode_enum)
        if refined_queries:
            logger.info(
                "[REFINE] Running second-pass recall: mode=%s, queries=%s",
                mode_enum.value,
                refined_queries,
            )
            refined_candidates, _ = await _broad_recall(
                project_id,
                user_id,
                query,
                refined_queries,
                concepts,
                signals,
                branch,
                config,
            )
            ranked = await _rank_candidates(
                [[*ranked], *refined_candidates],
                query,
                mode_enum,
                config,
                limit,
                project_id,
                user_id,
                concepts,
            )
            ranked = _filter_response_relevance(ranked)
            logger.info(
                "[REFINE] second_pass_complete ranked=%d top=%s score=%.4f",
                len(ranked),
                ranked[0].get("name") if ranked else None,
                _score(ranked[0]) if ranked else 0.0,
            )
        else:
            logger.info("[REFINE] skipped_after_trigger no refined queries returned")

    ranked = _hydrate_ranked_chunks(ranked, project_id, user_id, limit)

    related = []
    if config.graph_expand and ranked:
        seed_ids = [str(c["id"]) for c in ranked[: config.graph_seeds]]
        related = get_related_chunks_multihop(
            seed_ids,
            project_id,
            max_depth=config.graph_depth,
            max_total=config.graph_max,
        )
        ranked_ids = {c["id"] for c in ranked}
        related = [r for r in related if r["id"] not in ranked_ids]
        if related and config.rerank:
            related = await rerank_chunks(query, related, mode_enum, min(len(related), config.graph_max))
        logger.info(
            "[GRAPH] expanded seeds=%d related=%d depth=%d max=%d",
            len(seed_ids),
            len(related),
            config.graph_depth,
            config.graph_max,
        )
    else:
        logger.info("[GRAPH] skipped graph_expand=%s ranked=%d", config.graph_expand, len(ranked))

    top_ids = [str(c["id"]) for c in ranked[:5] if c.get("id")]
    increment_observation_counts(top_ids)
    search_id = record_search(
        project_id,
        user_id,
        query,
        mode_enum.value,
        [str(c["id"]) for c in ranked if c.get("id")],
        query_embedding,
        variant=variant or PIPELINE_TAG,
    )

    answer = None
    source_ids: list[str] = []
    if config.generate_answer:
        answer, source_ids = await generate_answer(query, ranked, project_summary)
        logger.info(
            "[ANSWER] generated=%s sources=%d",
            "yes" if answer else "no",
            len(source_ids),
        )

    logger.info(
        "[RETRIEVE] complete project=%s mode=%s ranked=%d related=%d search_id=%s",
        project_id,
        mode_enum.value,
        min(len(ranked), limit),
        len(related),
        search_id,
    )

    return FullSearchResult(
        ranked_chunks=ranked[:limit],
        related_chunks=related,
        branch_context=get_branch_context(project_id, branch),
        query_intent=analysis.intent,
        query_concepts=concepts,
        mode=mode_enum,
        answer=answer,
        source_ids=source_ids,
        search_id=search_id,
    )


# ── Graph-aware search paths ─────────────────────────────────────────────────

async def _local_search(
    project_id: str,
    query: str,
    query_embedding: list[float],
    mode_config,
    concepts: list[str],
    limit: int,
) -> list[dict]:
    """
    Local Search: anchor discovery → community scope → PageRank ranking.

    1. Find anchor chunks via concept embedding similarity + name exact-match.
    2. Identify which communities the anchors belong to.
    3. Retrieve all community members (PageRank-ordered by DB RPC).
    4. Merge anchors + members, apply Personalized PageRank boost on name-match.
    5. Return top-ranked list.
    """
    import time as _time
    t0 = _time.perf_counter()
    logger.info("[LOCAL_SEARCH] ► Start: project=%s query=%r", project_id, query[:60])

    # Step 1: concept embedding search for anchors
    concept_anchors = await asyncio.to_thread(
        match_concept_embeddings, project_id, query_embedding, 15
    )
    logger.info(
        "[LOCAL_SEARCH]   concept_anchors=%d (%.0fms)",
        len(concept_anchors), (_time.perf_counter() - t0) * 1000,
    )

    # Step 2: also run standard vector search for anchors
    t1 = _time.perf_counter()
    vector_anchors = await asyncio.to_thread(
        vector_search, project_id, "", query_embedding, 10
    )
    logger.info(
        "[LOCAL_SEARCH]   vector_anchors=%d (%.0fms)",
        len(vector_anchors), (_time.perf_counter() - t1) * 1000,
    )

    # Merge anchors by ID, concept match takes precedence for scoring
    seen: dict[str, dict] = {}
    for chunk in concept_anchors:
        cid = str(chunk.get("id", ""))
        if cid:
            chunk["_is_concept_anchor"] = True
            seen[cid] = chunk
    for chunk in vector_anchors:
        cid = str(chunk.get("id", ""))
        if cid and cid not in seen:
            seen[cid] = chunk

    anchors = list(seen.values())
    logger.info(
        "[LOCAL_SEARCH]   merged anchors=%d (concept=%d vector=%d)",
        len(anchors), len(concept_anchors), len(vector_anchors),
    )

    # Step 3: collect unique community IDs from anchors
    community_ids: list[str] = list(dict.fromkeys(
        str(a["community_id"]) for a in anchors
        if a.get("community_id")
    ))
    logger.info("[LOCAL_SEARCH]   communities_from_anchors=%d ids=%s", len(community_ids), community_ids[:3])

    # Step 4: fetch all community members, ranked by PageRank
    t1 = _time.perf_counter()
    community_chunks: list[dict] = []
    for comm_id in community_ids[:3]:   # cap at 3 communities
        members = await asyncio.to_thread(
            get_community_members_ranked, comm_id, mode_config.broad_limit
        )
        community_chunks.extend(members)
        logger.info("[LOCAL_SEARCH]   community=%s members_fetched=%d", comm_id, len(members))

    logger.info(
        "[LOCAL_SEARCH]   total community members fetched=%d (%.0fms)",
        len(community_chunks), (_time.perf_counter() - t1) * 1000,
    )

    # Merge anchors + community chunks (anchors first to preserve relevance signals)
    all_chunks: dict[str, dict] = {}
    for chunk in community_chunks:
        cid = str(chunk.get("id", ""))
        if cid:
            all_chunks[cid] = chunk
    for chunk in anchors:
        cid = str(chunk.get("id", ""))
        if cid:
            existing = all_chunks.get(cid, {})
            all_chunks[cid] = {**existing, **chunk}

    if not all_chunks:
        logger.info("[LOCAL_SEARCH] ◄ No chunks found — returning empty")
        return []

    # Step 5: Personalized PageRank — boost chunks whose name matches query terms
    query_terms = _find_terms(query)
    result_chunks = list(all_chunks.values())
    name_boosted = 0
    for chunk in result_chunks:
        pr = float(chunk.get("pagerank_score") or 0.0)
        name_lower = (chunk.get("name") or "").lower()
        name_match = any(term in name_lower for term in query_terms)
        # Personalized boost: if the name matches the query, double the PageRank weight
        personalized_pr = pr * 2.0 if name_match else pr
        if name_match:
            name_boosted += 1
        concept_sim = float(chunk.get("concept_similarity") or 0.0)
        vec_sim = float(chunk.get("similarity") or 0.0)
        chunk["final_score"] = max(personalized_pr, concept_sim, vec_sim)

    result_chunks.sort(key=lambda c: c.get("final_score", 0), reverse=True)
    top_results = result_chunks[:limit]

    logger.info(
        "[LOCAL_SEARCH] ◄ Done: total_pool=%d name_boosted=%d returning=%d elapsed=%.0fms | "
        "top3: %s",
        len(result_chunks), name_boosted, len(top_results),
        (_time.perf_counter() - t0) * 1000,
        ", ".join(
            f"{c.get('name','?')}({c.get('final_score', 0):.3f})" for c in top_results[:3]
        ),
    )
    return top_results


async def _global_search(
    project_id: str,
    query: str,
    query_embedding: list[float],
    limit: int,
) -> tuple[list[dict], list[dict]]:
    """
    Global Search: match community reports by embedding → return reports + member chunks.

    Returns:
        (community_reports, member_chunks)
        community_reports — list of CommunityReport dicts with summary text
        member_chunks     — top PageRank members from matched communities
    """
    import time as _time
    t0 = _time.perf_counter()
    logger.info("[GLOBAL_SEARCH] ► Start: project=%s query=%r", project_id, query[:60])

    # Check cache first
    cached = get_cached_community_reports(project_id)
    if cached is not None:
        community_reports = cached
        logger.info("[GLOBAL_SEARCH]   community_reports from cache: %d", len(community_reports))
    else:
        community_reports = await asyncio.to_thread(
            match_community_reports, project_id, query_embedding, 5
        )
        set_cached_community_reports(project_id, community_reports)
        logger.info(
            "[GLOBAL_SEARCH]   community_reports from DB: %d (%.0fms)",
            len(community_reports), (_time.perf_counter() - t0) * 1000,
        )

    if not community_reports:
        logger.info("[GLOBAL_SEARCH] ◄ No community reports found — returning empty")
        return [], []

    for report in community_reports[:3]:
        logger.info(
            "[GLOBAL_SEARCH]   report label=%r similarity=%.3f summary_preview=%r",
            report.get("label", "?"),
            report.get("similarity", 0.0),
            (report.get("summary") or "")[:100],
        )

    # Fetch member chunks from top 2 matching communities
    member_chunks: list[dict] = []
    for report in community_reports[:2]:
        comm_id = str(report.get("id", ""))
        if not comm_id:
            continue
        members = await asyncio.to_thread(
            get_community_members_ranked, comm_id, max(limit // 2, 5)
        )
        member_chunks.extend(members)
        logger.info(
            "[GLOBAL_SEARCH]   community=%s label=%r fetched=%d members",
            comm_id, report.get("label", "?"), len(members),
        )

    # Deduplicate
    seen_ids: set[str] = set()
    unique_members: list[dict] = []
    for chunk in member_chunks:
        cid = str(chunk.get("id", ""))
        if cid and cid not in seen_ids:
            seen_ids.add(cid)
            unique_members.append(chunk)

    logger.info(
        "[GLOBAL_SEARCH] ◄ Done: reports=%d member_chunks=%d elapsed=%.0fms",
        len(community_reports), len(unique_members),
        (_time.perf_counter() - t0) * 1000,
    )
    return community_reports, unique_members


async def _drift_search(
    project_id: str,
    query: str,
    query_embedding: list[float],
    mode_config,
    concepts: list[str],
    limit: int,
) -> tuple[list[dict], str | None]:
    """
    DRIFT Search for BUG mode: Primer (global context) → Follow-up (local × n) → Merge.

    PRIMER:
      - Retrieve top community reports.
      - Feed community context to LLM to get: broad answer + 2-3 follow-up questions.

    FOLLOW-UP:
      - Run _local_search for each follow-up question in parallel.

    MERGE:
      - Combine all retrieved chunks, deduplicate, sort by PageRank.
      - Attach community context string for the answer generator.

    Returns:
        (ranked_chunks, community_context_string)
    """
    import time as _time
    t0 = _time.perf_counter()
    logger.info("[DRIFT_SEARCH] ► Start: project=%s query=%r", project_id, query[:60])

    # PRIMER: global community context
    community_reports, primer_members = await _global_search(
        project_id, query, query_embedding, limit
    )
    logger.info(
        "[DRIFT_SEARCH]   PRIMER: reports=%d primer_members=%d (%.0fms)",
        len(community_reports), len(primer_members),
        (_time.perf_counter() - t0) * 1000,
    )

    community_context = format_community_context(community_reports, max_reports=2)

    # Generate follow-up questions from community context
    follow_up_queries: list[str] = []
    if community_reports:
        try:
            t1 = _time.perf_counter()
            follow_up_queries = await _generate_drift_followups(
                query, community_context, primer_members[:3]
            )
            logger.info(
                "[DRIFT_SEARCH]   Follow-up Qs generated: %d in %.0fms",
                len(follow_up_queries), (_time.perf_counter() - t1) * 1000,
            )
        except Exception as e:
            logger.warning("[DRIFT_SEARCH] Follow-up generation failed: %s", e)
            sentry_sdk.capture_exception(e)

    if not follow_up_queries:
        follow_up_queries = [query]
        logger.info("[DRIFT_SEARCH]   No follow-ups generated — using original query as fallback")

    for i, fq in enumerate(follow_up_queries):
        logger.info("[DRIFT_SEARCH]   follow_up[%d]: %r", i, fq[:80])

    # FOLLOW-UP: embed and run local search for each question in parallel
    try:
        followup_embeddings = await embed_texts([query] + follow_up_queries)
        logger.info("[DRIFT_SEARCH]   Embedded %d follow-up queries", len(followup_embeddings))
    except Exception as e:
        logger.warning("[DRIFT_SEARCH] Follow-up embedding failed: %s", e)
        sentry_sdk.capture_exception(e)
        followup_embeddings = [query_embedding] * (1 + len(follow_up_queries))

    local_tasks = []
    all_fqs = [query] + follow_up_queries
    for i, fq in enumerate(all_fqs):
        emb = followup_embeddings[i] if i < len(followup_embeddings) else query_embedding
        local_tasks.append(
            _local_search(project_id, fq, emb, mode_config, concepts, limit // 2)
        )

    t1 = _time.perf_counter()
    local_results = await asyncio.gather(*local_tasks, return_exceptions=True)
    logger.info(
        "[DRIFT_SEARCH]   Follow-up local searches done: %d tasks in %.0fms",
        len(local_tasks), (_time.perf_counter() - t1) * 1000,
    )

    # MERGE: deduplicate + PageRank order
    merged: dict[str, dict] = {}
    per_query_counts: list[int] = []
    for i, result in enumerate(local_results):
        if isinstance(result, BaseException):
            logger.warning("[DRIFT_SEARCH] Local search[%d] failed: %s", i, result)
            per_query_counts.append(0)
            continue
        count = 0
        for chunk in result:
            cid = str(chunk.get("id", ""))
            if cid and cid not in merged:
                merged[cid] = chunk
                count += 1
        per_query_counts.append(count)

    logger.info(
        "[DRIFT_SEARCH]   Per-query new chunks: %s",
        ", ".join(f"Q{i}={n}" for i, n in enumerate(per_query_counts)),
    )

    # Include primer members (may have chunks not in local results)
    primer_added = 0
    for chunk in primer_members:
        cid = str(chunk.get("id", ""))
        if cid and cid not in merged:
            chunk["final_score"] = float(chunk.get("pagerank_score") or 0.0)
            merged[cid] = chunk
            primer_added += 1

    ranked = sorted(merged.values(), key=lambda c: c.get("final_score", 0), reverse=True)
    final = ranked[:limit]

    logger.info(
        "[DRIFT_SEARCH] ◄ Done: merged_pool=%d primer_added=%d returning=%d elapsed=%.0fms | "
        "top3: %s",
        len(merged), primer_added, len(final),
        (_time.perf_counter() - t0) * 1000,
        ", ".join(
            f"{c.get('name','?')}({c.get('final_score',0):.3f})" for c in final[:3]
        ),
    )
    return final, community_context


async def _generate_drift_followups(
    query: str,
    community_context: str,
    top_chunks: list[dict],
) -> list[str]:
    """
    Use the LLM to generate 2-3 follow-up questions for DRIFT search.
    These questions drill into the specific code paths relevant to the bug.
    """
    chunk_summaries = [
        f"- {c.get('name', '?')} ({c.get('file_path', '?')}): "
        f"{(c.get('summary_code') or c.get('semantic_summary') or '')[:100]}"
        for c in top_chunks[:3]
    ]

    kwargs: dict = {
        "model": QUERY_REFINER_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You help diagnose code bugs by generating targeted follow-up search queries. "
                    "Given the original query, relevant subsystem context, and initial results, "
                    "generate 2-3 focused follow-up questions that would help find the root cause. "
                    "Focus on: data flow, error paths, shared state, and execution order. "
                    "Return strict JSON: {\"follow_ups\": [\"...\", ...]}"
                ),
            },
            {
                "role": "user",
                "content": json.dumps({
                    "query": query[:1000],
                    "subsystem_context": community_context[:800],
                    "initial_results": chunk_summaries,
                }),
            },
        ],
        "max_tokens": 300,
        "temperature": 0.1,
    }
    if OPENROUTER_API_KEY and "openrouter" in QUERY_REFINER_MODEL.lower():
        kwargs["api_key"] = OPENROUTER_API_KEY

    if prmpt_ai_client.is_configured():
        raw = (await prmpt_ai_client.completion_async(**kwargs)).strip()
    else:
        response = await asyncio.to_thread(litellm.completion, **kwargs)
        raw = (response.choices[0].message.content or "").strip()
    data = json.loads(_strip_json_fence(raw))
    follow_ups = data.get("follow_ups", [])
    if not isinstance(follow_ups, list):
        return []
    return [str(fq).strip()[:500] for fq in follow_ups if isinstance(fq, str)][:3]


async def _dispatch_graph_search(
    project_id: str,
    query: str,
    mode_enum: ModeEnum,
    config,
    concepts: list[str],
    limit: int,
    branch: Optional[str],
    signals,
    user_id: str,
    project_summary: str | None,
    variant: str | None,
    analysis,
) -> Optional[FullSearchResult]:
    """
    Route to the appropriate graph search path and build a FullSearchResult.
    Returns None if no results found (caller falls back to flat retrieval).
    """
    # Embed the query once
    try:
        embeddings = await embed_texts([query])
        query_embedding = embeddings[0] if embeddings else None
    except Exception as e:
        logger.warning("[GRAPH_DISPATCH] Embedding failed: %s", e)
        return None

    if not query_embedding:
        return None

    ranked: list[dict] = []
    community_context: str | None = None
    search_path = config.search_path

    if search_path == "local" or search_path == "local_centrality":
        ranked = await _local_search(
            project_id, query, query_embedding, config, concepts, limit * 2
        )

    elif search_path == "global":
        community_reports, member_chunks = await _global_search(
            project_id, query, query_embedding, limit * 2
        )
        ranked = member_chunks
        if community_reports:
            community_context = format_community_context(community_reports, max_reports=2)

    elif search_path == "drift":
        ranked, community_context = await _drift_search(
            project_id, query, query_embedding, config, concepts, limit * 2
        )

    if not ranked:
        logger.info("[GRAPH_DISPATCH] path=%s returned no ranked chunks — falling back", search_path)
        return None

    # Quality gate: if the top result has no meaningful score, the graph search
    # didn't produce useful results (e.g. concept embeddings not yet populated).
    # Return None so the caller falls back to flat retrieval.
    top_score = _score(ranked[0]) if ranked else 0.0
    if top_score < MIN_RESPONSE_RELEVANCE:
        logger.info(
            "[GRAPH_DISPATCH] path=%s top_score=%.4f below threshold=%.2f — falling back to flat",
            search_path, top_score, MIN_RESPONSE_RELEVANCE,
        )
        return None

    # Hydrate chunks that don't have code_body yet
    chunk_ids_needing_hydration = [
        str(c["id"]) for c in ranked if c.get("id") and not c.get("code_body")
    ]
    if chunk_ids_needing_hydration:
        hydrated = hydrate_chunks_by_ids(
            chunk_ids_needing_hydration[:limit], project_id, user_id
        )
        hydrated_by_id = {str(h["id"]): h for h in hydrated}
        ranked = [
            {**hydrated_by_id.get(str(c.get("id", "")), {}), **c}
            if not c.get("code_body") else c
            for c in ranked
        ]

    ranked = _filter_response_relevance(ranked) or ranked[:limit]
    ranked = ranked[:limit]

    top_ids = [str(c["id"]) for c in ranked[:5] if c.get("id")]
    increment_observation_counts(top_ids)

    search_id = record_search(
        project_id,
        user_id,
        query,
        mode_enum.value,
        [str(c["id"]) for c in ranked if c.get("id")],
        query_embedding,
        variant=variant or PIPELINE_TAG,
    )

    answer = None
    source_ids: list[str] = []
    if config.generate_answer:
        # Inject community context into project_summary for richer answers
        effective_summary = project_summary
        if community_context:
            effective_summary = f"{community_context}\n\n{project_summary or ''}".strip()
        answer, source_ids = await generate_answer(query, ranked, effective_summary)

    logger.info(
        "[GRAPH_DISPATCH] path=%s ranked=%d search_id=%s",
        search_path, len(ranked), search_id,
    )

    return FullSearchResult(
        ranked_chunks=ranked,
        related_chunks=[],
        branch_context=get_branch_context(project_id, branch),
        query_intent=analysis.intent,
        query_concepts=concepts,
        mode=mode_enum,
        answer=answer,
        source_ids=source_ids,
        search_id=search_id,
    )


async def _rank_candidates(
    candidates: list[list[dict]],
    query: str,
    mode: ModeEnum,
    config: ModeConfig,
    limit: int,
    project_id: str,
    user_id: str,
    concepts: list[str],
) -> list[dict]:
    fused = _reciprocal_rank_fusion(*candidates) if len(candidates) > 1 else (candidates[0] if candidates else [])
    logger.info(
        "[RANK] fused lists=%d unique=%d mode=%s",
        len(candidates),
        len(fused),
        mode.value,
    )
    for c in fused:
        c["final_score"] = c.get("final_score", c.get("rrf_score", c.get("similarity", c.get("rank", 0))))

    ranked = fused
    rank_limit = max(limit, config.rerank_limit if mode != ModeEnum.FIND else limit)
    if mode == ModeEnum.FIND:
        find_plan = _build_find_query_plan(query)
        ranked = _rank_find_candidates(
            fused,
            query,
            _normalize_find_concepts(query, _detect_concepts(query)),
            rank_limit,
            find_plan,
        )
        before = len(ranked)
        # Filter on the raw composite (absolute, pre-normalization) so recall
        # behavior is unchanged; the relative display score is for ranking spread.
        strict_ranked = [c for c in ranked if c.get("_find_raw", 0.0) >= FIND_MIN_SCORE]
        ranked = strict_ranked
        target_count = _find_target_count(rank_limit)
        if len(ranked) < target_count and before > len(ranked):
            relaxed_threshold = max(0.20, FIND_MIN_SCORE - 0.15)
            relaxed_ranked = [c for c in ranked if c.get("_find_raw", 0.0) >= relaxed_threshold]
            if len(relaxed_ranked) < target_count:
                relaxed_ranked = [
                    c
                    for c in _rank_find_candidates(
                        fused,
                        query,
                        _normalize_find_concepts(query, _detect_concepts(query)),
                        rank_limit,
                        find_plan,
                    )
                    if c.get("_find_raw", 0.0) >= relaxed_threshold
                ]
            if len(relaxed_ranked) > len(ranked):
                ranked = relaxed_ranked
                logger.info(
                    "[RANK] find threshold relaxed to %.2f to avoid thin recall (target=%d got=%d)",
                    relaxed_threshold,
                    target_count,
                    len(ranked),
                )
        if len(ranked) < target_count and before:
            ranked = _rank_find_candidates(
                fused,
                query,
                _normalize_find_concepts(query, _detect_concepts(query)),
                rank_limit,
                find_plan,
            )[:target_count]
            logger.info(
                "[RANK] find backfill applied to reach target=%d (now=%d)",
                target_count,
                len(ranked),
            )
        ranked = _postprocess_find_ranked(ranked, query, rank_limit, find_plan)
        strict_hits = (
            sum(1 for c in ranked if _chunk_matches_find_constraints(c, find_plan))
            if find_plan.has_constraints else 0
        )
        logger.info(
            "[RANK] find ranking applied limit=%d before_filter=%d after_filter=%d threshold=%.2f constraints=%s strict_hits=%d",
            rank_limit,
            before,
            len(ranked),
            FIND_MIN_SCORE,
            find_plan.has_constraints,
            strict_hits,
        )
        return ranked[:rank_limit]
    if config.rerank:
        ranked = _hydrate_ranked_chunks(fused, project_id, user_id, min(len(fused), 60))
        ranked = await _attach_structure_similarity(ranked, query, concepts, project_id, user_id)
        ranked = await rerank_chunks(query, ranked, mode, rank_limit)
        ranked = _blend_structure_similarity(ranked)
        logger.info("[RANK] rerank applied limit=%d returned=%d", rank_limit, len(ranked))
    else:
        logger.info("[RANK] rerank skipped")
    if config.mmr:
        ranked = _mmr(ranked, config.mmr_lambda, rank_limit)
        logger.info("[RANK] mmr applied lambda=%.2f returned=%d", config.mmr_lambda, len(ranked))
    else:
        logger.info("[RANK] mmr skipped")
    return ranked[:rank_limit]


def _should_refine(query: str, ranked: list[dict], mode: ModeEnum) -> bool:
    if mode == ModeEnum.FIND or not ranked:
        return False

    top_score = ranked[0].get("final_score", ranked[0].get("similarity_score", ranked[0].get("similarity", 0)))
    try:
        top_score = float(top_score)
    except (TypeError, ValueError):
        top_score = 0.0

    if top_score < ITERATIVE_REFINEMENT_THRESHOLD:
        logger.info("[REFINE] Triggered by low confidence: %.3f", top_score)
        return True

    # Complex multi-entity queries often need a second pass even if the first
    # result looks plausible, because the first pass can over-focus on one entity.
    words = query.split()
    separators = query.count(" and ") + query.count(" or ") + query.count(",")
    if len(words) > 30 and separators >= 2:
        logger.info("[REFINE] Triggered by complex query: words=%d separators=%d", len(words), separators)
        return True

    return False


async def _refine_sub_queries(query: str, top_chunks: list[dict], mode: ModeEnum) -> list[str]:
    context = []
    for idx, chunk in enumerate(top_chunks):
        context.append({
            "rank": idx + 1,
            "score": round(_score(chunk), 3),
            "file_path": chunk.get("file_path"),
            "name": chunk.get("name"),
            "summary": chunk.get("summary_code") or chunk.get("semantic_summary"),
            "purpose": chunk.get("summary_purpose"),
            "reason": chunk.get("relevance_reasoning"),
        })

    kwargs: dict = {
        "model": QUERY_REFINER_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You refine code search queries. Given the original query and top initial results, "
                    "return strict JSON: {\"sub_queries\": [\"...\"]}. Include 1-2 additional searches "
                    "that cover missing files, data flow, ownership checks, callers, or integration points. "
                    "Do not repeat the original query."
                ),
            },
            {
                "role": "user",
                "content": json.dumps({
                    "mode": mode.value,
                    "query": query[:3000],
                    "top_results": context,
                }),
            },
        ],
        "max_tokens": 240,
        "temperature": 0.1,
    }
    if OPENROUTER_API_KEY and "openrouter" in QUERY_REFINER_MODEL.lower():
        kwargs["api_key"] = OPENROUTER_API_KEY

    try:
        if prmpt_ai_client.is_configured():
            raw = (await prmpt_ai_client.completion_async(**kwargs)).strip()
        else:
            response = await asyncio.to_thread(litellm.completion, **kwargs)
            raw = (response.choices[0].message.content or "").strip()
        data = json.loads(_strip_json_fence(raw))
        sub_queries = data.get("sub_queries", [])
        if not isinstance(sub_queries, list):
            return []
        original = query.strip().lower()
        cleaned = []
        for sq in sub_queries:
            if not isinstance(sq, str):
                continue
            sq = sq.strip()
            if sq and sq.lower() != original:
                cleaned.append(sq[:500])
        return cleaned[:MAX_ITERATIONS]
    except Exception as e:
        logger.warning("[REFINE] Query refinement failed: %s", e)
        sentry_sdk.capture_exception(e)
        return []


def _strip_json_fence(raw: str) -> str:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1] if "\n" in cleaned else cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
    return cleaned.strip()


async def _analyze_query(query: str, config: ModeConfig) -> QueryAnalysis:
    if not config.decompose:
        return QueryAnalysis(intent=config.mode.value, sub_queries=[query], concepts=_detect_concepts(query))
    return await decompose_query(query)


_IDENTIFIER_HINT_RE = re.compile(
    r"`[^`]+`|[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*\([A-Za-z0-9_, ]*\)"
)


def _should_run_decompose(query: str, config: ModeConfig) -> bool:
    if not config.decompose:
        return False
    tokens = query.split()
    if len(tokens) < 12:
        return False
    if _IDENTIFIER_HINT_RE.search(query):
        return False
    return True


async def _broad_recall(
    project_id: str,
    user_id: str,
    query: str,
    sub_queries: list[str],
    concepts: list[str],
    signals: QuerySignals,
    branch: str | None,
    config: ModeConfig,
) -> tuple[list[list[dict]], list[float] | None]:
    lists: list[list[dict]] = []
    query_embedding: list[float] | None = None
    limit = config.broad_limit

    if config.vector_search:
        try:
            summary_embeddings = await embed_texts(sub_queries)
            query_embedding = summary_embeddings[0] if summary_embeddings else None

            async def _one_vector_search(emb: list[float]) -> list[dict]:
                return await asyncio.to_thread(
                    vector_search, project_id, user_id, emb, limit, branch
                )

            results_list = await asyncio.gather(
                *[_one_vector_search(e) for e in summary_embeddings],
                return_exceptions=True,
            )
            for results in results_list:
                if isinstance(results, BaseException):
                    logger.warning("[RECALL] vector search task failed: %s", results)
                    sentry_sdk.capture_exception(results)
                elif results:
                    lists.append(results)
            logger.info(
                "[RECALL] vector sub_queries=%d lists_now=%d",
                len(sub_queries),
                len(lists),
            )
        except Exception as e:
            sentry_sdk.capture_exception(e)
            logger.warning(
                "[RECALL] vector skipped after embedding failure; "
                "falling back to lexical/concept recall: %s",
                str(e)[:240],
            )
    else:
        logger.info("[RECALL] vector skipped mode=%s", config.mode.value)

    for sq in sub_queries:
        expanded = _expand_query(sq, concepts, config.mode)
        results = text_search(project_id, user_id, expanded, limit=limit)
        if results:
            lists.append(results)
    logger.info("[RECALL] text complete sub_queries=%d lists_now=%d", len(sub_queries), len(lists))

    if concepts:
        results = concept_search(project_id, user_id, concepts, limit=limit)
        if results:
            lists.append(results)
        logger.info("[RECALL] concept concepts=%s results=%d", concepts, len(results) if results else 0)
    else:
        logger.info("[RECALL] concept skipped no concepts")

    file_patterns = build_file_patterns(signals)
    if config.mode == ModeEnum.FIND:
        for term in sorted(_find_terms(query) - _FIND_GENERIC_TERMS):
            if len(term) >= 4:
                file_patterns.append(f"%{term}%")
        file_patterns = list(dict.fromkeys(file_patterns))[:10]
    if file_patterns:
        results = file_path_search(project_id, user_id, file_patterns, limit=limit)
        if results:
            lists.append(results)
        logger.info("[RECALL] filepath patterns=%s results=%d", file_patterns, len(results) if results else 0)
    else:
        logger.info("[RECALL] filepath skipped no file patterns")

    return lists, query_embedding


async def _find_vector_fallback_recall(
    project_id: str,
    user_id: str,
    query: str,
    branch: str | None,
    broad_limit: int,
) -> tuple[list[list[dict]], list[float] | None]:
    try:
        embeddings = await embed_texts([query])
        query_embedding = embeddings[0] if embeddings else None
        if not query_embedding:
            return [], None
        results = await asyncio.to_thread(
            vector_search, project_id, user_id, query_embedding, broad_limit, branch
        )
        if results:
            return [results], query_embedding
        return [], query_embedding
    except Exception as e:
        logger.warning("[RECALL] find vector fallback failed: %s", e)
        sentry_sdk.capture_exception(e)
        return [], None


def _filter_response_relevance(chunks: list[dict]) -> list[dict]:
    return [chunk for chunk in chunks if _score(chunk) > MIN_RESPONSE_RELEVANCE]


def _hydrate_ranked_chunks(
    chunks: list[dict],
    project_id: str,
    user_id: str,
    limit: int,
) -> list[dict]:
    """Fetch heavy columns for the small set that survived broad recall."""
    if not chunks or limit <= 0:
        return chunks
    hydrate_count = min(len(chunks), limit)
    chunk_ids = [str(c["id"]) for c in chunks[:hydrate_count] if c.get("id")]
    hydrated = hydrate_chunks_by_ids(chunk_ids, project_id, user_id)
    hydrated_by_id = {str(c["id"]): c for c in hydrated}

    merged: list[dict] = []
    for chunk in chunks:
        full = hydrated_by_id.get(str(chunk.get("id")))
        if full:
            merged_chunk = {**full, **chunk}
            for heavy_key in ("code_body", "context_header", "parent_summary"):
                if full.get(heavy_key) is not None:
                    merged_chunk[heavy_key] = full.get(heavy_key)
            merged.append(merged_chunk)
        else:
            merged.append(chunk)
    return merged


async def _attach_structure_similarity(
    chunks: list[dict],
    query: str,
    concepts: list[str],
    project_id: str,
    user_id: str,
) -> list[dict]:
    if not chunks:
        return chunks
    try:
        query_vectors = await embed_structure_texts([_structure_query(query, concepts)])
        query_vector = query_vectors[0] if query_vectors else None
        if not query_vector:
            return chunks

        chunk_ids = [str(c["id"]) for c in chunks[:60] if c.get("id")]
        structure_embeddings = get_chunk_structure_embeddings(chunk_ids, project_id, user_id)
        for chunk in chunks:
            raw_vector = structure_embeddings.get(str(chunk.get("id")))
            chunk_vector = _parse_vector(raw_vector)
            if chunk_vector:
                chunk["structure_similarity"] = _cosine_similarity(query_vector, chunk_vector)
    except Exception as e:
        logger.warning("[RANK] structure similarity skipped: %s", e)
        sentry_sdk.capture_exception(e)
    return chunks


def _blend_structure_similarity(chunks: list[dict]) -> list[dict]:
    """Blend rerank_score and structure_similarity into a deterministic final_score."""
    for chunk in chunks:
        rerank_score = chunk.get("rerank_score")
        if rerank_score is None:
            continue
        structure_sim = chunk.get("structure_similarity", 0.0)
        try:
            rerank_score = float(rerank_score)
            structure_sim = float(structure_sim)
        except (TypeError, ValueError):
            continue
        chunk["final_score"] = (
            (1.0 - STRUCTURE_SIMILARITY_WEIGHT) * rerank_score
            + STRUCTURE_SIMILARITY_WEIGHT * structure_sim
        )
    return chunks


def _parse_vector(value: object) -> list[float] | None:
    if value is None:
        return None
    if isinstance(value, list):
        try:
            return [float(v) for v in value]
        except (TypeError, ValueError):
            return None
    if isinstance(value, str):
        text = value.strip()
        if text.startswith("[") and text.endswith("]"):
            text = text[1:-1]
        if not text:
            return []
        try:
            return [float(part) for part in text.split(",")]
        except ValueError:
            return None
    return None


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    va = np.array(a, dtype=np.float32)
    vb = np.array(b, dtype=np.float32)
    denom = float(np.linalg.norm(va) * np.linalg.norm(vb))
    if denom == 0.0:
        return 0.0
    return float(max(0.0, min(1.0, np.dot(va, vb) / denom)))


def _score(chunk: dict) -> float:
    if not chunk:
        return 0.0
    try:
        return float(chunk.get("final_score", chunk.get("similarity_score", chunk.get("similarity", 0))) or 0)
    except (TypeError, ValueError):
        return 0.0


def _reciprocal_rank_fusion(*result_lists: list[dict], k: int = 60) -> list[dict]:
    scores: dict[str, float] = {}
    chunks: dict[str, dict] = {}
    for result_list in result_lists:
        for rank, chunk in enumerate(result_list):
            cid = str(chunk["id"])
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + rank + 1)
            chunks.setdefault(cid, chunk)
    ordered = sorted(scores, key=lambda cid: scores[cid], reverse=True)
    for cid in ordered:
        chunks[cid]["rrf_score"] = scores[cid]
    return [chunks[cid] for cid in ordered]


def _rank_find_candidates(
    chunks: list[dict],
    query: str,
    concepts: list[str],
    limit: int,
    plan: FindQueryPlan | None = None,
) -> list[dict]:
    terms = _find_terms(query)
    specific_terms = terms - _FIND_GENERIC_TERMS
    plan = plan or _build_find_query_plan(query)
    query_generic_symbol_terms = plan.explicit_generic_symbols
    # Domain signal terms that qualify for the signal-hit boost (configurable via env)
    query_signal_terms = terms & FIND_DOMAIN_SIGNAL_TERMS
    term_weights: dict[str, float] = {term: 1.0 for term in terms}
    chunk_haystacks: list[str] = []

    if chunks:
        # Candidate-local IDF weighting: rare discriminating terms (e.g. clipboard)
        # outrank ubiquitous terms (e.g. capture) without query-specific heuristics.
        chunk_haystacks = [_chunk_search_text(chunk) for chunk in chunks]
        if terms:
            df = {term: 0 for term in terms}
            for haystack in chunk_haystacks:
                for term in terms:
                    if term in haystack:
                        df[term] += 1
            n_docs = float(len(chunk_haystacks))
            idf = {
                term: math.log((n_docs + 1.0) / (float(df.get(term, 0)) + 0.5))
                for term in terms
            }
            mean_idf = max(sum(idf.values()) / max(len(idf), 1), 1e-6)
            term_weights = {term: (value / mean_idf) for term, value in idf.items()}

    for idx, chunk in enumerate(chunks):
        haystack = chunk_haystacks[idx] if idx < len(chunk_haystacks) else _chunk_search_text(chunk)
        file_path = str(chunk.get("file_path") or "").replace("\\", "/").lower()
        path_name = f"{file_path} {chunk.get('name', '')}".lower()
        signature = _split_identifiers(str(chunk.get("signature") or "")).lower()
        code_body = _split_identifiers(str(chunk.get("code_body") or "")[:2500]).lower()
        concepts_set = {str(c) for c in (chunk.get("concepts") or [])}

        lexical_hits = sum(term_weights.get(term, 1.0) for term in terms if term in haystack)
        path_hits = sum(term_weights.get(term, 1.0) for term in specific_terms if term in path_name)
        signature_hits = sum(term_weights.get(term, 1.0) for term in specific_terms if term in signature)
        body_hits = sum(term_weights.get(term, 1.0) for term in specific_terms if term in code_body)
        # Signal hits: query contained a domain-signal term AND the chunk text also contains it
        exact_signal_hits = sum(
            1 for term in query_signal_terms if term in haystack
        )
        concept_hits = len(concepts_set.intersection(concepts))
        name_token = str(chunk.get("name") or "").strip().lower()
        method_hits = sum(
            1
            for method in plan.http_methods
            if method in path_name or method in signature or name_token == method
        )
        domain_hits = sum(
            1
            for term in plan.domain_terms
            if term in path_name or term in signature or term in code_body or term in haystack
        )
        is_route_file = "/api/" in file_path and "/route." in file_path
        is_route_handler = bool(
            is_route_file
            and (
                name_token in _FIND_HTTP_METHODS
                or "route" in name_token
                or "handler" in name_token
                or any(method in signature for method in _FIND_HTTP_METHODS)
            )
        )

        # PageRank boost: implementers naturally have more incoming edges than callers.
        # When GRAPH_BUILDER_ENABLED, this is the primary signal distinguishing
        # "this IS the function" from "this USES the function".
        pagerank = float(chunk.get("pagerank_score") or 0.0)

        boost = (
            lexical_hits * FIND_BOOST_LEXICAL
            + path_hits * FIND_BOOST_PATH
            + signature_hits * FIND_BOOST_SIGNATURE
            + body_hits * FIND_BOOST_BODY
            + exact_signal_hits * FIND_BOOST_SIGNAL
            + concept_hits * FIND_BOOST_CONCEPT
            + pagerank * FIND_PAGERANK_WEIGHT
        )
        if "config" in terms and ".config" in (chunk.get("code_body") or "").lower():
            boost += 0.30
        if specific_terms and not (path_hits or signature_hits or body_hits):
            boost += FIND_PENALTY_MISS
        # Reduce generic-route/page noise unless user asked for those symbols.
        if (
            name_token in _FIND_GENERIC_SYMBOL_NAMES
            and name_token not in query_generic_symbol_terms
        ):
            boost -= 0.12
        if plan.wants_route_handlers:
            boost += 0.30 if is_route_handler else -0.22
        if plan.http_methods:
            boost += 0.22 if method_hits else -0.18
        if plan.domain_terms:
            boost += 0.24 if domain_hits else -0.20

        base = _score(chunk)
        # Keep the raw composite UNCLAMPED. Clamping to 1.0 pinned every strong
        # candidate to an identical 100% and made the final sort arbitrary among
        # them (the true best could sink). Ranking + display both derive from raw.
        chunk["_find_raw"] = base + boost
        chunk["_find_route_handler"] = is_route_handler
        chunk["_find_method_match"] = method_hits > 0
        chunk["_find_domain_match"] = domain_hits > 0
        if path_hits or signature_hits or body_hits or exact_signal_hits or concept_hits:
            reasons = []
            if path_hits:
                reasons.append("matches requested terms in file path/name")
            if signature_hits:
                reasons.append("matches requested terms in signature")
            if body_hits:
                reasons.append("matches requested terms in code")
            if exact_signal_hits:
                reasons.append("matches requested signal terms")
            if concept_hits:
                reasons.append(f"shares concepts: {', '.join(sorted(concepts_set.intersection(concepts)))}")
            if plan.wants_route_handlers and is_route_handler:
                reasons.append("matches route-handler intent")
            if plan.http_methods and method_hits:
                reasons.append("matches requested HTTP method")
            if plan.domain_terms and domain_hits:
                reasons.append("matches requested domain terms")
            chunk["relevance_reasoning"] = "; ".join(reasons)

    ranked = sorted(chunks, key=lambda c: c.get("_find_raw", 0.0), reverse=True)
    # Map raw composite scores onto a spread display confidence. The top match
    # anchors near 1.0 and weaker candidates decay via a power curve, so the
    # results carry a real, discriminating spread instead of a wall of 100%.
    if ranked:
        top_raw = max(ranked[0].get("_find_raw", 0.0), 1e-6)
        for c in ranked:
            rel = max(0.0, c.get("_find_raw", 0.0)) / top_raw
            c["find_score"] = round(min(rel ** 1.4, 1.0), 4)
            c["final_score"] = c["find_score"]
    return ranked[:limit]


def _find_target_count(limit: int) -> int:
    return max(min(limit, _FIND_MIN_RESULTS_FLOOR), min(4, limit))


def _is_breadth_find_query(query: str) -> bool:
    terms = _find_terms(query)
    if not terms:
        return False
    return bool(terms.intersection(_FIND_BREADTH_HINTS))


def _build_find_query_plan(query: str) -> FindQueryPlan:
    terms = _find_terms(query)
    method_terms = terms.intersection(_FIND_HTTP_METHODS)
    route_hint_terms = terms.intersection(_FIND_ROUTE_HINTS)
    explicit_generic_symbols = terms.intersection(_FIND_GENERIC_SYMBOL_NAMES)
    domain_terms = {
        term
        for term in terms
        if term not in _FIND_GENERIC_TERMS
        and term not in _FIND_BREADTH_HINTS
        and term not in _FIND_ROUTE_HINTS
        and term not in _FIND_HTTP_METHODS
        and term not in _FIND_GENERIC_SYMBOL_NAMES
    }
    return FindQueryPlan(
        scope_all=bool(terms.intersection(_FIND_BREADTH_HINTS)),
        wants_route_handlers=bool(route_hint_terms or method_terms),
        http_methods=method_terms,
        domain_terms=domain_terms,
        explicit_generic_symbols=explicit_generic_symbols,
    )


def _chunk_matches_find_constraints(chunk: dict, plan: FindQueryPlan) -> bool:
    if plan.wants_route_handlers and not bool(chunk.get("_find_route_handler")):
        return False
    if plan.http_methods and not bool(chunk.get("_find_method_match")):
        return False
    if plan.domain_terms and not bool(chunk.get("_find_domain_match")):
        return False
    return True


def _postprocess_find_ranked(ranked: list[dict], query: str, limit: int, plan: FindQueryPlan) -> list[dict]:
    if not ranked or limit <= 0:
        return ranked

    breadth_query = plan.scope_all
    selected: list[dict] = []
    seen_ids: set[str] = set()
    selected_file_paths: set[str] = set()
    # Recall floor + relative tail gate: keep at least the floor, then drop the
    # weak tail (raw far below the top) so noise doesn't pad the result page.
    floor = _find_target_count(limit)
    top_raw = max(ranked[0].get("_find_raw", 0.0), 1e-6)
    tail_min_raw = top_raw * _FIND_TAIL_FRACTION
    # Cap chunks per file so a single file can't flood the results.
    per_file_cap = 3 if breadth_query else 2

    def _add_chunk(chunk: dict) -> bool:
        cid = str(chunk.get("id") or "")
        file_path = str(chunk.get("file_path") or "")
        name = str(chunk.get("name") or "").strip().lower()
        current_raw = float(chunk.get("_find_raw", 0.0))
        if not cid or cid in seen_ids:
            return False
        # Apply tail suppression across all passes once the recall floor is met.
        if not breadth_query and len(selected) >= floor and current_raw < tail_min_raw:
            return False
        if file_path:
            file_count = sum(1 for c in selected if str(c.get("file_path") or "") == file_path)
            strong_same_file = current_raw >= (top_raw * _FIND_STRONG_FRACTION)
            if file_count >= per_file_cap and not strong_same_file:
                return False
        if name in _FIND_GENERIC_SYMBOL_NAMES and file_path:
            key = (file_path, name)
            if key in generic_seen_per_file:
                return False
            generic_seen_per_file.add(key)
        selected.append(chunk)
        seen_ids.add(cid)
        if file_path:
            selected_file_paths.add(file_path)
        return True

    generic_seen_per_file: set[tuple[str, str]] = set()

    # Pass 0: if query has explicit constraints, reserve top slots for candidates
    # satisfying all constraints (route-handler/method/domain).
    if plan.has_constraints:
        strict_candidates = [c for c in ranked if _chunk_matches_find_constraints(c, plan)]
        if strict_candidates:
            strict_contract = int(limit * (0.8 if breadth_query else 0.7))
            strict_contract = max(1, min(limit, strict_contract))
            for chunk in strict_candidates:
                if len(selected) >= strict_contract:
                    break
                _add_chunk(chunk)

    # Pass 1: prioritize unique files on breadth-style "where all" queries.
    if breadth_query:
        for chunk in ranked:
            if len(selected) >= limit:
                break
            cid = str(chunk.get("id") or "")
            file_path = str(chunk.get("file_path") or "")
            if not cid or cid in seen_ids or not file_path:
                continue
            if file_path in selected_file_paths:
                continue
            _add_chunk(chunk)

    # Pass 2: fill remaining slots with strongest leftovers, but suppress
    # duplicate generic symbols from the same file to reduce noisy repetition.
    for chunk in selected:
        file_path = str(chunk.get("file_path") or "")
        name = str(chunk.get("name") or "").strip().lower()
        if name in _FIND_GENERIC_SYMBOL_NAMES and file_path:
            generic_seen_per_file.add((file_path, name))

    for chunk in ranked:
        if len(selected) >= limit:
            break
        _add_chunk(chunk)

    return selected


def _mmr(chunks: list[dict], lambda_param: float, limit: int) -> list[dict]:
    selected: list[dict] = []
    remaining = list(chunks)
    file_counts: dict[str, int] = {}
    while remaining and len(selected) < limit:
        for chunk in remaining:
            file_path = chunk.get("file_path", "")
            count = file_counts.get(file_path, 0)
            score = chunk.get("final_score", chunk.get("rrf_score", chunk.get("similarity", 0)))
            chunk["mmr_score"] = score if count < 2 else score * (1 - lambda_param)
        best = max(remaining, key=lambda c: c.get("mmr_score", 0))
        selected.append(best)
        remaining.remove(best)
        file_counts[best.get("file_path", "")] = file_counts.get(best.get("file_path", ""), 0) + 1
    return selected


def _to_retrieved_chunk(c: dict, score: float | None = None) -> RetrievedChunk:
    return RetrievedChunk(
        id=str(c["id"]),
        file_path=c["file_path"],
        start_line=c["start_line"],
        end_line=c["end_line"],
        chunk_type=c["chunk_type"],
        name=c["name"],
        signature=c.get("signature"),
        language=c.get("language", ""),
        semantic_summary=c.get("summary_code") or c.get("semantic_summary"),
        summary_code=c.get("summary_code"),
        summary_purpose=c.get("summary_purpose"),
        code_body=c.get("code_body"),
        concepts=c.get("concepts") or [],
        similarity_score=score if score is not None else c.get("final_score", c.get("similarity", c.get("rrf_score", 0))),
        branch=c.get("branch"),
        branch_diverged=c.get("branch_diverged", False),
        relevance_reasoning=c.get("relevance_reasoning"),
        probable_issue=c.get("_probable_issue") or c.get("probable_issue"),
    )


def _detect_concepts(query: str) -> list[str]:
    return detect_concepts_from_query(query)


def _normalize_find_concepts(query: str, concepts: list[str]) -> list[str]:
    normalized = list(dict.fromkeys([*concepts, *_detect_concepts(query)]))
    specific = [c for c in normalized if c not in _FIND_GENERIC_CONCEPTS]
    return specific or normalized


def _expand_query(query: str, concepts: list[str], mode: ModeEnum = ModeEnum.BUG) -> str:
    words = set(re.findall(r"\w+", _split_identifiers(query).lower()))
    if mode == ModeEnum.FIND:
        words = _find_terms(query)
    for concept in concepts:
        words.update(CONCEPT_KEYWORDS.get(concept, [])[:4])
    return " or ".join(sorted(words)) if words else query


def _split_identifiers(text: str) -> str:
    return re.sub(r"([a-z])([A-Z])", r"\1 \2", text).replace("_", " ").replace(".", " ")


def _word_variants(text: str) -> set[str]:
    words = set(re.findall(r"\w+", _split_identifiers(text).lower()))
    variants = set(words)
    for word in words:
        # Better plural normalization: communities -> community
        if word.endswith("ies") and len(word) > 4:
            variants.add(word[:-3] + "y")
        # Common plural normalization: classes -> class, tokens -> token
        if word.endswith("es") and len(word) > 4:
            variants.add(word[:-2])
        if word.endswith("s") and len(word) > 3:
            variants.add(word[:-1])
    return variants


def _find_terms(query: str) -> set[str]:
    return {
        word for word in _word_variants(query)
        if len(word) >= 3 and word not in _FIND_STOP_WORDS
    }


_FIND_GENERIC_TERMS = {
    "config", "configs", "configuration", "configure", "configured",
    "located", "location", "where", "file", "files", "code",
}

_FIND_GENERIC_SYMBOL_NAMES = {
    "route", "get", "post", "put", "patch", "delete", "head", "options",
    "page", "layout", "default", "handler",
}

_FIND_HTTP_METHODS = {"get", "post", "put", "patch", "delete", "head", "options"}

_FIND_ROUTE_HINTS = {"route", "routes", "handler", "handlers", "endpoint", "endpoints", "api"}

_FIND_BREADTH_HINTS = {
    "all", "every", "entire", "full", "complete", "where", "locations",
    "location", "places", "codes", "files", "section", "sections",
}


def _chunk_search_text(chunk: dict) -> str:
    parts = [
        chunk.get("file_path"),
        chunk.get("name"),
        chunk.get("signature"),
        chunk.get("summary_code") or chunk.get("semantic_summary"),
        chunk.get("summary_purpose"),
        " ".join(chunk.get("concepts") or []),
        (chunk.get("code_body") or "")[:2500],
    ]
    return _split_identifiers("\n".join(str(p) for p in parts if p)).lower()


def _structure_query(query: str, concepts: list[str]) -> str:
    parts = [query, _split_identifiers(query)]
    if concepts:
        parts.append(" ".join(concepts))
    return "\n".join(parts)
