"""
Benchmark orchestrator.

For every (agent x variant x hardening x task x repeat) cell it:
  1. Creates an isolated git worktree of the task repo at base_commit (clean,
     parallel-safe, never touches the user's working tree).
  2. For MCP variants: indexes the repo and (for the optimizer variant) runs the
     PRMPT optimizer on the raw prompt — capturing OpenRouter generation ids.
  3. Runs the coding agent headlessly (Claude/Codex) with the raw-or-optimized
     prompt and the appropriate MCP config + hardening.
  4. Runs the task's verify_cmd as an objective pass/fail oracle.
  5. Writes one RunRecord JSON per cell into results/<batch>/.
  6. Tears the worktree down.

No LLM/agent drives this — it is plain subprocess orchestration, so there is no
"harness agent" spend to exclude. PRMPT's own OpenRouter spend is recorded
separately and reconciled to authoritative cost by reconcile.py afterwards.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shlex
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import yaml

from benchmarks import mcp_real, openrouter
from benchmarks.adapters import claude_adapter, codex_adapter
from benchmarks.metrics import (
    Agent, Hardening, Outcome, PrmptUsage, RunRecord, Variant,
)


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _run_shell(cmd: str, cwd: str, timeout: int) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, cwd=cwd, shell=True, capture_output=True, text=True, timeout=timeout,
    )


# ── git worktree isolation ───────────────────────────────────────────────────
def make_worktree(repo: Path, base_commit: str, dest: Path) -> str:
    """Create a clean worktree at base_commit. Returns the resolved commit sha."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        shutil.rmtree(dest, ignore_errors=True)
    sha = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", base_commit],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    subprocess.run(
        ["git", "-C", str(repo), "worktree", "add", "--detach", str(dest), sha],
        capture_output=True, text=True, check=True,
    )
    return sha


def remove_worktree(repo: Path, dest: Path) -> None:
    subprocess.run(
        ["git", "-C", str(repo), "worktree", "remove", "--force", str(dest)],
        capture_output=True, text=True,
    )
    if dest.exists():
        shutil.rmtree(dest, ignore_errors=True)


def files_touched(worktree: Path) -> list[str]:
    out = subprocess.run(
        ["git", "-C", str(worktree), "diff", "--name-only"],
        capture_output=True, text=True,
    ).stdout
    return [l.strip() for l in out.splitlines() if l.strip()]


