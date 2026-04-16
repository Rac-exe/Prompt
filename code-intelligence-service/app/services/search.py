"""
Hybrid retrieval engine: query preprocessing → decomposition → batch embedding →
multi-query vector search + full-text search + concept search + file-path search →
source-weighted RRF → query-aware rerank → filtered graph expansion → dedup →
observation tracking.
"""

import math
import re
import time
import logging
from typing import Optional
from app.services.embedding import embed_text, embed_texts
from app.services.query_analyzer import decompose_query
from app.services.query_preprocessor import preprocess_query, build_file_patterns, QuerySignals
from app.db.queries import (
    vector_search,
    text_search,
    concept_search,
    file_path_search,
    get_related_chunks_multihop,
    get_branch_context,
    increment_observation_counts,
)
from app.db.models import RetrievedChunk, RetrieveResponse
from app.config import GRAPH_SIMILARITY_THRESHOLD

logger = logging.getLogger("code-intel.search")


# ── Concept detection ───────────────────────────────────────────────────────

CONCEPT_KEYWORDS: dict[str, list[str]] = {
    "state-management": ["state", "store", "redux", "toggle", "setter", "getter", "usestate", "dispatch", "context"],
    "auth": ["auth", "login", "signup", "password", "token", "session", "jwt", "oauth", "credential"],
    "routing": ["route", "router", "navigate", "path", "url", "redirect", "endpoint"],
    "database": ["database", "db", "query", "model", "schema", "migration", "mongoose", "sql", "mongo", "prisma"],
    "API": ["api", "endpoint", "request", "response", "rest", "graphql", "controller", "handler"],
    "error-handling": ["error", "exception", "catch", "throw", "handler", "retry", "fallback"],
    "validation": ["valid", "validate", "schema", "sanitize", "check", "constraint", "zod", "joi"],
    "data-fetching": ["fetch", "get", "load", "retrieve", "download", "http", "axios", "httpx"],
    "caching": ["cache", "memoize", "store", "invalidate", "ttl", "redis"],
    "middleware": ["middleware", "interceptor", "pipe", "guard", "filter"],
    "file-io": ["file", "read", "write", "stream", "upload", "download", "fs"],
    "security": ["security", "encrypt", "hash", "cors", "csrf", "xss"],
    "UI-rendering": ["render", "component", "view", "template", "dom", "jsx", "tsx"],
    "config": ["config", "env", "settings", "options", "preference"],
    "logging": ["log", "logger", "debug", "trace", "monitor"],
    "testing": ["test", "spec", "mock", "assert", "expect", "jest", "mocha"],
    "concurrency": ["async", "await", "promise", "thread", "worker", "parallel", "concurrent"],
    "search": ["search", "find", "filter", "query", "index", "match"],
    "payments": ["payment", "stripe", "checkout", "billing", "invoice", "charge"],
    "notifications": ["notification", "email", "sms", "push", "alert", "webhook"],
}

MAX_CONCEPT_KEYWORDS_PER = 3


def _detect_concepts(query: str) -> list[str]:
    query_lower = query.lower()
    query_words = set(re.findall(r"\w+", query_lower))
    matched = []
    for concept, keywords in CONCEPT_KEYWORDS.items():
        if any(kw in query_words for kw in keywords):
            matched.append(concept)
    return matched


def _split_identifiers(text: str) -> str:
    result = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
    result = result.replace("_", " ").replace(".", " ")
    return result


def _expand_query(query: str, detected_concepts: list[str]) -> str:
    split_query = _split_identifiers(query)
    words = set(re.findall(r"\w+", split_query.lower()))
    words.update(re.findall(r"\w+", query.lower()))

    for concept in detected_concepts:
        kws = CONCEPT_KEYWORDS.get(concept, [])
        words.update(kws[:MAX_CONCEPT_KEYWORDS_PER])

    return " or ".join(sorted(words))


# ── Source-weighted Reciprocal Rank Fusion ───────────────────────────────────

