#!/usr/bin/env python3
"""
Evaluation harness for the Code Intelligence Service `/api/context` endpoint.

Loads a JSON fixture of hand-curated queries, fires each at a running
service, and reports:

  - File Recall@{1,3,5,10}: did any expected_file appear in the top-K
    ranked probable_locations?
  - MRR (mean reciprocal rank) on the first expected_file match.
  - Line IoU: intersection-over-union of the expected_line_range with
    (probable_line_start..probable_line_end) on the first expected match.
  - Total rendered prompt tokens (tiktoken cl100k_base) of the
    [PROBABLE LOCATIONS] block that would be sent to the LLM.
  - Latency p50 / p95 per /api/context call.

Also supports --flag-matrix to A/B the two optional features. That mode
does NOT restart the service; it just notes which flag combination the
service was started under, so you run the script multiple times, once
per deployment, and it compares the last few result files.

Usage:

    python scripts/eval.py \\
        --url http://127.0.0.1:8002 \\
        --token "$AUTH_TOKEN" \\
        --fixture tests/fixtures/ground_truth.json \\
        --out eval_runs/default.json

    # Flag-matrix compare mode (see run_matrix below).
    python scripts/eval.py --compare eval_runs/*.json
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import statistics
import sys
import time
from pathlib import Path
from typing import Any

try:
    import httpx
except ImportError:  # pragma: no cover
    print("httpx is required. pip install httpx", file=sys.stderr)
    sys.exit(2)

try:
    import tiktoken
    _ENCODER = tiktoken.get_encoding("cl100k_base")
except Exception:  # pragma: no cover - tiktoken optional
    _ENCODER = None


# ── Formatting: must match python-service/pipeline_v2/project_context.py ───
# We duplicate here (not import) so the eval script stays self-contained
# and doesn't depend on the prmpt python package being on PYTHONPATH.

MAX_BODY_PER_CHUNK = 2000
MAX_BODY_PER_CHUNK_MEDIUM = 800
MAX_PROBABLE_IN_CONTEXT = 8
MAX_RELATED_IN_CONTEXT = 8
CONF_HIGH = 0.7
CONF_MEDIUM = 0.4


def _format_line_range(loc: dict) -> str:
    start = loc.get("start_line", 0)
    end = loc.get("end_line", 0)
    pls = loc.get("probable_line_start")
    ple = loc.get("probable_line_end")
    src = loc.get("probable_line_source")
    base = f"lines {start}-{end}"
    if pls and ple and src:
        return f"{base}, likely {pls}-{ple} [{src}]"
    return base


def render_probable_block(probable: list[dict], related: list[dict]) -> str:
    """Subset of _format_probable_locations sufficient for token accounting."""
    lines: list[str] = [
        "[PROBABLE LOCATIONS - auto-retrieved from project index]",
        "These files/lines MAY be relevant to the user's request. "
        "Treat them as hints, not authoritative. Read the code and decide yourself.",
        "",
    ]
    for i, loc in enumerate(probable[:MAX_PROBABLE_IN_CONTEXT]):
        conf = float(loc.get("confidence_score") or 0.0)
        lang = loc.get("language", "") or ""
        lines.append(
            f"[PROBABLE #{i + 1}] {(loc.get('chunk_type') or '').title()}: "
            f"{loc.get('name','?')} ({_format_line_range(loc)}) | confidence {conf:.2f}"
        )
        if loc.get("concepts"):
            lines.append(f"Concepts: {', '.join(loc['concepts'])}")
        if loc.get("semantic_summary"):
            lines.append(f"Summary: {loc['semantic_summary']}")
        if loc.get("probable_issue"):
            lines.append(f"Why: {loc['probable_issue']}")
        if loc.get("branch_diverged"):
            lines.append("Note: modified in current branch")
        body = loc.get("code_body")
        if body and conf >= CONF_HIGH:
            lines.append(f"```{lang}")
            lines.append(body[:MAX_BODY_PER_CHUNK])
            lines.append("```")
        elif body and conf >= CONF_MEDIUM:
            if loc.get("signature"):
                lines.append(f"Signature: {loc['signature']}")
            lines.append(f"```{lang}")
            lines.append(body[:MAX_BODY_PER_CHUNK_MEDIUM])
            lines.append("```")
        elif loc.get("signature"):
            lines.append(f"Signature: {loc['signature']}")
        lines.append("")

    if related:
        lines.append("[RELATED - connected via call graph]")
        for loc in related[:MAX_RELATED_IN_CONTEXT]:
            lines.append(
                f"  {loc.get('file_path')}: {loc.get('name','?')} "
                f"({_format_line_range(loc)})"
            )
            if loc.get("semantic_summary"):
                lines.append(f"    {loc['semantic_summary'][:160]}")
        lines.append("")

    return "\n".join(lines)


def count_tokens(text: str) -> int:
    if _ENCODER is None:
        # Rough char/4 fallback — still useful for relative comparisons.
        return max(1, len(text) // 4)
    return len(_ENCODER.encode(text))


# ── Metrics ─────────────────────────────────────────────────────────────────

def file_recall_at_k(
    expected_files: list[str],
    predicted: list[dict],
    k: int,
) -> bool:
    """True if any expected file path appears in the top-k predictions."""
    top = predicted[:k]
    expected_set = {p.lower() for p in expected_files}
    for p in top:
        fp = (p.get("file_path") or "").lower()
        if fp in expected_set:
            return True
        # Also allow endswith match so short paths in the fixture still hit
        # longer absolute paths in the index.
        for exp in expected_set:
            if fp.endswith(exp) or exp.endswith(fp):
                return True
    return False


def reciprocal_rank(expected_files: list[str], predicted: list[dict]) -> float:
    expected_set = {p.lower() for p in expected_files}
    for i, p in enumerate(predicted, 1):
        fp = (p.get("file_path") or "").lower()
        if fp in expected_set or any(fp.endswith(e) or e.endswith(fp) for e in expected_set):
            return 1.0 / i
    return 0.0


def line_iou(expected: list[int] | None, predicted_first_match: dict | None) -> float | None:
    """IoU on line ranges. Returns None when we have no ground truth range."""
    if not expected or not predicted_first_match:
        return None
    exp_a, exp_b = int(expected[0]), int(expected[1])
    # Prefer narrow window when available; else fall back to envelope.
    pls = predicted_first_match.get("probable_line_start")
    ple = predicted_first_match.get("probable_line_end")
    if pls is None or ple is None:
        pls = predicted_first_match.get("start_line")
        ple = predicted_first_match.get("end_line")
    try:
        pred_a, pred_b = int(pls), int(ple)
    except (TypeError, ValueError):
        return 0.0
    lo = max(exp_a, pred_a)
    hi = min(exp_b, pred_b)
    inter = max(0, hi - lo + 1)
    union = max(exp_b, pred_b) - min(exp_a, pred_a) + 1
    return inter / union if union > 0 else 0.0


def first_expected_match(expected_files: list[str], predicted: list[dict]) -> dict | None:
    expected_set = {p.lower() for p in expected_files}
    for p in predicted:
        fp = (p.get("file_path") or "").lower()
        if fp in expected_set or any(fp.endswith(e) or e.endswith(fp) for e in expected_set):
            return p
    return None


# ── Runner ──────────────────────────────────────────────────────────────────

def run_one(client: httpx.Client, url: str, case: dict, token: str | None) -> dict:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = {
        "project_id": case["project_id"],
        "query": case["query"],
        "limit": MAX_PROBABLE_IN_CONTEXT,
    }
    if case.get("branch"):
        body["branch"] = case["branch"]

    t0 = time.perf_counter()
    try:
        resp = client.post(f"{url}/api/context", json=body, headers=headers, timeout=30.0)
    except Exception as e:
        return {"id": case["id"], "error": str(e), "elapsed_ms": int((time.perf_counter() - t0) * 1000)}
    elapsed_ms = int((time.perf_counter() - t0) * 1000)

    if resp.status_code != 200:
        return {
            "id": case["id"],
            "error": f"status {resp.status_code}",
            "detail": resp.text[:200],
            "elapsed_ms": elapsed_ms,
        }

    data = resp.json()
    probable = data.get("probable_locations", []) or []
    related = data.get("related_locations", []) or []

    block = render_probable_block(probable, related)
    tokens = count_tokens(block)
    matched = first_expected_match(case.get("expected_files", []), probable)

    return {
        "id": case["id"],
        "query": case["query"],
        "project_id": case["project_id"],
        "expected_files": case.get("expected_files", []),
        "predicted_files": [p.get("file_path") for p in probable],
        "predicted_lines": [
            (p.get("start_line"), p.get("end_line"), p.get("probable_line_start"), p.get("probable_line_end"))
            for p in probable
        ],
        "recall@1":  file_recall_at_k(case.get("expected_files", []), probable, 1),
        "recall@3":  file_recall_at_k(case.get("expected_files", []), probable, 3),
        "recall@5":  file_recall_at_k(case.get("expected_files", []), probable, 5),
        "recall@10": file_recall_at_k(case.get("expected_files", []), probable, 10),
        "mrr": reciprocal_rank(case.get("expected_files", []), probable),
        "line_iou": line_iou(case.get("expected_line_range"), matched),
        "tokens": tokens,
        "elapsed_ms": elapsed_ms,
        "intent_actual": data.get("intent"),
        "intent_expected": case.get("expected_intent"),
        "intent_match": (data.get("intent") == case.get("expected_intent"))
            if case.get("expected_intent") else None,
        "concepts_actual": data.get("concepts", []),
        "concepts_expected": case.get("expected_concepts", []),
        "concepts_hit": bool(
            set(data.get("concepts") or []) & set(case.get("expected_concepts") or [])
        ) if case.get("expected_concepts") else None,
    }


def aggregate(results: list[dict]) -> dict:
    ok = [r for r in results if "error" not in r]
    if not ok:
        return {"n": len(results), "failures": len(results)}
    def _mean(vals: list[float]) -> float:
        return statistics.mean(vals) if vals else 0.0
    iou_vals = [r["line_iou"] for r in ok if r.get("line_iou") is not None]
    ints = [r["intent_match"] for r in ok if r.get("intent_match") is not None]
    cmatches = [r["concepts_hit"] for r in ok if r.get("concepts_hit") is not None]
    latencies = [r["elapsed_ms"] for r in ok]
    return {
        "n": len(ok),
        "failures": len(results) - len(ok),
        "recall@1":  _mean([1.0 if r["recall@1"] else 0.0 for r in ok]),
        "recall@3":  _mean([1.0 if r["recall@3"] else 0.0 for r in ok]),
        "recall@5":  _mean([1.0 if r["recall@5"] else 0.0 for r in ok]),
        "recall@10": _mean([1.0 if r["recall@10"] else 0.0 for r in ok]),
        "mrr": _mean([r["mrr"] for r in ok]),
        "line_iou_mean": _mean(iou_vals) if iou_vals else None,
        "line_iou_n": len(iou_vals),
        "intent_accuracy": _mean([1.0 if v else 0.0 for v in ints]) if ints else None,
        "concepts_hit_rate": _mean([1.0 if v else 0.0 for v in cmatches]) if cmatches else None,
        "tokens_mean": _mean([r["tokens"] for r in ok]),
        "tokens_p95": statistics.quantiles(sorted([r["tokens"] for r in ok]), n=20)[-1] if len(ok) >= 20 else max(r["tokens"] for r in ok),
        "latency_p50_ms": statistics.median(latencies),
        "latency_p95_ms": sorted(latencies)[int(0.95 * (len(latencies) - 1))] if latencies else 0,
    }


def print_markdown(summary: dict, results: list[dict]) -> None:
    print("## Retrieval Eval Summary")
    print()
    print("| metric | value |")
    print("|---|---|")
    for k, v in summary.items():
        if isinstance(v, float):
            print(f"| {k} | {v:.3f} |")
        else:
            print(f"| {k} | {v} |")
    print()
    print("## Per-case (first 30)")
    print()
    print("| id | r@1 | r@3 | r@5 | MRR | IoU | tokens | ms |")
    print("|---|---|---|---|---|---|---|---|")
    for r in results[:30]:
        if "error" in r:
            print(f"| {r['id']} | ERR | ERR | ERR | ERR | ERR | - | {r.get('elapsed_ms','?')} |")
            continue
        iou = r.get("line_iou")
        iou_str = f"{iou:.2f}" if isinstance(iou, (int, float)) else "-"
        print(
            f"| {r['id']} | "
            f"{'Y' if r['recall@1'] else 'N'} | "
            f"{'Y' if r['recall@3'] else 'N'} | "
            f"{'Y' if r['recall@5'] else 'N'} | "
            f"{r['mrr']:.2f} | {iou_str} | {r['tokens']} | {r['elapsed_ms']} |"
        )


def compare_runs(paths: list[str]) -> None:
    """Print a side-by-side summary table for multiple saved runs."""
    runs = []
    for p in paths:
        try:
            with open(p) as f:
                data = json.load(f)
            runs.append((Path(p).name, data.get("summary", {}), data.get("flags", {})))
        except Exception as e:
            print(f"# failed to read {p}: {e}", file=sys.stderr)
    if not runs:
        return
    keys = list({k for _, s, _ in runs for k in s.keys()})
    print("## Matrix compare")
    print()
    header = "| run | flags | " + " | ".join(keys) + " |"
    print(header)
    print("|" + "---|" * (2 + len(keys)))
    for name, s, f in runs:
        flags_str = ",".join(f"{k}={v}" for k, v in sorted(f.items())) or "-"
        row = [name, flags_str]
        for k in keys:
            v = s.get(k)
            row.append(f"{v:.3f}" if isinstance(v, float) else str(v))
        print("| " + " | ".join(row) + " |")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("CODE_INTELLIGENCE_SERVICE_URL", "http://127.0.0.1:8002"))
    ap.add_argument("--token", default=os.environ.get("CODE_INTEL_AUTH_TOKEN"))
    ap.add_argument("--fixture", default=str(Path(__file__).parent.parent / "tests" / "fixtures" / "ground_truth.json"))
    ap.add_argument("--out", default=None, help="write JSON results to this path")
    ap.add_argument("--project-map", default=None, help='optional JSON dict {"TEST_PROJECT_A":"<uuid>",...} to substitute placeholder project_ids')
    ap.add_argument("--compare", nargs="+", help="compare mode: print a matrix table over saved run JSON files and exit")
    args = ap.parse_args()

    if args.compare:
        compare_runs([g for p in args.compare for g in glob.glob(p)])
        return 0

    with open(args.fixture) as f:
        fixture = json.load(f)
    cases = fixture.get("cases", [])
    if not cases:
        print("No cases in fixture", file=sys.stderr)
        return 1

    project_map: dict[str, str] = {}
    if args.project_map:
        project_map = json.loads(args.project_map) if args.project_map.startswith("{") else json.load(open(args.project_map))
        for c in cases:
            if c["project_id"] in project_map:
                c["project_id"] = project_map[c["project_id"]]

    # Capture which feature flags the server is (presumably) running under so
    # `--compare` can label rows. We read them from the env the eval script
    # sees, which must match the deployed service for the label to be useful.
    flags = {
        "ENABLE_SUB_FUNCTION_CHUNKS": os.environ.get("ENABLE_SUB_FUNCTION_CHUNKS", "false"),
        "ENABLE_LLM_PINPOINT": os.environ.get("ENABLE_LLM_PINPOINT", "false"),
    }

    print(f"# eval: {len(cases)} cases, url={args.url}, flags={flags}", file=sys.stderr)

    results: list[dict] = []
    with httpx.Client() as client:
        for case in cases:
            r = run_one(client, args.url, case, args.token)
            if "error" in r:
                print(f"! {case['id']}: {r['error']}", file=sys.stderr)
            else:
                print(f"- {case['id']}: r@1={r['recall@1']} mrr={r['mrr']:.2f} tokens={r['tokens']} {r['elapsed_ms']}ms", file=sys.stderr)
            results.append(r)

    summary = aggregate(results)
    payload = {"flags": flags, "summary": summary, "results": results}

    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        with open(args.out, "w") as f:
            json.dump(payload, f, indent=2)
        print(f"wrote {args.out}", file=sys.stderr)

    print_markdown(summary, results)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
