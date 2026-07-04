"""
mcp-ahh convenience entry point. Run from the REPO ROOT.

Phases (run in order):
  python mcp-ahh/prepare.py          # 1. live index + optimize -> prepared store
  python mcp-ahh/run.py              # 2. run matrix  3. build report

This wrapper just drives the engine in benchmarks/ with mcp-ahh's config+tasks,
then builds the report. Prepare is kept separate because it needs the PRMPT
services (:8001/:8002) up; the matrix only needs the agent CLIs.
"""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from benchmarks import report, runner  # noqa: E402

CONFIG = str(REPO_ROOT / "mcp-ahh" / "config.yaml")
TASKS = str(REPO_ROOT / "mcp-ahh" / "tasks.yaml")


def main() -> None:
    batch = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    only = None
    for i, a in enumerate(sys.argv):
        if a == "--only-task" and i + 1 < len(sys.argv):
            only = sys.argv[i + 1]

    argv = ["--config", CONFIG, "--tasks", TASKS, "--batch", batch]
    if only:
        argv += ["--only-task", only]
    sys.argv = [sys.argv[0]] + argv
    runner.main()

    results_dir = REPO_ROOT / "mcp-ahh" / "results" / batch
    sys.argv = [sys.argv[0], "--results", str(results_dir)]
    report.main()
    print(f"\n[mcp-ahh] report + runs.jsonl in {results_dir}")


if __name__ == "__main__":
    main()
