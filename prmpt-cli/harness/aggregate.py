"""
Aggregate 3-arm benchmark results and generate the comparison canvas.

Reads a results.jsonl produced by run_3arm.py, computes per-arm totals + a
per-task breakdown + savings (B vs A, C vs A), writes summary.json, and
generates a Cursor canvas (.canvas.tsx) with the real numbers embedded.

Run AFTER the benchmark has produced results (on the machine that ran it):
    python prmpt-cli/harness/aggregate.py --results prmpt-cli/harness/results/results-<batch>.jsonl

If --results is omitted, the newest results-*.jsonl in harness/results/ is used.
"""

from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path

CLI_ROOT = Path(__file__).resolve().parents[1]
RESULTS_DIR = CLI_ROOT / "harness" / "results"
SUMMARY_PATH = CLI_ROOT / "harness" / "summary.json"
# Cursor-managed canvases directory for this workspace.
CANVAS_DIR = Path(
    r"C:\Users\Prabhat\.cursor\projects\c-Users-Prabhat-Desktop-PROMPT\canvases"
)
CANVAS_PATH = CANVAS_DIR / "prmpt-cli-3arm.canvas.tsx"

ARM_ORDER = ["A", "B", "C"]
ARM_LABELS = {
    "A": "Claude Code + raw",
    "B": "PRMPT CLI + raw",
    "C": "PRMPT CLI + optimized",
}


def latest_results() -> Path | None:
    if not RESULTS_DIR.exists():
        return None
    files = sorted(RESULTS_DIR.glob("results-*.jsonl"), key=lambda p: p.stat().st_mtime)
    return files[-1] if files else None


