"""
demo_cmd.py — focused Command Code demo runner.

Runs atlas-p3 (highest-spread task) with:
  1. raw           — vague prompt straight to Command Code
  2. mcp_optimizer — PRMPT-optimized prompt + PRMPT MCP server active

Uses the pre-built prepared store from first-test/prepared/ so no live
PRMPT services are needed. Prints a side-by-side comparison table at the end.

Usage (from repo root):
    python mcp-ahh/demo_cmd.py

Optional flags:
    --task      atlas-p3           task id from tasks.yaml (default: atlas-p3)
    --store     first-test/prepared  path to prepared store (default above)
    --config    mcp-ahh/config.yaml
    --tasks     mcp-ahh/tasks.yaml
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

import yaml

# Force UTF-8 output on Windows (avoids charmap encode errors for box chars)
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# Make `benchmarks` importable from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from benchmarks import mcp_real
from benchmarks.adapters import command_code_adapter
from benchmarks.metrics import Agent, Hardening, Variant
from benchmarks.runner import (
    make_worktree, remove_worktree, files_touched,
    prepare_prmpt,
)


def _run_shell(cmd: str, cwd: str, timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, cwd=cwd, shell=True, capture_output=True, text=True, timeout=timeout,
    )


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def run_demo_variant(
    cfg: dict,
    task: dict,
    variant: Variant,
    hardening: Hardening,
    batch_dir: Path,
    store: str,
) -> dict:
    """Run one cell and return a summary dict."""
    run_id = uuid.uuid4().hex[:8]
    repo = Path(task["repo"]).resolve()
    model = cfg.get("command_code_model", "deepseek-v4-pro")
    bin_path = cfg["command_code"]["bin"]
    wt = Path(cfg["worktrees_dir"]).resolve() / f"demo-{task['id']}-{variant.value}-{run_id}"
    session_dir = batch_dir / run_id
    session_dir.mkdir(parents=True, exist_ok=True)

    repo_name = task.get("repo_name") or repo.name
    prompt_id = task.get("prompt_id", "p1")

    # Inject store path so prepare_prmpt can find the precomputed prompts
    cfg = dict(cfg)
    cfg["prepared_store"] = store
    cfg["_repo_name"] = repo_name
    cfg["_prompt_id"] = prompt_id

    print(f"\n{'─'*60}")
    print(f"  Variant : {variant.value}  |  Hardening : {hardening.value}")
    print(f"  Task    : {task['id']}  ({repo_name})")
    print(f"  Model   : {model}")
    print(f"{'─'*60}")

    result = {
        "variant": variant.value,
        "hardening": hardening.value,
        "raw_prompt": task["raw_prompt"],
        "final_prompt": task["raw_prompt"],
        "passed": False,
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
        "agent_cost_usd": 0.0,
        "prmpt_cost_usd": 0.0,
        "net_cost_usd": 0.0,
        "mcp_calls": 0,
        "wall_clock_s": 0.0,
        "error": None,
    }

    t0 = time.perf_counter()
    try:
        sha = make_worktree(repo, task.get("base_commit", "HEAD"), wt)
        print(f"  Worktree: {wt.name}  (commit {sha[:8]})")

        # Install node deps if not present (first run only)
        if not (wt / "node_modules").exists():
            print("  Installing node deps ...", flush=True)
            _run_shell("npm install --prefer-offline", cwd=str(wt), timeout=120)

        # PRMPT prepare (reads from store, no live services needed)
        final_prompt, pu = prepare_prmpt(cfg, variant, str(wt), task["raw_prompt"], run_id)
        result["final_prompt"] = final_prompt
        result["prmpt_cost_usd"] = pu.total_cost_usd

        # Set up real MCP server for non-raw variants
        call_log: Path | None = None
        if variant in (Variant.MCP_OPTIMIZER, Variant.MCP_ONLY):
            real_server = cfg.get("mcp_real_server", "")
            if real_server:
                optimized = mcp_real.load_prepared(store, repo_name)
                ctx = mcp_real.write_context(session_dir, repo_name, prompt_id, optimized)
                call_log = session_dir / "mcp-calls.jsonl"
                mcp_real.write_command_code_config(wt, real_server, ctx, call_log)
                final_prompt += mcp_real.mcp_instruction(prompt_id, hardening == Hardening.HARD)
                result["final_prompt"] = final_prompt
                print(f"  MCP server : {Path(real_server).name}")

        # Print what's being sent
        preview = final_prompt[:120].replace("\n", " ")
        print(f"  Prompt  : {preview}{'...' if len(final_prompt) > 120 else ''}")
        print(f"\n  Running command-code ...", flush=True)

        usage, text = command_code_adapter.run(
            bin_path=bin_path,
            prompt=final_prompt,
            model=model,
            cwd=str(wt),
            script_path=cfg["command_code"].get("script"),
            hardening=hardening,
            timeout_s=cfg.get("per_run_timeout_s", 900),
        )
        result["input_tokens"] = usage.input_tokens
        result["output_tokens"] = usage.output_tokens
        result["total_tokens"] = usage.total_tokens
        result["agent_cost_usd"] = usage.cost_usd
        result["mcp_calls"] = usage.mcp_tool_calls

        if call_log is not None and call_log.exists():
            n_calls, tools = mcp_real.count_mcp_calls(call_log)
            result["mcp_calls"] = n_calls
            if tools:
                print(f"  MCP tools called: {', '.join(tools)}")

        # Oracle: npm test
        print("  Running npm test (oracle) ...", flush=True)
        oracle = _run_shell(task["verify_cmd"], cwd=str(wt), timeout=120)
        passed = (oracle.returncode == 0)
        result["passed"] = passed
        print(f"  Oracle  : {'PASS' if passed else 'FAIL'} (exit {oracle.returncode})")
        if not passed and oracle.stdout:
            lines = [l for l in oracle.stdout.splitlines() if l.strip()][-6:]
            print("  --- test tail ---")
            for line in lines:
                print(f"    {line}")

    except subprocess.TimeoutExpired:
        result["error"] = "timeout"
        print("  ERROR: timeout")
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
        print(f"  ERROR: {exc}")
    finally:
        result["wall_clock_s"] = round(time.perf_counter() - t0, 1)
        result["net_cost_usd"] = result["agent_cost_usd"] + result["prmpt_cost_usd"]
        remove_worktree(repo, wt)

    return result


def print_comparison(raw: dict, prmpt: dict) -> None:
    def fmt_cost(v: float) -> str:
        return f"${v:.4f}" if v > 0 else "N/A (see OpenRouter)"

    def pct(a: float, b: float) -> str:
        if b == 0:
            return "—"
        return f"{((b - a) / b * 100):+.1f}%"

    print(f"\n{'═'*62}")
    print(f"  DEMO RESULTS — Command Code + PRMPT (atlas-p3)")
    print(f"{'═'*62}")
    print(f"  {'Metric':<28} {'RAW':>14} {'PRMPT+MCP':>14}")
    print(f"  {'─'*28} {'─'*14} {'─'*14}")
    print(f"  {'Task passed (npm test)':<28} {'PASS' if raw['passed'] else 'FAIL':>14} {'PASS' if prmpt['passed'] else 'FAIL':>14}")
    print(f"  {'Wall clock (s)':<28} {raw['wall_clock_s']:>14.1f} {prmpt['wall_clock_s']:>14.1f}")
    print(f"  {'Input tokens':<28} {raw['input_tokens']:>14,} {prmpt['input_tokens']:>14,}")
    print(f"  {'Output tokens':<28} {raw['output_tokens']:>14,} {prmpt['output_tokens']:>14,}")
    print(f"  {'Total tokens':<28} {raw['total_tokens']:>14,} {prmpt['total_tokens']:>14,}")
    print(f"  {'Agent cost':<28} {fmt_cost(raw['agent_cost_usd']):>14} {fmt_cost(prmpt['agent_cost_usd']):>14}")
    print(f"  {'PRMPT cost (amortized)':<28} {'$0.0000':>14} {fmt_cost(prmpt['prmpt_cost_usd']):>14}")
    print(f"  {'Net cost':<28} {fmt_cost(raw['net_cost_usd']):>14} {fmt_cost(prmpt['net_cost_usd']):>14}")
    print(f"  {'MCP tool calls':<28} {raw['mcp_calls']:>14} {prmpt['mcp_calls']:>14}")
    print(f"{'═'*62}")

    if raw["net_cost_usd"] > 0 and prmpt["net_cost_usd"] > 0:
        saving_pct = (raw["net_cost_usd"] - prmpt["net_cost_usd"]) / raw["net_cost_usd"] * 100
        label = f"Net saving: {saving_pct:+.1f}%"
        print(f"\n  {'='*40}")
        print(f"  {label}")
        print(f"  {'='*40}")
    else:
        print(f"\n  Note: token-level cost not available from Command Code stdout.")
        print(f"  Pass/fail and MCP call count are the primary signals.")

    print()


def main() -> None:
    ap = argparse.ArgumentParser(description="Command Code demo: raw vs PRMPT on atlas-p3")
    ap.add_argument("--task", default="atlas-p3", help="Task id (default: atlas-p3)")
    ap.add_argument("--store", default="first-test/prepared",
                    help="Prepared store directory (default: first-test/prepared)")
    ap.add_argument("--config", default="mcp-ahh/config.yaml")
    ap.add_argument("--tasks", default="mcp-ahh/tasks.yaml")
    ap.add_argument("--hardening", default="soft", choices=["soft", "hard"])
    args = ap.parse_args()

    cfg = yaml.safe_load(Path(args.config).read_text(encoding="utf-8"))
    tasks_list = yaml.safe_load(Path(args.tasks).read_text(encoding="utf-8"))["tasks"]
    task = next((t for t in tasks_list if t["id"] == args.task), None)
    if task is None:
        print(f"Task '{args.task}' not found in {args.tasks}", file=sys.stderr)
        sys.exit(1)

    store = str(Path(args.store).resolve())
    hardening = Hardening(args.hardening)

    batch_dir = Path(cfg["results_dir"]).resolve() / f"demo-cmd-{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}"
    batch_dir.mkdir(parents=True, exist_ok=True)

    print(f"\nPRMPT x Command Code Demo")
    print(f"Task      : {task['id']} — {task['raw_prompt'][:60]}...")
    print(f"Model     : {cfg.get('command_code_model', 'deepseek-v4-pro')}")
    print(f"Store     : {store}")
    print(f"Batch dir : {batch_dir}")

    # Run RAW first, then PRMPT+MCP
    raw_result = run_demo_variant(cfg, task, Variant.RAW, Hardening.NONE, batch_dir, store)
    prmpt_result = run_demo_variant(cfg, task, Variant.MCP_OPTIMIZER, hardening, batch_dir, store)

    # Save results
    results_file = batch_dir / "demo_results.json"
    results_file.write_text(
        json.dumps({"raw": raw_result, "prmpt": prmpt_result}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    print_comparison(raw_result, prmpt_result)
    print(f"Full results saved to: {results_file}")


if __name__ == "__main__":
    main()
