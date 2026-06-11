"""
Passive logger for REAL user sessions (the 6-pilot test).

Unlike runner.py (which drives the agent), this observes a human using Claude
Code / Codex normally. The user marks task boundaries; everything cost-related
is captured automatically and written as the SAME RunRecord JSON the controlled
harness produces — so report.py analyses both, and you can also feed the raw
JSON straight to an LLM without report.py at all.

What is always captured (does not depend on knowing the task):
  - agent tokens (parsed from the agent's own session log)
  - PRMPT's OpenRouter spend (key usage delta across the session window)
  - start/end/wall-clock
  - files touched (git diff in the repo)

What is optional (the "if-and-but" you can't always control):
  - success: self-reported y/n at stop, OR left unscored
  - turns: self-reported if you track it

Usage:
    # when the user begins a task
    python -m benchmarks.passive start \
        --repo /path/to/their/repo --agent claude \
        --variant mcp_optimizer --task "fix the import bug" \
        --state .passive_state.json

    # ... user works in Claude Code / Codex normally ...

    # when the task is done
    python -m benchmarks.passive stop \
        --state .passive_state.json --results ./results/pilot \
        --success yes --turns 7         # or: --success unknown
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import time
import uuid
from pathlib import Path

import yaml

from benchmarks import openrouter
from benchmarks.adapters import claude_adapter, codex_adapter
from benchmarks.metrics import (
    Agent, AgentUsage, Hardening, Outcome, PrmptUsage, RunRecord, Variant,
)


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _git_head(repo: str) -> str:
    try:
        return subprocess.run(
            ["git", "-C", repo, "rev-parse", "HEAD"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    except subprocess.CalledProcessError:
        return ""


def _files_touched(repo: str) -> list[str]:
    out = subprocess.run(
        ["git", "-C", repo, "diff", "--name-only"],
        capture_output=True, text=True,
    ).stdout
    return [l.strip() for l in out.splitlines() if l.strip()]


def _load_cfg(path: str | None) -> dict:
    if path and Path(path).exists():
        return yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    return {}


def cmd_start(args: argparse.Namespace) -> int:
    cfg = _load_cfg(args.config)
    or_key_env = cfg.get("prmpt", {}).get("openrouter_api_key_env", "OPENROUTER_API_KEY")
    import os
    or_key = os.environ.get(or_key_env, "")

    state = {
        "run_id": uuid.uuid4().hex[:12],
        "repo": str(Path(args.repo).resolve()),
        "agent": args.agent,
        "variant": args.variant,
        "task": args.task,
        "task_id": args.task_id or args.task[:40],
        "model": args.model or "",
        "started_at": _now(),
        "start_perf": time.time(),
        "base_commit": _git_head(args.repo),
        "or_before": openrouter.get_key_usage(or_key),
    }
    Path(args.state).write_text(json.dumps(state, indent=2), encoding="utf-8")
    print(f"[passive] started task '{state['task_id']}' run={state['run_id']}")
    return 0


def cmd_stop(args: argparse.Namespace) -> int:
    cfg = _load_cfg(args.config)
    pcfg = cfg.get("passive", {})
    import os
    or_key_env = cfg.get("prmpt", {}).get("openrouter_api_key_env", "OPENROUTER_API_KEY")
    or_key = os.environ.get(or_key_env, "")

    state = json.loads(Path(args.state).read_text(encoding="utf-8"))
    agent = Agent(state["agent"])
    start_perf = state["start_perf"]

    # ── agent tokens from its own session log produced during the window ─────
    if agent == Agent.CLAUDE:
        sess = claude_adapter.latest_session_since(start_perf)
        usage = claude_adapter.parse_session_usage(sess) if sess else AgentUsage()
        usage.cost_usd = round(
            usage.input_tokens / 1000 * pcfg.get("claude_cost_per_1k_input", 0.0)
            + usage.output_tokens / 1000 * pcfg.get("claude_cost_per_1k_output", 0.0)
            + usage.cache_read_tokens / 1000 * pcfg.get("claude_cost_per_1k_cache_read", 0.0),
            6,
        )
    else:
        sessions_dir = cfg.get("codex", {}).get("sessions_dir", "~/.codex/sessions")
        roll = codex_adapter.latest_rollout_since(sessions_dir, start_perf)
        usage = codex_adapter.parse_rollout_usage(roll) if roll else AgentUsage()
        usage.cost_usd = round(
            usage.input_tokens / 1000 * pcfg.get("codex_cost_per_1k_input", 0.0)
            + (usage.output_tokens + usage.reasoning_tokens) / 1000 * pcfg.get("codex_cost_per_1k_output", 0.0),
            6,
        )

    # ── PRMPT OpenRouter spend over the window ───────────────────────────────
    pu = PrmptUsage()
    if state.get("or_before") is not None and Variant(state["variant"]) != Variant.RAW:
        or_after = openrouter.settled_usage(or_key)
        pu.agent_loop_cost_usd = openrouter.usage_delta(state["or_before"], or_after)
        pu.reconciled = True

    # ── outcome (optional success) ───────────────────────────────────────────
    if args.success in ("yes", "no"):
        outcome = Outcome(
            passed=(args.success == "yes"),
            success_source="self_report", success_known=True,
        )
    else:  # unknown / unscored
        outcome = Outcome(passed=False, success_source="unscored", success_known=False)
    outcome.retries = args.retries
    if args.turns:
        usage.turns = args.turns
    outcome.wall_clock_s = round(time.time() - start_perf, 2)
    outcome.files_touched = _files_touched(state["repo"])

    rec = RunRecord(
        run_id=state["run_id"], task_id=state["task_id"], agent=agent,
        variant=Variant(state["variant"]),
        hardening=Hardening.NONE, repeat=0, model=state.get("model", ""),
        repo=state["repo"], base_commit=state.get("base_commit", ""),
        raw_prompt=state["task"], final_prompt="",
        started_at=state["started_at"], finished_at=_now(),
    )
    rec.agent_usage = usage
    rec.prmpt_usage = pu
    rec.outcome = outcome

    results_dir = Path(args.results)
    results_dir.mkdir(parents=True, exist_ok=True)
    out = results_dir / f"passive__{rec.task_id}__{agent.value}__{rec.variant.value}__{rec.run_id}.json"
    out.write_text(rec.to_json(), encoding="utf-8")
    Path(args.state).unlink(missing_ok=True)
    print(f"[passive] logged {out.name}  agent=${usage.cost_usd:.4f} "
          f"prmpt=${pu.total_cost_usd:.4f} success={outcome.success_source}:{args.success}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Passive real-user session logger.")
    ap.add_argument("--config", default="benchmarks/config.yaml")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("start")
    s.add_argument("--repo", required=True)
    s.add_argument("--agent", required=True, choices=[a.value for a in Agent])
    s.add_argument("--variant", required=True, choices=[v.value for v in Variant])
    s.add_argument("--task", required=True)
    s.add_argument("--task-id", default=None)
    s.add_argument("--model", default=None)
    s.add_argument("--state", default=".passive_state.json")
    s.set_defaults(func=cmd_start)

    t = sub.add_parser("stop")
    t.add_argument("--state", default=".passive_state.json")
    t.add_argument("--results", required=True)
    t.add_argument("--success", default="unknown", choices=["yes", "no", "unknown"])
    t.add_argument("--turns", type=int, default=0)
    t.add_argument("--retries", type=int, default=0)
    t.set_defaults(func=cmd_stop)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