def _reciprocal_rank_fusion(
    *result_lists: list[dict],
    weights: list[float] | None = None,
    k: int = 60,
) -> list[dict]:
    """
    Merge multiple ranked result lists using source-weighted RRF.
    score(d) = Σ  weight_i / (k + rank_i(d))   for each list i where d appears.
    """
    scores: dict[str, float] = {}
    chunks_by_id: dict[str, dict] = {}

    if weights is None:
        weights = [1.0] * len(result_lists)
    while len(weights) < len(result_lists):
        weights.append(1.0)

    for list_idx, results in enumerate(result_lists):
        w = weights[list_idx]
        for rank, chunk in enumerate(results):
            cid = chunk["id"]
            scores[cid] = scores.get(cid, 0.0) + w / (k + rank + 1)
            if cid not in chunks_by_id:
                chunks_by_id[cid] = chunk

    sorted_ids = sorted(scores, key=lambda x: scores[x], reverse=True)
    for cid in sorted_ids:
        chunks_by_id[cid]["rrf_score"] = scores[cid]

    return [chunks_by_id[cid] for cid in sorted_ids]


# ── Query-aware reranking ────────────────────────────────────────────────────

def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _rerank(
    chunks: list[dict],
    branch: Optional[str] = None,
    query_concepts: Optional[list[str]] = None,
    query_embedding: Optional[list[float]] = None,
    file_path_boost_ids: Optional[set[str]] = None,
) -> list[dict]:
    """
    Re-rank fused candidates using:
    score = rrf_score * obs_factor * branch_weight * concept_boost
            * export_boost * query_sim_boost * file_match_boost
    """
    for chunk in chunks:
        base = chunk.get("rrf_score", chunk.get("similarity", 0.0))
        obs = chunk.get("observation_count", 0)
        branch_weight = 1.0

        if branch and chunk.get("branch") == branch:
            branch_weight = 1.3
        if chunk.get("branch_diverged"):
            branch_weight *= 1.2

        concept_boost = 1.0
        if query_concepts and chunk.get("concepts"):
            overlap = len(set(chunk["concepts"]) & set(query_concepts))
            if overlap:
                concept_boost = 1.0 + 0.15 * overlap

        export_boost = 1.2 if chunk.get("is_exported") else 1.0
        obs_factor = min(math.log(2 + obs), 2.0)

        query_sim_boost = 1.0
        if query_embedding and chunk.get("embedding"):
            sim = _cosine_similarity(query_embedding, chunk["embedding"])
            query_sim_boost = 1.0 + max(0, sim) * 0.3

        file_match_boost = 1.0
        if file_path_boost_ids and chunk.get("id") in file_path_boost_ids:
            file_match_boost = 1.5

        chunk["final_score"] = (
            base * obs_factor * branch_weight * concept_boost
            * export_boost * query_sim_boost * file_match_boost
        )

    chunks.sort(key=lambda c: c.get("final_score", 0), reverse=True)

    if chunks:
        top = chunks[0]
        logger.info(
            f"[RERANK] Top chunk after reranking: {top.get('name')} "
            f"(rrf={top.get('rrf_score', 0):.4f}, final={top.get('final_score', 0):.4f}), "
            f"used_query_sim={'yes' if query_embedding else 'no'}, "
            f"file_boost_ids={len(file_path_boost_ids) if file_path_boost_ids else 0}"
        )

    return chunks


# ── Graph expansion filtering ────────────────────────────────────────────────

def _filter_related_by_similarity(
    related: list[dict],
    query_embedding: list[float] | None,
    threshold: float = GRAPH_SIMILARITY_THRESHOLD,
) -> list[dict]:
    """Only keep graph-expanded chunks above similarity threshold to the query."""
    if not query_embedding or not related:
        return related
    filtered = []
    for chunk in related:
        if chunk.get("embedding"):
            sim = _cosine_similarity(query_embedding, chunk["embedding"])
            if sim >= threshold:
                chunk["_graph_similarity"] = sim
                filtered.append(chunk)
        else:
            filtered.append(chunk)
    dropped = len(related) - len(filtered)
    logger.info(
        f"[GRAPH FILTER] {len(related)} → {len(filtered)} "
        f"(dropped {dropped}, threshold={threshold})"
    )
    return filtered


