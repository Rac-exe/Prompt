"""
GET /api/pipeline/status  — current pipeline fingerprint and all config values
GET /api/pipeline/compare — compare retrieval results across pipeline versions
"""

from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, Query

from app.auth import require_auth
from app.config import (
    APP_VERSION,
    ASK_BROAD_LIMIT,
    ASK_RERANK_LIMIT,
    BUG_BROAD_LIMIT,
    BUG_RERANK_LIMIT,
    FIND_BOOST_BODY,
    FIND_BOOST_CONCEPT,
    FIND_BOOST_LEXICAL,
    FIND_BOOST_PATH,
    FIND_BOOST_SIGNAL,
    FIND_BOOST_SIGNATURE,
    FIND_BROAD_LIMIT,
    FIND_PENALTY_MISS,
    GRAPH_DEPTH_OPTIMIZE,
    GRAPH_MAX_DEPTH,
    GRAPH_MAX_OPTIMIZE,
    GRAPH_MAX_RELATED,
    GRAPH_SEEDS_ASK,
    GRAPH_SEEDS_BUG,
    GRAPH_SEEDS_OPTIMIZE,
    ITERATIVE_REFINEMENT_THRESHOLD,
    MAX_ITERATIONS,
    MMR_ASK_LAMBDA,
    MMR_LAMBDA,
    MMR_OPTIMIZE_LAMBDA,
    OPTIMIZE_BROAD_LIMIT,
    OPTIMIZE_RERANK_LIMIT,
    PIPELINE_FINGERPRINT,
    PIPELINE_TAG,
    PIPELINE_VARIANTS,
    QUERY_DECOMPOSE_MODEL,
    QUERY_REFINER_MODEL,
    RERANKER_MODEL,
    STRUCTURE_SIMILARITY_WEIGHT,
    SUMMARIZER_MODEL,
)
from app.db import local_store

logger = logging.getLogger("code-intel.routes.pipeline")
router = APIRouter(tags=["pipeline"])


@router.get("/pipeline/status")
async def pipeline_status(auth: dict = Depends(require_auth)):
    """
    Return the current pipeline fingerprint and all retrieval-affecting config
    values.  Use this to confirm which version of the pipeline is running
    before comparing results in /api/pipeline/compare.
    """
    return {
        "pipeline_tag": PIPELINE_TAG,
        "pipeline_fingerprint": PIPELINE_FINGERPRINT,
        "app_version": APP_VERSION,
        "available_variants": list(PIPELINE_VARIANTS.keys()),
        "config": {
            "broad_limits": {
                "find": FIND_BROAD_LIMIT,
                "ask": ASK_BROAD_LIMIT,
                "bug": BUG_BROAD_LIMIT,
                "optimize": OPTIMIZE_BROAD_LIMIT,
            },
            "rerank_limits": {
                "ask": ASK_RERANK_LIMIT,
                "bug": BUG_RERANK_LIMIT,
                "optimize": OPTIMIZE_RERANK_LIMIT,
            },
            "mmr_lambdas": {
                "bug": MMR_LAMBDA,
                "ask": MMR_ASK_LAMBDA,
                "optimize": MMR_OPTIMIZE_LAMBDA,
            },
            "graph": {
                "max_depth": GRAPH_MAX_DEPTH,
                "max_related": GRAPH_MAX_RELATED,
                "seeds_bug": GRAPH_SEEDS_BUG,
                "seeds_ask": GRAPH_SEEDS_ASK,
                "seeds_optimize": GRAPH_SEEDS_OPTIMIZE,
                "depth_optimize": GRAPH_DEPTH_OPTIMIZE,
                "max_optimize": GRAPH_MAX_OPTIMIZE,
            },
            "refinement": {
                "threshold": ITERATIVE_REFINEMENT_THRESHOLD,
                "max_iterations": MAX_ITERATIONS,
            },
            "structure_similarity_weight": STRUCTURE_SIMILARITY_WEIGHT,
            "find_boost_weights": {
                "lexical": FIND_BOOST_LEXICAL,
                "path": FIND_BOOST_PATH,
                "signature": FIND_BOOST_SIGNATURE,
                "body": FIND_BOOST_BODY,
                "signal": FIND_BOOST_SIGNAL,
                "concept": FIND_BOOST_CONCEPT,
                "penalty_miss": FIND_PENALTY_MISS,
            },
            "models": {
                "reranker": RERANKER_MODEL,
                "decomposer": QUERY_DECOMPOSE_MODEL,
                "refiner": QUERY_REFINER_MODEL,
                "summarizer": SUMMARIZER_MODEL,
            },
        },
    }