def load_records(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def _num(rec: dict, key: str) -> float:
    v = rec.get(key)
    return float(v) if isinstance(v, (int, float)) else 0.0


def load_usage_rows(path: Path | None) -> list[dict]:
    """Load code-intel's own LLM usage log (PRMPT_LLM_USAGE_LOG). Each row is one
    litellm completion the service made (summaries/concepts/decompose/answer/
    agentic hops) with token counts + cost. Embeddings/rerank are local → absent."""
    if not path or not Path(path).exists():
        return []
    rows = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if r.get("ts_epoch") is not None:
            rows.append(r)
    return rows


def attribute_usage(records: list[dict], usage_rows: list[dict]) -> tuple[dict, dict]:
    """Attribute PRMPT-side LLM usage to runs by wall-clock window.

    Runs are strictly sequential, so a usage row falling inside a run's
    [started_epoch, ended_epoch] window belongs to that run's retrieval. Rows
    before the first run are one-time index/bootstrap cost (amortized later).
    Rows in no window (e.g. during Arm A, which never calls code-intel) are
    reported as unattributed rather than silently dropped."""
    bc = [
        r for r in records
        if r.get("arm") in ("B", "C")
        and r.get("started_epoch") and r.get("ended_epoch")
    ]
    windows = [(r["run_id"], r["started_epoch"], r["ended_epoch"]) for r in bc]
    starts = [r["started_epoch"] for r in records if r.get("started_epoch")]
    first_start = min(starts) if starts else None

    per_run: dict[str, dict] = {}
    index_tokens = index_cost = 0.0
    unatt_tokens = unatt_cost = 0.0
    for u in usage_rows:
        ts = u.get("ts_epoch")
        tok = float(u.get("total_tokens") or 0)
        cost = float(u.get("cost_usd") or 0.0)
        if ts is None:
            continue
        if first_start is not None and ts < first_start:
            index_tokens += tok
            index_cost += cost
            continue
        placed = False
        for rid, s, e in windows:
            if s <= ts <= e:
                d = per_run.setdefault(rid, {"tokens": 0.0, "cost": 0.0})
                d["tokens"] += tok
                d["cost"] += cost
                placed = True
                break
        if not placed:
            unatt_tokens += tok
            unatt_cost += cost

    meta = {
        "index_tokens": int(index_tokens),
        "index_cost": round(index_cost, 4),
        "unattributed_tokens": int(unatt_tokens),
        "unattributed_cost": round(unatt_cost, 4),
        "num_bc_runs": len(bc),
        "usage_rows": len(usage_rows),
    }
    return per_run, meta


def aggregate(records: list[dict], usage_per_run: dict, usage_meta: dict) -> dict:
    arms_present = [a for a in ARM_ORDER if any(r.get("arm") == a for r in records)]

    n_bc = usage_meta.get("num_bc_runs", 0)
    idx_tok_per_run = (usage_meta.get("index_tokens", 0) / n_bc) if n_bc else 0.0
    idx_cost_per_run = (usage_meta.get("index_cost", 0.0) / n_bc) if n_bc else 0.0

    per_arm: dict[str, dict] = {}
    for arm in arms_present:
        rs = [r for r in records if r.get("arm") == arm and "skipped" not in r]
        if not rs:
            continue
        n = len(rs)
        passed = sum(1 for r in rs if r.get("passed"))
        times = [_num(r, "elapsed_ms") for r in rs]
        agent_tokens = int(sum(_num(r, "total_tokens") for r in rs))
        agent_cost = round(sum(_num(r, "cost_usd") for r in rs), 4)

        # PRMPT-side (code-intel) spend only applies to retrieval arms (B/C).
        retr_tokens = int(sum(usage_per_run.get(r["run_id"], {}).get("tokens", 0) for r in rs))
        retr_cost = round(sum(usage_per_run.get(r["run_id"], {}).get("cost", 0.0) for r in rs), 4)
        idx_amort_tokens = int(round(idx_tok_per_run * n)) if arm in ("B", "C") else 0
        idx_amort_cost = round(idx_cost_per_run * n, 4) if arm in ("B", "C") else 0.0

        combined_tokens = agent_tokens + retr_tokens + idx_amort_tokens
        combined_cost = round(agent_cost + retr_cost + idx_amort_cost, 4)

        per_arm[arm] = {
            "label": ARM_LABELS[arm],
            "runs": n,
            "passed": passed,
            "pass_rate": round(100 * passed / n, 1) if n else 0.0,
            # Agent-only (base model) numbers
            "agent_tokens": agent_tokens,
            "agent_cost": agent_cost,
            "input_tokens": int(sum(_num(r, "input_tokens") for r in rs)),
            "output_tokens": int(sum(_num(r, "output_tokens") for r in rs)),
            # PRMPT-side (code-intel) numbers
            "prmpt_retrieval_tokens": retr_tokens,
            "prmpt_retrieval_cost": retr_cost,
            "prmpt_index_amortized_tokens": idx_amort_tokens,
            "prmpt_index_amortized_cost": idx_amort_cost,
            # Combined = the honest total used for the headline comparison
            "total_tokens": combined_tokens,
            "total_cost": combined_cost,
            "avg_tokens": int(combined_tokens / n) if n else 0,
            "avg_cost": round(combined_cost / n, 4) if n else 0.0,
            "avg_elapsed_ms": int(statistics.mean(times)) if times else 0,
            "avg_retrieval_calls": round(
                statistics.mean([_num(r, "retrieval_calls") for r in rs]), 2
            ) if n else 0.0,
        }

    def savings(base: str, arm: str) -> dict | None:
        if base not in per_arm or arm not in per_arm:
            return None
        b, a = per_arm[base], per_arm[arm]
        tok = (
            round(100 * (b["total_tokens"] - a["total_tokens"]) / b["total_tokens"], 1)
            if b["total_tokens"] else None
        )
        cost = (
            round(100 * (b["total_cost"] - a["total_cost"]) / b["total_cost"], 1)
            if b["total_cost"] else None
        )
        return {
            "token_saving_pct": tok,
            "cost_saving_pct": cost,
            "pass_rate_delta": round(a["pass_rate"] - b["pass_rate"], 1),
        }

    # Per-task breakdown
    task_ids: list[str] = []
    for r in records:
        if r.get("task_id") and r["task_id"] not in task_ids:
            task_ids.append(r["task_id"])

    per_task = []
    for tid in task_ids:
        row: dict = {"task_id": tid, "arms": {}}
        for arm in arms_present:
            rs = [r for r in records if r.get("task_id") == tid and r.get("arm") == arm]
            if not rs:
                continue
            r = rs[-1]  # last repeat
            row["arms"][arm] = {
                "passed": bool(r.get("passed")),
                "total_tokens": int(_num(r, "total_tokens")),
                "cost_usd": round(_num(r, "cost_usd"), 4),
                "retrieval_calls": int(_num(r, "retrieval_calls")),
                "elapsed_ms": int(_num(r, "elapsed_ms")),
                "skipped": r.get("skipped"),
            }
        per_task.append(row)

    return {
        "arms_present": arms_present,
        "per_arm": per_arm,
        "savings": {
            "B_vs_A": savings("A", "B"),
            "C_vs_A": savings("A", "C"),
            "C_vs_B": savings("B", "C"),
        },
        "per_task": per_task,
        "prmpt_side": {
            "index_tokens": usage_meta.get("index_tokens", 0),
            "index_cost": usage_meta.get("index_cost", 0.0),
            "unattributed_tokens": usage_meta.get("unattributed_tokens", 0),
            "unattributed_cost": usage_meta.get("unattributed_cost", 0.0),
            "usage_rows": usage_meta.get("usage_rows", 0),
            "captured": usage_meta.get("usage_rows", 0) > 0,
        },
        "model": next((r.get("model") for r in records if r.get("arm") in ("B", "C")), None),
        "batch": next((r.get("batch") for r in records if r.get("batch")), None),
        "total_runs": len(records),
    }


CANVAS_TEMPLATE = r'''import {
  Stack,
  Grid,
  Row,
  Spacer,
  H1,
  H2,
  H3,
  Text,
  Stat,
  Table,
  Callout,
  Pill,
  Divider,
  BarChart,
  useHostTheme,
} from "cursor/canvas";

// Generated by prmpt-cli/harness/aggregate.py — do not edit by hand.
const DATA = /*__DATA__*/ null as any;

const ARM_LABELS: Record<string, string> = {
  A: "Claude Code + raw",
  B: "PRMPT CLI + raw",
  C: "PRMPT CLI + optimized",
};
const ARM_TONE: Record<string, "info" | "success" | "warning"> = {
  A: "info",
  B: "success",
  C: "warning",
};

function fmtTokens(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

export default function Prmpt3ArmReport() {
  useHostTheme();
  const arms: string[] = DATA.arms_present;
  const perArm = DATA.per_arm;

  const tokenSeries = [{ name: "Total tokens", data: arms.map((a) => perArm[a].total_tokens) }];
  const costSeries = [{ name: "Total cost (USD)", data: arms.map((a) => perArm[a].total_cost) }];
  const armNames = arms.map((a) => ARM_LABELS[a]);

  const sav = DATA.savings;
  const ps = DATA.prmpt_side ?? {};

  return (
    <Stack gap={20} style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <Stack gap={4}>
        <H1>PRMPT CLI — 3-Arm Benchmark</H1>
        <Text tone="secondary">
          Same base model across all arms ({DATA.model ?? "Claude Sonnet 4.6"}). Only the
          retrieval / prompt layer changes. Oracle: `npm test` exit 0. Source: {DATA.total_runs} runs
          {DATA.batch ? ` · batch ${DATA.batch}` : ""}.
        </Text>
      </Stack>

      <Grid columns={arms.length} gap={16}>
        {arms.map((a) => (
          <Stat
            key={a}
            value={`${perArm[a].pass_rate}%`}
            label={`${ARM_LABELS[a]} — pass rate (${perArm[a].passed}/${perArm[a].runs})`}
            tone={perArm[a].pass_rate >= 100 ? "success" : perArm[a].pass_rate >= 50 ? "warning" : "danger"}
          />
        ))}
      </Grid>

      <Grid columns={arms.length} gap={16}>
        {arms.map((a) => (
          <Stat key={a} value={fmtTokens(perArm[a].total_tokens)} label={`${ARM_LABELS[a]} — total tokens`} />
        ))}
      </Grid>

      {sav.B_vs_A || sav.C_vs_A ? (
        <Callout tone="success" title="Token & cost savings vs Claude Code (Arm A)">
          <Stack gap={4}>
            {sav.B_vs_A ? (
              <Text>
                <Text weight="semibold">Arm B (PRMPT raw):</Text>{" "}
                {sav.B_vs_A.token_saving_pct ?? "—"}% fewer tokens, {sav.B_vs_A.cost_saving_pct ?? "—"}% lower cost,
                pass-rate delta {sav.B_vs_A.pass_rate_delta >= 0 ? "+" : ""}{sav.B_vs_A.pass_rate_delta} pts.
              </Text>
            ) : null}
            {sav.C_vs_A ? (
              <Text>
                <Text weight="semibold">Arm C (PRMPT optimized):</Text>{" "}
                {sav.C_vs_A.token_saving_pct ?? "—"}% fewer tokens, {sav.C_vs_A.cost_saving_pct ?? "—"}% lower cost,
                pass-rate delta {sav.C_vs_A.pass_rate_delta >= 0 ? "+" : ""}{sav.C_vs_A.pass_rate_delta} pts.
              </Text>
            ) : null}
          </Stack>
        </Callout>
      ) : null}

      <Callout
        tone={ps.captured ? "info" : "warning"}
        title={ps.captured ? "What 'total tokens' includes" : "PRMPT-side cost NOT captured in this run"}
      >
        <Text>
          {ps.captured
            ? "For Arms B/C, total tokens = base-model (agent) tokens + PRMPT-side code-intel tokens (per-query retrieval LLM calls + amortized one-time index cost). Arm A is agent-only — Claude Code never calls code-intel. Tokens are the apples-to-apples headline; dollar cost is secondary because Arm A may run on a Claude subscription (estimated $), not per-token billing."
            : "B/C totals here are agent-only. The code-intel layer's own LLM spend (index-time summaries/concepts + per-retrieval calls) was not logged, so PRMPT looks cheaper than it truly is. Re-run with PRMPT_LLM_USAGE_LOG set on the service to fold it in."}
        </Text>
      </Callout>

      <Stack gap={8}>
        <H2>Total tokens by arm</H2>
        <Text tone="secondary" size="small">
          Lower is better. Sum across all tasks. B/C include PRMPT-side tokens. Source: results.jsonl{ps.captured ? " + usage log" : ""}.
        </Text>
        <BarChart categories={armNames} series={tokenSeries} height={240} />
      </Stack>

      {ps.captured ? (
        <Stack gap={8}>
          <H2>Token decomposition — where B/C spend goes</H2>
          <Text tone="secondary" size="small">
            Agent = base model. Retrieval = code-intel LLM calls per query. Index = one-time indexing, amortized across {ps.usage_rows ? "runs" : "runs"}. Combined is the headline number.
          </Text>
          <Table
            headers={["Arm", "Agent tokens", "Retrieval tokens", "Amortized index", "Combined tokens"]}
            columnAlign={["left", "right", "right", "right", "right"]}
            rows={arms.map((a) => [
              ARM_LABELS[a],
              perArm[a].agent_tokens.toLocaleString(),
              (perArm[a].prmpt_retrieval_tokens ?? 0).toLocaleString(),
              (perArm[a].prmpt_index_amortized_tokens ?? 0).toLocaleString(),
              perArm[a].total_tokens.toLocaleString(),
            ])}
          />
        </Stack>
      ) : null}

      <Stack gap={8}>
        <H2>Total cost by arm (USD)</H2>
        <Text tone="secondary" size="small">Lower is better. Derived from model usage. Source: results.jsonl.</Text>
        <BarChart categories={armNames} series={costSeries} height={240} valueSuffix="" />
      </Stack>

      <Stack gap={8}>
        <H2>Per-arm summary</H2>
        <Table
          headers={["Arm", "Pass", "Total tokens", "Avg tokens/task", "Total cost", "Avg time", "Avg retrievals"]}
          columnAlign={["left", "right", "right", "right", "right", "right", "right"]}
          rows={arms.map((a) => [
            ARM_LABELS[a],
            `${perArm[a].passed}/${perArm[a].runs}`,
            perArm[a].total_tokens.toLocaleString(),
            perArm[a].avg_tokens.toLocaleString(),
            `$${perArm[a].total_cost.toFixed(4)}`,
            `${(perArm[a].avg_elapsed_ms / 1000).toFixed(1)}s`,
            a === "A" ? "—" : String(perArm[a].avg_retrieval_calls),
          ])}
        />
      </Stack>

      <Stack gap={8}>
        <H2>Per-task breakdown</H2>
        <Text tone="secondary" size="small">
          P = passed, tokens shown per arm (last repeat). Source: results.jsonl.
        </Text>
        <Table
          headers={["Task", ...arms.map((a) => `${a} pass`), ...arms.map((a) => `${a} tokens`)]}
          columnAlign={["left", ...arms.map(() => "center" as const), ...arms.map(() => "right" as const)]}
          rows={DATA.per_task.map((t: any) => [
            t.task_id,
            ...arms.map((a) => {
              const c = t.arms[a];
              if (!c) return "—";
              if (c.skipped) return "skip";
              return c.passed ? "PASS" : "FAIL";
            }),
            ...arms.map((a) => {
              const c = t.arms[a];
              return c && !c.skipped ? fmtTokens(c.total_tokens) : "—";
            }),
          ])}
          rowTone={DATA.per_task.map((t: any) => {
            const allPass = arms.every((a) => t.arms[a]?.passed);
            return allPass ? ("success" as const) : undefined;
          })}
        />
      </Stack>

      <Divider />
      <Stack gap={6}>
        <H3>Reading this</H3>
        <Text tone="secondary">
          The win metric is fewer total tokens at no loss in pass rate. Arm B isolates the value
          of live retrieval on a vague prompt; Arm C adds prompt optimization on top. Average
          retrievals shows how often the agent re-queried PRMPT mid-task — the live retry loop.
        </Text>
      </Stack>
    </Stack>
  );
}
'''


def write_canvas(summary: dict) -> None:
    CANVAS_DIR.mkdir(parents=True, exist_ok=True)
    data_json = json.dumps(summary, ensure_ascii=False, indent=2)
    tsx = CANVAS_TEMPLATE.replace("/*__DATA__*/ null as any", data_json + " as any")
    CANVAS_PATH.write_text(tsx, encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="Aggregate 3-arm results -> canvas")
    ap.add_argument("--results", default=None, help="path to results-*.jsonl")
    ap.add_argument(
        "--usage-log", default=None,
        help="path to code-intel's PRMPT_LLM_USAGE_LOG jsonl (PRMPT-side cost). "
             "Defaults to $PRMPT_LLM_USAGE_LOG if set.",
    )
    ap.add_argument("--no-canvas", action="store_true", help="write summary.json only")
    args = ap.parse_args()

    path = Path(args.results) if args.results else latest_results()
    if not path or not path.exists():
        print("No results file found. Run run_3arm.py first.")
        return 1

    records = load_records(path)
    if not records:
        print(f"{path} has no records.")
        return 1

    import os
    usage_log = args.usage_log or os.environ.get("PRMPT_LLM_USAGE_LOG")
    usage_rows = load_usage_rows(Path(usage_log) if usage_log else None)
    if not usage_rows:
        print("NOTE: no PRMPT-side usage log found; B/C totals are agent-only "
              "(index + retrieval LLM cost NOT included).")
    usage_per_run, usage_meta = attribute_usage(records, usage_rows)

    summary = aggregate(records, usage_per_run, usage_meta)
    SUMMARY_PATH.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {SUMMARY_PATH}")
    print(json.dumps(summary["per_arm"], indent=2))

    if not args.no_canvas:
        write_canvas(summary)
        print(f"Wrote canvas {CANVAS_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
