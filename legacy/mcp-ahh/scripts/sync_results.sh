#!/usr/bin/env bash
# Copy benchmark batch into first-test/ and Desktop.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BATCH="${1:?usage: sync_results.sh <batch_dir_name>}"
SRC="$REPO_ROOT/mcp-ahh/results/$BATCH"
DEST="$REPO_ROOT/first-test"

if [[ ! -d "$SRC" ]]; then
  echo "missing batch: $SRC" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST/reports" "$DEST/runs" "$DEST/logs" "$DEST/prepared" "$DEST/config"

cp "$SRC/FULL_REPORT.md" "$SRC/FULL_REPORT.pdf" "$SRC/report.md" "$SRC/summary.csv" "$DEST/reports/" 2>/dev/null || true
cp "$SRC/runs.jsonl" "$DEST/reports/" 2>/dev/null || true
cp "$SRC"/*.json "$DEST/runs/" 2>/dev/null || true
cp "$SRC/runner.log" "$DEST/logs/" 2>/dev/null || true
cp -R "$SRC/sessions" "$DEST/logs/" 2>/dev/null || true
cp "$REPO_ROOT/mcp-ahh/results/prepared/"* "$DEST/prepared/" 2>/dev/null || true
cp "$REPO_ROOT/mcp-ahh/config-run.yaml" "$REPO_ROOT/mcp-ahh/tasks-all-p2p3.yaml" "$DEST/config/"

cp "$DEST/reports/FULL_REPORT.md" /Users/nihal/Desktop/PRMPT_BENCHMARK_20260611_FULL_REPORT.md
cp "$DEST/reports/FULL_REPORT.pdf" /Users/nihal/Desktop/PRMPT_BENCHMARK_20260611_FULL_REPORT.pdf
cp "$DEST/reports/report.md" /Users/nihal/Desktop/PRMPT_BENCHMARK_20260611_report.md
cp "$DEST/reports/summary.csv" /Users/nihal/Desktop/PRMPT_BENCHMARK_20260611_summary.csv
cp "$DEST/reports/runs.jsonl" /Users/nihal/Desktop/PRMPT_BENCHMARK_20260611_runs.jsonl 2>/dev/null || true

echo "Synced $BATCH -> first-test/ and Desktop"
