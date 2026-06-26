"""
3-arm PRMPT CLI benchmark runner.

For each task (9 = 3 repos x 3 vague prompts) it runs up to three arms, all on
the SAME base model (Claude Sonnet 4.6) so the only variable is the retrieval /
prompt layer:

  Arm A  — Claude Code + raw prompt        (control; model explores the repo)
  Arm B  — PRMPT CLI   + raw prompt        (isolates live-retrieval value)
  Arm C  — PRMPT CLI   + optimized prompt  (adds prompt-optimization value)

Each run is fully isolated: the task repo is copied to a fresh temp dir, the
agent edits it there, then `verify_cmd` (npm test) decides pass/fail. One record
is appended to results.jsonl immediately after each run (crash-safe).

This script ONLY orchestrates + measures. It does not start services or index
repos — run `harness/bootstrap_index.py` once first, and have code-intel (:8002)
running. It makes real (paid) model calls, so run it on the machine that holds
the API budget.

Usage:
    python prmpt-cli/harness/run_3arm.py                 # all arms, all tasks
    python prmpt-cli/harness/run_3arm.py --arms B,C       # skip Claude Code
    python prmpt-cli/harness/run_3arm.py --only-task orbit-p1
    python prmpt-cli/harness/run_3arm.py --repeats 3
    python prmpt-cli/harness/run_3arm.py --dry-run        # print plan, run nothing

Required env:
    OPENROUTER_API_KEY     base-model credential for the PRMPT CLI (Arms B/C)
    (Arm A uses whatever auth the `claude` CLI already has on this machine.)
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import yaml

CLI_ROOT = Path(__file__).resolve().parents[1]            # prmpt-cli/
REPO_ROOT = CLI_ROOT.parent                               # PROMPT/
DEFAULT_TASKS = REPO_ROOT / "mcp-ahh" / "tasks.yaml"
DEFAULT_STORE = REPO_ROOT / "first-test" / "prepared" / "optimized_by_repo.json"
FALLBACK_STORE = REPO_ROOT / "mcp-ahh" / "results" / "prepared" / "optimized_by_repo.json"
INDEX_MAP = CLI_ROOT / "index_map.json"
DIST_ENTRY = CLI_ROOT / "dist" / "index.js"

# Make the existing Claude Code adapter importable (Arm A).
sys.path.insert(0, str(REPO_ROOT))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_yaml(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def load_optimized(store_path: Path) -> dict:
    if not store_path.exists():
        return {}
    return json.loads(store_path.read_text(encoding="utf-8"))


def optimized_prompt_for(store: dict, repo_name: str, prompt_id: str) -> str:
    for item in store.get(repo_name, []):
        if item.get("prompt_id") == prompt_id:
            return item.get("optimized_prompt") or ""
    return ""


def copy_repo(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    # Copy source tree but skip any VCS/node_modules baggage (tasks use node:test,
    # no install needed). This is the per-run isolation boundary.
    shutil.copytree(
        src, dst,
        ignore=shutil.ignore_patterns(".git", "node_modules"),
    )


def run_verify(verify_cmd: str, cwd: Path, timeout_s: int = 300) -> tuple[bool, str]:
    try:
        proc = subprocess.run(
            verify_cmd, cwd=cwd, shell=True, capture_output=True,
            text=True, timeout=timeout_s,
        )
    except subprocess.TimeoutExpired:
        return False, "verify timed out"
    tail = (proc.stdout or "")[-1500:] + (proc.stderr or "")[-500:]
    return proc.returncode == 0, tail


def precision_recall(retrieved: list[str], expected: list[str]) -> tuple[float | None, float | None]:
    if not expected:
        return None, None
    exp = {e.replace("\\", "/") for e in expected}
    got = {r.replace("\\", "/") for r in retrieved}
    if not got:
        return 0.0, 0.0
    tp = len(exp & got)
    precision = tp / len(got) if got else 0.0
    recall = tp / len(exp) if exp else 0.0
    return round(precision, 3), round(recall, 3)


# ── Arm A: Claude Code ──────────────────────────────────────────────────────

def run_arm_a(task: dict, repo_dir: Path, model: str, timeout_s: int) -> dict:
    from benchmarks.adapters import claude_adapter
    from benchmarks.metrics import Hardening

    claude_bin = shutil.which("claude") or shutil.which("claude.cmd") or "claude"
    t0 = time.perf_counter()
    usage, final_text = claude_adapter.run(
        bin_path=claude_bin,
        prompt=task["raw_prompt"],
        model=model,
        cwd=str(repo_dir),
        hardening=Hardening.NONE,
        extra_args=["--permission-mode", "bypassPermissions"],
        timeout_s=timeout_s,
    )
    elapsed_ms = round((time.perf_counter() - t0) * 1000)
    return {
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
        "cache_read_tokens": usage.cache_read_tokens,
        "cache_write_tokens": usage.cache_write_tokens,
        "total_tokens": usage.total_tokens,
        "cost_usd": usage.cost_usd,
        "tool_calls": (usage.mcp_tool_calls + usage.native_search_calls),
        "retrieval_calls": 0,
        "retrieval_files": [],
        "context_tokens": None,
        "elapsed_ms": elapsed_ms,
        "agent_ok": bool(final_text.strip()),
        "raw_session_path": usage.raw_session_path,
    }


# ── Arms B / C: PRMPT CLI ───────────────────────────────────────────────────

def run_prmpt(task: dict, repo_dir: Path, prompt: str, idx: dict,
              out_dir: Path, run_id: str, model: str, provider: str,
              timeout_s: int) -> dict:
    usage_out = out_dir / f"{run_id}.usage.json"
    retrieve_log = out_dir / f"{run_id}.retrieve.jsonl"
    env = dict(os.environ)
    env.update({
        "PRMPT_CODE_INTEL_URL": idx["code_intel_url"],
        "PRMPT_CODE_INTEL_ROOT": idx["code_intel_root"],
        "PRMPT_PROJECT_ID": idx["projects"][task["repo_name"]],
        "PRMPT_DEV_AUTH_TOKEN": os.environ.get("PRMPT_DEV_AUTH_TOKEN", "dev-cli-token"),
        "PRMPT_RETRIEVE_LOG": str(retrieve_log),
        "PRMPT_USAGE_OUT": str(usage_out),
        "PRMPT_MODEL": model,
        "PRMPT_PROVIDER": provider,
    })
    # Pass the prompt via a temp file to avoid shell-quoting issues on long
    # optimized prompts.
    prompt_file = out_dir / f"{run_id}.prompt.txt"
    prompt_file.write_text(prompt, encoding="utf-8")
    cmd = ["node", str(DIST_ENTRY), "--cwd", str(repo_dir), "--prompt-file", str(prompt_file)]

    t0 = time.perf_counter()
    try:
        proc = subprocess.run(
            cmd, cwd=str(CLI_ROOT), env=env, capture_output=True,
            text=True, timeout=timeout_s,
        )
        agent_err = None if proc.returncode == 0 else (proc.stderr or "")[-800:]
    except subprocess.TimeoutExpired:
        agent_err = "prmpt cli timed out"
    elapsed_ms = round((time.perf_counter() - t0) * 1000)

    usage = {}
    if usage_out.exists():
        try:
            usage = json.loads(usage_out.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            usage = {}

    return {
        "input_tokens": usage.get("input_tokens", 0),
        "output_tokens": usage.get("output_tokens", 0),
        "cache_read_tokens": usage.get("cache_read_tokens", 0),
        "cache_write_tokens": usage.get("cache_write_tokens", 0),
        "total_tokens": usage.get("total_tokens", 0),
        "cost_usd": usage.get("cost_usd", 0.0),
        "tool_calls": usage.get("tool_calls", 0),
        "retrieval_calls": usage.get("retrieval_calls", 0),
        "retrieval_files": usage.get("retrieval_files", []),
        "context_tokens": usage.get("context_tokens"),
        "elapsed_ms": usage.get("elapsed_ms", elapsed_ms),
        "agent_ok": bool(usage.get("ok")) and agent_err is None,
        "raw_session_path": str(usage_out),
        "agent_error": agent_err or usage.get("error"),
    }


# ── Orchestration ───────────────────────────────────────────────────────────

ARM_LABELS = {
    "A": "Claude Code + raw",
    "B": "PRMPT CLI + raw",
    "C": "PRMPT CLI + optimized",
}


def main() -> int:
    ap = argparse.ArgumentParser(description="3-arm PRMPT CLI benchmark")
    ap.add_argument("--arms", default="A,B,C", help="comma list of arms to run")
    ap.add_argument("--tasks", default=str(DEFAULT_TASKS))
    ap.add_argument("--store", default=str(DEFAULT_STORE))
    ap.add_argument("--only-task", default=None, help="run a single task id")
    ap.add_argument("--repeats", type=int, default=1)
    ap.add_argument("--out-dir", default=str(CLI_ROOT / "harness" / "results"))
    ap.add_argument("--prmpt-model", default="anthropic/claude-sonnet-4.6")
    ap.add_argument("--prmpt-provider", default="openrouter")
    ap.add_argument("--claude-model", default="claude-sonnet-4-6")
    ap.add_argument("--timeout-s", type=int, default=900)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    arms = [a.strip().upper() for a in args.arms.split(",") if a.strip()]

    if not INDEX_MAP.exists():
        print(f"ERROR: {INDEX_MAP} missing. Run bootstrap_index.py first.", file=sys.stderr)
        return 1
    idx = json.loads(INDEX_MAP.read_text(encoding="utf-8"))

    if ("B" in arms or "C" in arms) and not DIST_ENTRY.exists():
        print(f"ERROR: {DIST_ENTRY} missing. Run `npm run build` in prmpt-cli first.", file=sys.stderr)
        return 1
    if ("B" in arms or "C" in arms) and not os.environ.get("OPENROUTER_API_KEY"):
        print("WARNING: OPENROUTER_API_KEY not set; Arms B/C will fail.", file=sys.stderr)

    store_path = Path(args.store)
    if not store_path.exists() and FALLBACK_STORE.exists():
        store_path = FALLBACK_STORE
    store = load_optimized(store_path)
    if "C" in arms and not store:
        print(f"WARNING: optimized store not found ({store_path}); Arm C cannot run.", file=sys.stderr)

    tasks = load_yaml(Path(args.tasks))["tasks"]
    if args.only_task:
        tasks = [t for t in tasks if t["id"] == args.only_task]
        if not tasks:
            print(f"ERROR: task {args.only_task} not found", file=sys.stderr)
            return 1

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    work_root = out_dir / "_work"
    work_root.mkdir(parents=True, exist_ok=True)
    batch = datetime.now().strftime("%Y%m%d-%H%M%S")
    results_path = out_dir / f"results-{batch}.jsonl"

    total = len(tasks) * len(arms) * args.repeats
    print(f"Plan: {len(tasks)} tasks x {len(arms)} arms x {args.repeats} repeats = {total} runs")
    print(f"Arms: " + ", ".join(f"{a} ({ARM_LABELS.get(a, a)})" for a in arms))
    print(f"Results -> {results_path}\n")

    n = 0
    for task in tasks:
        repo_src = (REPO_ROOT / task["repo"]).resolve()
        for rep in range(args.repeats):
            for arm in arms:
                n += 1
                run_id = f"{task['id']}-{arm}-r{rep}-{uuid.uuid4().hex[:6]}"
                label = ARM_LABELS.get(arm, arm)
                print(f"[{n}/{total}] {task['id']} | Arm {arm} ({label})")

                if args.dry_run:
                    continue

                repo_dir = work_root / run_id
                copy_repo(repo_src, repo_dir)

                # Wall-clock window for this run. aggregate.py uses it to attribute
                # code-intel's own LLM usage (from PRMPT_LLM_USAGE_LOG) to Arms B/C.
                run_started_epoch = time.time()
                metrics: dict = {}
                try:
                    if arm == "A":
                        metrics = run_arm_a(task, repo_dir, args.claude_model, args.timeout_s)
                    elif arm == "B":
                        metrics = run_prmpt(
                            task, repo_dir, task["raw_prompt"], idx, out_dir,
                            run_id, args.prmpt_model, args.prmpt_provider, args.timeout_s,
                        )
                    elif arm == "C":
                        opt = optimized_prompt_for(store, task["repo_name"], task["prompt_id"])
                        if not opt:
                            metrics = {"skipped": "no optimized prompt"}
                        else:
                            metrics = run_prmpt(
                                task, repo_dir, opt, idx, out_dir,
                                run_id, args.prmpt_model, args.prmpt_provider, args.timeout_s,
                            )
                    else:
                        metrics = {"skipped": f"unknown arm {arm}"}
                except Exception as e:  # never lose a batch to one bad run
                    metrics = {"error": f"{type(e).__name__}: {e}"}
                run_ended_epoch = time.time()

                passed = False
                verify_tail = ""
                if "skipped" not in metrics and "error" not in metrics:
                    passed, verify_tail = run_verify(task["verify_cmd"], repo_dir)

                prec, rec = precision_recall(
                    metrics.get("retrieval_files", []), task.get("expected_files", []),
                )

                record = {
                    "run_id": run_id,
                    "ts": now_iso(),
                    "batch": batch,
                    "task_id": task["id"],
                    "repo_name": task["repo_name"],
                    "prompt_id": task["prompt_id"],
                    "arm": arm,
                    "arm_label": label,
                    "model": args.claude_model if arm == "A" else f"{args.prmpt_provider}/{args.prmpt_model}",
                    "repeat": rep,
                    "started_epoch": run_started_epoch,
                    "ended_epoch": run_ended_epoch,
                    "passed": passed,
                    "precision": prec,
                    "recall": rec,
                    "verify_tail": verify_tail[-600:],
                    **metrics,
                }
                # Crash-safe: append immediately.
                with results_path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(record, ensure_ascii=False) + "\n")

                status = "PASS" if passed else ("SKIP" if "skipped" in metrics else "FAIL")
                toks = metrics.get("total_tokens", 0)
                cost = metrics.get("cost_usd", 0.0)
                print(f"        -> {status} | tokens={toks} cost=${cost:.4f} "
                      f"retrieval={metrics.get('retrieval_calls', 0)} "
                      f"time={metrics.get('elapsed_ms', 0)}ms")

                # Reclaim disk: drop the per-run worktree (artifacts already saved).
                shutil.rmtree(repo_dir, ignore_errors=True)

    print(f"\nDone. {results_path}")
    print(f"Aggregate with: python prmpt-cli/harness/aggregate.py --results {results_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