# ── Main retrieval entry-point ──────────────────────────────────────────────

# Source weights: vector > concept > text > file-path
_VECTOR_WEIGHT = 1.5
_CONCEPT_WEIGHT = 1.2
_TEXT_WEIGHT = 1.0
_FILE_PATH_WEIGHT = 1.8


async def retrieve_context(
    project_id: str,
    user_id: str,
    query: str,
    branch: Optional[str] = None,
    limit: int = 10,
    signals: Optional[QuerySignals] = None,
) -> RetrieveResponse:
    t_start = time.perf_counter()

    logger.info(
        f"[project={project_id}] Retrieval started: "
        f"query={query[:100]!r}, branch={branch}, limit={limit}"
    )

    if signals is None:
        signals = preprocess_query(query)

    t_decompose = time.perf_counter()
    analysis = await decompose_query(query)
    query_concepts = analysis.concepts or _detect_concepts(query)
    sub_queries = analysis.sub_queries

    logger.info(
        f"[project={project_id}] Query decomposed in "
        f"{time.perf_counter() - t_decompose:.3f}s: "
        f"intent={analysis.intent}, sub_queries={len(sub_queries)}, "
        f"concepts={query_concepts}"
    )

    # ── Batch embed all sub-queries in a single call ─────────────────────
    t_embed = time.perf_counter()
    logger.info(
        f"[project={project_id}] [BATCH EMBED] Embedding {len(sub_queries)} sub-queries "
        f"in a single batch call (instead of {len(sub_queries)} serial calls)"
    )
    all_embeddings = await embed_texts(sub_queries)
    logger.info(
        f"[project={project_id}] [BATCH EMBED] Complete: "
        f"{len(all_embeddings)} vectors in {time.perf_counter() - t_embed:.3f}s"
    )

    query_embedding = all_embeddings[0] if all_embeddings else None

    # ── Multi-source search ──────────────────────────────────────────────
    t_search = time.perf_counter()
    overfetch = limit * 2

    result_lists: list[list[dict]] = []
    result_weights: list[float] = []

    for sq_idx, (sq, emb) in enumerate(zip(sub_queries, all_embeddings)):
        vec_results = vector_search(
            project_id=project_id,
            user_id=user_id,
            query_embedding=emb,
            limit=overfetch,
            branch=branch,
        )
        logger.info(
            f"[project={project_id}] [SEARCH] sub_query[{sq_idx}] vector: "
            f"{len(vec_results)} results (weight={_VECTOR_WEIGHT}x)"
        )
        result_lists.append(vec_results)
        result_weights.append(_VECTOR_WEIGHT)

        expanded = _expand_query(sq, query_concepts)
        txt_results = text_search(
            project_id=project_id,
            user_id=user_id,
            query=expanded,
            limit=overfetch,
        )
        if txt_results:
            logger.info(
                f"[project={project_id}] [SEARCH] sub_query[{sq_idx}] text: "
                f"{len(txt_results)} results (weight={_TEXT_WEIGHT}x)"
            )
            result_lists.append(txt_results)
            result_weights.append(_TEXT_WEIGHT)

    if query_concepts:
        concept_results = concept_search(
            project_id=project_id,
            user_id=user_id,
            concepts=query_concepts,
            limit=overfetch,
        )
        if concept_results:
            logger.info(
                f"[project={project_id}] [SEARCH] concept: "
                f"{len(concept_results)} results for {query_concepts} (weight={_CONCEPT_WEIGHT}x)"
            )
            result_lists.append(concept_results)
            result_weights.append(_CONCEPT_WEIGHT)

    # ── File-path search from preprocessor signals ───────────────────────
    file_path_boost_ids: set[str] = set()
    file_patterns = build_file_patterns(signals)
    if file_patterns:
        fp_results = file_path_search(
            project_id=project_id,
            user_id=user_id,
            file_patterns=file_patterns,
            limit=overfetch,
        )
        if fp_results:
            file_path_boost_ids = {r["id"] for r in fp_results}
            result_lists.append(fp_results)
            result_weights.append(_FILE_PATH_WEIGHT)
            logger.info(
                f"[project={project_id}] File-path search: "
                f"{len(fp_results)} chunks for patterns={file_patterns}"
            )

    total_candidates = sum(len(rl) for rl in result_lists)
    logger.info(
        f"[project={project_id}] Multi-query search: "
        f"{len(result_lists)} result lists, {total_candidates} total candidates, "
        f"took {time.perf_counter() - t_search:.3f}s"
    )

    # ── Source-weighted RRF ──────────────────────────────────────────────
    if len(result_lists) > 1:
        fused = _reciprocal_rank_fusion(*result_lists, weights=result_weights)
        logger.info(
            f"[project={project_id}] Weighted RRF: "
            f"{len(fused)} unique from {len(result_lists)} lists"
        )
    elif result_lists:
        fused = result_lists[0]
        for rank, c in enumerate(fused):
            c["rrf_score"] = c.get("similarity", 0.0)
    else:
        fused = []

    # ── Query-aware reranking ────────────────────────────────────────────
    ranked = _rerank(
        fused,
        branch=branch,
        query_concepts=query_concepts,
        query_embedding=query_embedding,
        file_path_boost_ids=file_path_boost_ids,
    )[:limit]

    if ranked:
        top = ranked[0]
        has_body = sum(1 for c in ranked if c.get("code_body"))
        has_concepts = sum(1 for c in ranked if c.get("concepts"))
        logger.info(
            f"[project={project_id}] Top result: {top.get('name')} "
            f"(score={top.get('final_score', 0):.4f}), "
            f"{has_body}/{len(ranked)} with code bodies, "
            f"{has_concepts}/{len(ranked)} with concepts"
        )

    ranked_chunks = [_to_retrieved_chunk(c) for c in ranked]

    # ── Filtered graph expansion ─────────────────────────────────────────
    top_ids = [c.id for c in ranked_chunks[:5]]
    t_graph = time.perf_counter()
    related_raw = get_related_chunks_multihop(top_ids, project_id)

    related_raw = _filter_related_by_similarity(
        related_raw, query_embedding, GRAPH_SIMILARITY_THRESHOLD,
    )

    # ── Deduplication: remove related chunks already in ranked ───────────
    ranked_ids = {c.id for c in ranked_chunks}
    related_raw = [r for r in related_raw if r["id"] not in ranked_ids]

    related_chunks = [_to_retrieved_chunk(r, score=0.0) for r in related_raw]
    logger.info(
        f"[project={project_id}] Graph expansion: "
        f"{len(related_chunks)} related (filtered+deduped) from {len(top_ids)} seeds, "
        f"took {time.perf_counter() - t_graph:.3f}s"
    )

    increment_observation_counts(top_ids)

    branch_ctx = get_branch_context(project_id, branch)

    total = time.perf_counter() - t_start
    logger.info(
        f"[project={project_id}] Retrieval complete: "
        f"{len(ranked_chunks)} ranked + {len(related_chunks)} related, "
        f"total={total:.3f}s"
    )

    return RetrieveResponse(
        ranked_chunks=ranked_chunks,
        related_chunks=related_chunks,
        branch_context=branch_ctx,
        query_intent=analysis.intent,
        query_concepts=query_concepts,
    )


def _to_retrieved_chunk(c: dict, score: float | None = None) -> RetrievedChunk:
    return RetrievedChunk(
        id=c["id"],
        file_path=c["file_path"],
        start_line=c["start_line"],
        end_line=c["end_line"],
        chunk_type=c["chunk_type"],
        name=c["name"],
        signature=c.get("signature"),
        language=c.get("language", ""),
        semantic_summary=c.get("semantic_summary"),
        code_body=c.get("code_body"),
        concepts=c.get("concepts") or [],
        similarity_score=score if score is not None else c.get("final_score", c.get("similarity", 0)),
        branch=c.get("branch"),
        branch_diverged=c.get("branch_diverged", False),
    )
