# PRMPT Current Context

This document captures where PRMPT currently stands from a product, technical, and benchmark perspective. It is intentionally focused on PRMPT itself, not fundraising.

## Current State In One Line

PRMPT has moved from being only an MCP/plugin-style retrieval layer on top of existing agents into an early standalone CLI coding-agent prototype, built on the Pi coding-agent SDK, with PRMPT's retrieval/indexing pipeline integrated into the agent loop and benchmarked against Claude Code, Cursor CLI, and Codex-style baselines.

## Current Branch / Working Area

- Active branch: `feat/prmpt-cli`
- Main working package: `prmpt-cli/`
- Important current files:
  - `prmpt-cli/src/index.ts`
  - `prmpt-cli/src/prmpt-extension.ts`
  - `prmpt-cli/harness/run_3arm.py`
  - `prmpt-cli/harness/bootstrap_index.py`
  - `prmpt-cli/harness/aggregate.py`
  - `prmpt-cli/README.md`
  - `prmpt-cli/harness/results/repeats3-20260628-010310/`
  - `prmpt-cli/report/latest.md`
  - `prmpt-cli/report/repeats3-20260628-010421.md`

There is also an older untracked report locally:

- `prmpt-cli/report/prmpt-cli-adjusted-benchmark-report.md`

That older file is from the prior adjusted report. The cleaner rerun artifacts are the `repeats3-*` files.

## What PRMPT Used To Be

Originally, PRMPT was mainly a retrieval system layered onto other agents through MCP. The purpose was:

- Given a vague coding task, retrieve the most relevant files and line ranges.
- Reduce wasted context by avoiding broad repo scanning.
- Improve token efficiency when paired with agents like Claude Code.

The earlier testing setup was roughly:

- Claude Code raw
- Claude Code + PRMPT MCP
- Claude Code + PRMPT MCP + optimized prompt

That MCP-based setup did not clearly beat Claude Code. Claude remained very strong, and PRMPT did not show enough reliability advantage there. The MCP layer also created overhead and did not fully control the agent's behavior.

## What PRMPT Is Now

PRMPT is now being tested as its own CLI coding agent.

The new idea is:

> PRMPT should not just be a plugin attached to Claude Code. PRMPT should be the harness/agent itself, with file retrieval and token control built into the core execution loop.

The current CLI prototype:

- Uses `@earendil-works/pi-coding-agent`.
- Runs as a headless CLI.
- Uses Claude Sonnet 4.6 through OpenRouter for PRMPT arms.
- Adds a custom tool called `prmpt_retrieve`.
- Calls the existing code-intelligence service on `:8002`.
- Injects a PRMPT policy/preamble that tells the agent to retrieve focused context rather than blindly scan the repo.
- Emits usage JSON per run so benchmark scripts can measure tokens, cost, retrieval calls, timing, and context usage.

Example intended usage:

```bash
node prmpt-cli/dist/index.js --cwd <repo> --prompt "fix the bug and run tests"
```

The current prototype is not a polished product CLI yet. It is a working test harness for validating the core thesis.

## Core Technical Architecture

The current PRMPT CLI path looks like this:

1. `run_3arm.py` copies a target repo into an isolated temporary work directory.
2. The runner first runs the verification command, usually `npm test`, before any agent touches the repo.
3. If the repo already passes before the agent runs, the run is marked invalid and skipped.
4. For PRMPT arms, the runner starts the PRMPT CLI with:
   - `PRMPT_CODE_INTEL_URL`
   - `PRMPT_CODE_INTEL_ROOT`
   - `PRMPT_PROJECT_ID`
   - `PRMPT_RETRIEVE_LOG`
   - `PRMPT_USAGE_OUT`
   - `PRMPT_MODEL`
   - `PRMPT_PROVIDER`
5. The PRMPT CLI creates a Pi SDK agent session.
6. The custom `prmpt_retrieve` tool calls the code-intelligence `/api/context` endpoint.
7. The agent edits files using normal coding tools.
8. The runner runs the verification command again after the agent finishes.
9. The runner records:
   - pass/fail
   - tokens
   - cost
   - elapsed time
   - retrieval calls
   - changed files
   - pre-test output
   - post-test output
   - prompt used
   - usage JSON
   - retrieval logs

## Code-Intel Layer

The code-intelligence service remains central to PRMPT.

Current role:

- Index the benchmark repos once.
- Store code chunks in a local SQLite-backed code-intel root.
- Serve retrieval requests from the PRMPT CLI through `/api/context`.
- Return ranked probable file locations and code bodies.

Important recent change:

- A fast variant called `prmpt_cli_fast` was added.

`prmpt_cli_fast` disables:

- decomposition
- reranking
- refinement
- graph expansion

Reason:

- For the CLI benchmark, the full internal pipeline can add unnecessary latency and token cost.
- The fast variant lets the agent retrieve quickly and cheaply.

Current observed effect:

- PRMPT-side retrieval LLM cost was basically zero in the clean rerun.
- Captured PRMPT-side usage was index-time only.
- This means the CLI benchmark is not hiding a large extra internal PRMPT cost.

## Auth / Model Fixes

Several fixes were needed before the CLI actually worked properly:

1. The PRMPT CLI now explicitly reads runtime API keys from environment variables:
   - `OPENROUTER_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `OPENAI_API_KEY`
   - `GOOGLE_API_KEY`

2. OpenRouter provider registration was fixed.

3. `PRMPT_MAX_TOKENS=4096` support was added.

This matters because OpenRouter/Pi could otherwise default to an extremely large output cap and fail or behave unpredictably. The current benchmark used:

```text
PRMPT_MAX_TOKENS=4096
```

## Benchmark Harness

The current benchmark runner is:

```text
prmpt-cli/harness/run_3arm.py
```

The benchmark arms are:

- Arm A: Claude Code + raw prompt
- Arm B: PRMPT CLI + raw prompt
- Arm C: PRMPT CLI + optimized prompt

The benchmark task set currently contains:

- 3 generated JS repos
- 3 vague bug-fix prompts per repo
- 9 tasks total

With `--repeats 3`, this becomes:

```text
9 tasks x 3 arms x 3 repeats = 81 cells
```

Verification oracle:

```bash
npm test
```

This is a binary test oracle. It proves tests pass or fail, but it does not prove the patch is beautiful or production-ready.

## Benchmark Hardening Added

The benchmark was hardened after initial skepticism about whether results could be trusted.

The runner now:

- Runs `npm test` before the agent touches the copied repo.
- Rejects already-green repos.
- Records `pre_passed`.
- Stores pre-agent verification output.
- Stores post-agent verification output.
- Stores changed-file manifests.
- Stores prompt files.
- Stores PRMPT usage JSON.
- Stores retrieval logs.
- Stores a batch manifest with:
  - branch
  - commit
  - git status
  - node version
  - npm version
  - Python version
  - Claude Code version
  - model args
  - code-intel root
  - project IDs

This was added specifically to make the benchmark auditable.

## Latest Clean Rerun

The latest meaningful rerun is:

```text
prmpt-cli/harness/results/repeats3-20260628-010310/
```

Report:

```text
prmpt-cli/report/latest.md
prmpt-cli/report/repeats3-20260628-010421.md
```

Summary:

```text
prmpt-cli/harness/summary.json
```

Commit containing artifacts:

```text
78c6cc7 Add clean PRMPT CLI benchmark rerun artifacts
```

## Latest Clean Rerun Results

The latest 3-repeat benchmark produced:

```text
Claude Code raw:       26/27 passes, 8.196M tokens, $7.9444, 90.3s avg
PRMPT CLI raw:         24/27 passes, 3.834M tokens, $5.0949, 48.0s avg
PRMPT CLI optimized:   25/27 passes, 2.647M tokens, $3.7275, 56.0s avg
```

Savings:

```text
PRMPT raw vs Claude:
- 53.2% fewer tokens
- 35.9% lower cost
- 7.4 percentage-point lower pass rate

PRMPT optimized vs Claude:
- 67.7% fewer tokens
- 53.1% lower cost
- 3.7 percentage-point lower pass rate

PRMPT optimized vs PRMPT raw:
- 31.0% fewer tokens
- 26.8% lower cost
- 3.7 percentage-point better pass rate
```

## Clean-Check Result

The hardened rerun showed:

```text
Total rows: 81
Invalid already-green tasks: 0
Pre-agent passing tasks: 0
Agent errors: 0
Skipped runs: 0
Runs with zero changed files: 0
```

This means:

- Every run started from a failing repo.
- Every run actually changed files.
- No run was counted because the repo was already green.
- No run was a silent agent crash.

## Failure Pattern

Failures in the 3-repeat run:

```text
orbit-p2 B rep 0
orbit-p2 B rep 1
orbit-p2 B rep 2

nova-p1 C rep 0
nova-p1 C rep 2