@router.get("/pipeline/compare")
async def pipeline_compare(
    project_id: str = Query(..., description="Project to compare results for"),
    tag_a: str = Query(..., description="First pipeline tag (e.g. '1.1.0-a3f9c2b1')"),
    tag_b: str = Query(..., description="Second pipeline tag to compare against"),
    limit: int = Query(default=20, ge=1, le=100, description="Max queries to compare"),
    auth: dict = Depends(require_auth),
):
    """
    Compare retrieval results between two pipeline versions for the same project.

    Returns:
    - queries run under both tags
    - how many result IDs overlapped vs. changed
    - which chunks appeared in one version but not the other

    Use /api/pipeline/status to see the current tag and all historical tags
    visible in retrieval_searches.
    """
    user_id = auth.get("sub")

    try:
        rows_a = local_store.get_searches_by_variant(project_id, user_id, tag_a, limit)
        rows_b = local_store.get_searches_by_variant(project_id, user_id, tag_b, limit)
    except Exception as e:
        logger.warning("pipeline_compare DB query failed: %s", e)
        return {"error": str(e), "tag_a": tag_a, "tag_b": tag_b, "matches": []}

    # Build lookup: query_text+mode → row for each tag
    index_a: dict[str, dict] = {
        f"{r['query_text']}|{r['mode']}": r for r in rows_a
    }
    index_b: dict[str, dict] = {
        f"{r['query_text']}|{r['mode']}": r for r in rows_b
    }

    common_keys = set(index_a) & set(index_b)
    comparisons = []

    for key in sorted(common_keys):
        row_a = index_a[key]
        row_b = index_b[key]
        ids_a = set(row_a.get("retrieved_chunk_ids") or [])
        ids_b = set(row_b.get("retrieved_chunk_ids") or [])
        overlap = ids_a & ids_b
        only_in_a = ids_a - ids_b
        only_in_b = ids_b - ids_a
        comparisons.append({
            "query": row_a["query_text"],
            "mode": row_a["mode"],
            "overlap_count": len(overlap),
            "only_in_a_count": len(only_in_a),
            "only_in_b_count": len(only_in_b),
            "overlap_pct": round(len(overlap) / max(len(ids_a | ids_b), 1) * 100, 1),
            "only_in_a": sorted(only_in_a)[:10],
            "only_in_b": sorted(only_in_b)[:10],
            "search_id_a": row_a["id"],
            "search_id_b": row_b["id"],
        })

    avg_overlap = (
        sum(c["overlap_pct"] for c in comparisons) / len(comparisons)
        if comparisons else 0.0
    )

    return {
        "tag_a": tag_a,
        "tag_b": tag_b,
        "queries_in_a": len(rows_a),
        "queries_in_b": len(rows_b),
        "queries_comparable": len(comparisons),
        "avg_overlap_pct": round(avg_overlap, 1),
        "summary": (
            f"{len(comparisons)} queries compared. "
            f"Average result overlap: {avg_overlap:.1f}%. "
            f"{'High overlap — pipelines behave similarly.' if avg_overlap > 70 else 'Low overlap — pipelines produce meaningfully different results.'}"
        ),
        "comparisons": comparisons,
    }
