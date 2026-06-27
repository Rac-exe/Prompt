# PRMPT CLI 3-Arm Benchmark Rerun

Generated: 2026-06-27T21:04:05.411155+00:00
Batch: `20260628-010421`
Results: `prmpt-cli/harness/results/repeats3-20260628-010310/results-20260628-010421.jsonl`
Usage log: `prmpt-cli/harness/results/repeats3-20260628-010310/llm_usage.jsonl`

## TL;DR

This hardened `--repeats 3` rerun shows a real PRMPT token-saving signal with only a small pass-rate drop. Arm C is the best PRMPT configuration: 67.7% fewer total tokens than Claude Code while passing 25/27 versus Claude Code at 26/27.

## Arms

| Arm | Setup | Pass rate | Passes | Total tokens | Total cost | Avg time | Avg retrievals |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | Claude Code + raw | 96.3% | 26/27 | 8,196,009 | $7.9444 | 90.3s | 0.0 |
| B | PRMPT CLI + raw | 88.9% | 24/27 | 3,834,229 | $5.0949 | 48.0s | 1.63 |
| C | PRMPT CLI + optimized | 92.6% | 25/27 | 2,647,232 | $3.7275 | 56.0s | 0.07 |

## Savings

- **B vs A:** 53.2% fewer tokens, 35.9% lower cost, pass-rate delta -7.4 pts.
- **C vs A:** 67.7% fewer tokens, 53.1% lower cost, pass-rate delta -3.7 pts.
- **C vs B:** 31.0% fewer tokens, 26.8% lower cost, pass-rate delta +3.7 pts.

## Hardening

- The runner rejects already-green copied repos before model calls, so passing tests cannot count unless the agent started from a failing repo.
- Each cell stores pre-agent and post-agent test output, changed-file evidence, prompts, PRMPT usage JSON, retrieval logs, and a batch manifest.
- This run used `--repeats 3`, so it ran 81 cells instead of a single 27-cell sample.
- PRMPT-side usage logging was enabled and folded into B/C totals. In this run, captured PRMPT-side spend was index-time only; the fast retrieval variant did not make per-retrieval LLM calls.
- PRMPT CLI used `PRMPT_MAX_TOKENS=4096` so OpenRouter requests did not fail from the model defaulting to an unaffordable 65k+ output cap.

## Interpretation

Arm C is the strongest result: it preserves near-Claude reliability while using materially fewer tokens and less cost. Arm B also saves tokens but has a larger pass-rate drop. This is good prototype-level viability evidence, not a universal victory claim: the oracle is still binary `npm test`, the tasks are JS-only, and C averaged very few live retrieval calls, so the win should be described as optimized prompt + PRMPT CLI rather than live retrieval alone.

## Audit Artifacts

- Manifest: `prmpt-cli/harness/results/repeats3-20260628-010310/manifest-20260628-010421.json`
- Summary: `prmpt-cli/harness/summary.json`
- PRMPT usage captured: `True`; usage rows: `8`; index tokens: `20,440`; unattributed tokens: `0`
