"""
Run-record schema for the PRMPT benchmark harness.

One RunRecord is produced per (agent x variant x task x repeat) cell. Everything
the report needs is captured here so the report step is a pure function of the
recorded JSON — no re-running, no live API calls during reporting.

Three cost planes are tracked separately and only combined at report time:
  - agent_*   : tokens/cost spent by the coding agent (Claude Code / Codex)
  - prmpt_*   : tokens/cost spent by PRMPT itself on OpenRouter
                (indexing + prompt optimization + agentic retrieval loop)
  - outcome_* : did the task actually get fixed, and how expensively in time

Net savings is computed at report time as:
    net_saved = agent_cost(raw baseline) - (agent_cost(variant) + prmpt_cost(variant))
"""

from __future__ import annotations

import dataclasses
import json
from dataclasses import dataclass, field, asdict
from enum import Enum


class Agent(str, Enum):
    CLAUDE = "claude"
    CODEX = "codex"


class Variant(str, Enum):
    # Raw prompt straight to the agent, no PRMPT anything. The baseline.
    RAW = "raw"
    # Raw prompt -> PRMPT optimizer -> optimized prompt + MCP (agentic loop on).
    MCP_OPTIMIZER = "mcp_optimizer"
    # Raw prompt straight to agent, but PRMPT MCP available (no optimizer).
    MCP_ONLY = "mcp_only"


class Hardening(str, Enum):
    # Native search tools (Grep/Glob/find/rg) left enabled — organic tool choice.
    SOFT = "soft"
    # Native search tools denied — forces MCP usage. Stronger claim.
    HARD = "hard"
    # Not applicable (e.g. RAW baseline).
    NONE = "none"


@dataclass
class AgentUsage:
    """Plane 1 — the coding agent's own spend."""
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    reasoning_tokens: int = 0  # Codex: pulled from rollout file, not stdout.
    total_tokens: int = 0
    cost_usd: float = 0.0
    turns: int = 0
    # Tool-call counts so we can see whether native search was used vs the MCP.
    mcp_tool_calls: int = 0
    native_search_calls: int = 0  # Grep/Glob/find/rg invocations
    raw_session_path: str | None = None  # session/rollout file for audit


@dataclass
class PrmptUsage:
    """Plane 2 — PRMPT's own OpenRouter spend, by stage."""
    index_tokens: int = 0
    index_cost_usd: float = 0.0
    optimize_tokens: int = 0
    optimize_cost_usd: float = 0.0
    agent_loop_tokens: int = 0
    agent_loop_cost_usd: float = 0.0
    # OpenRouter generation ids captured during the run; reconciled post-hoc
    # against GET /api/v1/generation?id= for authoritative total_cost.
    generation_ids: list[str] = field(default_factory=list)
    reconciled: bool = False

    @property
    def total_tokens(self) -> int:
        return self.index_tokens + self.optimize_tokens + self.agent_loop_tokens

    @property
    def total_cost_usd(self) -> float:
        return self.index_cost_usd + self.optimize_cost_usd + self.agent_loop_cost_usd


@dataclass
class Outcome:
    """Plane 3 — did it actually work."""
    passed: bool = False          # verify_cmd exit 0 on first agent attempt
    retries: int = 0              # extra attempts the harness allowed
    wall_clock_s: float = 0.0
    files_touched: list[str] = field(default_factory=list)
    expected_files: list[str] = field(default_factory=list)
    verify_exit_code: int | None = None
    error: str | None = None      # harness-level failure (agent crashed, timeout)

    @property
    def precision(self) -> float | None:
        if not self.files_touched:
            return None
        if not self.expected_files:
            return None
        hit = len(set(self.files_touched) & set(self.expected_files))
        return round(hit / len(self.files_touched), 4)

    @property
    def recall(self) -> float | None:
        if not self.expected_files:
            return None
        hit = len(set(self.files_touched) & set(self.expected_files))
        return round(hit / len(self.expected_files), 4)


@dataclass
class RunRecord:
    run_id: str
    task_id: str
    agent: Agent
    variant: Variant
    hardening: Hardening
    repeat: int
    model: str
    repo: str
    base_commit: str
    raw_prompt: str
    final_prompt: str = ""        # optimized prompt if applicable, else raw
    started_at: str = ""
    finished_at: str = ""

    agent_usage: AgentUsage = field(default_factory=AgentUsage)
    prmpt_usage: PrmptUsage = field(default_factory=PrmptUsage)
    outcome: Outcome = field(default_factory=Outcome)

    def to_json(self) -> str:
        def _enc(o):
            if isinstance(o, Enum):
                return o.value
            if dataclasses.is_dataclass(o):
                return asdict(o)
            raise TypeError(type(o))
        return json.dumps(asdict(self), default=_enc, indent=2)

    @staticmethod
    def from_dict(d: dict) -> "RunRecord":
        rec = RunRecord(
            run_id=d["run_id"], task_id=d["task_id"],
            agent=Agent(d["agent"]), variant=Variant(d["variant"]),
            hardening=Hardening(d.get("hardening", "none")),
            repeat=d.get("repeat", 0), model=d.get("model", ""),
            repo=d.get("repo", ""), base_commit=d.get("base_commit", ""),
            raw_prompt=d.get("raw_prompt", ""), final_prompt=d.get("final_prompt", ""),
            started_at=d.get("started_at", ""), finished_at=d.get("finished_at", ""),
        )
        rec.agent_usage = AgentUsage(**d.get("agent_usage", {}))
        pu = dict(d.get("prmpt_usage", {}))
        pu.pop("total_tokens", None)
        pu.pop("total_cost_usd", None)
        rec.prmpt_usage = PrmptUsage(**pu)
        oc = dict(d.get("outcome", {}))
        oc.pop("precision", None)
        oc.pop("recall", None)
        rec.outcome = Outcome(**oc)
        return rec
