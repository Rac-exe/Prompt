from __future__ import annotations

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
)
from app.db.models import ModeEnum


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
    ),
}


def get_mode_config(mode: ModeEnum | str | None) -> ModeConfig:
    if mode is None:
        return MODE_CONFIGS[ModeEnum.BUG]
    if not isinstance(mode, ModeEnum):
        mode = ModeEnum(mode)
    return MODE_CONFIGS[mode]
