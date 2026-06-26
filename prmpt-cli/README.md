# PRMPT CLI — standalone coding agent + 3-arm benchmark

PRMPT as its own CLI coding agent, built on the [Pi SDK](https://pi.dev)
(`@earendil-works/pi-coding-agent`) running Claude Sonnet 4.6. Instead of being
an MCP plugin bolted onto another agent, PRMPT *is* the agent: it drives the Pi
loop and exposes a single live retrieval tool, `prmpt_retrieve`, backed by the
existing code-intelligence service.

```
prmpt -p "<task>" --cwd <repo>
```

## Layout


| Path                         | Role                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/prmpt-extension.ts`     | The `prmpt_retrieve` tool (live `POST :8002/api/context`) + the "retrieve first" policy preamble. Logs every call for the retry metric.       |
| `src/index.ts`               | Headless binary. Runs the Pi agent loop, streams to stderr, prints a usage JSON line on stdout (tokens, cost, retrieval calls, context size). |
| `harness/bootstrap_index.py` | Indexes the 3 JS repos once into a shared store; writes `index_map.json`.                                                                     |
| `harness/run_3arm.py`        | The 3-arm benchmark runner (A/B/C × 9 tasks), worktree isolation, `npm test` oracle, crash-safe `results.jsonl`.                              |
| `harness/aggregate.py`       | Aggregates `results.jsonl` → `summary.json` and generates the comparison canvas.                                                              |


## The 3 arms

All on the **same base model (Claude Sonnet 4.6)** — only the retrieval/prompt layer changes.

- **Arm A** — Claude Code + raw prompt (control; the model explores the repo itself)
- **Arm B** — PRMPT CLI + raw prompt (isolates live-retrieval value)
- **Arm C** — PRMPT CLI + optimized prompt (adds prompt-optimization value)

Win metric: fewer **total tokens** (apples-to-apples across arms). Guardrail: pass
rate must not drop. Tiebreaker: wall-clock time. Dollar cost is reported as a
**secondary** number — Arm A may run on a Claude subscription where `$` is an
estimate, not per-token billing.

> **Important — "total tokens" for B/C is not just the agent.** PRMPT spends
> tokens in its own code-intel layer too: indexing (summaries/concepts via
> OpenRouter; embeddings/rerank are local and free) and a small LLM call on each
> `prmpt_retrieve`. The benchmark folds that PRMPT-side spend into the B/C totals
> so the comparison is honest — but only if you start the service with usage
> logging on (step 2 below). Arm A never calls code-intel, so it has none.

## How it's driven (same model as prior benchmarks)

A script (`run_3arm.py`) runs every cell; a person or agent watches it. It is a
benchmark **runner**, not a generic multi-agent harness — see *Limitations* at the
bottom. On the test machine:

- **Claude Code (Arm A)** is invoked through this runner using the `claude` CLI
already installed there (its own auth/subscription).
- **PRMPT CLI (Arms B and C)** is invoked through the same runner; Arm C feeds the
pre-optimized prompts from `first-test/prepared/`.

All three produce one comparable record per run in `results.jsonl`.

## Setup (once per machine)

1. **Install deps + build:**
  ```bash
   cd prmpt-cli
   npm install
   npm run build
  ```
2. **Start the code-intelligence service** with PRMPT-side usage logging on
  (from repo root, uses its own `.venv`):
   Wait for `Application startup complete` and the log line
   `[Usage] PRMPT LLM usage logging ENABLED`. (On a machine without the local
   ONNX embedding deps, `pip install -r requirements.txt` into that venv first.)
   Every LLM call the service makes is appended to `llm_usage.jsonl` with token
   counts + cost; `aggregate.py` reads it to compute PRMPT's true cost. Leaving
   `PRMPT_LLM_USAGE_LOG` unset just means B/C totals are agent-only.
3. **Index the 3 repos** (writes `prmpt-cli/index_map.json`):
  ```bash
   python prmpt-cli/harness/bootstrap_index.py
  ```

## API keys

- **Arms B/C (PRMPT CLI):** set `OPENROUTER_API_KEY`. The CLI defaults to
`provider=openrouter`, `model=anthropic/claude-sonnet-4.6`. Override with
`PRMPT_PROVIDER` / `PRMPT_MODEL` (e.g. `provider=anthropic`,
`model=claude-sonnet-4-6` if you have a real Anthropic key).
- **Arm A (Claude Code):** uses whatever auth the `claude` CLI already has.

## Run the benchmark

```bash
# all arms, all 9 tasks (27 runs) — makes real, paid model calls
python prmpt-cli/harness/run_3arm.py

# subsets
python prmpt-cli/harness/run_3arm.py --arms B,C            # skip Claude Code
python prmpt-cli/harness/run_3arm.py --only-task orbit-p1
python prmpt-cli/harness/run_3arm.py --repeats 3
python prmpt-cli/harness/run_3arm.py --dry-run             # print the plan, run nothing
```

Each run copies the task repo to a throwaway dir, runs the agent there, runs
`npm test`, and appends one record to `harness/results/results-<batch>.jsonl`.

## Report

```bash
# pass the same usage log the service wrote so PRMPT-side cost is folded in
python prmpt-cli/harness/aggregate.py \
  --usage-log code-intelligence-service/llm_usage.jsonl
```

`aggregate.py` attributes each usage-log row to a run by wall-clock window (runs
are sequential, so this is unambiguous): rows during a B/C run → that run's
retrieval cost; rows before the first run → one-time index cost, amortized across
B/C runs. It writes `harness/summary.json` and generates the `prmpt-cli-3arm`
Cursor canvas (pass rates, token/cost bars, **agent vs PRMPT-side vs combined**
decomposition, savings, per-task table). If `--usage-log` is omitted it still
runs, but prints a NOTE that B/C totals are agent-only.

## Metrics captured per run

input/output/cache tokens · total tokens · cost (USD) · wall-clock time ·
passed (tests green) · retrieval retries (`prmpt_retrieve` calls) · tool calls ·
file precision/recall vs `expected_files` · context size · PRMPT-side code-intel
tokens/cost (retrieval + amortized index, via the usage log).

## Limitations (read before trusting the numbers)

This is a purpose-built runner, not a general harness. Known constraints:

1. **JS-only indexing.** `bootstrap_index.py` parses `src/**/*.js`. Other
  languages won't index, so `prmpt_retrieve` returns nothing and PRMPT degrades
   to blind editing. Adding a language needs a real (AST/tree-sitter) parser.
2. **Binary oracle.** Pass/fail is `npm test` exit code only — no partial credit
  or judged diff quality. A test can pass for the wrong reason.
3. **Sequential only.** code-intel selects its DB root per request globally, so
  runs must be serial (the runner is). Time-window cost attribution relies on
   this; do not parallelize.
4. **Mixed billing basis for Arm A.** Token counts are comparable, but if Claude
  Code runs on a subscription the `$` is an estimate. Headline on tokens.
5. **Claude Code model pinning.** The runner passes `--model claude-sonnet-4-6`,
  but the effective version depends on the local `claude` CLI/account — confirm
   it is really 4.6.
6. **Single sample by default** (`--repeats 1`); noisy. Use `--repeats 3` if the
  budget allows.
7. **Repos at HEAD, not a pinned SHA** — reproducibility assumes the bundled
  buggy repos don't change.
8. **Not a standalone harness agent.** The PRMPT CLI itself is a real agent you
  can point at any repo, but it only retrieves usefully for repos indexed into
   code-intel (JS today). The 3-arm runner is wired to these 9 tasks; new
   agents/languages/tasks require editing the script.

All work for this lives on git branch `**feat/prmpt-cli`**.