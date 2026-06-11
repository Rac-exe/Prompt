# PRMPT Benchmark Report

Net cost = agent spend + PRMPT OpenRouter spend (reconciled to billed). A variant only counts as a win if it lowers net cost AND holds first-try pass-rate vs its RAW baseline.

## Verdict (auto-derived)

### Wins (net cost down AND correctness held)
- atlas-p2/codex/mcp_only/hard — net -22.27%, pass 1.0 ≥ base 1.0
- atlas-p2/codex/mcp_only/soft — net -14.41%, pass 1.0 ≥ base 1.0
- atlas-p2/codex/mcp_optimizer/hard — net -22.47%, pass 1.0 ≥ base 1.0
- atlas-p2/codex/mcp_optimizer/soft — net -20.95%, pass 1.0 ≥ base 1.0
- atlas-p3/claude/mcp_only/hard — net -11.17%, pass 1.0 ≥ base 1.0
- atlas-p3/claude/mcp_only/soft — net -7.12%, pass 1.0 ≥ base 1.0
- atlas-p3/claude/mcp_optimizer/hard — net -1.6%, pass 1.0 ≥ base 1.0
- atlas-p3/codex/mcp_only/hard — net -52.0%, pass 1.0 ≥ base 1.0
- atlas-p3/codex/mcp_only/soft — net -46.41%, pass 1.0 ≥ base 1.0
- atlas-p3/codex/mcp_optimizer/hard — net -30.19%, pass 1.0 ≥ base 1.0
- atlas-p3/codex/mcp_optimizer/soft — net -31.04%, pass 1.0 ≥ base 1.0
- nova-p2/codex/mcp_only/hard — net -33.22%, pass 1.0 ≥ base 1.0
- nova-p2/codex/mcp_only/soft — net -34.8%, pass 1.0 ≥ base 1.0
- nova-p2/codex/mcp_optimizer/hard — net -23.96%, pass 1.0 ≥ base 1.0
- nova-p2/codex/mcp_optimizer/soft — net -41.68%, pass 1.0 ≥ base 1.0
- nova-p3/codex/mcp_only/hard — net -19.79%, pass 1.0 ≥ base 1.0
- nova-p3/codex/mcp_only/soft — net -10.59%, pass 1.0 ≥ base 1.0
- nova-p3/codex/mcp_optimizer/hard — net -17.51%, pass 1.0 ≥ base 1.0
- nova-p3/codex/mcp_optimizer/soft — net -8.08%, pass 1.0 ≥ base 1.0
- orbit-p2/claude/mcp_optimizer/hard — net -0.25%, pass 1.0 ≥ base 1.0
- orbit-p3/codex/mcp_only/hard — net -26.81%, pass 1.0 ≥ base 1.0
- orbit-p3/codex/mcp_only/soft — net -15.75%, pass 1.0 ≥ base 1.0
- orbit-p3/codex/mcp_optimizer/hard — net -39.79%, pass 1.0 ≥ base 1.0
- orbit-p3/codex/mcp_optimizer/soft — net -29.62%, pass 1.0 ≥ base 1.0

