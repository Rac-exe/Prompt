"""
Real Prompt MCP server glue for the benchmark engine.

This wires the rigorous measurement engine (runner/report/metrics) to the REAL
stdio MCP server bundled in `mcp-shi/` (mcp-shi/benchmark-runs/prompt_mcp_server.py)
plus the prepared optimized-prompt store produced by `mcp-ahh/prepare.py`.

Why it matters vs the abstract-hook path:
  - The agent talks to a real MCP server over stdio (not a stubbed HTTP hook).
  - MCP usage is counted from the SERVER'S OWN call-log, so "did the agent
    actually call the MCP" is a fact, not a heuristic guess from the session.
"""

from __future__ import annotations

import json
import sys
import textwrap
from pathlib import Path


def load_prepared(store_dir: str | Path, repo_name: str) -> list[dict]:
    """Optimized-prompt items for a repo, from prepare.py's store."""
    p = Path(store_dir) / "optimized_by_repo.json"
    if not p.exists():
        return []
    data = json.loads(p.read_text(encoding="utf-8"))
    return data.get(repo_name, [])


def optimized_prompt_for(store_dir: str | Path, repo_name: str, prompt_id: str) -> str:
    for item in load_prepared(store_dir, repo_name):
        if item.get("prompt_id") == prompt_id:
            return item.get("optimized_prompt") or ""
    return ""


def prepare_cost_per_task(store_dir: str | Path) -> float:
    """Amortize the offline index+optimize OpenRouter spend across all tasks.

    With the precomputed MCP server, PRMPT spends nothing *during* a run; its
    real cost is paid once in prepare.py. Charging each MCP run its share keeps
    the net-savings math honest.
    """
    meta = Path(store_dir) / "prepare_meta.json"
    if not meta.exists():
        return 0.0
    m = json.loads(meta.read_text(encoding="utf-8"))
    cost = float(m.get("prepare_openrouter_cost_usd") or 0.0)
    tasks = int(m.get("tasks") or 0)
    return round(cost / tasks, 6) if tasks else 0.0


def write_context(out_dir: Path, repo_name: str, prompt_id: str,
                  optimized_for_repo: list[dict]) -> Path:
    ctx = out_dir / "prompt-mcp-context.json"
    ctx.parent.mkdir(parents=True, exist_ok=True)
    ctx.write_text(json.dumps({
        "repo": repo_name, "prompt_id": prompt_id,
        "optimized_prompts": optimized_for_repo,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return ctx


def write_claude_config(out_dir: Path, server: str, context_file: Path,
                        call_log: Path) -> Path:
    cfg = out_dir / "claude-mcp.json"
    cfg.write_text(json.dumps({
        "mcpServers": {"prompt": {
            "command": sys.executable,
            "args": [str(server)],
            "env": {
                "PRMPT_CONTEXT_FILE": str(context_file),
                "PRMPT_MCP_CALL_LOG": str(call_log),
                "PRMPT_MCP_TRACE_LOG": str(out_dir / "prompt-mcp-trace.jsonl"),
            },
        }}
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return cfg


def write_codex_config(worktree: Path, server: str, context_file: Path,
                       call_log: Path) -> None:
    codex_dir = worktree / ".codex"
    codex_dir.mkdir(parents=True, exist_ok=True)
    toml = textwrap.dedent(f"""
    [mcp_servers.prompt]
    command = "{sys.executable}"
    args = ["{server}"]
    enabled = true

    [mcp_servers.prompt.env]
    PRMPT_CONTEXT_FILE = "{context_file}"
    PRMPT_MCP_CALL_LOG = "{call_log}"
    PRMPT_MCP_TRACE_LOG = "{codex_dir / 'prompt-mcp-trace.jsonl'}"
    """).strip() + "\n"
    (codex_dir / "config.toml").write_text(toml, encoding="utf-8")


_MCP_INSTRUCTION = (
    "\n\nCall `mcp__prompt__prmpt_optimize_task` first with task=<the bug report> "
    "and prompt_id={pid}. Treat the returned JSON as the authoritative route: run "
    "`npm test`, read the JSON primary files, patch them, and rerun `npm test` "
    "until it passes."
)
_HARD_CLAUSE = (
    " Do NOT Glob/Grep or broadly cross-check the repo; search elsewhere only if "
    "a failing stack trace explicitly names another file."
)


def mcp_instruction(prompt_id: str, hard: bool) -> str:
    """Instruction appended so the agent actually invokes the MCP route.

    Availability alone is not enough — without this, agents often make zero MCP
    calls (observed in mcp-shi's 'Clean MCP' run)."""
    return _MCP_INSTRUCTION.format(pid=prompt_id) + (_HARD_CLAUSE if hard else "")


def count_mcp_calls(call_log: Path) -> tuple[int, list[str]]:
    """Definitive MCP-call count from the server's log (one record per call)."""
    if not call_log.exists():
        return 0, []
    tools: list[str] = []
    n = 0
    for line in call_log.read_text(encoding="utf-8", errors="ignore").splitlines():
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        n += 1
        if rec.get("tool"):
            tools.append(rec["tool"])
    return n, sorted(set(tools))
