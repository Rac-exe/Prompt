# PRMPT Benchmark Environment

A fully automated, controlled benchmark that answers one question honestly:

> On a real repo, does PRMPT lower the **net** cost of getting a coding task done
> (agent spend **plus** PRMPT's own OpenRouter spend) **without** lowering the
> first-try success rate — and does the advantage grow with repo size?

It runs a matrix of coding-agent sessions headlessly (no human, no agent driving
it, so there is no harness spend to exclude), measures three cost planes, and
produces a reproducible report.

## For the LLM/agent operator — READ THIS FIRST

If you are an AI agent asked to "run the benchmark", your job is to be the
**operator**, not the coding agent under test. Concretely:

- **DO** run the Python commands below. The harness will itself launch Claude
  Code / Codex as subprocesses and measure them.
- **DO NOT** try to fix the tasks' bugs yourself, read the target repos, or edit
  any code. You only run commands and report what the harness produced.
- **DO NOT** run cells in parallel and **DO NOT** background the runner. PRMPT
  cost is measured from the OpenRouter usage delta per run, which only works if
  runs happen one at a time. Let `runner.py` finish.
- **DO NOT** invent token/cost numbers. The only valid numbers are the ones in
  `results/<batch>/report.md`, `summary.csv`, and `runs.jsonl`.

### Exact procedure (follow in order)

```bash
# 0. PREFLIGHT — confirm the environment, abort and report if any fails:
which claude && claude --version          # Claude Code CLI present + logged in
which codex  && codex --version           # Codex CLI present + logged in
echo "${OPENROUTER_API_KEY:?set this}"    # OpenRouter key in env
test -f benchmarks/config.yaml            # config exists (copy from .example if not)
test -f benchmarks/tasks.yaml             # tasks exist (copy from .example if not)

# 1. VALIDATE EACH TASK'S ORACLE — for every task, the verify_cmd MUST FAIL at
#    base_commit (otherwise a "pass" is meaningless). For each task repo:
#      git -C <repo> stash; git -C <repo> checkout <base_commit>
#      <verify_cmd>   # must exit NON-zero here
#    If it already passes, the task is broken — report it, do not include it.

# 2. RUN THE MATRIX with a FIXED batch name so later steps target the same dir:
python -m benchmarks.runner --config benchmarks/config.yaml \
    --tasks benchmarks/tasks.yaml --batch run01

# 3. (ONLY if config has openrouter_cost_capture: false) reconcile PRMPT cost:
python -m benchmarks.reconcile --results benchmarks/results/run01

# 4. BUILD THE REPORT:
python -m benchmarks.report --results benchmarks/results/run01
```

### After the run, report to the user (do not editorialise the numbers)

1. Open `benchmarks/results/run01/report.md` and relay the **Verdict** section
   verbatim (Wins / Regressions / Inconclusive).
2. Flag any row with `suspect_empty_runs > 0` — those runs failed to launch
   (likely the Claude silent-exit bug) and must be re-run, not trusted.
3. Flag any row with `reconciled = false` — PRMPT cost is an estimate, not billed.
4. If any task failed preflight step 1, say so explicitly; its results are void.

That is the whole job. Everything else below is reference detail.

## The matrix

For each task it runs these cells (× `repeats`):


| Agent          | Variant         | Meaning                                                                 |
| -------------- | --------------- | ----------------------------------------------------------------------- |
| claude / codex | `raw`           | raw prompt → agent. The baseline.                                       |
| claude / codex | `mcp_optimizer` | index repo → PRMPT optimizer → optimized prompt + MCP (agentic loop on) |
| claude / codex | `mcp_only`      | raw prompt → agent, PRMPT MCP available, no optimizer                   |


The two MCP variants each run in `soft` (native search allowed — organic) and
`hard` (native Grep/Glob/find denied — forces MCP) hardening, so you see both
"does the model choose PRMPT" and "can PRMPT replace native search".

## The three measurement planes

1. **Agent spend** — Claude `total_cost_usd` from `--output-format json`; Codex
  tokens from the rollout file (`~/.codex/sessions/.../rollout-*.jsonl`, because
   `--json` omits reasoning tokens) priced at the rates you configure.
2. **PRMPT spend** — every OpenRouter call PRMPT makes for indexing, optimizing,
   and the agentic loop. Measured with **zero changes to the PRMPT services**:
   the agent bills through Anthropic/OpenAI, PRMPT bills through OpenRouter, so
   PRMPT's cost for a run == the increase in the OpenRouter key's cumulative
   usage across the run window (`openrouter.py`). This is OpenRouter's own
   billed figure. Requires sequential runs (the default).
   *(Legacy fallback: if `openrouter_cost_capture: false`, the harness uses the
   generation-id hooks + `reconcile.py` instead — needs service-side ids.)*
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
# 1. run the matrix (pick a batch name so later steps target the same folder)
python -m benchmarks.runner --config benchmarks/config.yaml \
    --tasks benchmarks/tasks.yaml --batch run01

# 2. ONLY if openrouter_cost_capture is false — reconcile estimated PRMPT cost
#    to billed. With the default (delta capture on) this step is NOT needed.
python -m benchmarks.reconcile --results benchmarks/results/run01

# 3. build the report
python -m benchmarks.report --results benchmarks/results/run01
```

You get `results/run01/report.md` (verdict + tables), `summary.csv`, and
`runs.jsonl` (one record per line, for feeding to an LLM).

Single-task dry run first (recommended before the full matrix — runs only that
task's cells):

```bash
python -m benchmarks.runner --only-task <task_id> --batch smoke01
```

## Two test modes, one report

| | **Controlled** (`runner.py`) | **Passive** (`passive.py`) |
|---|---|---|
| Who drives the agent | the script (headless) | a real human |
| Task | predefined prompt | whatever the user does |
| "Did it work?" | `verify_cmd` exit code | self-reported y/n, or unscored |
| Cost capture | OpenRouter usage-delta + agent JSON | OpenRouter usage-delta + agent log |
| Output | `RunRecord` JSON | the **same** `RunRecord` JSON |

Both feed the same `report.py`. Unscored passive runs still record exact cost;
the report shows their saving but marks them **inconclusive** (cost-only) so an
unverified run can never be claimed as a correctness win.

### Passive mode (the 6 real users)

```bash
# user begins a task
python -m benchmarks.passive start --config benchmarks/config.yaml \
    --repo /path/to/their/repo --agent claude \
    --variant mcp_optimizer --task "fix the import bug"
# ... user works in Claude Code / Codex normally ...
# user finishes
python -m benchmarks.passive stop --config benchmarks/config.yaml \
    --results benchmarks/results/pilot --success yes --turns 7
# (use --success unknown to leave it unscored)
```

`start` snapshots OpenRouter usage + git HEAD + time; `stop` parses the agent's
session log for tokens, computes the OpenRouter delta, runs `git diff`, and
writes a `RunRecord`. The user's own file (prompt / success / turns) merges via
the `--success` / `--turns` flags.

## Feeding the data to an LLM instead of report.py

`report.py` also writes `results/<batch>/runs.jsonl` — one complete `RunRecord`
per line. Hand that whole file to any LLM with the field definitions from
`metrics.py` and it can write the report itself. No dependency on report.py.

## No service-side change required

PRMPT's cost is read from the OpenRouter account usage (delta across the run),
so you do **not** need to edit the PRMPT services. Just make `OPENROUTER_API_KEY`
available in the env and run sequentially. The old generation-id path is kept
only as a fallback (`openrouter_cost_capture: false`).

## Honesty guardrails baked in

- No agent drives the harness → no harness spend to exclude.
- A `$0` + no-tokens + no-output Claude run is flagged `SUSPECT_EMPTY_RUN` (the
known `--disallowedTools` + `--mcp-config` silent-exit bug) instead of being
scored as a free success. Hardening uses `settings.json` deny rules to avoid it.
- `net_cost` always includes PRMPT's own spend.
- A token saving that lowers pass-rate is reported as a **regression**, not a win.
- `repeats ≥ 3`, median + min/max spread, pinned models, `web_search` off.

