# Adjusted PRMPT CLI 3-Arm Benchmark Report

Adjusted run: Arm A was rerun with `--permission-mode bypassPermissions`; Arms B/C are from the original final PRMPT run.

## Headline Results

| Arm | Pass Rate | Passed | Total Tokens | Avg Tokens | Total Cost | Avg Cost | Avg Time | Avg Retrieval Calls |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A - Claude Code + raw | 100.0% | 9/9 | 2,631,050 | 292,338 | $2.6315 | $0.2924 | 96.2s | 0.00 |
| B - PRMPT CLI + raw | 88.9% | 8/9 | 1,199,764 | 133,307 | $1.6644 | $0.1849 | 47.2s | 1.67 |
| C - PRMPT CLI + optimized | 88.9% | 8/9 | 841,418 | 93,490 | $1.1869 | $0.1319 | 57.0s | 0.00 |

## Updated Takeaways

- Corrected Arm A passed all tasks: 9/9 after bypass permissions.
- Arm B passed 8/9 and used 1,431,286 fewer tokens than Arm A (54.4% savings).
- Arm C passed 8/9 and used 1,789,632 fewer tokens than Arm A (68.0% savings), plus 358,346 fewer than Arm B (29.9% additional savings).
- Arm B was fastest on average (47.2s); Arm C was cheapest ($1.1869) and lowest-token (841,418).

## PRMPT-Side Accounting

| Arm | Agent Tokens | PRMPT Retrieval Tokens | Amortized Index Tokens | Combined Tokens | Agent Cost | PRMPT Side Cost | Combined Cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 2,631,050 | 0 | 0 | 2,631,050 | $2.6315 | $0.0000 | $2.6315 |
| B | 1,186,355 | 0 | 13,409 | 1,199,764 | $1.6575 | $0.0069 | $1.6644 |
| C | 828,009 | 0 | 13,409 | 841,418 | $1.1800 | $0.0069 | $1.1869 |

## Per-Task Results

| Task | A Pass | A Tokens | A Time | B Pass | B Tokens | B Ret. | B Time | C Pass | C Tokens | C Ret. | C Time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| atlas-p1 | PASS | 200,677 | 65.7s | PASS | 84,270 | 2 | 41.8s | PASS | 61,007 | 0 | 47.2s |
| atlas-p2 | PASS | 181,527 | 80.3s | PASS | 184,602 | 2 | 48.2s | PASS | 74,406 | 0 | 47.8s |
| atlas-p3 | PASS | 199,615 | 95.3s | PASS | 175,268 | 1 | 45.3s | PASS | 93,229 | 0 | 66.9s |
| nova-p1 | PASS | 383,285 | 70.7s | PASS | 124,117 | 2 | 47.4s | FAIL | 88,741 | 0 | 55.5s |
| nova-p2 | PASS | 228,582 | 55.9s | PASS | 56,131 | 1 | 33.6s | PASS | 87,471 | 0 | 49.0s |
| nova-p3 | PASS | 248,555 | 56.6s | PASS | 233,345 | 1 | 49.2s | PASS | 96,887 | 0 | 52.4s |
| orbit-p1 | PASS | 367,814 | 162.3s | PASS | 144,229 | 2 | 61.0s | PASS | 130,215 | 0 | 66.3s |
| orbit-p2 | PASS | 446,533 | 150.5s | FAIL | 72,015 | 3 | 45.6s | PASS | 105,459 | 0 | 69.0s |
| orbit-p3 | PASS | 374,462 | 128.2s | PASS | 112,378 | 1 | 52.5s | PASS | 90,594 | 0 | 59.0s |

## Artifacts

- Adjusted combined results: `harness/results/final-adjusted-report/results-adjusted-claude-a-bypass.jsonl`
- Corrected Claude A rerun: `harness/results/final-claude-a-rerun/results-20260627-013658.jsonl`
- Original PRMPT B/C source: `harness/results/final-full-run/results-20260627-005309.jsonl`
- Aggregate summary: `harness/summary.json`
- PRMPT usage log: `harness/results/final-llm-usage.jsonl`
