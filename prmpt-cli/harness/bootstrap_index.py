"""
Index the 3 JS benchmark repos (orbit/atlas/nova) into the code-intel service
ONCE, into a shared SQLite root, and record {repo_name: project_id} so every
benchmark run can reuse the same index.

The PRMPT CLI's `prmpt_retrieve` tool reads PRMPT_PROJECT_ID + PRMPT_CODE_INTEL_ROOT
from the environment; this script produces both (written to index_map.json).

Run once before the 3-arm harness:
    python prmpt-cli/harness/bootstrap_index.py

Requires the code-intel service running on :8002 (PRMPT_CODE_INTEL_URL).
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import httpx

CLI_ROOT = Path(__file__).resolve().parents[1]          # prmpt-cli/
REPO_ROOT = CLI_ROOT.parent                              # PROMPT/
BENCH_RUNS = REPO_ROOT / "mcp-shi" / "benchmark-runs"
TEST_REPOS = REPO_ROOT / "mcp-shi" / "test-repo"

# Reuse the proven JS chunk parser from the existing benchmark.
sys.path.insert(0, str(BENCH_RUNS))
from run_benchmark import parse_repo_chunks  # noqa: E402

CODE_INTEL_URL = os.environ.get("PRMPT_CODE_INTEL_URL", "http://127.0.0.1:8002/api")
DEV_TOKEN = os.environ.get("PRMPT_DEV_AUTH_TOKEN", "dev-cli-token")
# Shared, stable store reused across all runs.
CODE_INTEL_ROOT = Path(
    os.environ.get("PRMPT_CODE_INTEL_ROOT", str(CLI_ROOT / ".code-intel-root"))
).resolve()
INDEX_MAP_PATH = CLI_ROOT / "index_map.json"
POLL_TIMEOUT_S = int(os.environ.get("PRMPT_BENCH_INDEX_TIMEOUT", "1200"))

REPOS = [
    "orbit-crm-generated",
    "atlas-commerce-generated",
    "nova-support-generated",
]


def index_repo(client: httpx.Client, repo_name: str) -> str:
    repo_path = TEST_REPOS / repo_name
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DEV_TOKEN}",
        "X-Prmpt-Code-Intel-Root": str(CODE_INTEL_ROOT),
    }
    create = client.post(
        f"{CODE_INTEL_URL}/projects",
        headers=headers,
        json={
            "name": f"prmpt-cli-{repo_name}",
            "local_path": str(repo_path),
            "default_branch": "main",
        },
    )
    create.raise_for_status()
    project = create.json()
    project_id = project["id"]

    chunks, language_map = parse_repo_chunks(repo_path)
    ingest = client.post(
        f"{CODE_INTEL_URL}/index/ingest",
        headers=headers,
        json={
            "project_id": project_id,
            "chunks": chunks,
            "call_graph": [],
            "language_map": language_map,
            "branch": "main",
            "cleanup_scope": "project",
            "cleanup_keys": [],
        },
    )
    ingest.raise_for_status()

    deadline = time.time() + POLL_TIMEOUT_S
    while time.time() < deadline:
        status = client.get(
            f"{CODE_INTEL_URL}/projects/{project_id}", headers=headers
        )
        status.raise_for_status()
        st = status.json()
        state = st.get("index_status")
        if state == "ready":
            print(f"  [{repo_name}] ready: {len(chunks)} chunks -> {project_id}")
            return project_id
        if state == "error":
            raise RuntimeError(f"indexing failed for {repo_name}: {st}")
        time.sleep(4)
    raise TimeoutError(f"indexing timed out for {repo_name}")


def main() -> None:
    CODE_INTEL_ROOT.mkdir(parents=True, exist_ok=True)
    print(f"Code-intel root: {CODE_INTEL_ROOT}")
    print(f"Service:         {CODE_INTEL_URL}")

    projects: dict[str, str] = {}
    with httpx.Client(timeout=300) as client:
        for repo in REPOS:
            print(f"Indexing {repo} ...")
            projects[repo] = index_repo(client, repo)

    INDEX_MAP_PATH.write_text(
        json.dumps(
            {
                "code_intel_url": CODE_INTEL_URL,
                "code_intel_root": str(CODE_INTEL_ROOT),
                "projects": projects,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nWrote {INDEX_MAP_PATH}")


if __name__ == "__main__":
    main()
