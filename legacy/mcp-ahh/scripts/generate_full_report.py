#!/usr/bin/env python3
"""Build comprehensive MD + PDF report from a benchmark batch."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from benchmarks import report  # noqa: E402
from benchmarks.metrics import RunRecord  # noqa: E402
from benchmarks.report import net_cost  # noqa: E402


def load_records(batch_dir: Path) -> list[RunRecord]:
    recs = []
    for f in sorted(batch_dir.glob("*.json")):
        if f.name in {"prepare_meta.json"}:
            continue
        try:
            recs.append(RunRecord.from_dict(json.loads(f.read_text(encoding="utf-8"))))
        except (json.JSONDecodeError, KeyError):
            continue
    return recs


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: generate_full_report.py <batch_dir>")
        return 1
    batch_dir = Path(sys.argv[1]).resolve()
    if not batch_dir.exists():
        print(f"missing: {batch_dir}")
        return 1

    import benchmarks.report as report_mod
    sys.argv = [sys.argv[0], "--results", str(batch_dir)]
    report_mod.main()

    recs = load_records(batch_dir)
    prep_meta = {}
    prep_path = REPO_ROOT / "mcp-ahh/results/prepared/prepare_meta.json"
    if prep_path.exists():
        prep_meta = json.loads(prep_path.read_text(encoding="utf-8"))

    lines: list[str] = []
    lines.append("# PRMPT Benchmark — Full Run Report")
    lines.append("")
    lines.append(f"- **Generated:** {datetime.now(timezone.utc).isoformat()}")
    lines.append(f"- **Batch:** `{batch_dir.name}`")
    lines.append(f"- **Runs recorded:** {len(recs)}")
    if prep_meta:
        lines.append(f"- **Prepare OpenRouter cost:** ${prep_meta.get('prepare_openrouter_cost_usd', 0):.4f}")
        lines.append(f"- **Prepare tasks indexed:** {prep_meta.get('tasks', 0)}")
    lines.append("")
    lines.append("## Executive summary")
    lines.append("")
    if (batch_dir / "report.md").exists():
        for line in (batch_dir / "report.md").read_text(encoding="utf-8").splitlines():
            if line.startswith("## Verdict") or line.startswith("|") or line.startswith("- **"):
                lines.append(line)
    lines.append("")
    lines.append("## Per-run log")
    lines.append("")
    lines.append("| Task | Agent | Variant | Hard | Pass | Agent $ | PRMPT $ | Net $ | Agent tok | MCP calls | Native search | Wall s |")
    lines.append("|------|-------|---------|------|------|---------|---------|-------|-----------|-----------|---------------|--------|")
    for r in sorted(recs, key=lambda x: (x.task_id, x.agent.value, x.variant.value, x.hardening.value)):
        pu = r.prmpt_usage.total_cost_usd
        au = r.agent_usage
        lines.append(
            f"| {r.task_id} | {r.agent.value} | {r.variant.value} | {r.hardening.value} "
            f"| {'Y' if r.outcome.passed else 'N'} | ${au.cost_usd:.4f} | ${pu:.4f} | ${net_cost(r):.4f} "
            f"| {au.total_tokens} | {au.mcp_tool_calls} | {au.native_search_calls} | {r.outcome.wall_clock_s:.1f} |"
        )
    lines.append("")
    lines.append("## Repo runner logs")
    lines.append("")
    for log_name in ("orbit.log", "atlas.log", "nova.log"):
        log_path = batch_dir / log_name
        if log_path.exists():
            lines.append(f"### {log_name}")
            lines.append("```text")
            lines.append(log_path.read_text(encoding="utf-8", errors="replace")[-12000:])
            lines.append("```")
            lines.append("")

    for r in recs:
        lines.append(f"## Run detail: {r.task_id} / {r.agent.value} / {r.variant.value} / {r.hardening.value}")
        lines.append("")
        lines.append("**Raw prompt:**")
        lines.append(f"> {r.raw_prompt}")
        lines.append("")
        if r.final_prompt != r.raw_prompt:
            lines.append("**Final prompt:**")
            lines.append("```")
            lines.append(r.final_prompt[:4000])
            lines.append("```")
            lines.append("")
        lines.append("```json")
        lines.append(r.to_json())
        lines.append("```")
        lines.append("")

    md_path = batch_dir / "FULL_REPORT.md"
    md_path.write_text("\n".join(lines), encoding="utf-8")

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfgen import canvas

        pdf_path = batch_dir / "FULL_REPORT.pdf"
        c = canvas.Canvas(str(pdf_path), pagesize=A4)
        w, h = A4
        y = h - 40
        c.setFont("Helvetica-Bold", 14)
        c.drawString(40, y, f"PRMPT Benchmark Report — {batch_dir.name}")
        y -= 30
        c.setFont("Helvetica", 9)
        for line in lines[:120]:
            if not line.strip():
                y -= 10
                continue
            if line.startswith("#"):
                y -= 14
                c.setFont("Helvetica-Bold", 10)
                c.drawString(40, y, line.lstrip("# ").strip()[:100])
                c.setFont("Helvetica", 9)
            elif line.startswith("|"):
                c.drawString(40, y, line[:110])
            else:
                c.drawString(40, y, line[:110])
            y -= 12
            if y < 50:
                c.showPage()
                y = h - 40
        c.save()
        print(f"Wrote {pdf_path}")
    except Exception as exc:
        print(f"PDF skipped: {exc}")

    print(f"Wrote {md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
