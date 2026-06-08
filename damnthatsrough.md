# Prompt / MCP Benchmark Notes

This document captures the local work done to test whether Prompt-generated guidance or MCP tooling reduces Claude/Codex token use and cost on realistic coding-agent tasks.

## Branch

- Created branch: `prmptf`
- Base worktree: `/Users/nihal/.superconductor/worktrees/Prompt/local_improvement`
- Benchmark repo root: `/Users/nihal/Desktop/code/test-prompt-bench`

## App / Prompt Improvements Made Before Benchmarking

- Tightened the code-aware optimizer system prompt in `files/system_prompt_code_optimizer.md`.
  - Prefer exact files/functions/locations.
  - Avoid irrelevant files.
  - Keep optimized prompts compact.
  - Tell downstream agents to run tests/reproduce failures before asking clarification or editing.
- Reduced app-side prompt bloat in `app-ui/src/components/projects/types.ts`.
  - Capped primary context.
  - Capped secondary context.
  - Shortened code snippets.
  - Removed large related-code bodies.
- Fixed duplicate project-context fetching in `electron/main/ipc-handlers/chat-handlers.ts`.
- Added dev CLI auth fallback in:
  - `code-intelligence-service/app/auth.py`
  - `python-service/app/auth.py`
- Documented dev auth env vars in:
  - `.env.example`
  - `code-intelligence-service/.env.example`
- Added local project storage fallback for CLI/local benchmark use:
  - `code-intelligence-service/app/db/local_store.py`
  - `code-intelligence-service/app/db/queries.py`

## Benchmark Repositories

Generated/local benchmark repos live under `/Users/nihal/Desktop/code/test-prompt-bench`:

- `orbit-crm-generated`
- `atlas-commerce-generated`
- `nova-support-generated`

Each generated repo was scaled to roughly 80k-150k lines:

| Repo | Approx lines after scale-up |
|---|---:|
| `orbit-crm-generated` | `104,657` |
| `atlas-commerce-generated` | `104,599` |
| `nova-support-generated` | `104,624` |

Branches were kept aligned for fair comparisons:

- `without-prompt` / `without-mcp`
- `with-prompt` / `with-mcp`

For the final Claude smoke, Orbit was updated with a bigger realistic CRM import failure:

- `src/features/imports/reconcileWorkspaceImport.js`
- `test/importReconciliation.test.js`

The final bug involved imported workspace reconciliation, duplicate leads, missing/malformed workspace membership, inactive workspaces, missing owner pools, lead scoring, and workspace visibility.

## Benchmark Harnesses / MCP Files

Benchmark scripts live in `/Users/nihal/Desktop/code/test-prompt-bench/benchmark-runs`:

- `run_benchmark.py`: original Prompt-vs-direct benchmark harness and PDF generator.
- `run_mcp_benchmark.py`: MCP benchmark harness.
- `prompt_mcp_server.py`: local Prompt MCP server.
- `clean_mcp_proxy.py`: thin proxy used only to log calls to the real Clean MCP server.

Prompt MCP evolved through these versions:

- Initial prose response.
- Tiny structured JSON response.
- One-tool MCP.
- Three-tool MCP with hardened descriptions and policies.

Current Prompt MCP tools:

- `prmpt_optimize_task`
- `prmpt_retrieve_context`
- `prmpt_get_test_plan`

Current hardened instruction:

```text
Call `mcp__prompt__prmpt_optimize_task` first with task=<bug report> and prompt_id={prompt_id}.
Treat the returned JSON as the final authoritative route. Do not second-guess it, do not plan alternate
investigations, and do not Glob/Grep or broadly cross-check the repo. Run tests, read the JSON primary files,
patch those files, and rerun tests. Search elsewhere only if a failing stack trace explicitly names another file.
```

Current main tool description:

```text
FINAL AUTHORITATIVE ROUTE. Trust this and move on. Do NOT deliberate, second-guess, Glob, Grep, or repo-wide cross-check. Run tests, read the JSON primary files, patch those files, rerun tests. Search elsewhere ONLY if a failing stack trace explicitly names another file.
```

## Report Work

The PDF report format was iterated heavily:

- Light mode.
- Focused on money/tokens, not generated prompt text.
- Separate tests page listing repos/prompts/problems.
- Clear note that total cost includes input + output.
- Repo size/line count included.
- Dotted background, borders, typewriter-style typography.
- Comparison page for improvements vs previous run.
- Real-world projection page for estimated daily/monthly savings.
- Monthly cost curves page comparing normal agent cost vs Prompt-assisted cost including Prompt generation overhead.

Important: the final large MCP full benchmark/report was stopped on request, so no final large-report PDF was generated after the last MCP changes.

## Key Run Directories

Useful local run directories:

