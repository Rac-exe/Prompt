"""
Warm multi-turn benchmark runner.

This differs from run_3arm.py: one copied workspace is used for a repo flow, then
the agent receives p1 -> p2 -> p3 sequentially. Raw agents use their native
resume/chat/thread mechanics when available. PRMPT CLI is currently single-shot,
so B/C are same-workspace sequential turns, not one persisted Pi conversation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

CLI_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = CLI_ROOT.parent
DEFAULT_TASKS = REPO_ROOT / "mcp-ahh" / "tasks.yaml"
DEFAULT_STORE = REPO_ROOT / "first-test" / "prepared" / "optimized_by_repo.json"
FALLBACK_STORE = REPO_ROOT / "mcp-ahh" / "results" / "prepared" / "optimized_by_repo.json"
INDEX_MAP = CLI_ROOT / "index_map.json"
DIST_ENTRY = CLI_ROOT / "dist" / "index.js"

ARM_LABELS = {
    "A": "Claude Code + raw warm session",
    "B": "PRMPT CLI + raw same-workspace sequential",
    "C": "PRMPT CLI + optimized same-workspace sequential",
    "cursor": "Cursor Agent + raw warm session",
    "codex": "Codex CLI + raw warm session",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_yaml(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_optimized(path: Path) -> dict[str, Any]:
    if not path.exists() and FALLBACK_STORE.exists():
        path = FALLBACK_STORE
    if not path.exists():
        return {}
    return load_json(path)


def optimized_prompt_for(store: dict[str, Any], repo_name: str, prompt_id: str) -> str:
    for item in store.get(repo_name, []):
        if item.get("prompt_id") == prompt_id:
            return item.get("optimized_prompt") or ""
    return ""


def run_capture(cmd: list[str], cwd: Path | None = None, timeout_s: int = 20) -> str | None:
    try:
        proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout_s)
    except Exception:
        return None
    out = ((proc.stdout or "") + (proc.stderr or "")).strip()
    return out.splitlines()[0] if out else None


def copy_repo(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns(".git", "node_modules"))


def run_verify(verify_cmd: str, cwd: Path, timeout_s: int = 300) -> tuple[bool, str]:
    try:
        proc = subprocess.run(
            verify_cmd,
            cwd=cwd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
    except subprocess.TimeoutExpired:
        return False, "verify timed out"
    tail = (proc.stdout or "")[-1500:] + (proc.stderr or "")[-500:]
    return proc.returncode == 0, tail


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text or "", encoding="utf-8", errors="replace")


def file_hashes(root: Path) -> dict[str, str]:
    ignored_dirs = {".git", "node_modules", "dist", "coverage"}
    hashes: dict[str, str] = {}
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel_parts = path.relative_to(root).parts
        if any(part in ignored_dirs for part in rel_parts):
            continue
        try:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            continue
        hashes[str(path.relative_to(root)).replace("\\", "/")] = digest
    return hashes


def diff_hashes(before: dict[str, str], after: dict[str, str]) -> dict[str, list[str]]:
    before_keys = set(before)
    after_keys = set(after)
    return {
        "added": sorted(after_keys - before_keys),
        "deleted": sorted(before_keys - after_keys),
        "modified": sorted(k for k in before_keys & after_keys if before[k] != after[k]),
    }


def parse_json_line(text: str) -> dict[str, Any]:
    for line in reversed(text.splitlines()):
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            continue
    return {}


def usage_from_claude(payload: dict[str, Any]) -> dict[str, Any]:
    u = payload.get("usage") or {}
    input_tokens = int(u.get("input_tokens") or 0)
    output_tokens = int(u.get("output_tokens") or 0)
    cache_read = int(u.get("cache_read_input_tokens") or 0)
    cache_write = int(u.get("cache_creation_input_tokens") or 0)
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_read_tokens": cache_read,
        "cache_write_tokens": cache_write,
        "reasoning_tokens": 0,
        "total_tokens": input_tokens + output_tokens + cache_read + cache_write,
        "cost_usd": float(payload.get("total_cost_usd") or 0.0),
        "agent_ok": bool((payload.get("result") or payload.get("text") or "").strip()),
        "session_id": payload.get("session_id"),
    }


def usage_from_cursor(payload: dict[str, Any]) -> dict[str, Any]:
    u = payload.get("usage") or {}
    input_tokens = int(u.get("inputTokens") or u.get("input_tokens") or 0)
    output_tokens = int(u.get("outputTokens") or u.get("output_tokens") or 0)
    cache_read = int(u.get("cacheReadTokens") or u.get("cache_read_tokens") or 0)
    cache_write = int(u.get("cacheWriteTokens") or u.get("cache_write_tokens") or 0)
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_read_tokens": cache_read,
        "cache_write_tokens": cache_write,
        "reasoning_tokens": 0,
        "total_tokens": input_tokens + output_tokens + cache_read + cache_write,
        "cost_usd": float(payload.get("total_cost_usd") or payload.get("cost_usd") or 0.0),
        "agent_ok": not bool(payload.get("is_error")),
        "session_id": payload.get("session_id"),
    }


def usage_from_codex_stdout(stdout: str) -> tuple[dict[str, Any], str | None]:
    thread_id = None
    usage_payload: dict[str, Any] = {}
    final_text = ""
    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if ev.get("thread_id"):
            thread_id = ev.get("thread_id")
        if ev.get("type") == "item.completed":
            item = ev.get("item") or {}
            if item.get("type") in {"agent_message", "assistant_message"}:
                final_text = item.get("text") or item.get("content") or final_text
        if ev.get("type") == "turn.completed":
            usage_payload = ev.get("usage") or {}
    input_tokens = int(usage_payload.get("input_tokens") or 0)
    output_tokens = int(usage_payload.get("output_tokens") or 0)
    cache_read = int(usage_payload.get("cached_input_tokens") or 0)
    reasoning = int(
        usage_payload.get("reasoning_tokens") or usage_payload.get("reasoning_output_tokens") or 0
    )
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_read_tokens": cache_read,
        "cache_write_tokens": 0,
        "reasoning_tokens": reasoning,
        "total_tokens": input_tokens + output_tokens + reasoning,
        "cost_usd": 0.0,
        "agent_ok": bool(final_text.strip()),
        "session_id": thread_id,
    }, thread_id


def run_claude_turn(prompt: str, repo_dir: Path, session_id: str, first: bool, timeout_s: int) -> dict[str, Any]:
    cmd = [
        "claude",
        "-p",
        "--output-format",
        "json",
        "--model",
        "claude-sonnet-4-6",
        "--permission-mode",
        "bypassPermissions",
    ]
    if first:
        cmd += ["--session-id", session_id]
    else:
        cmd += ["--resume", session_id]
    cmd += ["--", prompt]
    t0 = time.perf_counter()
    proc = subprocess.run(cmd, cwd=repo_dir, capture_output=True, text=True, timeout=timeout_s)
    elapsed_ms = round((time.perf_counter() - t0) * 1000)
    payload = parse_json_line(proc.stdout)
    usage = usage_from_claude(payload)
    usage.update({
        "elapsed_ms": elapsed_ms,
        "agent_error": None if proc.returncode == 0 else (proc.stderr or proc.stdout or "")[-1200:],
        "raw_stdout_tail": (proc.stdout or "")[-2000:],
        "raw_stderr_tail": (proc.stderr or "")[-2000:],
    })
    return usage


def run_cursor_turn(prompt: str, repo_dir: Path, chat_id: str, timeout_s: int) -> dict[str, Any]:
    cmd = [
        "cursor-agent",
        "--print",
        "--output-format",
        "json",
        "--force",
        "--trust",
        "--sandbox",
        "disabled",
        "--model",
        "claude-4.6-sonnet-medium",
        "--workspace",
        str(repo_dir),
        "--resume",
        chat_id,
        prompt,
    ]
    t0 = time.perf_counter()
    proc = subprocess.run(cmd, cwd=repo_dir, capture_output=True, text=True, timeout=timeout_s)
    elapsed_ms = round((time.perf_counter() - t0) * 1000)
    payload = parse_json_line(proc.stdout)
    usage = usage_from_cursor(payload)
    usage.update({
        "elapsed_ms": elapsed_ms,
        "agent_error": None if proc.returncode == 0 else (proc.stderr or proc.stdout or "")[-1200:],
        "raw_stdout_tail": (proc.stdout or "")[-2000:],
        "raw_stderr_tail": (proc.stderr or "")[-2000:],
    })
    return usage


def run_codex_turn(prompt: str, repo_dir: Path, thread_id: str | None, timeout_s: int) -> dict[str, Any]:
    if thread_id:
        cmd = [
            "codex",
            "exec",
            "resume",
            "--json",
            "--dangerously-bypass-approvals-and-sandbox",
            thread_id,
            "-",
        ]
    else:
        cmd = [
            "codex",
            "exec",
            "--json",
            "-C",
            str(repo_dir),
            "--dangerously-bypass-approvals-and-sandbox",
            "-",
        ]
    t0 = time.perf_counter()
    proc = subprocess.run(cmd, cwd=repo_dir, input=prompt, capture_output=True, text=True, timeout=timeout_s)
    elapsed_ms = round((time.perf_counter() - t0) * 1000)
    usage, next_thread_id = usage_from_codex_stdout(proc.stdout)
    usage.update({
        "elapsed_ms": elapsed_ms,
        "agent_error": None if proc.returncode == 0 else (proc.stderr or proc.stdout or "")[-1200:],
        "raw_stdout_tail": (proc.stdout or "")[-2000:],
        "raw_stderr_tail": (proc.stderr or "")[-2000:],
        "session_id": next_thread_id or thread_id,
    })
    return usage


def run_prmpt_turn(
    *,
    task: dict[str, Any],
    prompt: str,
    repo_dir: Path,
    idx: dict[str, Any],
    out_dir: Path,
    run_id: str,
    timeout_s: int,
) -> dict[str, Any]:
    usage_out = out_dir / f"{run_id}.usage.json"
    retrieve_log = out_dir / f"{run_id}.retrieve.jsonl"
    prompt_file = out_dir / f"{run_id}.prompt.txt"
    prompt_file.write_text(prompt, encoding="utf-8")
    env = dict(os.environ)
    env.update({
        "PRMPT_CODE_INTEL_URL": idx["code_intel_url"],
        "PRMPT_CODE_INTEL_ROOT": idx["code_intel_root"],
        "PRMPT_PROJECT_ID": idx["projects"][task["repo_name"]],
        "PRMPT_DEV_AUTH_TOKEN": os.environ.get("PRMPT_DEV_AUTH_TOKEN", "dev-cli-token"),
        "PRMPT_RETRIEVE_LOG": str(retrieve_log),
        "PRMPT_USAGE_OUT": str(usage_out),
        "PRMPT_MODEL": "anthropic/claude-sonnet-4.6",
        "PRMPT_PROVIDER": "openrouter",
    })
    cmd = ["node", str(DIST_ENTRY), "--cwd", str(repo_dir), "--prompt-file", str(prompt_file)]
    t0 = time.perf_counter()
    try:
        proc = subprocess.run(
            cmd,
            cwd=CLI_ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
        agent_error = None if proc.returncode == 0 else (proc.stderr or proc.stdout or "")[-1200:]
    except subprocess.TimeoutExpired:
        elapsed_ms = round((time.perf_counter() - t0) * 1000)
        return {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 0,
            "cache_write_tokens": 0,
            "reasoning_tokens": 0,
            "total_tokens": 0,
            "cost_usd": 0.0,
            "retrieval_calls": 0,
            "retrieval_files": [],
            "context_tokens": None,
            "elapsed_ms": elapsed_ms,
            "agent_ok": False,
            "agent_error": "prmpt cli timed out",
            "raw_session_path": str(usage_out),
        }
    elapsed_ms = round((time.perf_counter() - t0) * 1000)
    usage = {}
    if usage_out.exists():
        try:
            usage = json.loads(usage_out.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            usage = {}
    return {
        "input_tokens": int(usage.get("input_tokens") or 0),
        "output_tokens": int(usage.get("output_tokens") or 0),
        "cache_read_tokens": int(usage.get("cache_read_tokens") or 0),
        "cache_write_tokens": int(usage.get("cache_write_tokens") or 0),
        "reasoning_tokens": int(usage.get("reasoning_tokens") or 0),
        "total_tokens": int(usage.get("total_tokens") or 0),
        "cost_usd": float(usage.get("cost_usd") or 0.0),
        "retrieval_calls": int(usage.get("retrieval_calls") or 0),
        "retrieval_files": usage.get("retrieval_files") or [],
        "context_tokens": usage.get("context_tokens"),
        "elapsed_ms": int(usage.get("elapsed_ms") or elapsed_ms),
        "agent_ok": bool(usage.get("ok")) and agent_error is None,
        "agent_error": agent_error or usage.get("error"),
        "raw_session_path": str(usage_out),
    }


def grouped_tasks(tasks: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for task in tasks:
        grouped[task["repo_name"]].append(task)
    return dict(grouped)


def summarize(results_path: Path, summary_path: Path, arm: str) -> None:
    rows = []
    if results_path.exists():
        for line in results_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                rows.append(json.loads(line))
    valid = [r for r in rows if not r.get("invalid_flow")]
    summary = {
        "arm": arm,
        "label": ARM_LABELS.get(arm, arm),
        "turns": len(valid),
        "passed_turns": sum(1 for r in valid if r.get("passed")),
        "sessions": len({r.get("flow_id") for r in valid}),
        "completed_sessions": sum(
            1
            for flow_id in {r.get("flow_id") for r in valid}
            if len([r for r in valid if r.get("flow_id") == flow_id]) == 3
            and all(r.get("passed") for r in valid if r.get("flow_id") == flow_id)
        ),
        "total_tokens": sum(int(r.get("total_tokens") or 0) for r in valid),
        "avg_tokens_per_turn": round(
            sum(int(r.get("total_tokens") or 0) for r in valid) / len(valid)
        ) if valid else 0,
        "total_time_min": round(sum(int(r.get("elapsed_ms") or 0) for r in valid) / 60000, 2),
        "avg_elapsed_ms": round(
            sum(int(r.get("elapsed_ms") or 0) for r in valid) / len(valid)
        ) if valid else 0,
        "agent_errors": sum(1 for r in valid if r.get("agent_error")),
        "invalid_flows": sum(1 for r in rows if r.get("invalid_flow")),
    }
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="Run warm multi-turn benchmark for one arm.")
    ap.add_argument("--arm", required=True, choices=["A", "B", "C", "cursor", "codex"])
    ap.add_argument("--tasks", default=str(DEFAULT_TASKS))
    ap.add_argument("--store", default=str(DEFAULT_STORE))
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--timeout-s", type=int, default=900)
    args = ap.parse_args()

    arm = args.arm
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    work_root = out_dir / "_work"
    work_root.mkdir(parents=True, exist_ok=True)
    batch = datetime.now().strftime("%Y%m%d-%H%M%S")
    results_path = out_dir / f"results-{arm}-{batch}.jsonl"
    manifest_path = out_dir / f"manifest-{arm}-{batch}.json"
    summary_path = out_dir / f"summary-{arm}.json"

    tasks = load_yaml(Path(args.tasks))["tasks"]
    by_repo = grouped_tasks(tasks)
    idx = load_json(INDEX_MAP) if INDEX_MAP.exists() else {}
    store = load_optimized(Path(args.store))

    if arm in {"B", "C"} and not DIST_ENTRY.exists():
        print(f"ERROR: {DIST_ENTRY} missing. Run npm run build in prmpt-cli.", file=sys.stderr)
        return 1
    if arm in {"B", "C"} and not os.environ.get("OPENROUTER_API_KEY"):
        print("WARNING: OPENROUTER_API_KEY not set; PRMPT arms may fail.", file=sys.stderr)

    manifest = {
        "batch": batch,
        "created_at": now_iso(),
        "arm": arm,
        "label": ARM_LABELS.get(arm, arm),
        "repo_root": str(REPO_ROOT),
        "benchmark_branch": run_capture(["git", "branch", "--show-current"], REPO_ROOT),
        "benchmark_commit": run_capture(["git", "rev-parse", "HEAD"], REPO_ROOT),
        "benchmark_status": run_capture(["git", "status", "--short"], REPO_ROOT),
        "tasks_file": str(Path(args.tasks).resolve()),
        "store_file": str(Path(args.store).resolve()),
        "repeats": args.repeats,
        "flow_shape": "one copied workspace per repo/repeat; prompts p1 -> p2 -> p3 in order",
        "session_semantics": {
            "A": "true Claude conversation resume via --session-id then --resume",
            "cursor": "true Cursor chat resume via create-chat then --resume",
            "codex": "true Codex thread resume via codex exec resume",
            "B": "same workspace sequential turns; PRMPT CLI process/session is single-shot",
            "C": "same workspace sequential turns; PRMPT CLI process/session is single-shot",
        }.get(arm),
        "models": {
            "A": "claude-sonnet-4-6",
            "B": "openrouter/anthropic/claude-sonnet-4.6",
            "C": "openrouter/anthropic/claude-sonnet-4.6",
            "cursor": "claude-4.6-sonnet-medium",
            "codex": "gpt-5.5 account default",
        },
        "results": str(results_path),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    total_turns = len(by_repo) * args.repeats * 3
    print(f"Warm plan for {arm}: {len(by_repo)} repos x {args.repeats} repeats x 3 turns = {total_turns} turns")
    print(f"Results -> {results_path}", flush=True)

    turn_n = 0
    for repo_name, repo_tasks in by_repo.items():
        repo_tasks = sorted(repo_tasks, key=lambda t: t["prompt_id"])
        repo_src = (REPO_ROOT / repo_tasks[0]["repo"]).resolve()
        for rep in range(args.repeats):
            flow_id = f"{repo_name}-{arm}-r{rep}-{uuid.uuid4().hex[:6]}"
            repo_dir = work_root / flow_id
            copy_repo(repo_src, repo_dir)
            session_id = str(uuid.uuid4()) if arm == "A" else None
            cursor_chat_id = None
            codex_thread_id = None
            if arm == "cursor":
                cursor_chat_id = (run_capture(["cursor-agent", "create-chat"], REPO_ROOT, 60) or "").strip()
            initial_passed, initial_tail = run_verify(repo_tasks[0]["verify_cmd"], repo_dir)
            write_text(out_dir / f"{flow_id}.initial_verify.txt", initial_tail)
            if initial_passed:
                record = {
                    "flow_id": flow_id,
                    "ts": now_iso(),
                    "repo_name": repo_name,
                    "arm": arm,
                    "repeat": rep,
                    "invalid_flow": "initial copied repo already passed verification",
                }
                with results_path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(record, ensure_ascii=False) + "\n")
                print(f"{flow_id}: INVALID initial repo already passed", flush=True)
                shutil.rmtree(repo_dir, ignore_errors=True)
                continue

            for turn_index, task in enumerate(repo_tasks):
                turn_n += 1
                run_id = f"{flow_id}-{task['prompt_id']}"
                print(f"[{turn_n}/{total_turns}] {flow_id} | {task['prompt_id']} | {task['id']}", flush=True)
                before = file_hashes(repo_dir)
                pre_passed, pre_tail = run_verify(task["verify_cmd"], repo_dir)
                write_text(out_dir / f"{run_id}.pre_verify.txt", pre_tail)
                prompt = task["raw_prompt"]
                if arm == "C":
                    prompt = optimized_prompt_for(store, task["repo_name"], task["prompt_id"]) or prompt
                write_text(out_dir / f"{run_id}.prompt.txt", prompt)

                started_epoch = time.time()
                try:
                    if arm == "A":
                        metrics = run_claude_turn(
                            prompt, repo_dir, session_id or "", turn_index == 0, args.timeout_s
                        )
                    elif arm == "cursor":
                        metrics = run_cursor_turn(prompt, repo_dir, cursor_chat_id or "", args.timeout_s)
                    elif arm == "codex":
                        metrics = run_codex_turn(prompt, repo_dir, codex_thread_id, args.timeout_s)
                        codex_thread_id = metrics.get("session_id") or codex_thread_id
                    elif arm in {"B", "C"}:
                        metrics = run_prmpt_turn(
                            task=task,
                            prompt=prompt,
                            repo_dir=repo_dir,
                            idx=idx,
                            out_dir=out_dir,
                            run_id=run_id,
                            timeout_s=args.timeout_s,
                        )
                    else:
                        metrics = {"agent_error": f"unknown arm {arm}", "agent_ok": False}
                except subprocess.TimeoutExpired:
                    metrics = {
                        "input_tokens": 0,
                        "output_tokens": 0,
                        "cache_read_tokens": 0,
                        "cache_write_tokens": 0,
                        "reasoning_tokens": 0,
                        "total_tokens": 0,
                        "cost_usd": 0.0,
                        "elapsed_ms": args.timeout_s * 1000,
                        "agent_ok": False,
                        "agent_error": "agent timed out",
                    }
                except Exception as exc:
                    metrics = {
                        "input_tokens": 0,
                        "output_tokens": 0,
                        "cache_read_tokens": 0,
                        "cache_write_tokens": 0,
                        "reasoning_tokens": 0,
                        "total_tokens": 0,
                        "cost_usd": 0.0,
                        "elapsed_ms": 0,
                        "agent_ok": False,
                        "agent_error": f"{type(exc).__name__}: {exc}",
                    }
                ended_epoch = time.time()
                post_passed, post_tail = run_verify(task["verify_cmd"], repo_dir)
                write_text(out_dir / f"{run_id}.post_verify.txt", post_tail)
                changed = diff_hashes(before, file_hashes(repo_dir))
                (out_dir / f"{run_id}.changed_files.json").write_text(
                    json.dumps(changed, indent=2),
                    encoding="utf-8",
                )

                record = {
                    "run_id": run_id,
                    "flow_id": flow_id,
                    "ts": now_iso(),
                    "arm": arm,
                    "arm_label": ARM_LABELS.get(arm, arm),
                    "repo_name": repo_name,
                    "task_id": task["id"],
                    "prompt_id": task["prompt_id"],
                    "repeat": rep,
                    "turn_index": turn_index,
                    "started_epoch": started_epoch,
                    "ended_epoch": ended_epoch,
                    "pre_passed": pre_passed,
                    "passed": post_passed,
                    "changed_files": changed,
                    "changed_file_count": sum(len(v) for v in changed.values()),
                    "verify_tail": post_tail[-600:],
                    **metrics,
                }
                with results_path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(record, ensure_ascii=False) + "\n")
                status = "PASS" if post_passed else "FAIL"
                print(
                    f"        -> {status} | tokens={record.get('total_tokens', 0)} "
                    f"time={record.get('elapsed_ms', 0)}ms",
                    flush=True,
                )
                summarize(results_path, summary_path, arm)
            shutil.rmtree(repo_dir, ignore_errors=True)

    summarize(results_path, summary_path, arm)
    print(f"Done. Summary -> {summary_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
