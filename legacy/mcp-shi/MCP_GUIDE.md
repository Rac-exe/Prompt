# Prompt MCP Benchmark Guide

This directory packages the local MCP benchmark work so another teammate can pull this branch, point an agent at this guide, and understand how to run or inspect the MCP tests.

## What Is Included

```text
mcp-shi/
  README.md
  MCP_GUIDE.md
  requirements.txt
  benchmark-runs/
    run_benchmark.py
    run_mcp_benchmark.py
    prompt_mcp_server.py
  examples/
    prompt-mcp-context.example.json
    claude-mcp.example.json
  scripts/
    smoke_mcp_server.py
    smoke_claude_mcp.sh
    setup_benchmark_repo_git.sh
  test-repo/
    orbit-crm-generated/
    atlas-commerce-generated/
    nova-support-generated/
  REPOS.md
  results/
    prompt_mcp_three_way_results.json
```

Install Python deps once:

```bash
pip install -r mcp-shi/requirements.txt
```

Initialize benchmark repo git metadata once (after clone):

```bash
./mcp-shi/scripts/setup_benchmark_repo_git.sh
```

The scripts were copied from the local benchmark folder and made portable. They no longer default to `/Users/nihal/Desktop/...`; they default to this repo's `mcp-shi/` directory and support environment-variable overrides.

## Benchmark Repositories (included)

The three generated workspaces are bundled under `mcp-shi/test-repo/`:

- `test-repo/orbit-crm-generated` (~9 MB)
- `test-repo/atlas-commerce-generated` (~9 MB)
- `test-repo/nova-support-generated` (~9 MB)

See **[REPOS.md](./REPOS.md)** for prompts per repo, layout, and override instructions.

What is committed vs local-only:

| Committed | Gitignored (local-only) |
|-----------|-------------------------|
| `package.json`, `src/`, `test/` | `.git/` (recreated by setup script) |
| | `node_modules/` |
| | `package-lock.json` |

Each repo needs these branches for the harness (created by the setup script):

- `without-prompt`
- `with-prompt`

For MCP comparisons, the harness maps:

- `without-mcp` -> `without-prompt`
- `with-mcp` -> `with-prompt`

To use repos from another folder instead:

```bash
export PRMPT_TEST_REPOS_ROOT="/path/to/folder-containing-generated-repos"
```

## Required Local Services

Run these from the Prompt repo root before launching the benchmark:

```bash
npm run python:dev:mac
npm run code-intel:dev:mac
```

Expected service URLs:

- Python optimizer: `ws://127.0.0.1:8001/ws/optimize-stream`
- Code Intelligence: `http://127.0.0.1:8002/api`

Override if needed:

```bash
export PRMPT_OPTIMIZER_WS_URL="ws://127.0.0.1:8001/ws/optimize-stream"
export PRMPT_CODE_INTEL_URL="http://127.0.0.1:8002/api"
```

Dev auth must allow the benchmark token:

```bash
export PRMPT_DEV_AUTH_TOKEN="dev-cli-token"
export PRMPT_ALLOW_DEV_CLI_AUTH="true"
```

The repo already documents these dev-auth vars in `.env.example` and `code-intelligence-service/.env.example`.

## Required CLIs

For Claude runs:

```bash
claude --version
```

For Codex runs:

```bash
codex --version
```

The full harness attempts both `claude` and `codex` by default. If one is unavailable, edit `AGENTS` in `benchmark-runs/run_mcp_benchmark.py` or make sure the CLI is installed/authenticated.

## Quick MCP Server Smoke Test

This tests only the local Prompt MCP server, not Claude Code.

Automated (recommended):

```bash
python3 mcp-shi/scripts/smoke_mcp_server.py
```

Manual interactive test from the repo root:

```bash
export PRMPT_CONTEXT_FILE="$PWD/mcp-shi/examples/prompt-mcp-context.example.json"
export PRMPT_MCP_CALL_LOG="$PWD/mcp-shi/mcp-calls.jsonl"
export PRMPT_MCP_TRACE_LOG="$PWD/mcp-shi/mcp-trace.jsonl"
python3 -u mcp-shi/benchmark-runs/prompt_mcp_server.py
```

Then paste this JSON line into stdin:

```json
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
```

Expected behavior:

- The server returns the three tools:
  - `prmpt_optimize_task`
  - `prmpt_retrieve_context`
  - `prmpt_get_test_plan`