### Regressions / non-wins
- atlas-p2/claude/mcp_only/hard — net -19.47% (no saving), pass 1.0
- atlas-p2/claude/mcp_only/soft — net -50.85% (no saving), pass 1.0
- atlas-p2/claude/mcp_optimizer/hard — net -54.68% (no saving), pass 1.0
- atlas-p2/claude/mcp_optimizer/soft — net -52.11% (no saving), pass 1.0
- atlas-p3/claude/mcp_optimizer/soft — net -0.55% (no saving), pass 1.0
- nova-p2/claude/mcp_only/hard — net -14.68% (no saving), pass 1.0
- nova-p2/claude/mcp_only/soft — net -24.88% (no saving), pass 1.0
- nova-p2/claude/mcp_optimizer/hard — net -32.37% (no saving), pass 1.0
- nova-p2/claude/mcp_optimizer/soft — net -39.07% (no saving), pass 1.0
- nova-p3/claude/mcp_only/hard — net -2.8% (no saving), pass 1.0
- nova-p3/claude/mcp_only/soft — net -4.06% (no saving), pass 1.0
- nova-p3/claude/mcp_optimizer/hard — net -12.3% (no saving), pass 1.0
- nova-p3/claude/mcp_optimizer/soft — net -19.24% (no saving), pass 1.0
- orbit-p2/claude/mcp_only/hard — net -49.23% (no saving), pass 1.0
- orbit-p2/claude/mcp_only/soft — net -32.11% (no saving), pass 1.0
- orbit-p2/claude/mcp_optimizer/soft — net -16.63% (no saving), pass 1.0
- orbit-p2/codex/mcp_only/hard — net -25.68% (no saving), pass 1.0
- orbit-p2/codex/mcp_only/soft — net -39.79% (no saving), pass 1.0
- orbit-p2/codex/mcp_optimizer/hard — net -25.16% (no saving), pass 1.0
- orbit-p2/codex/mcp_optimizer/soft — net -17.33% (no saving), pass 1.0
- orbit-p3/claude/mcp_only/hard — net -42.08% (no saving), pass 1.0
- orbit-p3/claude/mcp_only/soft — net -46.82% (no saving), pass 1.0
- orbit-p3/claude/mcp_optimizer/hard — net -26.06% (no saving), pass 1.0
- orbit-p3/claude/mcp_optimizer/soft — net -76.55% (no saving), pass 1.0

## Full results

