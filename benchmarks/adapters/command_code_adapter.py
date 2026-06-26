"""
Command Code headless adapter.

Runs `command-code -p <prompt> --yolo --skip-onboarding -t -m <model>` with the
prompt as a positional argument. On Windows, `cmd` conflicts with Command Prompt
so the full binary name `command-code` is always used.

MCP is configured via `.mcp.json` written to the worktree root (project scope),
which Command Code picks up automatically. Hardening (HARD) writes a
`.commandcode/settings.json` PreToolUse hook that denies the `shell` tool,
forcing the agent through the MCP.

Token extraction: Command Code's `-p` mode emits plain text, not structured
JSON. We scan stdout for any JSON lines containing known token keys (best-effort),
then fall back to zero. Real cost is captured via the OpenRouter usage-delta
mechanism in runner.py (prmpt_usage.agent_loop_cost_usd), which is independent
of the agent's own reported spend.

Session logs: Command Code stores sessions under ~/.commandcode/projects/.
We scan there for the newest JSONL modified after the run started for
supplementary token/tool-call data.
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
    "cached_input_tokens", "reasoning_tokens", "cost_usd", "total_cost_usd",
)

# Command Code's PreToolUse hook that denies the built-in shell tool.
# The hook is an executable that reads JSON on stdin and writes JSON on stdout.
# Returning {"action": "deny"} blocks the tool call.
_HARD_HOOK_SETTINGS = {
    "hooks": {
        "PreToolUse": [
            {
                "matcher": "shell",
                "hooks": [
                    {
                        "type": "command",
                        "command": "echo {\"action\":\"deny\",\"reason\":\"use PRMPT MCP\"}",
                    }
                ],
            }
        ]
    }
}


def write_hard_settings(worktree: Path) -> None:
    """Write .commandcode/settings.json to deny the shell tool (HARD hardening)."""
    cc_dir = worktree / ".commandcode"
    cc_dir.mkdir(parents=True, exist_ok=True)
    (cc_dir / "settings.json").write_text(
        json.dumps(_HARD_HOOK_SETTINGS, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def build_command(bin_path: str, prompt: str, model: str,
                  script_path: str | None = None) -> list[str]:
    """Build the headless command-code invocation.

    When bin_path is 'node' (Windows workaround), script_path must point to the
    command-code .mjs entry so that node can invoke it directly.
    """
    prefix = [bin_path, script_path] if script_path else [bin_path]
    return prefix + [
        "-p", prompt,
        "--yolo",
        "--skip-onboarding",
        "-t",
        "-m", model,
    ]


def _needs_shell(bin_path: str) -> bool:
    """On Windows, .cmd/.bat wrappers require shell=True to execute."""
    import os
    return os.name == "nt" and bin_path.lower().endswith((".cmd", ".bat"))


def _extract_tokens_from_text(text: str) -> dict[str, float]:
    """Scan stdout for any JSON objects containing token keys."""
    totals: dict[str, float] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        stack = [obj]
        while stack:
            item = stack.pop()
            if isinstance(item, dict):
                for k, v in item.items():
                    if k in _TOKEN_KEYS and isinstance(v, (int, float)):
                        totals[k] = totals.get(k, 0) + v
                    elif isinstance(v, (dict, list)):
                        stack.append(v)
            elif isinstance(item, list):
                stack.extend(item)
    return totals


def _newest_session_since(since_ts: float) -> Path | None:
    home = Path.home() / ".commandcode" / "projects"
    if not home.exists():
        return None
    candidates = [
        p for p in home.rglob("*.jsonl")
        if p.stat().st_mtime >= since_ts - 2
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def _content_chars(content) -> tuple[int, int]:
    """Recursively extract (input_chars, output_chars) from a content value.

    Command Code session events have `content` as either a string or a list of
    typed blocks (reasoning, tool-call, tool-result).  We count:
      - reasoning + tool-call text → assistant output
      - tool-result text           → rounds back as input next turn
    Returns (input_chars, output_chars) from a single content value.
    """
    in_c = out_c = 0
    if isinstance(content, str):
        out_c += len(content)
    elif isinstance(content, list):
        for block in content:
            if not isinstance(block, dict):
                continue
            btype = block.get("type", "")
            text = block.get("text") or block.get("value") or ""
            inp = block.get("input") or {}
            out = block.get("output") or {}
            # Extract nested text from input/output dicts recursively
            def _flatten(obj) -> str:
                if isinstance(obj, str):
                    return obj
                if isinstance(obj, dict):
                    return " ".join(_flatten(v) for v in obj.values())
                if isinstance(obj, list):
                    return " ".join(_flatten(v) for v in obj)
                return str(obj) if obj is not None else ""
            if btype in ("reasoning", "tool-call", "text"):
                out_c += len(text) + len(_flatten(inp))
            elif btype == "tool-result":
                # tool results become next turn's input context
                in_c += len(_flatten(out)) + len(text)
    return in_c, out_c


# DeepSeek V4 Pro: $0.27/M input, $1.10/M output (base API rate).
# With Command Code's permanent 4x credit deal: effective $0.0675/M input,
# $0.275/M output. We store both raw and effective so the caller can choose.
_DEEPSEEK_V4_PRO_INPUT_PER_M  = 0.27
_DEEPSEEK_V4_PRO_OUTPUT_PER_M = 1.10
_CHARS_PER_TOKEN = 3.8   # calibrated against Studio rows (code-heavy sessions)


def _estimate_usage_from_session(session: Path, model: str) -> AgentUsage:
    """Estimate token usage + cost from a Command Code session JSONL.

    Command Code's CLI does not emit token counts in stdout.  The session file
    has the full text of every turn, so we can estimate tokens by summing
    character lengths.  Each assistant turn re-receives the full accumulated
    context (like all stateless LLMs), so input tokens grow with depth.

    Accuracy: ±15–25%.  Direction is always correct.  Calibrated against
    Studio Usage rows from the demo run (15K–22K input tokens per call at
    ~3.8 chars/token for code-heavy English).
    """
    usage = AgentUsage(raw_session_path=str(session))
    try:
        lines = session.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return usage

    # Reconstruct the conversation: each assistant turn sees the full history
    # up to that point as input, plus its own generated text as output.
    accumulated_input_chars = 0
    total_output_chars = 0
    turns = 0

    for line in lines:
        if not line.strip():
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue

        role = ev.get("role", "")
        content = ev.get("content")

        in_c, out_c = _content_chars(content)

        if role == "user":
            accumulated_input_chars += in_c + out_c
        elif role == "assistant":
            # This turn's LLM call: input = everything accumulated so far,
            # output = text this turn generates
            usage.input_tokens  += int(accumulated_input_chars / _CHARS_PER_TOKEN)
            usage.output_tokens += int(out_c / _CHARS_PER_TOKEN)
            accumulated_input_chars += out_c   # assistant output becomes future input
            total_output_chars += out_c
            turns += 1

            # Count tool calls
            if isinstance(content, list):
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "tool-call":
                        tname = block.get("toolName", "")
                        if tname.startswith("mcp__"):
                            usage.mcp_tool_calls += 1
                        elif _SHELL_SEARCH_RE.search(tname):
                            usage.native_search_calls += 1
        elif role == "tool":
            # Tool results feed back as input next turn
            accumulated_input_chars += in_c + out_c

    usage.turns = turns
    usage.total_tokens = usage.input_tokens + usage.output_tokens

    # Cost estimate using base API rates (conservative, no credit multiplier)
    usage.cost_usd = round(
        (usage.input_tokens  / 1_000_000) * _DEEPSEEK_V4_PRO_INPUT_PER_M +
        (usage.output_tokens / 1_000_000) * _DEEPSEEK_V4_PRO_OUTPUT_PER_M,
        6,
    )
    return usage


def run(
    *,
    bin_path: str,
    prompt: str,
    model: str,
    cwd: str,
    script_path: str | None = None,
    hardening: Hardening = Hardening.NONE,
    timeout_s: int = 900,
) -> tuple[AgentUsage, str]:
    """Run Command Code headlessly in `cwd`. Returns (usage, final_text).

    script_path: when bin_path is 'node', pass the absolute path to
    command-code's index.mjs (Windows workaround for .cmd wrapper issues).
    """
    if hardening == Hardening.HARD:
        write_hard_settings(Path(cwd))

    cmd = build_command(bin_path, prompt, model, script_path=script_path)
    t0 = time.time()
    use_shell = _needs_shell(bin_path)
    # On Windows with shell=True we must pass the command as a string
    cmd_arg: list[str] | str = " ".join(f'"{c}"' if " " in c else c for c in cmd) if use_shell else cmd
    proc = subprocess.run(
        cmd_arg, cwd=cwd, capture_output=True, text=True,
        timeout=timeout_s, shell=use_shell,
    )

    stdout = proc.stdout or ""
    stderr = proc.stderr or ""

    usage = AgentUsage()
    totals = _extract_tokens_from_text(stdout)
    usage.input_tokens = int(totals.get("input_tokens", 0))
    usage.output_tokens = int(totals.get("output_tokens", 0))
    usage.reasoning_tokens = int(totals.get("reasoning_tokens", 0))
    usage.cache_read_tokens = int(totals.get("cached_input_tokens", 0))
    usage.total_tokens = int(totals.get("total_tokens", 0)) or (
        usage.input_tokens + usage.output_tokens + usage.reasoning_tokens
    )
    if totals.get("cost_usd") or totals.get("total_cost_usd"):
        usage.cost_usd = float(
            totals.get("cost_usd") or totals.get("total_cost_usd") or 0
        )

    # Primary: estimate tokens from session JSONL (much more accurate than stdout parse)
    session = _newest_session_since(t0)
    if session:
        usage = _estimate_usage_from_session(session, model)
    # Fallback: try stdout token keys (rarely populated by Command Code)
    if usage.total_tokens == 0:
        totals = _extract_tokens_from_text(stdout)
        usage.input_tokens  = int(totals.get("input_tokens", 0))
        usage.output_tokens = int(totals.get("output_tokens", 0))
        usage.total_tokens  = int(totals.get("total_tokens", 0)) or (
            usage.input_tokens + usage.output_tokens
        )

    # Surface full output as final text (plain text, not JSON)
    final_text = stdout.strip() or stderr.strip() or ""

    return usage, final_text
