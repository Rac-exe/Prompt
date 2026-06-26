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

| Path | Role |
|------|------|
| `src/prmpt-extension.ts` | The `prmpt_retrieve` tool (live `POST :8002/api/context`) + the "retrieve first" policy preamble. Logs every call for the retry metric. |
| `src/index.ts` | Headless binary. Runs the Pi agent loop, streams to stderr, prints a usage JSON line on stdout (tokens, cost, retrieval calls, context size). |
| `harness/bootstrap_index.py` | Indexes the 3 JS repos once into a shared store; writes `index_map.json`. |
| `harness/run_3arm.py` | The 3-arm benchmark runner (A/B/C × 9 tasks), worktree isolation, `npm test` oracle, crash-safe `results.jsonl`. |
| `harness/aggregate.py` | Aggregates `results.jsonl` → `summary.json` and generates the comparison canvas. |

## The 3 arms

All on the **same base model (Claude Sonnet 4.6)** — only the retrieval/prompt layer changes.

- **Arm A** — Claude Code + raw prompt (control; the model explores the repo itself)
- **Arm B** — PRMPT CLI + raw prompt (isolates live-retrieval value)
- **Arm C** — PRMPT CLI + optimized prompt (adds prompt-optimization value)

Win metric: fewer total tokens. Guardrail: pass rate must not drop. Tiebreaker: wall-clock time.

## Setup (once per machine)

1. **Install deps + build:**
   ```bash
   cd prmpt-cli
   npm install
   npm run build
   ```

2. **Start the code-intelligence service** (from repo root, uses its own `.venv`):
   ```bash
   cd code-intelligence-service
   ./.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8002
   ```
   Wait for `Application startup complete`. (On a machine without the local
   ONNX embedding deps, `pip install -r requirements.txt` into that venv first.)

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
python prmpt-cli/harness/aggregate.py            # uses newest results file
```

Writes `harness/summary.json` and generates the `prmpt-cli-3arm` Cursor canvas
(A/B/C totals, token/cost bars, savings, per-task table).

## Metrics captured per run

input/output/cache tokens · total tokens · cost (USD) · wall-clock time ·
passed (tests green) · retrieval retries (`prmpt_retrieve` calls) · tool calls ·
file precision/recall vs `expected_files` · context size.
