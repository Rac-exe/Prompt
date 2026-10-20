from __future__ import annotations

import dataclasses
import logging
from dataclasses import dataclass
from app.config import (
    ASK_BROAD_LIMIT,
    ASK_RERANK_LIMIT,
    BUG_BROAD_LIMIT,
    BUG_RERANK_LIMIT,
    FIND_BROAD_LIMIT,
    GRAPH_DEPTH_OPTIMIZE,
    GRAPH_MAX_OPTIMIZE,
    GRAPH_SEEDS_ASK,
    GRAPH_SEEDS_BUG,
    GRAPH_SEEDS_OPTIMIZE,
    MMR_ASK_LAMBDA,
    MMR_LAMBDA,
    MMR_OPTIMIZE_LAMBDA,
    OPTIMIZE_BROAD_LIMIT,
    OPTIMIZE_RERANK_LIMIT,
    PIPELINE_VARIANTS,
)
from app.db.models import ModeEnum

logger = logging.getLogger("code-intel.mode_router")


@dataclass(frozen=True)
class ModeConfig:
    mode: ModeEnum
    decompose: bool
    vector_search: bool
    broad_limit: int
    rerank: bool
    rerank_limit: int
    mmr: bool
    mmr_lambda: float
    graph_expand: bool
    graph_seeds: int
    graph_depth: int
    graph_max: int
    refine: bool
    generate_answer: bool
    # Graph-aware search path — used when GRAPH_BUILDER_ENABLED=true.
    # "flat"             — existing vector + text + concept + filepath recall (default)
    # "local"            — anchor discovery → community scope → PageRank rank
    # "global"           — community report matching → top member chunks
    # "drift"            — PRIMER (global) → FOLLOW-UP (local × n) → MERGE
    # "local_centrality" — local search with subgraph centrality ranking
    search_path: str = "flat"


MODE_CONFIGS = {
    ModeEnum.FIND: ModeConfig(
        mode=ModeEnum.FIND,
        decompose=False,
        vector_search=False,
        broad_limit=FIND_BROAD_LIMIT,
        rerank=False,
        rerank_limit=FIND_BROAD_LIMIT,
        mmr=False,
        mmr_lambda=1.0,
        graph_expand=False,
        graph_seeds=0,
        graph_depth=0,
        graph_max=0,
        refine=False,
        generate_answer=False,
        # FIND uses the flat path: multi-channel recall → _rank_find_candidates.
        # That scorer already applies FIND_PAGERANK_WEIGHT so graph data is used.
        # Community/local search requires populated concept embeddings (from a full
        # re-index with GRAPH_BUILDER_ENABLED) and is better suited for structural
        # exploration, not symbol-level lookup.
        search_path="flat",
    ),
    ModeEnum.ASK: ModeConfig(
        mode=ModeEnum.ASK,
        decompose=True,
        vector_search=True,
        broad_limit=ASK_BROAD_LIMIT,
        rerank=True,
        rerank_limit=ASK_RERANK_LIMIT,
        mmr=True,
        mmr_lambda=MMR_ASK_LAMBDA,
        graph_expand=True,
        graph_seeds=GRAPH_SEEDS_ASK,
        graph_depth=2,
        graph_max=20,
        refine=True,
        generate_answer=True,
        search_path="global",
    ),
    ModeEnum.BUG: ModeConfig(
        mode=ModeEnum.BUG,
        decompose=True,
        vector_search=True,
        broad_limit=BUG_BROAD_LIMIT,
        rerank=True,
        rerank_limit=BUG_RERANK_LIMIT,
        mmr=True,
        mmr_lambda=MMR_LAMBDA,
        graph_expand=True,
        graph_seeds=GRAPH_SEEDS_BUG,
        graph_depth=2,
        graph_max=20,
        refine=True,
        generate_answer=False,
        search_path="drift",
    ),
    ModeEnum.OPTIMIZE: ModeConfig(
        mode=ModeEnum.OPTIMIZE,
        decompose=True,
        vector_search=True,
        broad_limit=OPTIMIZE_BROAD_LIMIT,
        rerank=True,
        rerank_limit=OPTIMIZE_RERANK_LIMIT,
        mmr=True,
        mmr_lambda=MMR_OPTIMIZE_LAMBDA,
        graph_expand=True,
        graph_seeds=GRAPH_SEEDS_OPTIMIZE,
        graph_depth=GRAPH_DEPTH_OPTIMIZE,
        graph_max=GRAPH_MAX_OPTIMIZE,
        refine=True,
        generate_answer=False,
        search_path="local_centrality",
    ),
}


def get_mode_config(mode: ModeEnum | str | None, variant: str | None = None) -> ModeConfig:
    if mode is None:
        mode = ModeEnum.BUG
    if not isinstance(mode, ModeEnum):
        mode = ModeEnum(mode)
    base = MODE_CONFIGS[mode]
    if not variant:
        return base
    overrides = PIPELINE_VARIANTS.get(variant)
    if not overrides:
        logger.warning("[MODE] Unknown variant %r, ignoring", variant)
        return base
    try:
        config = dataclasses.replace(base, **overrides)
        logger.info("[MODE] Variant %r applied to mode %s: %s", variant, mode.value, overrides)
        return config
    except TypeError as e:
        logger.warning("[MODE] Invalid variant overrides for %r: %s", variant, e)
        return base
