#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"
source mcp-ahh/.venv/bin/activate
set -a && source .env && set +a
export PRMPT_ALLOW_DEV_CLI_AUTH=true PRMPT_DEV_AUTH_TOKEN=dev-cli-token

BATCH="${1:-$(date +%Y%m%d-%H%M%S)-seq-p2p3}"
RESULTS="$REPO_ROOT/mcp-ahh/results/$BATCH"
LOG="$RESULTS/runner.log"
mkdir -p "$RESULTS"

echo "Batch: $BATCH" | tee "$LOG"
echo "Sequential run — 6 tasks × 10 cells = 60 runs" | tee -a "$LOG"

python -m benchmarks.runner \
  --config mcp-ahh/config-run.yaml \
  --tasks mcp-ahh/tasks-all-p2p3.yaml \
  --batch "$BATCH" \
  2>&1 | tee -a "$LOG"

python -m benchmarks.report --results "$RESULTS" 2>&1 | tee -a "$LOG"
python mcp-ahh/scripts/generate_full_report.py "$RESULTS" 2>&1 | tee -a "$LOG"

echo "BATCH=$BATCH" | tee -a "$LOG"
