#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"
source mcp-ahh/.venv/bin/activate
set -a && source .env && set +a
export PRMPT_ALLOW_DEV_CLI_AUTH=true PRMPT_DEV_AUTH_TOKEN=dev-cli-token

BATCH="${1:-$(date +%Y%m%d-%H%M%S)-complex-p2p3}"
RESULTS="$REPO_ROOT/mcp-ahh/results/$BATCH"
mkdir -p "$RESULTS"

echo "Batch: $BATCH"
echo "Results: $RESULTS"

run_repo() {
  local name="$1" tasks="$2"
  echo "[start] $name $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$RESULTS/${name}.log"
  python -m benchmarks.runner \
    --config mcp-ahh/config-run.yaml \
    --tasks "$tasks" \
    --batch "$BATCH" \
    2>&1 | tee -a "$RESULTS/${name}.log"
  echo "[done] $name $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$RESULTS/${name}.log"
}

run_repo orbit mcp-ahh/tasks-orbit.yaml &
PID_ORBIT=$!
run_repo atlas mcp-ahh/tasks-atlas.yaml &
PID_ATLAS=$!
run_repo nova  mcp-ahh/tasks-nova.yaml &
PID_NOVA=$!

wait $PID_ORBIT $PID_ATLAS $PID_NOVA
echo "All repos finished. Building report..."
python -m benchmarks.report --results "$RESULTS"
echo "BATCH=$BATCH"
