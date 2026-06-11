"""
Claude Code headless adapter.

Runs `claude -p <prompt> --output-format json` and parses the structured result
for cost + token usage. `total_cost_usd` is authoritative for the agent's own
spend (API users); for Max/Pro subscribers it is a local estimate but still the
best per-invocation signal available.

Hardening (HARD): native search tools are denied via a settings.json `deny`
list rather than `--disallowedTools`, because `--disallowedTools`/`--tools`
combined with `--mcp-config` + a large `--append-system-prompt` triggers a
known silent 0-cost exit (anthropics/claude-code#32079). We also pass `--`
before the prompt to avoid variadic-arg parsing eating the prompt.
"""

from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path

from benchmarks.metrics import AgentUsage, Hardening


_NATIVE_SEARCH_TOOLS = ("Grep", "Glob")


def build_command(
    bin_path: str,
    prompt: str,
    model: str,
    *,
    mcp_config: str | None,
    settings_file: str | None,
    append_system_prompt_file: str | None,
    extra_args: list[str] | None,
    session_dir: str | None,
) -> list[str]:
    cmd: list[str] = [bin_path, "-p", "--output-format", "json", "--model", model]
    if extra_args:
        cmd += list(extra_args)
    if mcp_config:
        cmd += ["--mcp-config", mcp_config]
    if settings_file:
        cmd += ["--settings", settings_file]
    if append_system_prompt_file:
        cmd += ["--append-system-prompt-file", append_system_prompt_file]
    if session_dir:
        # Persist the session so tool-call counting can audit it afterwards.
        cmd += ["--session-id-file", str(Path(session_dir) / "session_id.txt")]
    # `--` separates flags from the positional prompt (parsing-bug workaround).
    cmd += ["--", prompt]
    return cmd


def _parse_usage(payload: dict) -> AgentUsage:
    usage = AgentUsage()
    usage.cost_usd = float(payload.get("total_cost_usd") or 0.0)
    usage.turns = int(payload.get("num_turns") or payload.get("turns") or 0)
    u = payload.get("usage") or {}
    usage.input_tokens = int(u.get("input_tokens") or 0)
    usage.output_tokens = int(u.get("output_tokens") or 0)
    usage.cache_read_tokens = int(u.get("cache_read_input_tokens") or 0)
    usage.cache_write_tokens = int(u.get("cache_creation_input_tokens") or 0)
    usage.total_tokens = (
        usage.input_tokens + usage.output_tokens
        + usage.cache_read_tokens + usage.cache_write_tokens
    )
    return usage


def _count_tool_calls(session_path: Path) -> tuple[int, int]:
    """Count MCP vs native-search tool calls from the session JSONL.

    Returns (mcp_tool_calls, native_search_calls). Best-effort — if the session
    file is absent or malformed we return zeros.
    """
    mcp_calls = 0
    native_calls = 0
    if not session_path.exists():
        return 0, 0
    try:
        for line in session_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            if not line.strip():
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            for tu in _iter_tool_uses(ev):
                name = tu.get("name", "")
                if name.startswith("mcp__"):
                    mcp_calls += 1
                elif name in _NATIVE_SEARCH_TOOLS:
                    native_calls += 1
    except OSError:
        pass
    return mcp_calls, native_calls


def _iter_tool_uses(ev: dict):
    """Yield tool_use blocks from a Claude session event (schema-tolerant)."""
    msg = ev.get("message") or ev
    content = msg.get("content")
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "tool_use":
                yield block


def find_session_file(session_dir: str | None) -> Path | None:
    if not session_dir:
        return None
    sid_file = Path(session_dir) / "session_id.txt"
    if not sid_file.exists():
        return None
    sid = sid_file.read_text().strip()
    # Claude stores sessions under ~/.claude/projects/<slug>/<session>.jsonl.
    home = Path.home() / ".claude" / "projects"
    if not home.exists():
        return None
    for p in home.rglob(f"{sid}.jsonl"):
        return p
    return None


def run(
    *,
    bin_path: str,
    prompt: str,
    model: str,
    cwd: str,
    mcp_config: str | None = None,
    hardening: Hardening = Hardening.NONE,
    settings_file: str | None = None,
    append_system_prompt_file: str | None = None,
    extra_args: list[str] | None = None,
    timeout_s: int = 900,
    session_dir: str | None = None,
) -> tuple[AgentUsage, str]:
    """Run Claude headlessly in `cwd`. Returns (usage, final_text)."""
    settings = settings_file if hardening == Hardening.HARD else None
    cmd = build_command(
        bin_path, prompt, model,
        mcp_config=mcp_config,
        settings_file=settings,
        append_system_prompt_file=append_system_prompt_file,
        extra_args=extra_args,
        session_dir=session_dir,
    )
    t0 = time.perf_counter()
    proc = subprocess.run(
        cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout_s,
    )
    elapsed = time.perf_counter() - t0

    final_text = ""
    usage = AgentUsage()
    try:
        payload = json.loads(proc.stdout)
        usage = _parse_usage(payload)
        final_text = payload.get("result") or payload.get("text") or ""
    except json.JSONDecodeError:
        # Surface raw output so the runner can flag a malformed/empty run
        # (e.g. the silent-exit bug) instead of silently scoring it $0.
        final_text = (proc.stdout or proc.stderr or "")[:2000]

    session_path = find_session_file(session_dir)
    if session_path:
        usage.raw_session_path = str(session_path)
        usage.mcp_tool_calls, usage.native_search_calls = _count_tool_calls(session_path)

    # Sanity flag: $0 cost AND no tokens AND no text usually means a failed
    # launch (e.g. the disallowedTools+mcp silent exit), not a free success.
    if usage.cost_usd == 0 and usage.total_tokens == 0 and not final_text.strip():
        usage.raw_session_path = usage.raw_session_path or "SUSPECT_EMPTY_RUN"

    return usage, final_text