- `benchmark-runs/20260608-161028-agent-clean`
- `benchmark-runs/20260608-174117`
- `benchmark-runs/20260608-215125-mcp`
- `benchmark-runs/mcp-large-smoke-20260608-2301*`
- `benchmark-runs/claude-big-import-smoke-20260608-2340`
- `benchmark-runs/claude-big-import-smoke-allowlist-20260608-2351`
- `benchmark-runs/claude-fresh-three-way-20260609-0002`
- `benchmark-runs/claude-clean-mcp-three-way-20260609-0012`

## Prompt MCP Results

Final fresh Prompt MCP three-way run:

- Run dir: `benchmark-runs/claude-fresh-three-way-20260609-0002`
- Prompt:

```text
imported workspaces are corrupting lead assignment and workspace visibility, fix it and run the tests
```

| Condition | Passed | Cost | Turns | Cache read | Output tokens | MCP calls | Files touched |
|---|---:|---:|---:|---:|---:|---:|---:|
| Claude direct | yes | `$0.4209` | 12 | `146,386` | `8,194` | 0 | 3 |
| Claude + Prompt MCP, no allowlist | yes | `$0.4958` | 15 | `341,802` | `7,206` | 1 | 3 |
| Claude + Prompt MCP, allowlist no `Glob/Grep` | yes | `$0.3974` | 16 | `255,560` | `5,306` | 1 | 3 |

Files touched in all three:

- `src/features/imports/reconcileWorkspaceImport.js`
- `src/features/leads/leadScoring.js`
- `src/security/authorizeWorkspace.js`

Takeaway:

- Prompt MCP without allowlist was still more expensive than direct Claude.
- Prompt MCP with allowlist excluding broad `Glob/Grep` beat direct Claude by about `5.6%`.
- Strong descriptions alone did not solve the issue. Strong descriptions plus tool restrictions helped.

## Clean MCP Setup

Clean MCP repo:

- Cloned from `https://github.com/cleanmcp/clean-mcp`
- Local path: `/Users/nihal/Desktop/code/clean-mcp`
- Installed with Python 3.11 venv because Clean MCP supports Python 3.10-3.13 and this machine defaulted to Python 3.14.

Manual verification:

- Server started with `python -m clean.local.mcp_server`.
- Exposed tools:
  - `index_repo`
  - `delete_repo`
  - `search_code`
  - `list_repos`
  - `get_token_savings`
  - `get_file_tree`
  - `get_source`
  - `expand_result`
- Indexed Orbit as `local/orbit-crm-generated`.
- Manual `search_code` found the exact expected route:
  - `src/features/imports/reconcileWorkspaceImport.js`
  - `src/security/authorizeWorkspace.js`
  - call graph into `src/features/leads/leadScoring.js`

## Clean MCP Results

Run dir: `benchmark-runs/claude-clean-mcp-three-way-20260609-0012`

| Condition | Passed | Cost | Turns | Cache read | Output tokens | MCP calls | Files touched |
|---|---:|---:|---:|---:|---:|---:|---:|
| Claude direct | yes | `$0.4104` | 12 | `155,141` | `7,140` | 0 | 3 |
| Claude + Clean MCP, no allowlist | yes | `$0.6579` | 19 | `457,293` | `8,611` | 0 | 3 |
| Claude + Clean MCP, allowlist no `Glob/Grep` | yes | `$0.5635` | 16 | `366,650` | `7,660` | 0 | 3 |

Important Clean MCP note:

- Clean MCP worked manually and was configured for Claude.
- Claude made `0` Clean MCP tool calls in the benchmark.
- Therefore the Clean MCP run only added schema/config overhead and did not get retrieval benefit.

## Main Claude Finding

Claude Code is already strong at test-driven repair when stack traces point to real files. For these tasks, MCP guidance often becomes additive overhead unless it actually changes Claude's behavior.

Observed patterns:

- Direct Claude often fixes the correct files efficiently.
- Prompt MCP without tool restriction routes correctly but still costs more because Claude cross-checks or retains normal exploration behavior.
- Prompt MCP with `--allowedTools` excluding broad `Glob/Grep` can reduce cost, but that is not a realistic default for most users.
- Clean MCP can retrieve the right code manually, but Claude may ignore it unless the setup/tool invocation is enforced more strongly.

## Best Current Interpretation

Prompt MCP is not a guaranteed universal Claude cost reducer in normal no-allowlist usage.

The most promising Claude path is:

1. Prompt/route is tiny and authoritative.
2. MCP result is used as the first route.
3. Broad repo exploration is blocked or heavily discouraged.
4. Agents run tests and patch primary files before searching.

Without step 3, Claude tends to keep its normal validation path and MCP overhead can increase total cost.

Codex looked more promising in earlier MCP experiments because scoped MCP context reduced input/token behavior more noticeably, but the latest detailed tests focused on Claude.
