"""
Report generator — turns a batch of RunRecords into the A/B/C answer.

Pure function of the recorded JSON (run reconcile.py first so PRMPT cost is the
authoritative billed amount). Produces:
  - report.md   : human-readable tables + the headline verdict
  - summary.csv : one row per (task, agent, variant, hardening) aggregate

Metrics, per the agreed definitions:
  A  tasks-before-wall : pass-rate and total NET cost to complete the task set
                         (proxy for "how much work fits in a fixed quota")
  B  net cost          : agent_cost(variant) + prmpt_cost(variant), and the
                         saving vs the RAW baseline for the same task/agent
  C  first-try success : pass-rate (verify exit 0) and retries

Repeats are aggregated by median (cost/tokens) and mean pass-rate, with min/max
spread shown so a single lucky/unlucky run can't masquerade as signal.
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
from collections import defaultdict
from pathlib import Path

from benchmarks.metrics import RunRecord, Variant


def load_batch(results_dir: Path) -> list[RunRecord]:
    recs = []
    for f in sorted(results_dir.glob("*.json")):
        try:
            recs.append(RunRecord.from_dict(json.loads(f.read_text(encoding="utf-8"))))
        except (json.JSONDecodeError, KeyError):
            continue
    return recs


def net_cost(rec: RunRecord) -> float:
    """Agent spend + PRMPT's own OpenRouter spend. The honest number."""
    return round(rec.agent_usage.cost_usd + rec.prmpt_usage.total_cost_usd, 6)


def _med(xs: list[float]) -> float:
    return round(statistics.median(xs), 6) if xs else 0.0


def aggregate(recs: list[RunRecord]) -> dict:
    """key -> aggregate. key = (task, agent, variant, hardening)."""
    groups: dict[tuple, list[RunRecord]] = defaultdict(list)
    for r in recs:
        groups[(r.task_id, r.agent.value, r.variant.value, r.hardening.value)].append(r)

    agg = {}
    for key, rs in groups.items():
        scored = [r for r in rs if r.outcome.success_known]
        passes = [1 if r.outcome.passed else 0 for r in scored]
        net = [net_cost(r) for r in rs]
        agent_c = [r.agent_usage.cost_usd for r in rs]
        prmpt_c = [r.prmpt_usage.total_cost_usd for r in rs]
        toks = [r.agent_usage.total_tokens for r in rs]
        native = [r.agent_usage.native_search_calls for r in rs]
        mcp = [r.agent_usage.mcp_tool_calls for r in rs]
        suspect = sum(1 for r in rs if r.agent_usage.raw_session_path == "SUSPECT_EMPTY_RUN")
        agg[key] = {
            "n": len(rs),
            "n_scored": len(scored),
            "pass_rate": round(sum(passes) / len(scored), 4) if scored else None,
            "net_cost_median": _med(net),
            "net_cost_min": round(min(net), 6),
            "net_cost_max": round(max(net), 6),
            "agent_cost_median": _med(agent_c),
            "prmpt_cost_median": _med(prmpt_c),
            "agent_tokens_median": _med([float(t) for t in toks]),
            "native_search_median": _med([float(x) for x in native]),
            "mcp_calls_median": _med([float(x) for x in mcp]),
            "suspect_empty_runs": suspect,
            "reconciled": all(r.prmpt_usage.reconciled for r in rs),
        }
    return agg


def build_rows(agg: dict) -> list[dict]:
    rows = []
    for (task, agent, variant, hard), a in sorted(agg.items()):
        # Baseline = RAW for the same task+agent.
        base_key = (task, agent, Variant.RAW.value, "none")
        base = agg.get(base_key)
        saving_pct = None
        saving_usd = None
        if base and variant != Variant.RAW.value and base["net_cost_median"] > 0:
            saving_usd = round(base["net_cost_median"] - a["net_cost_median"], 6)
            saving_pct = round(100.0 * saving_usd / base["net_cost_median"], 2)
        rows.append({
            "task": task, "agent": agent, "variant": variant, "hardening": hard,
            "n": a["n"], "pass_rate": a["pass_rate"],
            "net_cost_median": a["net_cost_median"],
            "net_cost_spread": f'{a["net_cost_min"]}–{a["net_cost_max"]}',
            "agent_cost_median": a["agent_cost_median"],
            "prmpt_cost_median": a["prmpt_cost_median"],
            "agent_tokens_median": a["agent_tokens_median"],
            "vs_baseline_saving_usd": saving_usd,
            "vs_baseline_saving_pct": saving_pct,
            "native_search_median": a["native_search_median"],
            "mcp_calls_median": a["mcp_calls_median"],
            "suspect_empty_runs": a["suspect_empty_runs"],
            "reconciled": a["reconciled"],
        })
    return rows


