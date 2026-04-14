"""
Hybrid retrieval engine: vector search + full-text search → Reciprocal
Rank Fusion → rerank → multi-hop graph expansion → observation tracking.
"""

import math
import re
import time
import logging
from typing import Optional
from app.services.embedding import embed_text
from app.db.queries import (
    vector_search,
    text_search,
    get_related_chunks_multihop,
    get_branch_context,
    increment_observation_counts,
)
from app.db.models import RetrievedChunk, RetrieveResponse

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


def _detect_concepts(query: str) -> list[str]:
    """Detect which domain concepts are relevant to a query."""
    query_lower = query.lower()
    query_words = set(re.findall(r"\w+", query_lower))
    matched = []
    for concept, keywords in CONCEPT_KEYWORDS.items():
        if any(kw in query_words for kw in keywords):
            matched.append(concept)
    return matched


def _split_identifiers(text: str) -> str:
    """Mirror the SQL split_identifiers(): camelCase → spaces, _ → spaces, . → spaces."""
    result = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
    result = result.replace("_", " ").replace(".", " ")
    return result


MAX_CONCEPT_KEYWORDS_PER = 3


def _expand_query(query: str, detected_concepts: list[str]) -> str:
    """
    Expand a natural-language query for full-text search by:
    1. Splitting camelCase/snake_case terms in the original query
    2. Adding top keywords from each detected concept
    """
    split_query = _split_identifiers(query)
    words = set(re.findall(r"\w+", split_query.lower()))
    words.update(re.findall(r"\w+", query.lower()))

    for concept in detected_concepts:
        kws = CONCEPT_KEYWORDS.get(concept, [])
        words.update(kws[:MAX_CONCEPT_KEYWORDS_PER])

    return " or ".join(sorted(words))


# ── Reciprocal Rank Fusion ──────────────────────────────────────────────────

def _reciprocal_rank_fusion(
    *result_lists: list[dict],
    k: int = 60,
) -> list[dict]:
    """
    Merge multiple ranked result lists using RRF.
    score(d) = Σ  1 / (k + rank_i(d))   for each list i where d appears.
    """
    scores: dict[str, float] = {}
    chunks_by_id: dict[str, dict] = {}

    for results in result_lists:
        for rank, chunk in enumerate(results):
            cid = chunk["id"]
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + rank + 1)
            if cid not in chunks_by_id:
                chunks_by_id[cid] = chunk

    sorted_ids = sorted(scores, key=lambda x: scores[x], reverse=True)
    for cid in sorted_ids:
        chunks_by_id[cid]["rrf_score"] = scores[cid]

    return [chunks_by_id[cid] for cid in sorted_ids]


# ── Reranking ───────────────────────────────────────────────────────────────

def _rerank(
    chunks: list[dict],
    branch: Optional[str] = None,
    query_concepts: Optional[list[str]] = None,
) -> list[dict]:
    """
    Re-rank fused candidates using:
    score = rrf_score * min(log(2 + obs), 2.0) * branch_weight * concept_boost
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

        obs_factor = min(math.log(2 + obs), 2.0)
        chunk["final_score"] = base * obs_factor * branch_weight * concept_boost

    chunks.sort(key=lambda c: c.get("final_score", 0), reverse=True)
    return chunks


# ── Main retrieval entry-point ──────────────────────────────────────────────

async def retrieve_context(
    project_id: str,
    user_id: str,
    query: str,
    branch: Optional[str] = None,
    limit: int = 10,
) -> RetrieveResponse:
    t_start = time.perf_counter()

    logger.info(
        f"[project={project_id}] Retrieval started: "
        f"query={query[:100]!r}, branch={branch}, limit={limit}"
    )

    query_concepts = _detect_concepts(query)
    if query_concepts:
        logger.info(
            f"[project={project_id}] Detected concepts: {query_concepts}"
        )

    t_embed = time.perf_counter()
    query_embedding = await embed_text(query)
    logger.debug(
        f"[project={project_id}] Query embedded in {time.perf_counter() - t_embed:.3f}s"
    )

    expanded_query = _expand_query(query, query_concepts)
    logger.debug(
        f"[project={project_id}] Expanded text query: {expanded_query[:200]!r}"
    )

    t_search = time.perf_counter()
    overfetch = limit * 2
    vec_candidates = vector_search(
        project_id=project_id,
        user_id=user_id,
        query_embedding=query_embedding,
        limit=overfetch,
        branch=branch,
    )

    txt_candidates = text_search(
        project_id=project_id,
        user_id=user_id,
        query=expanded_query,
        limit=overfetch,
    )
    logger.info(
        f"[project={project_id}] Search results: "
        f"vector={len(vec_candidates)}, text={len(txt_candidates)}, "
        f"took {time.perf_counter() - t_search:.3f}s"
    )

    if txt_candidates:
        fused = _reciprocal_rank_fusion(vec_candidates, txt_candidates)
        overlap = len(set(c["id"] for c in vec_candidates) & set(c["id"] for c in txt_candidates))
        logger.info(
            f"[project={project_id}] RRF fusion: "
            f"{len(fused)} unique candidates, {overlap} in both search paths"
        )
    else:
        for rank, c in enumerate(vec_candidates):
            c["rrf_score"] = c.get("similarity", 0.0)
        fused = vec_candidates
        logger.debug(
            f"[project={project_id}] No text search results, using vector-only"
        )

    ranked = _rerank(fused, branch=branch, query_concepts=query_concepts)[:limit]

    if ranked:
        top = ranked[0]
        has_body = sum(1 for c in ranked if c.get("code_body"))
        has_concepts = sum(1 for c in ranked if c.get("concepts"))
        logger.info(
            f"[project={project_id}] Top result: {top.get('name')} "
            f"(score={top.get('final_score', 0):.4f}, obs={top.get('observation_count', 0)}), "
            f"{has_body}/{len(ranked)} with code bodies, "
            f"{has_concepts}/{len(ranked)} with concepts"
        )

    ranked_chunks = [_to_retrieved_chunk(c) for c in ranked]

    top_ids = [c.id for c in ranked_chunks[:5]]
    t_graph = time.perf_counter()
    related_raw = get_related_chunks_multihop(top_ids, project_id)
    related_chunks = [_to_retrieved_chunk(r, score=0.0) for r in related_raw]
    logger.info(
        f"[project={project_id}] Graph expansion: "
        f"{len(related_chunks)} related chunks from {len(top_ids)} seeds, "
        f"took {time.perf_counter() - t_graph:.3f}s"
    )

    increment_observation_counts(top_ids)

    branch_ctx = get_branch_context(project_id, branch)

    total = time.perf_counter() - t_start
    logger.info(
        f"[project={project_id}] Retrieval complete: "
        f"{len(ranked_chunks)} ranked + {len(related_chunks)} related, "
        f"branch_context={'yes' if branch_ctx else 'no'}, "
        f"total={total:.3f}s"
    )

    return RetrieveResponse(
        ranked_chunks=ranked_chunks,
        related_chunks=related_chunks,
        branch_context=branch_ctx,
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
