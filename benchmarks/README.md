# PRMPT Benchmark Environment

A fully automated, controlled benchmark that answers one question honestly:

> On a real repo, does PRMPT lower the **net** cost of getting a coding task done
> (agent spend **plus** PRMPT's own OpenRouter spend) **without** lowering the
> first-try success rate — and does the advantage grow with repo size?

It runs a matrix of coding-agent sessions headlessly (no human, no agent driving
it, so there is no harness spend to exclude), measures three cost planes, and
produces a reproducible report.

## The matrix

For each task it runs these cells (× `repeats`):

| Agent | Variant | Meaning |
|---|---|---|
| claude / codex | `raw` | raw prompt → agent. The baseline. |
| claude / codex | `mcp_optimizer` | index repo → PRMPT optimizer → optimized prompt + MCP (agentic loop on) |
| claude / codex | `mcp_only` | raw prompt → agent, PRMPT MCP available, no optimizer |

The two MCP variants each run in `soft` (native search allowed — organic) and
`hard` (native Grep/Glob/find denied — forces MCP) hardening, so you see both
"does the model choose PRMPT" and "can PRMPT replace native search".

## The three measurement planes

1. **Agent spend** — Claude `total_cost_usd` from `--output-format json`; Codex
   tokens from the rollout file (`~/.codex/sessions/.../rollout-*.jsonl`, because
   `--json` omits reasoning tokens) priced at the rates you configure.
2. **PRMPT spend** — every OpenRouter call PRMPT makes for indexing, optimizing,
   and the agentic loop. Captured as generation ids during the run, then
   reconciled to the **authoritative billed `total_cost`** via
   `GET /api/v1/generation?id=` (the streamed/estimated cost can be up to 4× low).
3. **Outcome** — `verify_cmd` exit 0 is the only definition of "fixed". Plus
   retries, wall-clock, files touched, and retrieval precision/recall.

`net_cost = agent_spend + prmpt_spend`. A variant only "wins" if net cost drops
**and** first-try pass-rate holds vs the raw baseline. The report enforces this.

## Setup

```bash
pip install -r benchmarks/requirements.txt
cp benchmarks/config.example.yaml benchmarks/config.yaml
cp benchmarks/tasks.example.yaml  benchmarks/tasks.yaml
```

Then edit `config.yaml`:
- Pin `claude_model` / `codex_model`.
- Set `codex_cost_per_1k_input` / `_output` to your model's rates (Codex reports
  no USD).
- Point `mcp_config_claude` / `mcp_config_codex` at your launched PRMPT MCP
  (see `hardening/mcp.claude.example.json` / `mcp.codex.example.toml`). The MCP
  server (`prompt_mcp_server.py`) currently lives in the external
  `test-prompt-bench` repo — copy/launch it and point these here.
- Export the env the hooks need:
  ```bash
  export OPENROUTER_API_KEY=sk-or-...
  export PRMPT_INDEX_URL=http://localhost:8002/api/bench/index
  export PRMPT_OPTIMIZE_URL=http://localhost:8001/api/bench/optimize
  ```

Define real tasks in `tasks.yaml`. Best practice: a bug with a test that **fails
at `base_commit` and passes after a correct fix** (SWE-bench style).

## Run

```bash
# 1. run the matrix
python -m benchmarks.runner --config benchmarks/config.yaml --tasks benchmarks/tasks.yaml

# 2. reconcile PRMPT's OpenRouter spend to billed cost
python -m benchmarks.reconcile --results benchmarks/results/<batch>

# 3. build the report
python -m benchmarks.report --results benchmarks/results/<batch>
```

You get `results/<batch>/report.md` (verdict + tables) and `summary.csv`.

## What PRMPT must expose for plane 2 (the only service-side dependency)

When `BENCH_MODE=1`, the indexer, optimizer, and MCP/agentic-loop must surface
the OpenRouter generation id of each LLM call for the request, via either:
- response body `{"_bench": {"generation_ids": [...], "tokens": N, "cost_usd": X}}`, or
- response header `x-openrouter-generation-id`.

The agentic loop already accumulates a `stats` dict (tokens/hops); it needs the
generation-id capture added to match. Without these ids, plane 2 falls back to
local estimates and the report flags `reconciled=false`.

## Honesty guardrails baked in

- No agent drives the harness → no harness spend to exclude.
- A `$0` + no-tokens + no-output Claude run is flagged `SUSPECT_EMPTY_RUN` (the
  known `--disallowedTools` + `--mcp-config` silent-exit bug) instead of being
  scored as a free success. Hardening uses `settings.json` deny rules to avoid it.
- `net_cost` always includes PRMPT's own spend.
- A token saving that lowers pass-rate is reported as a **regression**, not a win.
- `repeats ≥ 3`, median + min/max spread, pinned models, `web_search` off.