Then paste:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"prmpt_optimize_task","arguments":{"task":"imported workspaces are corrupting lead assignment and workspace visibility, fix it and run the tests","prompt_id":"p4"}}}
```

Expected behavior:

- The server returns compact JSON with `primary` file locations and a strict policy.
- `mcp-shi/mcp-calls.jsonl` records the tool call.

Exit with `Ctrl-D`.

## Manual Claude MCP Smoke Test

This runs Claude Code against a repo with the Prompt MCP server configured. It is useful before running the whole benchmark.

Automated wrapper (requires `claude` CLI and a benchmark repo):

```bash
export REPO_UNDER_TEST="$PWD/mcp-shi/test-repo/orbit-crm-generated"
./mcp-shi/scripts/smoke_claude_mcp.sh
```

Or set paths manually:

```bash
export REPO_UNDER_TEST="$PWD/mcp-shi/test-repo/orbit-crm-generated"
export MCP_CALL_LOG="$PWD/mcp-shi/manual-mcp-calls.jsonl"
export MCP_CONFIG="$PWD/mcp-shi/claude-mcp.manual.json"
```

Copy `mcp-shi/examples/claude-mcp.example.json` to `$MCP_CONFIG` and replace relative paths with absolute paths if needed.

Run Claude:

```bash
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
```

Check:

```bash
test -s "$MCP_CALL_LOG" && echo "MCP was called" || echo "MCP was not called"
```

## Full MCP Benchmark

From the Prompt repo root:

```bash
python3 mcp-shi/benchmark-runs/run_mcp_benchmark.py
```

This will:

1. Verify benchmark repos are clean.
2. Index each generated repo through the Code Intelligence service.
3. Ask the Python optimizer to generate scoped prompts.
4. Create disposable clones/worktrees for each condition.
5. Run agents with and without MCP.
6. Save test output, diffs, agent output, MCP call logs, token/cost usage, and a PDF report.

Outputs go under:

```text
mcp-shi/benchmark-runs/<timestamp>-mcp/
```

Important output files:

- `run_config.json`
- `indexed_projects.json`
- `optimized_prompts.json`
- `agent_results.json`
- `summary.json`
- `mcp-benchmark-report.pdf`
- `agent-runs/**/result.json`
- `agent-runs/**/cost_usage.json`
- `agent-runs/**/mcp_calls.json`
- `agent-runs/**/git_diff.patch`
- `agent-runs/**/test_before.json`
- `agent-runs/**/test_after.json`

## Full Non-MCP Prompt Benchmark

Use this when comparing raw prompts against optimized text prompts without MCP:

```bash
python3 mcp-shi/benchmark-runs/run_benchmark.py
```

It uses the same repos and services but compares:

- `without-prompt`
- `with-prompt`

## Environment Variables

The copied scripts support these overrides:

```bash
export PRMPT_APP_ROOT="/path/to/Prompt"
export PRMPT_BENCH_ROOT="/path/to/mcp-shi"
export PRMPT_TEST_REPOS_ROOT="/path/to/folder-containing-generated-repos"
export PRMPT_BENCH_RUNS_ROOT="/path/to/output-runs"
export PRMPT_CODE_INTEL_URL="http://127.0.0.1:8002/api"
export PRMPT_OPTIMIZER_WS_URL="ws://127.0.0.1:8001/ws/optimize-stream"
export PRMPT_DEV_AUTH_TOKEN="dev-cli-token"
export PRMPT_BENCH_AGENT_TIMEOUT="900"
export PRMPT_BENCH_INDEX_TIMEOUT="1200"
export PRMPT_MCP_SERVER="/path/to/prompt_mcp_server.py"
export PRMPT_BASE_BENCH_SCRIPT="/path/to/run_benchmark.py"
```

## Current Historical Results

Included historical result snapshots:

- `results/prompt_mcp_three_way_results.json`

Prompt MCP three-way result:

| Condition | Passed | Cost | Turns | Cache Read | Output Tokens | MCP Calls |
|---|---:|---:|---:|---:|---:|---:|
| Claude direct | yes | `$0.4209` | 12 | `146,386` | `8,194` | 0 |
| Claude + Prompt MCP | yes | `$0.4958` | 15 | `341,802` | `7,206` | 1 |
| Claude + Prompt MCP allowlist | yes | `$0.3974` | 16 | `255,560` | `5,306` | 1 |

Takeaway:

- Prompt MCP only became cheaper in the allowlist case.
- Strong MCP tool descriptions alone did not prevent Claude from doing extra exploration.
- Broad search/tool behavior must be constrained or the MCP route can add overhead.
- MCP availability is not enough. The downstream agent must actually invoke and follow it.

## How To Explain This To Another Agent

Use this prompt:

```text
Read mcp-shi/MCP_GUIDE.md first. Then inspect mcp-shi/benchmark-runs/prompt_mcp_server.py, run_mcp_benchmark.py, and the result snapshots in mcp-shi/results. Explain how the Prompt MCP benchmark works, what external generated repos/services are required, and how to run a smoke test before the full benchmark.
```

## Known Gaps

- The generated benchmark repos are still external and must be copied or regenerated.
- The full harness is expensive because it runs real Claude/Codex agent sessions.
- The Prompt MCP server is benchmark-grade, not production-grade.
- The current MCP server returns precomputed optimized prompt context from a JSON file. Production should create a run ID, optimize/retrieve live, and upload downstream usage/outcome metrics.
- The historical result JSON contains absolute paths from the original local run. Those paths are informational only.

