#!/usr/bin/env bash
# Manual Claude + Prompt MCP smoke test. Requires: claude CLI, benchmark repo on disk.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MCP_ROOT="$REPO_ROOT/mcp-shi"
REPO_UNDER_TEST="${REPO_UNDER_TEST:-}"

REPO_UNDER_TEST="${REPO_UNDER_TEST:-$MCP_ROOT/test-repo/orbit-crm-generated}"

if [[ ! -d "$REPO_UNDER_TEST" ]]; then
  echo "Benchmark repo not found: $REPO_UNDER_TEST"
  echo "Run ./mcp-shi/scripts/setup_benchmark_repo_git.sh first."
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "claude CLI not found in PATH"
  exit 1
fi

CONTEXT_FILE="$MCP_ROOT/examples/prompt-mcp-context.example.json"
MCP_CALL_LOG="$MCP_ROOT/manual-mcp-calls.jsonl"
MCP_TRACE_LOG="$MCP_ROOT/manual-mcp-trace.jsonl"
MCP_CONFIG="$MCP_ROOT/claude-mcp.manual.json"

cat > "$MCP_CONFIG" <<EOF
{
  "mcpServers": {
    "prompt": {
      "command": "python3",
      "args": ["$MCP_ROOT/benchmark-runs/prompt_mcp_server.py"],
      "env": {
        "PRMPT_CONTEXT_FILE": "$CONTEXT_FILE",
        "PRMPT_MCP_CALL_LOG": "$MCP_CALL_LOG",
        "PRMPT_MCP_TRACE_LOG": "$MCP_TRACE_LOG"
      }
    }
  }
}
EOF

rm -f "$MCP_CALL_LOG" "$MCP_TRACE_LOG"

cd "$REPO_UNDER_TEST"
claude -p "imported workspaces are corrupting lead assignment and workspace visibility, fix it and run the tests

Call \`mcp__prompt__prmpt_optimize_task\` first with task=<bug report> and prompt_id=p4.
Treat the returned JSON as the final authoritative route. Do not second-guess it, do not plan alternate investigations, and do not Glob/Grep or broadly cross-check the repo. Run tests, read the JSON primary files, patch those files, and rerun tests. Search elsewhere only if a failing stack trace explicitly names another file.

You are in a disposable benchmark clone. Fix the issue in this repository.
Run \`npm test\` before editing to discover the concrete failures.
Re-run \`npm test\` after editing and stop when the suite passes.
Do not commit changes." \
  --output-format json \
  --permission-mode bypassPermissions \
  --no-session-persistence \
  --mcp-config "$MCP_CONFIG" \
  --strict-mcp-config

if [[ -s "$MCP_CALL_LOG" ]]; then
  echo "MCP was called. Log: $MCP_CALL_LOG"
else
  echo "MCP was NOT called. Check Claude MCP config."
  exit 1
fi