def write_csv(rows: list[dict], path: Path) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def _verdict(rows: list[dict]) -> list[str]:
    """The honest headline: a variant only 'wins' if it saves NET cost AND does
    not reduce first-try success vs its RAW baseline."""
    lines = ["## Verdict (auto-derived)", ""]
    byba = {(r["task"], r["agent"]): r for r in rows if r["variant"] == "raw"}
    wins, regress, inconclusive = [], [], []
    for r in rows:
        if r["variant"] == "raw":
            continue
        base = byba.get((r["task"], r["agent"]))
        if not base:
            continue
        tag = f'{r["task"]}/{r["agent"]}/{r["variant"]}/{r["hardening"]}'
        if r["suspect_empty_runs"]:
            inconclusive.append(f'{tag} — {r["suspect_empty_runs"]} suspect empty run(s); re-run')
            continue
        if r["vs_baseline_saving_pct"] is None:
            inconclusive.append(f"{tag} — no baseline cost to compare")
            continue
        if r["pass_rate"] is None or base["pass_rate"] is None:
            sign = "-" if r["vs_baseline_saving_pct"] > 0 else "+"
            inconclusive.append(
                f'{tag} — net {sign}{abs(r["vs_baseline_saving_pct"])}% but success unscored '
                "(cost-only; cannot confirm correctness held)")
            continue
        saved = r["vs_baseline_saving_pct"] > 0
        held = r["pass_rate"] >= base["pass_rate"]
        if saved and held:
            wins.append(f'{tag} — net -{r["vs_baseline_saving_pct"]}%, pass {r["pass_rate"]} ≥ base {base["pass_rate"]}')
        elif saved and not held:
            regress.append(f'{tag} — saved {r["vs_baseline_saving_pct"]}% BUT pass {r["pass_rate"]} < base {base["pass_rate"]} (regression)')
        else:
            regress.append(f'{tag} — net {r["vs_baseline_saving_pct"]}% (no saving), pass {r["pass_rate"]}')
    lines.append("### Wins (net cost down AND correctness held)")
    lines += [f"- {w}" for w in wins] or ["- none"]
    lines.append("\n### Regressions / non-wins")
    lines += [f"- {w}" for w in regress] or ["- none"]
    if inconclusive:
        lines.append("\n### Inconclusive (re-run)")
        lines += [f"- {w}" for w in inconclusive]
    return lines


def write_markdown(rows: list[dict], path: Path) -> None:
    cols = ["task", "agent", "variant", "hardening", "n", "pass_rate",
            "net_cost_median", "net_cost_spread", "agent_cost_median",
            "prmpt_cost_median", "agent_tokens_median", "vs_baseline_saving_pct",
            "native_search_median", "mcp_calls_median", "suspect_empty_runs", "reconciled"]
    out = ["# PRMPT Benchmark Report", "",
           "Net cost = agent spend + PRMPT OpenRouter spend (reconciled to billed). "
           "A variant only counts as a win if it lowers net cost AND holds first-try "
           "pass-rate vs its RAW baseline.", ""]
    out += _verdict(rows)
    out += ["", "## Full results", "", "| " + " | ".join(cols) + " |",
            "|" + "|".join(["---"] * len(cols)) + "|"]
    for r in rows:
        out.append("| " + " | ".join(str(r.get(c, "")) for c in cols) + " |")
    path.write_text("\n".join(out) + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description="Build the PRMPT benchmark report.")
    ap.add_argument("--results", required=True)
    args = ap.parse_args()
    results_dir = Path(args.results)
    recs = load_batch(results_dir)
    if not recs:
        raise SystemExit(f"no records in {results_dir}")
    agg = aggregate(recs)
    rows = build_rows(agg)
    write_csv(rows, results_dir / "summary.csv")
    write_markdown(rows, results_dir / "report.md")
    # Combined one-line-per-run dump: hand this whole file to an LLM and it has
    # everything it needs to write a report without report.py.
    with (results_dir / "runs.jsonl").open("w", encoding="utf-8") as f:
        for f_json in sorted(results_dir.glob("*.json")):
            try:
                f.write(json.dumps(json.loads(f_json.read_text(encoding="utf-8"))) + "\n")
            except (json.JSONDecodeError, OSError):
                continue
    if not all(r["reconciled"] for r in rows):
        print("WARNING: some records not reconciled — run reconcile.py for billed PRMPT cost.")
    print(f"Wrote {results_dir/'report.md'} and {results_dir/'summary.csv'} "
          f"from {len(recs)} runs.")


if __name__ == "__main__":
    main()
