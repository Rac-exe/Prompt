"""
Codex CLI headless adapter.

Runs `codex exec --json <prompt>` and parses the JSONL event stream. IMPORTANT:
the `--json` stream OMITS reasoning tokens (openai/codex#19022). The complete
token accounting (input/output/reasoning/total) is only in the on-disk rollout:
    ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl   (event payload.type == "token_count")
So we parse stdout for the result + visible usage, then read the newest rollout
file for the authoritative token_count. We therefore must NOT use --ephemeral.

Hardening: Codex has no built-in tool-deny. The HARD profile relies on an
AGENTS.md that forbids broad search plus web_search disabled; native shell grep
can't be fully blocked, so we count grep/find/rg shell calls from the rollout
to measure whether it cheated rather than pretending it can't.
"""

from __future__ import annotations

import json
import re
import subprocess
import time
from pathlib import Path

from benchmarks.metrics import AgentUsage, Hardening

_SHELL_SEARCH_RE = re.compile(r"\b(rg|grep|find|ag|ripgrep)\b")


def build_command(bin_path: str, prompt: str, model: str, *, sandbox: str = "workspace-write") -> list[str]:
    return [
        bin_path, "exec", "--json",
        "-c", f"model={model}",
        "-c", f"sandbox_mode={sandbox}",
        "-c", "web_search=disabled",
        prompt,
    ]


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


def _parse_stdout(stdout: str) -> tuple[AgentUsage, str]:
    """Pull turn.completed usage + final message from the JSONL stream."""
    usage = AgentUsage()
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
        if etype in ("turn.completed", "turn_completed"):
            u = ev.get("usage") or ev.get("msg", {}).get("usage") or {}
            usage.input_tokens = int(u.get("input_tokens") or 0)
            usage.output_tokens = int(u.get("output_tokens") or 0)
            usage.cache_read_tokens = int(u.get("cached_input_tokens") or 0)
            usage.turns += 1
        if etype in ("item.completed", "item_completed"):
            item = ev.get("item") or {}
            if item.get("type") in ("agent_message", "assistant_message"):
                final_text = item.get("text") or item.get("content") or final_text
    return usage, final_text


def _augment_from_rollout(usage: AgentUsage, rollout: Path) -> None:
    """Overlay authoritative token_count (incl. reasoning) + count shell search."""
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
            # shell/exec commands that perform repo-wide search
            if payload.get("type") in ("exec_command", "shell_command", "command"):
                cmd_str = json.dumps(payload)
                if _SHELL_SEARCH_RE.search(cmd_str):
                    native_search += 1
            if payload.get("type") == "mcp_tool_call":
                usage.mcp_tool_calls += 1
    except OSError:
        return

    if last_tc:
        usage.input_tokens = int(last_tc.get("input_tokens") or usage.input_tokens)
        usage.output_tokens = int(last_tc.get("output_tokens") or usage.output_tokens)
        usage.reasoning_tokens = int(last_tc.get("reasoning_output_tokens") or 0)
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
    """Run Codex headlessly in `cwd`. Returns (usage, final_text).

    Codex does not report USD per run, so cost is computed from token counts and
    the configured per-1k price (set these to the model's OpenRouter/API rates).
    """
    cmd = build_command(bin_path, prompt, model)
    t0 = time.time()
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout_s)

    usage, final_text = _parse_stdout(proc.stdout)

    rollout = _newest_rollout(Path(sessions_dir).expanduser(), t0)
    if rollout:
        _augment_from_rollout(usage, rollout)

    if usage.total_tokens == 0:
        usage.total_tokens = usage.input_tokens + usage.output_tokens + usage.reasoning_tokens

    billable_in = usage.input_tokens  # cache handling left to the price you set
    usage.cost_usd = round(
        (billable_in / 1000.0) * cost_per_1k_input
        + ((usage.output_tokens + usage.reasoning_tokens) / 1000.0) * cost_per_1k_output,
        6,
    )
    if not final_text.strip():
        final_text = (proc.stdout or proc.stderr or "")[:2000]
    return usage, final_text
