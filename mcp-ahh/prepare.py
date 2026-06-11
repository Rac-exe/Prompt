"""
mcp-ahh PREPARE step.

Runs the REAL Prompt pipeline once per task (live index via Code Intel :8002 +
live optimize via the optimizer WS :8001), exactly like mcp-shi does, and writes
an optimized-prompt store that the MCP server serves during runs.

It also snapshots OpenRouter usage around the whole prepare phase, so the
indexing/optimizing spend is attributed to PRMPT (not free) in the net-cost math.

Run from repo root:  python mcp-ahh/prepare.py
Requires:            npm run python:dev + npm run code-intel:dev, OPENROUTER_API_KEY
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from benchmarks import openrouter  # noqa: E402

MCP_BASE = REPO_ROOT / "mcp-shi" / "benchmark-runs" / "run_benchmark.py"
STORE = Path(os.environ.get("MCP_AHH_STORE", REPO_ROOT / "mcp-ahh" / "results" / "prepared"))


def _load_base():
    spec = importlib.util.spec_from_file_location("mcp_shi_base", MCP_BASE)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


async def main() -> int:
    base = _load_base()
    STORE.mkdir(parents=True, exist_ok=True)
    work = STORE / "work"
    work.mkdir(parents=True, exist_ok=True)

    or_key = os.environ.get("OPENROUTER_API_KEY", "")
    or_before = openrouter.get_key_usage(or_key) if or_key else None

    for spec in base.REPOS.values():
        base.ensure_clean_worktree(spec["path"])

    indexed = []
    for repo_name, spec in base.REPOS.items():
        print(f"[index] {repo_name}", flush=True)
        indexed.append(await base.index_repo(work, repo_name, spec["path"]))

    by_repo: dict[str, list[dict]] = {}
    for project in indexed:
        for i, prompt in enumerate(base.REPOS[project.repo]["prompts"], 1):
            prompt_id = f"p{i}"
            print(f"[optimize] {project.repo} {prompt_id}", flush=True)
            try:
                item = await base.optimize_prompt(work, project, prompt_id, prompt)
            except Exception as exc:  # keep going; record the failure
                item = {"repo": project.repo, "prompt_id": prompt_id,
                        "generic_prompt": prompt, "optimized_prompt": "",
                        "error": f"{exc.__class__.__name__}: {exc}"}
            by_repo.setdefault(project.repo, []).append(item)

    or_after = openrouter.settled_usage(or_key) if or_key else None
    prep_delta = openrouter.usage_delta(or_before, or_after)

    (STORE / "optimized_by_repo.json").write_text(
        json.dumps(by_repo, ensure_ascii=False, indent=2), encoding="utf-8")
    (STORE / "prepare_meta.json").write_text(json.dumps({
        "created_at": datetime.now(timezone.utc).isoformat(),
        "prepare_openrouter_cost_usd": prep_delta,
        "repos": list(by_repo.keys()),
        "tasks": sum(len(v) for v in by_repo.values()),
    }, indent=2), encoding="utf-8")
    print(f"[done] store={STORE}  prepare_openrouter_cost=${prep_delta:.4f}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