| task | agent | variant | hardening | n | pass_rate | net_cost_median | net_cost_spread | agent_cost_median | prmpt_cost_median | agent_tokens_median | vs_baseline_saving_pct | native_search_median | mcp_calls_median | suspect_empty_runs | reconciled |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| atlas-p2 | claude | mcp_only | hard | 1 | 1.0 | 0.262962 | 0.262962–0.262962 | 0.214028 | 0.048934 | 205993.0 | -19.47 | 0.0 | 1.0 | 0 | True |
| atlas-p2 | claude | mcp_only | soft | 1 | 1.0 | 0.332046 | 0.332046–0.332046 | 0.283112 | 0.048934 | 343526.0 | -50.85 | 0.0 | 1.0 | 0 | True |
| atlas-p2 | claude | mcp_optimizer | hard | 1 | 1.0 | 0.340484 | 0.340484–0.340484 | 0.29155 | 0.048934 | 348230.0 | -54.68 | 0.0 | 1.0 | 0 | True |
| atlas-p2 | claude | mcp_optimizer | soft | 1 | 1.0 | 0.334823 | 0.334823–0.334823 | 0.285889 | 0.048934 | 346527.0 | -52.11 | 0.0 | 1.0 | 0 | True |
| atlas-p2 | claude | raw | none | 1 | 1.0 | 0.220116 | 0.220116–0.220116 | 0.220116 | 0.0 | 212524.0 | None | 0.0 | 0.0 | 0 | True |
| atlas-p2 | codex | mcp_only | hard | 1 | 1.0 | 0.263752 | 0.263752–0.263752 | 0.214818 | 0.048934 | 151785.0 | 22.27 | 0.0 | 1.0 | 0 | True |
| atlas-p2 | codex | mcp_only | soft | 1 | 1.0 | 0.290411 | 0.290411–0.290411 | 0.241477 | 0.048934 | 173995.0 | 14.41 | 0.0 | 1.0 | 0 | True |
| atlas-p2 | codex | mcp_optimizer | hard | 1 | 1.0 | 0.263067 | 0.263067–0.263067 | 0.214133 | 0.048934 | 154086.0 | 22.47 | 0.0 | 1.0 | 0 | True |
| atlas-p2 | codex | mcp_optimizer | soft | 1 | 1.0 | 0.268229 | 0.268229–0.268229 | 0.219295 | 0.048934 | 156375.0 | 20.95 | 0.0 | 1.0 | 0 | True |
| atlas-p2 | codex | raw | none | 1 | 1.0 | 0.339297 | 0.339297–0.339297 | 0.339297 | 0.0 | 237530.0 | None | 0.0 | 0.0 | 0 | True |
| atlas-p3 | claude | mcp_only | hard | 1 | 1.0 | 0.292301 | 0.292301–0.292301 | 0.243367 | 0.048934 | 303480.0 | 11.17 | 0.0 | 1.0 | 0 | True |
| atlas-p3 | claude | mcp_only | soft | 1 | 1.0 | 0.305653 | 0.305653–0.305653 | 0.256719 | 0.048934 | 306404.0 | 7.12 | 0.0 | 1.0 | 0 | True |
| atlas-p3 | claude | mcp_optimizer | hard | 1 | 1.0 | 0.323806 | 0.323806–0.323806 | 0.274872 | 0.048934 | 345425.0 | 1.6 | 0.0 | 1.0 | 0 | True |
| atlas-p3 | claude | mcp_optimizer | soft | 1 | 1.0 | 0.330883 | 0.330883–0.330883 | 0.28195 | 0.048934 | 253452.0 | -0.55 | 0.0 | 1.0 | 0 | True |
| atlas-p3 | claude | raw | none | 1 | 1.0 | 0.329075 | 0.329075–0.329075 | 0.329075 | 0.0 | 243037.0 | None | 0.0 | 0.0 | 0 | True |
| atlas-p3 | codex | mcp_only | hard | 1 | 1.0 | 0.202174 | 0.202174–0.202174 | 0.15324 | 0.048934 | 105463.0 | 52.0 | 0.0 | 1.0 | 0 | True |
| atlas-p3 | codex | mcp_only | soft | 1 | 1.0 | 0.225695 | 0.225695–0.225695 | 0.176761 | 0.048934 | 124616.0 | 46.41 | 0.0 | 1.0 | 0 | True |
| atlas-p3 | codex | mcp_optimizer | hard | 1 | 1.0 | 0.294033 | 0.294033–0.294033 | 0.245099 | 0.048934 | 176472.0 | 30.19 | 0.0 | 1.0 | 0 | True |
| atlas-p3 | codex | mcp_optimizer | soft | 1 | 1.0 | 0.29045 | 0.29045–0.29045 | 0.241516 | 0.048934 | 160845.0 | 31.04 | 0.0 | 1.0 | 0 | True |
| atlas-p3 | codex | raw | none | 1 | 1.0 | 0.421186 | 0.421186–0.421186 | 0.421186 | 0.0 | 303293.0 | None | 0.0 | 0.0 | 0 | True |
| nova-p2 | claude | mcp_only | hard | 1 | 1.0 | 0.266124 | 0.266124–0.266124 | 0.21719 | 0.048934 | 234880.0 | -14.68 | 0.0 | 1.0 | 0 | True |
| nova-p2 | claude | mcp_only | soft | 1 | 1.0 | 0.28978 | 0.28978–0.28978 | 0.240846 | 0.048934 | 238903.0 | -24.88 | 0.0 | 1.0 | 0 | True |
| nova-p2 | claude | mcp_optimizer | hard | 1 | 1.0 | 0.307175 | 0.307175–0.307175 | 0.258241 | 0.048934 | 306935.0 | -32.37 | 0.0 | 1.0 | 0 | True |
| nova-p2 | claude | mcp_optimizer | soft | 1 | 1.0 | 0.322719 | 0.322719–0.322719 | 0.273785 | 0.048934 | 374725.0 | -39.07 | 0.0 | 1.0 | 0 | True |
| nova-p2 | claude | raw | none | 1 | 1.0 | 0.232053 | 0.232053–0.232053 | 0.232053 | 0.0 | 301624.0 | None | 0.0 | 0.0 | 0 | True |
| nova-p2 | codex | mcp_only | hard | 1 | 1.0 | 0.267188 | 0.267188–0.267188 | 0.218254 | 0.048934 | 154520.0 | 33.22 | 0.0 | 1.0 | 0 | True |
| nova-p2 | codex | mcp_only | soft | 1 | 1.0 | 0.260886 | 0.260886–0.260886 | 0.211952 | 0.048934 | 150487.0 | 34.8 | 0.0 | 1.0 | 0 | True |
| nova-p2 | codex | mcp_optimizer | hard | 1 | 1.0 | 0.30427 | 0.30427–0.30427 | 0.255336 | 0.048934 | 181414.0 | 23.96 | 0.0 | 1.0 | 0 | True |
| nova-p2 | codex | mcp_optimizer | soft | 1 | 1.0 | 0.233334 | 0.233334–0.233334 | 0.1844 | 0.048934 | 129495.0 | 41.68 | 0.0 | 1.0 | 0 | True |
| nova-p2 | codex | raw | none | 1 | 1.0 | 0.400121 | 0.400121–0.400121 | 0.400121 | 0.0 | 279742.0 | None | 0.0 | 0.0 | 0 | True |
| nova-p3 | claude | mcp_only | hard | 1 | 1.0 | 0.28241 | 0.28241–0.28241 | 0.233476 | 0.048934 | 236762.0 | -2.8 | 0.0 | 1.0 | 0 | True |
| nova-p3 | claude | mcp_only | soft | 1 | 1.0 | 0.285873 | 0.285873–0.285873 | 0.236939 | 0.048934 | 239390.0 | -4.06 | 0.0 | 1.0 | 0 | True |
| nova-p3 | claude | mcp_optimizer | hard | 1 | 1.0 | 0.308509 | 0.308509–0.308509 | 0.259575 | 0.048934 | 340254.0 | -12.3 | 0.0 | 1.0 | 0 | True |
| nova-p3 | claude | mcp_optimizer | soft | 1 | 1.0 | 0.327577 | 0.327577–0.327577 | 0.278643 | 0.048934 | 347316.0 | -19.24 | 0.0 | 1.0 | 0 | True |
| nova-p3 | claude | raw | none | 1 | 1.0 | 0.274729 | 0.274729–0.274729 | 0.274729 | 0.0 | 356147.0 | None | 0.0 | 0.0 | 0 | True |
| nova-p3 | codex | mcp_only | hard | 1 | 1.0 | 0.266919 | 0.266919–0.266919 | 0.217985 | 0.048934 | 153101.0 | 19.79 | 0.0 | 1.0 | 0 | True |
| nova-p3 | codex | mcp_only | soft | 1 | 1.0 | 0.29753 | 0.29753–0.29753 | 0.248596 | 0.048934 | 176176.0 | 10.59 | 0.0 | 1.0 | 0 | True |
| nova-p3 | codex | mcp_optimizer | hard | 1 | 1.0 | 0.274485 | 0.274485–0.274485 | 0.225551 | 0.048934 | 159091.0 | 17.51 | 0.0 | 1.0 | 0 | True |
| nova-p3 | codex | mcp_optimizer | soft | 1 | 1.0 | 0.305875 | 0.305875–0.305875 | 0.256941 | 0.048934 | 181291.0 | 8.08 | 0.0 | 1.0 | 0 | True |
| nova-p3 | codex | raw | none | 1 | 1.0 | 0.332759 | 0.332759–0.332759 | 0.332759 | 0.0 | 239908.0 | None | 0.0 | 0.0 | 0 | True |
| orbit-p2 | claude | mcp_only | hard | 1 | 1.0 | 0.602023 | 0.602023–0.602023 | 0.493128 | 0.108895 | 559117.0 | -49.23 | 0.0 | 1.0 | 0 | True |
| orbit-p2 | claude | mcp_only | soft | 1 | 1.0 | 0.53297 | 0.53297–0.53297 | 0.484036 | 0.048934 | 466128.0 | -32.11 | 0.0 | 1.0 | 0 | True |
| orbit-p2 | claude | mcp_optimizer | hard | 1 | 1.0 | 0.402394 | 0.402394–0.402394 | 0.351572 | 0.050822 | 285482.0 | 0.25 | 0.0 | 1.0 | 0 | True |
| orbit-p2 | claude | mcp_optimizer | soft | 1 | 1.0 | 0.470504 | 0.470504–0.470504 | 0.360776 | 0.109728 | 412548.0 | -16.63 | 0.0 | 1.0 | 0 | True |
| orbit-p2 | claude | raw | none | 1 | 1.0 | 0.403419 | 0.403419–0.403419 | 0.403419 | 0.0 | 232221.0 | None | 0.0 | 0.0 | 0 | True |
| orbit-p2 | codex | mcp_only | hard | 1 | 1.0 | 0.320802 | 0.320802–0.320802 | 0.229426 | 0.091376 | 158558.0 | -25.68 | 0.0 | 1.0 | 0 | True |
| orbit-p2 | codex | mcp_only | soft | 1 | 1.0 | 0.356818 | 0.356818–0.356818 | 0.29453 | 0.062288 | 207554.0 | -39.79 | 0.0 | 1.0 | 0 | True |
| orbit-p2 | codex | mcp_optimizer | hard | 1 | 1.0 | 0.319477 | 0.319477–0.319477 | 0.270543 | 0.048934 | 189540.0 | -25.16 | 0.0 | 1.0 | 0 | True |
| orbit-p2 | codex | mcp_optimizer | soft | 1 | 1.0 | 0.299492 | 0.299492–0.299492 | 0.245158 | 0.054334 | 166047.0 | -17.33 | 0.0 | 1.0 | 0 | True |
| orbit-p2 | codex | raw | none | 1 | 1.0 | 0.255256 | 0.255256–0.255256 | 0.255256 | 0.0 | 179012.0 | None | 0.0 | 0.0 | 0 | True |
| orbit-p3 | claude | mcp_only | hard | 1 | 1.0 | 0.481866 | 0.481866–0.481866 | 0.362532 | 0.119334 | 366323.0 | -42.08 | 0.0 | 1.0 | 0 | True |
| orbit-p3 | claude | mcp_only | soft | 1 | 1.0 | 0.497962 | 0.497962–0.497962 | 0.373187 | 0.124775 | 414663.0 | -46.82 | 0.0 | 1.0 | 0 | True |
| orbit-p3 | claude | mcp_optimizer | hard | 1 | 1.0 | 0.427543 | 0.427543–0.427543 | 0.356714 | 0.070829 | 436875.0 | -26.06 | 0.0 | 1.0 | 0 | True |
| orbit-p3 | claude | mcp_optimizer | soft | 1 | 1.0 | 0.598806 | 0.598806–0.598806 | 0.426004 | 0.172802 | 487904.0 | -76.55 | 0.0 | 1.0 | 0 | True |
| orbit-p3 | claude | raw | none | 1 | 1.0 | 0.339162 | 0.339162–0.339162 | 0.339162 | 0.0 | 403275.0 | None | 0.0 | 0.0 | 0 | True |
| orbit-p3 | codex | mcp_only | hard | 1 | 1.0 | 0.350598 | 0.350598–0.350598 | 0.243918 | 0.10668 | 165762.0 | 26.81 | 0.0 | 1.0 | 0 | True |
| orbit-p3 | codex | mcp_only | soft | 1 | 1.0 | 0.403574 | 0.403574–0.403574 | 0.26544 | 0.138134 | 185479.0 | 15.75 | 0.0 | 1.0 | 0 | True |
| orbit-p3 | codex | mcp_optimizer | hard | 1 | 1.0 | 0.288407 | 0.288407–0.288407 | 0.239473 | 0.048934 | 166462.0 | 39.79 | 0.0 | 1.0 | 0 | True |
| orbit-p3 | codex | mcp_optimizer | soft | 1 | 1.0 | 0.337126 | 0.337126–0.337126 | 0.241123 | 0.096003 | 165682.0 | 29.62 | 0.0 | 1.0 | 0 | True |
| orbit-p3 | codex | raw | none | 1 | 1.0 | 0.479031 | 0.479031–0.479031 | 0.479031 | 0.0 | 345712.0 | None | 0.0 | 0.0 | 0 | True |
