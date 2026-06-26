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


def aggregate(records: list[dict]) -> dict:
    arms_present = [a for a in ARM_ORDER if any(r.get("arm") == a for r in records)]

    per_arm: dict[str, dict] = {}
    for arm in arms_present:
        rs = [r for r in records if r.get("arm") == arm and "skipped" not in r]
        if not rs:
            continue
        n = len(rs)
        passed = sum(1 for r in rs if r.get("passed"))
        times = [_num(r, "elapsed_ms") for r in rs]
        per_arm[arm] = {
            "label": ARM_LABELS[arm],
            "runs": n,
            "passed": passed,
            "pass_rate": round(100 * passed / n, 1) if n else 0.0,
            "total_tokens": int(sum(_num(r, "total_tokens") for r in rs)),
            "input_tokens": int(sum(_num(r, "input_tokens") for r in rs)),
            "output_tokens": int(sum(_num(r, "output_tokens") for r in rs)),
            "total_cost": round(sum(_num(r, "cost_usd") for r in rs), 4),
            "avg_tokens": int(statistics.mean([_num(r, "total_tokens") for r in rs])) if n else 0,
            "avg_cost": round(statistics.mean([_num(r, "cost_usd") for r in rs]), 4) if n else 0.0,
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

      <Stack gap={8}>
        <H2>Total tokens by arm</H2>
        <Text tone="secondary" size="small">Lower is better. Sum across all tasks. Source: results.jsonl.</Text>
        <BarChart categories={armNames} series={tokenSeries} height={240} />
      </Stack>

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

    summary = aggregate(records)
    SUMMARY_PATH.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {SUMMARY_PATH}")
    print(json.dumps(summary["per_arm"], indent=2))

    if not args.no_canvas:
        write_canvas(summary)
        print(f"Wrote canvas {CANVAS_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
