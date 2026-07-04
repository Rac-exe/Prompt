"""
run_cc.py — Full Command Code benchmark: all 9 tasks × raw + mcp_optimizer.

Records pass/fail, wall clock, turn count, tool-call breakdown per run.
Cost is NOT auto-captured (Command Code has no billing API).
After the run completes, check Studio → Usage for the exact time window
printed at the end, sum the rows, and fill in the cost manually.

Usage (from repo root):
    python mcp-ahh/run_cc.py
    python mcp-ahh/run_cc.py --tasks mcp-ahh/tasks.yaml --only orbit-p3,atlas-p3
    python mcp-ahh/run_cc.py --hardening hard
"""

from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import subprocess
import sys
import time
import uuid
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from benchmarks import mcp_real
from benchmarks.adapters import command_code_adapter
from benchmarks.metrics import Agent, Hardening, Variant
from benchmarks.runner import make_worktree, remove_worktree, prepare_prmpt


def _run_shell(cmd: str, cwd: str, timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, cwd=cwd, shell=True, capture_output=True, text=True, timeout=timeout,
    )


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _now_local() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def run_one(cfg: dict, task: dict, variant: Variant, hardening: Hardening,
            store: str, batch_dir: Path) -> dict:
    run_id = uuid.uuid4().hex[:8]
    repo = Path(task["repo"]).resolve()
    model = cfg.get("command_code_model", "deepseek-v4-pro")
    bin_path = cfg["command_code"]["bin"]
    script_path = cfg["command_code"].get("script")
    wt = Path(cfg["worktrees_dir"]).resolve() / f"cc-{task['id']}-{variant.value}-{run_id}"
    session_dir = batch_dir / "sessions" / run_id
    session_dir.mkdir(parents=True, exist_ok=True)

    repo_name = task.get("repo_name") or repo.name
    prompt_id = task.get("prompt_id", "p1")

    cfg = dict(cfg)
    cfg["prepared_store"] = store
    cfg["_repo_name"] = repo_name
    cfg["_prompt_id"] = prompt_id

    row = {
        "run_id": run_id,
        "task_id": task["id"],
        "repo_name": repo_name,
        "prompt_id": prompt_id,
        "variant": variant.value,
        "hardening": hardening.value,
        "model": model,
        "raw_prompt": task["raw_prompt"],
        "final_prompt": task["raw_prompt"],
        "passed": False,
        "wall_clock_s": 0.0,
        "turns": 0,
        "mcp_calls": 0,
        "native_search_calls": 0,
        "tool_explore": 0,
        "tool_shell": 0,
        "tool_read": 0,
        "tool_write": 0,
        "tool_edit": 0,
        "input_tokens_est": 0,
        "output_tokens_est": 0,
        "prmpt_cost_usd": 0.0,
        "studio_cost_usd": None,   # filled in manually from Studio screenshot
        "started_at": _now_iso(),
        "finished_at": "",
        "error": None,
    }

    t0 = time.perf_counter()
    try:
        sha = make_worktree(repo, task.get("base_commit", "HEAD"), wt)
        row["base_commit"] = sha

        if not (wt / "node_modules").exists():
            _run_shell("npm install --prefer-offline", cwd=str(wt), timeout=120)

        final_prompt, pu = prepare_prmpt(cfg, variant, str(wt), task["raw_prompt"], run_id)
        row["final_prompt"] = final_prompt
        row["prmpt_cost_usd"] = pu.total_cost_usd

        call_log: Path | None = None
        if variant in (Variant.MCP_OPTIMIZER, Variant.MCP_ONLY):
            real_server = cfg.get("mcp_real_server", "")
            if real_server:
                optimized = mcp_real.load_prepared(store, repo_name)
                ctx = mcp_real.write_context(session_dir, repo_name, prompt_id, optimized)
                call_log = session_dir / "mcp-calls.jsonl"
                mcp_real.write_command_code_config(wt, real_server, ctx, call_log)
                final_prompt += mcp_real.mcp_instruction(prompt_id, hardening == Hardening.HARD)
                row["final_prompt"] = final_prompt

        usage, _ = command_code_adapter.run(
            bin_path=bin_path,
            prompt=final_prompt,
            model=model,
            cwd=str(wt),
            script_path=script_path,
            hardening=hardening,
            timeout_s=cfg.get("per_run_timeout_s", 900),
        )

        row["turns"] = usage.turns
        row["input_tokens_est"] = usage.input_tokens
        row["output_tokens_est"] = usage.output_tokens
        row["native_search_calls"] = usage.native_search_calls

        if call_log and call_log.exists():
            n, _ = mcp_real.count_mcp_calls(call_log)
            row["mcp_calls"] = n
        else:
            row["mcp_calls"] = usage.mcp_tool_calls

        # Count tool types from session JSONL
        if usage.raw_session_path:
            _count_tools(Path(usage.raw_session_path), row)

        oracle = _run_shell(task["verify_cmd"], cwd=str(wt), timeout=120)
        row["passed"] = (oracle.returncode == 0)

    except subprocess.TimeoutExpired:
        row["error"] = "timeout"
    except Exception as exc:
        row["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        row["wall_clock_s"] = round(time.perf_counter() - t0, 1)
        row["finished_at"] = _now_iso()
        remove_worktree(repo, wt)

    return row


def _count_tools(session: Path, row: dict) -> None:
    tool_map = {
        "explore": "tool_explore",
        "shell_command": "tool_shell",
        "read_file": "tool_read",
        "write_file": "tool_write",
        "edit_file": "tool_edit",
    }
    try:
        for line in session.read_text(encoding="utf-8", errors="ignore").splitlines():
            if not line.strip():
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if ev.get("role") != "assistant":
                continue
            for block in (ev.get("content") or []):
                if not isinstance(block, dict) or block.get("type") != "tool-call":
                    continue
                tname = block.get("toolName", "")
                if tname.startswith("mcp__"):
                    row["mcp_calls"] = row.get("mcp_calls", 0) + 1
                for key, col in tool_map.items():
                    if tname == key:
                        row[col] = row.get(col, 0) + 1
    except OSError:
        pass


def print_row(row: dict) -> None:
    status = "PASS" if row["passed"] else f"FAIL({row.get('error') or 'tests'})"
    print(f"  [{status:<14}] {row['task_id']:<12} {row['variant']:<15} "
          f"t={row['wall_clock_s']:>6.1f}s  turns={row['turns']}  "
          f"mcp={row['mcp_calls']}  prmpt=${row['prmpt_cost_usd']:.4f}")


def print_summary(results: list[dict]) -> None:
    print(f"\n{'═'*72}")
    print(f"  COMMAND CODE FULL BENCHMARK SUMMARY")
    print(f"{'═'*72}")

    raw_rows    = [r for r in results if r["variant"] == "raw"]
    prmpt_rows  = [r for r in results if r["variant"] == "mcp_optimizer"]

    raw_pass    = sum(1 for r in raw_rows   if r["passed"])
    prmpt_pass  = sum(1 for r in prmpt_rows if r["passed"])

    print(f"  RAW    pass: {raw_pass}/{len(raw_rows)}  "
          f"avg time: {sum(r['wall_clock_s'] for r in raw_rows)/max(len(raw_rows),1):.0f}s")
    print(f"  PRMPT  pass: {prmpt_pass}/{len(prmpt_rows)}  "
          f"avg time: {sum(r['wall_clock_s'] for r in prmpt_rows)/max(len(prmpt_rows),1):.0f}s")

    print(f"\n  {'Task':<12} {'RAW time':>10} {'PRMPT time':>12} {'Time saved':>12} {'RAW':>5} {'PRMPT':>6}")
    print(f"  {'─'*12} {'─'*10} {'─'*12} {'─'*12} {'─'*5} {'─'*6}")

    task_ids = sorted(set(r["task_id"] for r in results))
    for tid in task_ids:
        raw_r   = next((r for r in raw_rows   if r["task_id"] == tid), None)
        prmpt_r = next((r for r in prmpt_rows if r["task_id"] == tid), None)
        if not raw_r or not prmpt_r:
            continue
        rt = raw_r["wall_clock_s"]
        pt = prmpt_r["wall_clock_s"]
        saved = rt - pt
        saved_pct = saved / rt * 100 if rt > 0 else 0
        print(f"  {tid:<12} {rt:>9.1f}s {pt:>11.1f}s {saved_pct:>+10.1f}%  "
              f"{'P' if raw_r['passed'] else 'F':>5}  {'P' if prmpt_r['passed'] else 'F':>6}")
    print(f"{'═'*72}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config",    default="mcp-ahh/config.yaml")
    ap.add_argument("--tasks",     default="mcp-ahh/tasks.yaml")
    ap.add_argument("--store",     default="first-test/prepared")
    ap.add_argument("--hardening", default="soft", choices=["soft", "hard"])
    ap.add_argument("--only",      default="",
                    help="comma-separated task ids to run (default: all 9)")
    args = ap.parse_args()

    cfg        = yaml.safe_load(Path(args.config).read_text(encoding="utf-8"))
    tasks_all  = yaml.safe_load(Path(args.tasks).read_text(encoding="utf-8"))["tasks"]
    store      = str(Path(args.store).resolve())
    hardening  = Hardening(args.hardening)

    if args.only:
        wanted = {t.strip() for t in args.only.split(",")}
        tasks_all = [t for t in tasks_all if t["id"] in wanted]

    variants = [Variant.RAW, Variant.MCP_OPTIMIZER]
    total_runs = len(tasks_all) * len(variants)

    batch_name = f"cc-full-{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}"
    batch_dir  = Path(cfg["results_dir"]).resolve() / batch_name
    batch_dir.mkdir(parents=True, exist_ok=True)

    run_started = _now_local()
    print(f"\nCommand Code Full Benchmark")
    print(f"Model   : {cfg.get('command_code_model', 'deepseek-v4-pro')}")
    print(f"Tasks   : {len(tasks_all)} × {len(variants)} variants = {total_runs} runs")
    print(f"Store   : {store}")
    print(f"Batch   : {batch_dir}")
    print(f"Started : {run_started}  <-- use this for Studio filter")
    print(f"{'─'*72}")

    all_results: list[dict] = []
    run_n = 0

    for task in tasks_all:
        for variant in variants:
            run_n += 1
            h = Hardening.NONE if variant == Variant.RAW else hardening
            print(f"\n[{run_n:02d}/{total_runs}] {task['id']} | {variant.value} | {h.value}", flush=True)
            row = run_one(cfg, task, variant, h, store, batch_dir)
            all_results.append(row)
            print_row(row)

            # Save after every run (crash-safe)
            results_file = batch_dir / "results.jsonl"
            with results_file.open("a", encoding="utf-8") as f:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")

    run_finished = _now_local()
    print_summary(all_results)

    # Save full JSON
    full_file = batch_dir / "results_full.json"
    full_file.write_text(
        json.dumps(all_results, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print(f"\nResults : {batch_dir}")
    print(f"Started : {run_started}")
    print(f"Finished: {run_finished}")
    print(f"\n>>> Studio filter: {run_started}  to  {run_finished}")
    print(f">>> Open commandcode.ai/studio/usage, filter by this window,")
    print(f"    screenshot all rows, and share with me to merge cost data.")


if __name__ == "__main__":
    main()
