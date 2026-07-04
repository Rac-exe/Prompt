"""
Codex CLI headless adapter.

Uses the same invocation as the proven mcp-shi harness:
  codex exec --json -C <worktree> --dangerously-bypass-approvals-and-sandbox -
with the prompt on stdin. Tokens are extracted from the stdout JSONL stream
(recursive scan) and augmented from the on-disk rollout when available.
"""

from __future__ import annotations

import json
import re
import subprocess
import time
from pathlib import Path

from benchmarks.metrics import AgentUsage, Hardening

_SHELL_SEARCH_RE = re.compile(r"\b(rg|grep|find|ag|ripgrep)\b")
_TOKEN_KEYS = (
    "input_tokens", "output_tokens", "total_tokens",
    "cached_input_tokens", "reasoning_tokens", "reasoning_output_tokens",
    "cost_usd", "total_cost_usd",
)


def build_command(bin_path: str, cwd: str) -> list[str]:
    return [
        bin_path, "exec", "--json",
        "-C", cwd,
        "--dangerously-bypass-approvals-and-sandbox",
        "-",
    ]


def latest_rollout_since(sessions_dir: str, ts: float) -> Path | None:
    return _newest_rollout(Path(sessions_dir).expanduser(), ts)


def parse_rollout_usage(rollout: Path) -> AgentUsage:
    usage = AgentUsage()
    _augment_from_rollout(usage, rollout)
    if usage.total_tokens == 0:
        usage.total_tokens = usage.input_tokens + usage.output_tokens + usage.reasoning_tokens
    return usage


def _newest_rollout(sessions_dir: Path, since_ts: float) -> Path | None:
    if not sessions_dir.exists():
        return None
    candidates = [
        p for p in sessions_dir.rglob("rollout-*.jsonl")
        if p.stat().st_mtime >= since_ts - 2
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def _extract_tokens_from_jsonl(text: str) -> dict[str, float]:
    """Recursive token scan — matches mcp-shi extract_codex_usage."""
    totals: dict[str, float] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        stack = [row]
        while stack:
            item = stack.pop()
            if isinstance(item, dict):
                for key, value in item.items():
                    if key in _TOKEN_KEYS and isinstance(value, (int, float)):
                        totals[key] = totals.get(key, 0) + value
                    elif isinstance(value, (dict, list)):
                        stack.append(value)
            elif isinstance(item, list):
                stack.extend(item)
    return totals


def _parse_stdout(stdout: str) -> tuple[AgentUsage, str]:
    usage = AgentUsage()
    totals = _extract_tokens_from_jsonl(stdout)
    usage.input_tokens = int(totals.get("input_tokens", 0))
    usage.output_tokens = int(totals.get("output_tokens", 0))
    usage.reasoning_tokens = int(
        totals.get("reasoning_tokens", 0) or totals.get("reasoning_output_tokens", 0)
    )
    usage.cache_read_tokens = int(totals.get("cached_input_tokens", 0))
    usage.total_tokens = int(totals.get("total_tokens", 0)) or (
        usage.input_tokens + usage.output_tokens + usage.reasoning_tokens
    )
    if totals.get("cost_usd") or totals.get("total_cost_usd"):
        usage.cost_usd = float(totals.get("cost_usd") or totals.get("total_cost_usd") or 0)

    final_text = ""
    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        etype = ev.get("type") or ev.get("msg", {}).get("type")
        if etype in ("item.completed", "item_completed"):
            item = ev.get("item") or {}
            if item.get("type") in ("agent_message", "assistant_message"):
                final_text = item.get("text") or item.get("content") or final_text
        payload = ev.get("payload") or {}
        if payload.get("type") == "agent_message":
            final_text = payload.get("message") or payload.get("text") or final_text
    return usage, final_text


def _augment_from_rollout(usage: AgentUsage, rollout: Path) -> None:
    last_tc: dict | None = None
    native_search = 0
    try:
        for line in rollout.read_text(encoding="utf-8", errors="ignore").splitlines():
            if not line.strip():
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            payload = ev.get("payload") or {}
            if payload.get("type") == "token_count":
                last_tc = payload
            if payload.get("type") in ("exec_command", "shell_command", "command"):
                if _SHELL_SEARCH_RE.search(json.dumps(payload)):
                    native_search += 1
            if payload.get("type") == "mcp_tool_call":
                usage.mcp_tool_calls += 1
    except OSError:
        return

    if last_tc:
        usage.input_tokens = int(last_tc.get("input_tokens") or usage.input_tokens)
        usage.output_tokens = int(last_tc.get("output_tokens") or usage.output_tokens)
        usage.reasoning_tokens = int(last_tc.get("reasoning_output_tokens") or usage.reasoning_tokens)
        usage.cache_read_tokens = int(last_tc.get("cached_input_tokens") or usage.cache_read_tokens)
        total = last_tc.get("total_tokens")
        usage.total_tokens = int(total) if total else (
            usage.input_tokens + usage.output_tokens + usage.reasoning_tokens
        )
    usage.native_search_calls = native_search
    usage.raw_session_path = str(rollout)


def run(
    *,
    bin_path: str,
    prompt: str,
    model: str,
    cwd: str,
    sessions_dir: str,
    cost_per_1k_input: float = 0.0,
    cost_per_1k_output: float = 0.0,
    hardening: Hardening = Hardening.NONE,
    timeout_s: int = 900,
) -> tuple[AgentUsage, str]:
    cmd = build_command(bin_path, cwd)
    t0 = time.time()
    proc = subprocess.run(
        cmd, cwd=cwd, input=prompt, capture_output=True, text=True, timeout=timeout_s,
    )

    usage, final_text = _parse_stdout(proc.stdout)

    rollout = _newest_rollout(Path(sessions_dir).expanduser(), t0)
    if rollout:
        _augment_from_rollout(usage, rollout)

    if usage.total_tokens == 0:
        usage.total_tokens = usage.input_tokens + usage.output_tokens + usage.reasoning_tokens

    if usage.cost_usd == 0 and usage.total_tokens > 0:
        usage.cost_usd = round(
            (usage.input_tokens / 1000.0) * cost_per_1k_input
            + ((usage.output_tokens + usage.reasoning_tokens) / 1000.0) * cost_per_1k_output,
            6,
        )
    if not final_text.strip():
        final_text = (proc.stdout or proc.stderr or "")[:2000]
    return usage, final_text
