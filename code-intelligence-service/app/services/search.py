"""
Mode-aware retrieval engine.
"""

from __future__ import annotations

import math
import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Optional

import litellm
import sentry_sdk

from app.config import (
    ITERATIVE_REFINEMENT_THRESHOLD,
    MAX_ITERATIONS,
    OPENROUTER_API_KEY,
    QUERY_REFINER_MODEL,
)
from app.db.models import ModeEnum, RetrievedChunk, RetrieveResponse
from app.db.queries import (
    concept_search,
    file_path_search,
    get_branch_context,
    get_chunk_structure_embeddings,
    get_related_chunks_multihop,
    hydrate_chunks_by_ids,
    increment_observation_counts,
    text_search,
    vector_search,
)
from app.services.answer_generator import generate_answer
from app.services.concepts import CONCEPT_KEYWORDS, detect_concepts_from_query
from app.services.embedding import embed_structure_texts, embed_texts
from app.services.feedback import record_search
from app.services.mode_router import ModeConfig, get_mode_config
from app.services.query_analyzer import QueryAnalysis, decompose_query
from app.services.query_preprocessor import QuerySignals, build_file_patterns, preprocess_query
from app.services.reranker import rerank_chunks

logger = logging.getLogger("code-intel.search")

_FIND_STOP_WORDS = {
    "where", "what", "which", "when", "why", "how", "find", "show",
    "list", "happening", "happen", "happens", "used", "using", "usage",
    "workflow", "workflows", "code", "base", "codebase", "there", "here",
    "the", "and", "or", "is", "are", "can", "could", "would", "should",
    "i", "me", "my", "a", "an", "to", "of", "in", "on", "for", "with",
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


async def retrieve_context(
    project_id: str,
    user_id: str,
    query: str,
    branch: Optional[str] = None,
    limit: int = 10,
    signals: Optional[QuerySignals] = None,
    mode: ModeEnum | str = ModeEnum.BUG,
) -> RetrieveResponse:
    full = await retrieve_context_full(project_id, user_id, query, branch, limit, signals, mode)
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
) -> FullSearchResult:
    mode_enum = mode if isinstance(mode, ModeEnum) else ModeEnum(mode)
    config = get_mode_config(mode_enum)
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
    analysis = await _analyze_query(query, config)
    concepts = analysis.concepts or _detect_concepts(query)
    if mode_enum == ModeEnum.FIND:
        concepts = _normalize_find_concepts(query, concepts)
    sub_queries = analysis.sub_queries or [query]
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
    logger.info(
        "[RETRIEVE] ranked_after_first_pass=%d top=%s score=%.4f",
        len(ranked),
        ranked[0].get("name") if ranked else None,
        _score(ranked[0]) if ranked else 0.0,
    )

    if config.refine and await _should_refine(query, ranked, mode_enum):
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
        ranked = _rank_find_candidates(fused, query, _normalize_find_concepts(query, _detect_concepts(query)), rank_limit)
        logger.info("[RANK] find ranking applied limit=%d returned=%d", rank_limit, len(ranked))
        return ranked[:rank_limit]
    if config.rerank:
        ranked = _hydrate_ranked_chunks(fused, project_id, user_id, min(len(fused), 60))
        ranked = await _attach_structure_similarity(ranked, query, concepts, project_id, user_id)
        ranked = await rerank_chunks(query, ranked, mode, rank_limit)
        logger.info("[RANK] rerank applied limit=%d returned=%d", rank_limit, len(ranked))
    else:
        logger.info("[RANK] rerank skipped")
    if config.mmr:
        ranked = _mmr(ranked, config.mmr_lambda, rank_limit)
        logger.info("[RANK] mmr applied lambda=%.2f returned=%d", config.mmr_lambda, len(ranked))
    else:
        logger.info("[RANK] mmr skipped")
    return ranked[:rank_limit]


async def _should_refine(query: str, ranked: list[dict], mode: ModeEnum) -> bool:
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
    for chunk in top_chunks:
        context.append({
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
            for summary_emb in summary_embeddings:
                results = vector_search(
                    project_id,
                    user_id,
                    summary_emb,
                    limit=limit,
                    branch=branch,
                )
                if results:
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
    if file_patterns:
        results = file_path_search(project_id, user_id, file_patterns, limit=limit)
        if results:
            lists.append(results)
        logger.info("[RECALL] filepath patterns=%s results=%d", file_patterns, len(results) if results else 0)
    else:
        logger.info("[RECALL] filepath skipped no file patterns")

    return lists, query_embedding


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
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return max(0.0, min(1.0, dot / (norm_a * norm_b)))


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


def _rank_find_candidates(chunks: list[dict], query: str, concepts: list[str], limit: int) -> list[dict]:
    terms = _find_terms(query)
    token_terms = {"token", "tokens", "access", "refresh", "jwt", "bearer", "cookie", "cookies"}
    auth_terms = {
        "auth", "authentication", "authorize", "authorization", "login", "logout",
        "session", "user", "google", "oauth", "middleware",
    }

    for chunk in chunks:
        haystack = _chunk_search_text(chunk)
        path_name = f"{chunk.get('file_path', '')} {chunk.get('name', '')}".lower()
        concepts_set = {str(c) for c in (chunk.get("concepts") or [])}

        lexical_hits = sum(1 for term in terms if term in haystack)
        exact_signal_hits = sum(1 for term in token_terms | auth_terms if term in terms and term in haystack)
        concept_hits = len(concepts_set.intersection(concepts))

        boost = lexical_hits * 0.05 + exact_signal_hits * 0.12 + concept_hits * 0.15
        if "auth" in concepts and any(term in path_name for term in auth_terms | token_terms):
            boost += 0.35
        if any(term in terms for term in token_terms) and any(term in haystack for term in token_terms):
            boost += 0.30
        if any(term in path_name for term in ("auth", "login", "user", "token", "middleware", "google")):
            boost += 0.20

        base = _score(chunk)
        chunk["find_score"] = min(base + boost, 1.0)
        chunk["final_score"] = chunk["find_score"]
        if exact_signal_hits or concept_hits:
            reasons = []
            if exact_signal_hits:
                reasons.append("matches requested auth/token terms")
            if concept_hits:
                reasons.append(f"shares concepts: {', '.join(sorted(concepts_set.intersection(concepts)))}")
            chunk["relevance_reasoning"] = "; ".join(reasons)

    ranked = sorted(chunks, key=lambda c: c.get("find_score", 0), reverse=True)
    return ranked[:limit]


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
        if word.endswith("s") and len(word) > 3:
            variants.add(word[:-1])
    return variants


def _find_terms(query: str) -> set[str]:
    return {
        word for word in _word_variants(query)
        if len(word) >= 3 and word not in _FIND_STOP_WORDS
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