nova-p1 A rep 2
```

Per-task pass breakdown:

```text
atlas-p1  A 3/3   B 3/3   C 3/3
atlas-p2  A 3/3   B 3/3   C 3/3
atlas-p3  A 3/3   B 3/3   C 3/3
nova-p1   A 2/3   B 3/3   C 1/3
nova-p2   A 3/3   B 3/3   C 3/3
nova-p3   A 3/3   B 3/3   C 3/3
orbit-p1  A 3/3   B 3/3   C 3/3
orbit-p2  A 3/3   B 0/3   C 3/3
orbit-p3  A 3/3   B 3/3   C 3/3
```

Interpretation:

- PRMPT raw consistently failed `orbit-p2`.
- PRMPT optimized struggled with `nova-p1`.
- Claude Code also failed `nova-p1` once.
- The failures appear to be agent execution variance and prompt/retrieval policy weakness, not evidence that the harness itself is broken.

## Additional Rerun Of Failed Tasks

After the clean 3-repeat run, failed tasks were rerun manually / separately.

Observed outcome:

- PRMPT reached the same task-success level as Claude on rerun.
- This supports the view that the failures are partly nondeterministic agent behavior rather than a hard capability gap.

Important caveat:

- Single-shot pass rate and retry-assisted pass rate must be reported separately.
- Do not claim `27/27` single-shot if it required rerunning failed cells.

Best framing:

> PRMPT is in the same reliability band as top coding agents, while using materially fewer tokens.

## Cursor / Codex Comparison

Separate testing against Cursor CLI and Codex CLI reportedly showed:

- They could reach `27/27`.
- Their token usage was much higher, reportedly above `10M` tokens.

If verified with artifacts, this strengthens PRMPT's positioning:

> PRMPT's advantage is not that it is the only system that can solve the tasks. Its advantage is that it can approach the same success band while using dramatically fewer tokens.

This needs to be artifact-backed before being used as a hard public claim.

## What The Result Proves

The result supports this claim:

> PRMPT has a real token-efficiency signal on coding-agent tasks.

More specifically:

> A PRMPT-style controlled agent loop can solve most benchmark tasks while using far fewer tokens than Claude Code.

The result does not yet prove:

- PRMPT is universally better than Claude Code.
- PRMPT is ready for normal developer adoption.
- PRMPT generalizes to all languages and real-world repos.
- PRMPT can replace Cursor/Claude/Codex today.

## Honest Current Interpretation

The strongest honest headline is:

> In a hardened 3-repeat benchmark across 9 JS coding tasks, PRMPT optimized reduced total token usage by 67.7% and cost by 53.1% versus Claude Code, while passing 25/27 runs compared with Claude Code's 26/27.

If including reruns:

> On retrying failed tasks, PRMPT reached Claude-level task success, suggesting the remaining gap is largely agent nondeterminism rather than a fixed harness limitation.

Avoid saying:

> PRMPT beats Claude Code.

Better:

> PRMPT shows Claude-level viability with substantially lower token usage, but still needs a proper v2 agent loop and broader validation.

## Important Red Flags / Caveats

1. The benchmark is still JS-only.

2. The oracle is `npm test`, so it measures functional pass/fail, not code quality.

3. The latest manifest showed:

```text
benchmark_status: M prmpt-cli/harness/run_3arm.py
```

This means the run was launched from a dirty working tree. The likely dirty change was related to `PRMPT_MAX_TOKENS=4096`, and that support is now committed, but for a courtroom-grade benchmark the next run should start from a clean git status.

4. The artifact commit mixed code fixes and benchmark results.

This is not fatal, but cleaner process would be:

- commit code changes first
- verify clean tree
- run benchmark
- commit only artifacts

5. Arm C barely used retrieval.

Current latest rerun:

```text
PRMPT raw retrieval calls: 44 total across 27 runs
PRMPT optimized retrieval calls: 2 total across 27 runs
```

This means:

- Arm B tests retrieval more directly.
- Arm C mostly tests optimized prompts + PRMPT CLI wrapper.
- The best result should not be described as "live retrieval alone beat Claude."

## Current Product Viability Assessment

Technical viability:

```text
8.5 / 10
```

Reason:

- The current prototype is rough but already shows large token savings.
- Pass rate is close to Claude Code on the benchmark.
- Reruns suggest failures are partly nondeterministic.
- The system has obvious improvement paths.

Product viability today:

```text
4 / 10
```

Reason:

- It is not yet a polished CLI.
- Setup is still too complex.
- Requires code-intel service.
- Retrieval/indexing is JS-only for the benchmark path.
- Normal developers would not yet choose this over Claude Code/Cursor.

Product viability after focused v2:

```text
7 to 7.5 / 10
```

Reason:

- If PRMPT keeps even half the token savings while matching reliability, it becomes genuinely useful.
- The wedge is cost-controlled coding agents, not generic coding assistance.

## Biggest Technical Opportunity

Make PRMPT's execution loop smarter.

Right now:

- Arm B uses retrieval but has weaker pass rate.
- Arm C has strong token savings but barely uses retrieval.

The obvious v2 is:

> Optimized prompt + mandatory initial retrieval + test-failure re-query + patch verification loop.

Desired loop:

1. Start with optimized prompt.
2. Always perform at least one retrieval for the task.
3. Edit only likely relevant files first.
4. Run tests.
5. If tests fail, feed the failing output back into retrieval.
6. Retrieve again using concrete failure/test names.
7. Inspect changed files.
8. Patch narrowly.
9. Rerun tests.
10. Stop when green or when token/time budget is hit.

This turns nondeterminism into a product feature:

> PRMPT uses budget-aware retries to reach high reliability while staying below competitors' token usage.

## Most Important Next Build Items

1. Proper retry loop

The CLI should not stop after one failed attempt. It should automatically recover:

- read failing test output
- re-query retrieval
- patch
- rerun tests
- stop on green

2. Mandatory retrieval policy

Especially for optimized prompts, PRMPT should still perform a cheap initial retrieval. Otherwise Arm C becomes mostly a prompt optimization test, not a retrieval-agent test.

3. Better run accounting

Track:

- first attempt tokens
- retry tokens
- total tokens
- number of test runs
- number of retrieval calls
- files touched
- files retrieved
- pass after attempt 1 vs pass after retry

4. Broader language support

The current benchmark indexing path is JS-focused. To become a real CLI, PRMPT needs:

- TypeScript
- Python
- maybe Go/Rust later
- better parser/chunker, likely tree-sitter-based

5. Cleaner install / run experience

Current setup is not user-friendly. A real CLI needs:

- one command install
- automatic service start or embedded retrieval
- clear auth setup
- simple project indexing
- simple `prmpt "task"` UX

6. Stronger benchmark suite

Current benchmark is promising but narrow. Need:

- more repos
- more languages
- repeated runs
- competitor baselines with artifacts
- single-shot and retry-assisted metrics separated

## Recommended Positioning Right Now

PRMPT should be described as:

> A cost-controlled coding-agent CLI that uses retrieval and prompt optimization to reduce wasted context while preserving task success.

Not:

> A Claude Code killer.

Better current claim:

> Early benchmarks show PRMPT can reach the same reliability band as leading coding agents with substantially lower token usage.

## Current Confidence Scores

Core insight is real:

```text
85%
```

Reason:

- Multiple runs show large token reduction.
- Competitors appear to use far more tokens on the same task class.

Current CLI is ready for users:

```text
25%
```

Reason:

- It works as a prototype, not a product.

PRMPT can become a usable CLI:

```text
70%
```

Reason:

- The prototype already works.
- The main missing pieces are engineering/productization, not a missing fundamental idea.

PRMPT can compete on cost efficiency:

```text
85%
```

Reason:

- The benchmark signal is large enough that even with overhead from better retries, PRMPT likely keeps a meaningful savings margin.

PRMPT can beat Claude/Cursor/Codex on raw reliability soon:

```text
45%
```

Reason:

- These products are mature and very strong.
- PRMPT should first aim to match reliability with lower cost, not beat them on every task.

PRMPT can be attractive to users who care about AI coding cost:

```text
70%
```

Reason:

- If setup is made simple and results stay consistent, the value proposition is clear.

## Next Clean Benchmark Recommendation

If running another formal benchmark:

1. Pull latest branch.
2. Ensure clean tree:

```bash
git status -sb
```

Should show no modified files.

3. Build PRMPT CLI:

```bash
cd prmpt-cli
npm install
npm run build
```

4. Start code-intel with usage logging.

5. Bootstrap indexes.

6. Run:

```bash
python prmpt-cli/harness/run_3arm.py --repeats 3
```

7. Commit artifacts separately:

```bash
git add prmpt-cli/harness/results prmpt-cli/harness/summary.json prmpt-cli/report
git commit -m "Add clean PRMPT CLI benchmark rerun artifacts"
```

8. Report both:

- single-shot pass rate
- retry-assisted pass rate

Do not mix those numbers.

## Bottom Line

PRMPT is no longer just an MCP retrieval experiment. It is now an early standalone coding-agent CLI prototype with a real benchmark signal.

The current result does not prove PRMPT is better than Claude Code overall. It does show that PRMPT can operate in the same success band while using dramatically fewer tokens on the tested workload.

The next phase should focus on turning this into a real agent loop:

- mandatory retrieval
- test-aware retry
- budget-aware patching
- better language support
- cleaner CLI UX

If v2 keeps reliability near Claude/Cursor/Codex while preserving a large token advantage, PRMPT becomes a genuinely viable developer tool.
