# mcp-ahh — the central benchmark

`mcp-ahh` is the single place to benchmark PRMPT. It fuses the two halves we had:

- `**mcp-shi/**` (your friend's work): a **real**, working stdio MCP server, three
bundled buggy repos with real failing tests, and the live index/optimize
pipeline calls. It runs end-to-end today.
- `**benchmarks/`** (our engine): the measurement rigor — 3 variants, soft/hard
hardening, OpenRouter usage-delta cost, repeats, an honest net-savings verdict,
a passive real-user logger, and LLM-ready `runs.jsonl` output.

mcp-ahh wires the engine to drive the real server + repos, so we get **one
harness that is both real and rigorous.**

---

## What each side had, and what was missing


| Capability                                            | mcp-shi (friend)                   | benchmarks (ours)                    | mcp-ahh (central)              |
| ----------------------------------------------------- | ---------------------------------- | ------------------------------------ | ------------------------------ |
| Real stdio MCP server                                 | ✅ `prompt_mcp_server.py`           | ❌ assumed external                   | ✅ reuses mcp-shi's             |
| Bundled buggy repos + `npm test` oracle               | ✅ 3 repos, 9 prompts               | ❌ none                               | ✅ reuses mcp-shi's             |
| Live index + optimize pipeline                        | ✅ WS `:8001` + `:8002`             | ⚠️ stub HTTP hooks                   | ✅ `prepare.py` (mcp-shi calls) |
| MCP-call counting                                     | ✅ server **call-log** (definitive) | ⚠️ session heuristic                 | ✅ call-log (definitive)        |
| Variants                                              | ⚠️ 2 (with / without)              | ✅ 3 (raw / mcp_only / mcp_optimizer) | ✅ 3                            |
| Soft **and** hard hardening                           | ❌ prompt-only                      | ✅ both (deny rules)                  | ✅ both                         |
| PRMPT cost measurement                                | ❌ **hardcoded** token guess        | ✅ OpenRouter usage-delta             | ✅ delta + amortized prep cost  |
| Repeats / variance                                    | ❌ 1 run/cell                       | ✅ K repeats + median                 | ✅ K repeats                    |
| Net-savings verdict (cost ↓ **and** correctness held) | ⚠️ PDF, guessed overhead           | ✅ honest rule                        | ✅ honest rule                  |
| Passive real-user logger                              | ❌                                  | ✅ `passive.py`                       | ✅ `passive.py`                 |
| Silent-exit ($0) guard                                | ❌                                  | ✅ SUSPECT_EMPTY_RUN                  | ✅                              |
| LLM-ready output                                      | ❌                                  | ✅ `runs.jsonl`                       | ✅                              |


**The single biggest fix mcp-ahh brings:** mcp-shi's report computed PRMPT's
overhead from a **hardcoded** `48962` input / `2461` output token constant, then
subtracted it from "savings." That number is a guess, not a measurement. mcp-ahh
replaces it with the **measured** OpenRouter usage-delta (live calls) plus the
**amortized real prep cost** from `prepare.py`. The savings number becomes real.

**The honest read of mcp-shi's own historical results:** Prompt MCP was only
cheaper in the *allowlist* (hard-hardening) case; with strong tool descriptions
alone, Claude still explored and the MCP *added* cost. mcp-ahh is built to expose
exactly this — it runs soft vs hard side by side and counts calls from the server
log, so we stop guessing.

> Note on the MCP server: it currently serves **precomputed** optimized prompts
> from a context file (per mcp-shi's "Known Gaps"). mcp-ahh treats that honestly —
> prep cost is paid once and amortized. When the server is upgraded to optimize
> live, the engine already captures that spend via the per-run delta (no change
> needed here).

---

## Scope — read the results correctly

**What this measures:** the *routing / optimizer* value on **first-try** bug
fixes — does `mcp_only` or `mcp_optimizer` beat `raw` on net cost while keeping
correctness, and does it only win under `hard` hardening.

**What this does NOT test yet (deliberately deferred):**

- **The agentic retrieval loop.** The bundled MCP server is precomputed, so the
loop in `code-intelligence-service/app/services/agent_loop.py` does **not** run
during the agent's turn. (It may run once, first-pass only, during `prepare.py`
if `AGENTIC_RETRIEVAL_ENABLED=true`.)
- **The "fix it again" determinism fix.** The loop can escalate on retries, but
no caller drives it — `search.py` always calls it with `attempt_number=1` and
no error signal, and the MCP layer has no per-run state. Wiring this needs the
pipeline rework (live + stateful MCP session), not a harness change.

**Trigger to turn the loop test on (later):** (1) MCP server calls code-intel
live with `AGENTIC_RETRIEVAL_ENABLED=true`; (2) `search.py` threads
`attempt_number` / `previous_attempt_chunk_ids` / `error_signal`; (3) add a retry
oracle here (on `npm test` fail, re-retrieve with the failure signal). Until then,
read every result as **"routing/optimizer baseline,"** not "finished product."

---

## Layout

```
mcp-ahh/
  config.yaml      # engine wired to the real server + bundled repos
  tasks.yaml       # the 9 bundled tasks (npm test oracle)
  prepare.py       # PHASE 1: live index+optimize -> results/prepared/
  run.py           # PHASE 2+3: run matrix, then build report
  README.md
benchmarks/
  mcp_real.py      # NEW: glue (context file, MCP config, call-log counting)
  runner.py        # extended: drives the real server when configured
  report.py, metrics.py, openrouter.py, passive.py, adapters/, hardening/
mcp-shi/
  benchmark-runs/prompt_mcp_server.py   # the real MCP server (reused)
  test-repo/<3 repos>                   # bundled, reused
```

---

## How to run it (from the repo root)

```bash
# 0. one-time deps + recreate the bundled repos' git metadata
pip install -r mcp-shi/requirements.txt
./mcp-shi/scripts/setup_benchmark_repo_git.sh
export OPENROUTER_API_KEY=sk-or-...        # same key the PRMPT services use

# bring PRMPT services up (needed for prepare only)
npm run python:dev:mac
npm run code-intel:dev:mac

# PHASE 1 — live index + optimize, writes mcp-ahh/results/prepared/
python mcp-ahh/prepare.py

# PHASE 2+3 — run the full matrix, then build the report
python mcp-ahh/run.py
# single task while iterating:
python mcp-ahh/run.py --only-task orbit-p1
```

Outputs land in `mcp-ahh/results/<timestamp>/`:

- `report.md` / `report.csv` — net savings + correctness + soft-vs-hard
- `runs.jsonl` — one record per cell; **feed this straight to an LLM** for a
write-up (no need to use our report at all)

### Preflight checklist for the operator (LLM or human)

1. `OPENROUTER_API_KEY` exported; `python mcp-ahh/prepare.py` finished and
  `mcp-ahh/results/prepared/prepare_meta.json` shows a non-zero prep cost.
2. `claude --version` (and `codex --version` if running Codex) work.
3. Smoke the server once: `python mcp-shi/scripts/smoke_mcp_server.py`.
4. Validate the oracle: in one bundled repo, `npm test` must FAIL before any fix
  (a task that already passes proves nothing).
5. Run `--only-task orbit-p1` first; confirm the run record shows
  `mcp_tool_calls > 0` for the MCP variants before launching the full matrix.

---

## Real users (the 6 pilots)

Same engine, no controlled tasks:

```bash
python -m benchmarks.passive start --repo <their repo> --agent claude --variant mcp_optimizer --task "<what they asked>"
# they work...
python -m benchmarks.passive stop --success y --turns 3
```

Captures agent tokens, the PRMPT OpenRouter delta, and the git diff. Pass/fail is
self-reported (`success_source: self_report`) or left `unscored`.