# ── PRMPT hooks ──────────────────────────────────────────────────────────────
def _call_prmpt_hook(cmd_template: str, subs: dict, timeout: int) -> dict:
    cmd = cmd_template.format(**subs)
    proc = subprocess.run(shlex.split(cmd), capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(f"prmpt hook failed ({proc.returncode}): {proc.stderr[:300]}")
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return json.loads(line)


def prepare_prmpt(cfg: dict, variant: Variant, repo: str, raw_prompt: str,
                  run_id: str) -> tuple[str, PrmptUsage]:
    """Index (+optimize) as needed. Returns (final_prompt, PrmptUsage)."""
    pu = PrmptUsage()
    final_prompt = raw_prompt
    if variant == Variant.RAW:
        return final_prompt, pu

    # mcp-ahh path: index+optimize already ran offline in prepare.py. Read the
    # optimized prompt from the store and charge the amortized prep cost. No live
    # hooks, no per-run OpenRouter calls (the precomputed MCP server is free).
    store = cfg.get("prepared_store")
    if store:
        if variant == Variant.MCP_OPTIMIZER:
            repo_name = Path(cfg.get("_repo_name") or repo).name
            opt = mcp_real.optimized_prompt_for(store, repo_name, cfg.get("_prompt_id", "p1"))
            if opt:
                final_prompt = opt
        pu.optimize_cost_usd = mcp_real.prepare_cost_per_task(store)
        return final_prompt, pu

    pc = cfg["prmpt"]
    subs = {"repo": repo, "run_id": run_id, "prompt": shlex.quote(raw_prompt),
            "prompt_id": run_id, "out": ""}

    idx = _call_prmpt_hook(pc["index_cmd"], subs, cfg.get("per_run_timeout_s", 900))
    pu.index_tokens = idx.get("tokens", 0)
    pu.index_cost_usd = idx.get("cost_usd", 0.0)
    pu.generation_ids += idx.get("generation_ids", [])

    if variant == Variant.MCP_OPTIMIZER:
        opt = _call_prmpt_hook(pc["optimize_cmd"], subs, cfg.get("per_run_timeout_s", 900))
        pu.optimize_tokens = opt.get("tokens", 0)
        pu.optimize_cost_usd = opt.get("cost_usd", 0.0)
        pu.generation_ids += opt.get("generation_ids", [])
        if opt.get("result"):
            final_prompt = opt["result"]
    return final_prompt, pu


# ── one cell ─────────────────────────────────────────────────────────────────
def run_cell(cfg: dict, task: dict, agent: Agent, variant: Variant,
             hardening: Hardening, repeat: int, batch_dir: Path) -> RunRecord:
    run_id = uuid.uuid4().hex[:12]
    repo = Path(task["repo"]).resolve()
    model = cfg["claude_model"] if agent == Agent.CLAUDE else cfg["codex_model"]
    wt = Path(cfg["worktrees_dir"]).resolve() / f"{task['id']}-{run_id}"
    session_dir = batch_dir / "sessions" / run_id
    session_dir.mkdir(parents=True, exist_ok=True)

    rec = RunRecord(
        run_id=run_id, task_id=task["id"], agent=agent, variant=variant,
        hardening=hardening if variant != Variant.RAW else Hardening.NONE,
        repeat=repeat, model=model, repo=str(repo),
        base_commit=task.get("base_commit", "HEAD"),
        raw_prompt=task["raw_prompt"], started_at=_now(),
    )

    # OpenRouter usage-delta capture: snapshot the key's spend before any PRMPT
    # work and again after the agent finishes. The delta IS PRMPT's billed cost
    # (agent bills elsewhere), so no service-side change is needed. Requires
    # sequential runs (the harness runs sequentially).
    capture_or = bool(cfg.get("openrouter_cost_capture", True)) and variant != Variant.RAW
    or_key = os.environ.get(cfg.get("prmpt", {}).get("openrouter_api_key_env", "OPENROUTER_API_KEY"), "")
    or_before = openrouter.get_key_usage(or_key) if (capture_or and or_key) else None

    t0 = time.perf_counter()
    try:
        sha = make_worktree(repo, task.get("base_commit", "HEAD"), wt)
        rec.base_commit = sha

        repo_name = task.get("repo_name") or repo.name
        prompt_id = task.get("prompt_id", "p1")
        cfg["_repo_name"], cfg["_prompt_id"] = repo_name, prompt_id

        final_prompt, pu = prepare_prmpt(cfg, variant, str(wt), task["raw_prompt"], run_id)
        rec.final_prompt = final_prompt
        rec.prmpt_usage = pu

        mcp_config = None
        call_log: Path | None = None
        real_server = cfg.get("mcp_real_server")
        if variant in (Variant.MCP_OPTIMIZER, Variant.MCP_ONLY):
            if real_server:
                # Drive the REAL stdio MCP server with this task's prepared context.
                optimized = mcp_real.load_prepared(cfg.get("prepared_store", ""), repo_name)
                ctx = mcp_real.write_context(session_dir, repo_name, prompt_id, optimized)
                call_log = session_dir / "mcp-calls.jsonl"
                if agent == Agent.CLAUDE:
                    mcp_config = str(mcp_real.write_claude_config(
                        session_dir, real_server, ctx, call_log))
                else:
                    mcp_real.write_codex_config(wt, real_server, ctx, call_log)
                # Tell the agent to actually use the MCP route (availability
                # alone yields ~0 calls). Hard hardening forbids broad search.
                final_prompt += mcp_real.mcp_instruction(
                    prompt_id, hardening == Hardening.HARD)
                rec.final_prompt = final_prompt
            else:
                mcp_config = (cfg.get("mcp_config_claude") if agent == Agent.CLAUDE
                              else cfg.get("mcp_config_codex"))

        timeout = cfg.get("per_run_timeout_s", 900)
        if agent == Agent.CLAUDE:
            usage, _text = claude_adapter.run(
                bin_path=cfg["claude"]["bin"], prompt=final_prompt, model=model,
                cwd=str(wt), mcp_config=mcp_config, hardening=hardening,
                settings_file=cfg.get("hardening_claude_settings"),
                append_system_prompt_file=cfg.get("append_system_prompt_file"),
                extra_args=cfg["claude"].get("extra_args"),
                timeout_s=timeout, session_dir=str(session_dir),
            )
        else:
            usage, _text = codex_adapter.run(
                bin_path=cfg["codex"]["bin"], prompt=final_prompt, model=model,
                cwd=str(wt), sessions_dir=cfg["codex"]["sessions_dir"],
                cost_per_1k_input=cfg.get("codex_cost_per_1k_input", 0.0),
                cost_per_1k_output=cfg.get("codex_cost_per_1k_output", 0.0),
                hardening=hardening, timeout_s=timeout,
            )
        rec.agent_usage = usage

        # Definitive MCP-call count from the server's own log (beats the
        # session-parsed heuristic) when the real server is in play.
        if call_log is not None:
            n_calls, _tools = mcp_real.count_mcp_calls(call_log)
            rec.agent_usage.mcp_tool_calls = n_calls

        # PRMPT's authoritative OpenRouter spend = usage delta across the window
        # (covers indexing + optimize + any agentic-loop calls the MCP made
        # during the agent run). Supersedes the hooks' local estimates.
        if or_before is not None:
            or_after = openrouter.settled_usage(or_key)
            delta = openrouter.usage_delta(or_before, or_after)
            if not cfg.get("prepared_store"):
                # Live-pipeline path: the whole delta is PRMPT's spend.
                rec.prmpt_usage.index_cost_usd = 0.0
                rec.prmpt_usage.optimize_cost_usd = 0.0
            # With a prepared store, keep the amortized prep cost set above and
            # ADD any live spend (e.g. an agentic-loop call the MCP made).
            rec.prmpt_usage.agent_loop_cost_usd = delta
            rec.prmpt_usage.reconciled = True

        # ── objective oracle ─────────────────────────────────────────────────
        verify = _run_shell(task["verify_cmd"], cwd=str(wt),
                            timeout=task.get("timeout_s", timeout))
        rec.outcome = Outcome(
            passed=(verify.returncode == 0),
            verify_exit_code=verify.returncode,
            files_touched=files_touched(wt),
            expected_files=task.get("expected_files", []),
            wall_clock_s=round(time.perf_counter() - t0, 2),
        )
    except subprocess.TimeoutExpired:
        rec.outcome = Outcome(passed=False, error="timeout",
                              wall_clock_s=round(time.perf_counter() - t0, 2))
    except Exception as e:  # harness-level failure, never a silent $0 success
        rec.outcome = Outcome(passed=False, error=f"{type(e).__name__}: {e}"[:400],
                              wall_clock_s=round(time.perf_counter() - t0, 2))
    finally:
        remove_worktree(repo, wt)
        rec.finished_at = _now()

    out_file = batch_dir / f"{rec.task_id}__{agent.value}__{variant.value}__{rec.hardening.value}__r{repeat}__{run_id}.json"
    out_file.write_text(rec.to_json(), encoding="utf-8")
    return rec


def _variant_hardenings(cfg: dict, variant: Variant) -> list[Hardening]:
    if variant == Variant.RAW:
        return [Hardening.NONE]
    return [Hardening(h) for h in cfg.get("hardenings", ["soft"])]


def main() -> None:
    ap = argparse.ArgumentParser(description="Run the PRMPT benchmark matrix.")
    ap.add_argument("--config", default="benchmarks/config.yaml")
    ap.add_argument("--tasks", default="benchmarks/tasks.yaml")
    ap.add_argument("--only-task", default=None, help="run a single task id")
    ap.add_argument("--batch", default=None, help="batch name (default: timestamp)")
    args = ap.parse_args()

    cfg = yaml.safe_load(Path(args.config).read_text(encoding="utf-8"))
    tasks = yaml.safe_load(Path(args.tasks).read_text(encoding="utf-8"))["tasks"]
    if args.only_task:
        tasks = [t for t in tasks if t["id"] == args.only_task]

    batch = args.batch or dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    batch_dir = Path(cfg["results_dir"]).resolve() / batch
    batch_dir.mkdir(parents=True, exist_ok=True)

    agents = [Agent(a) for a in cfg["agents"]]
    variants = [Variant(v) for v in cfg["variants"]]
    repeats = int(cfg.get("repeats", 1))

    total = 0
    for task in tasks:
        for agent in agents:
            for variant in variants:
                for hard in _variant_hardenings(cfg, variant):
                    for r in range(repeats):
                        cell = f"{task['id']} | {agent.value} | {variant.value} | {hard.value} | r{r}"
                        print(f"[RUN] {cell}", flush=True)
                        rec = run_cell(cfg, task, agent, variant, hard, r, batch_dir)
                        status = "PASS" if rec.outcome.passed else f"FAIL({rec.outcome.error or rec.outcome.verify_exit_code})"
                        print(f"      -> {status}  agent=${rec.agent_usage.cost_usd:.4f} "
                              f"prmpt_gen_ids={len(rec.prmpt_usage.generation_ids)}", flush=True)
                        total += 1

    print(f"\nDone. {total} runs in {batch_dir}")
    print("Next: python -m benchmarks.reconcile --results "
          f"{batch_dir}  then  python -m benchmarks.report --results {batch_dir}")


if __name__ == "__main__":
    main()
