# first-test

First **successful** sequential benchmark run on `benchmark-environment` (after harness fixes).

**Batch:** `20260611-seq-p2p3-fixed`  
**Date:** 2026-06-11 → 2026-06-12  
**Tasks:** p2 + p3 across all 3 repos (6 tasks, 60 cells)  
**Execution:** Sequential (one cell at a time)

## Fixes applied before this run

- Absolute paths for MCP config (relative paths broke in worktrees)
- `--strict-mcp-config` for Claude MCP
- Fixed `mcp__prompt__*` allow list typo in hard settings
- Removed duplicate `append-system-prompt` on MCP runs
- Codex: mcp-shi style invocation (`-C worktree`, stdin prompt, bypass sandbox)
- Absolute path for Claude hard settings file

## Quick results

| Metric | Value |
|--------|------:|
| Total runs | 60 |
| Passed | **60/60** |
| Prepare OpenRouter cost | $0.4404 |
| Amortized PRMPT cost/task | $0.0489 |

### Pass rate by variant

| Agent | Variant | Pass |
|-------|---------|-----:|
| Claude | raw | 6/6 |
| Claude | mcp_only | 12/12 |
| Claude | mcp_optimizer | 12/12 |
| Codex | raw | 6/6 |
| Codex | mcp_only | 12/12 |
| Codex | mcp_optimizer | 12/12 |

### Verdict highlights

- **24 MCP wins** (net cost down + pass rate held) — mostly Codex; some Claude on atlas-p3, orbit-p2/3
- **Claude MCP on atlas-p2 / nova-p2** often cost *more* than raw (regression in savings, but still passed)
- Compare to broken parallel run (`20260611-complex-p2p3-parallel`): MCP now actually runs ($0.20–$0.50/cell, MCP calls logged)

### Rerun note

One cell initially failed: `orbit-p2 / codex / mcp_optimizer / hard` — Codex hit the 900s harness timeout mid-patch (not a silent exit; rollout showed ~134k tokens used). Reran that cell only; passed in 66s at $0.27. Reports regenerated and synced after the rerun.

## Layout

```
first-test/
  README.md
  reports/     ← FULL_REPORT.md, .pdf, report.md, summary.csv, runs.jsonl
  runs/        ← 60 individual run JSON files
  logs/        ← runner.log, sessions/
  prepared/    ← prepare_meta.json, optimized_by_repo.json
  config/      ← config-run.yaml, tasks-all-p2p3.yaml
```

## Desktop copies

- `~/Desktop/PRMPT_BENCHMARK_20260611_FULL_REPORT.md`
- `~/Desktop/PRMPT_BENCHMARK_20260611_FULL_REPORT.pdf`
- `~/Desktop/PRMPT_BENCHMARK_20260611_report.md`
- `~/Desktop/PRMPT_BENCHMARK_20260611_summary.csv`
- `~/Desktop/PRMPT_BENCHMARK_20260611_runs.jsonl`

## Source batch

Full artifacts live at `mcp-ahh/results/20260611-seq-p2p3-fixed/`.
