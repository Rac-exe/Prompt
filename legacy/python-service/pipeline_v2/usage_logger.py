"""
usage_logger.py — Silent backend token + cost tracking for pipeline_v2.

Appends one JSON record per LLM call to:
    pipeline_v2/storage/usage/YYYY-MM-DD.jsonl

Each record:
    {
        "ts":               "2026-03-07T17:54:03Z",
        "session_id":       "abc123",
        "call_type":        "optimizer" | "summarizer",
        "model":            "claude-3-5-haiku",
        "skills":           ["technical", "creative"],
        "prompt_tokens":    412,
        "completion_tokens": 198,
        "total_tokens":     610,
        "latency_ms":       1340,
        "cost_usd":         0.00142
    }

COMPLETELY SILENT — no output to user stdout.

Run report:
    python -m pipeline_v2.usage_logger          # last 7 days
    python -m pipeline_v2.usage_logger 15       # last 15 days
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

# ── Storage root ──────────────────────────────────────────────────────────────
USAGE_DIR = Path(__file__).parent / "storage" / "usage"


# ── Cost table (USD per 1M tokens) ───────────────────────────────────────────
# Keys match the model string stored in the log (stripped of provider prefix).
# Add new models here as you onboard them.
COST_TABLE: dict[str, dict[str, float]] = {
    # Anthropic
    "claude-3-5-haiku-20241022":      {"in": 0.80,  "out": 4.00},
    "claude-3-5-haiku":               {"in": 0.80,  "out": 4.00},
    "claude-haiku-4-5-20251001":      {"in": 0.80,  "out": 4.00},
    "claude-3-5-sonnet-20241022":     {"in": 6.00,  "out": 30.00},
    "claude-3-5-sonnet":              {"in": 6.00,  "out": 30.00},
    "claude-sonnet-4-5-20250929":     {"in": 6.00,  "out": 30.00},
    # OpenAI
    "gpt-4o":                         {"in": 5.00,  "out": 15.00},
    "gpt-4o-mini":                    {"in": 0.15,  "out": 0.60},
    "gpt-5.1":                        {"in": 2.00,  "out": 8.00},
    # DeepSeek
    "deepseek-chat":                  {"in": 0.14,  "out": 0.28},
    "deepseek/deepseek-chat":         {"in": 0.14,  "out": 0.28},
    # Google
    "gemini-2.5-flash":               {"in": 0.30,  "out": 2.50},
    "gemini/gemini-2.5-flash":        {"in": 0.30,  "out": 2.50},
    "gemini-flash-2.0":               {"in": 0.075, "out": 0.30},
}


def _estimate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    """Return estimated USD cost. Returns 0.0 if model not in cost table."""
    # Strip provider prefixes like "openai/", "openrouter/anthropic/", etc.
    stripped = model.split("/")[-1]
    rates = COST_TABLE.get(model) or COST_TABLE.get(stripped)
    if not rates:
        return 0.0
    return (prompt_tokens * rates["in"] + completion_tokens * rates["out"]) / 1_000_000


# ─────────────────────────────────────────────────────────────────────────────
# Core logging function — SILENT (no print, no visible output)
# ─────────────────────────────────────────────────────────────────────────────

def log_usage(
    call_type: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int,
    session_id: Optional[str] = None,
    skills: Optional[List[str]] = None,
    latency_ms: Optional[int] = None,
) -> None:
    """
    Append a usage record to today's JSONL log. Completely silent to user.

    Args:
        call_type:         "optimizer" or "summarizer"
        model:             exact model name used
        prompt_tokens:     input token count
        completion_tokens: output token count
        total_tokens:      combined total
        session_id:        session identifier
        skills:            list of skill names selected (e.g. ["technical"])
        latency_ms:        wall-clock time for the LLM call in milliseconds
    """
    try:
        now = datetime.now(timezone.utc)
        cost = _estimate_cost(model, prompt_tokens, completion_tokens)

        record = {
            "ts":               now.isoformat(timespec="seconds").replace("+00:00", "Z"),
            "session_id":       session_id or "unknown",
            "call_type":        call_type,
            "model":            model,
            "skills":           skills or [],
            "prompt_tokens":    prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens":     total_tokens,
            "latency_ms":       latency_ms,
            "cost_usd":         round(cost, 8),
        }

        USAGE_DIR.mkdir(parents=True, exist_ok=True)
        log_file = USAGE_DIR / f"{now.strftime('%Y-%m-%d')}.jsonl"

        with log_file.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")

    except Exception as _log_err:
        import sys
        print(f"[UsageLogger] write failed: {_log_err}", file=sys.stderr)


# ─────────────────────────────────────────────────────────────────────────────
# Report — run via:  python -m pipeline_v2.usage_logger [days]
# ─────────────────────────────────────────────────────────────────────────────

def _parse_records(file: Path) -> list[dict]:
    records = []
    for line in file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return records


def report(last_n_days: int = 7) -> None:
    """Print a usage + cost report to stdout (admin-only command)."""
    files = sorted(USAGE_DIR.glob("*.jsonl"))[-last_n_days:]

    if not files:
        print("No usage logs found.")
        return

    by_day:        dict[str, dict] = defaultdict(lambda: {"tokens": 0, "cost": 0.0, "calls": 0})
    by_model:      dict[str, dict] = defaultdict(lambda: {"tokens": 0, "cost": 0.0, "calls": 0})
    by_call_type:  dict[str, dict] = defaultdict(lambda: {"tokens": 0, "cost": 0.0, "calls": 0})
    by_skill:      dict[str, int]  = defaultdict(int)
    latencies:     list[int]       = []
    grand_tokens   = 0
    grand_cost     = 0.0
    grand_calls    = 0

    for f in files:
        day = f.stem
        for r in _parse_records(f):
            t = r.get("total_tokens", 0)
            c = r.get("cost_usd", 0.0)
            ct = r.get("call_type", "?")
            m = r.get("model", "?")

            by_day[day]["tokens"] += t
            by_day[day]["cost"]   += c
            by_day[day]["calls"]  += 1

            by_model[m]["tokens"] += t
            by_model[m]["cost"]   += c
            by_model[m]["calls"]  += 1

            by_call_type[ct]["tokens"] += t
            by_call_type[ct]["cost"]   += c
            by_call_type[ct]["calls"]  += 1

            for skill in r.get("skills", []):
                by_skill[skill] += 1

            if r.get("latency_ms"):
                latencies.append(r["latency_ms"])

            grand_tokens += t
            grand_cost   += c
            grand_calls  += 1

    W = 62
    print("=" * W)
    print(f"  TOKEN + COST REPORT  (last {last_n_days} days)")
    print("=" * W)

    print("\n── By Day ──────────────────────────────────────────────────")
    for day in sorted(by_day):
        d = by_day[day]
        bar = "█" * min(d["tokens"] // 500, 20)
        print(f"  {day}  {d['tokens']:>8,} tokens  ${d['cost']:.4f}  {d['calls']} calls  {bar}")

    print("\n── By Model ────────────────────────────────────────────────")
    for model, d in sorted(by_model.items(), key=lambda x: -x[1]["cost"]):
        print(f"  {model:<38} {d['tokens']:>7,} tok  ${d['cost']:.4f}  {d['calls']} calls")

    print("\n── By Call Type ────────────────────────────────────────────")
    for ctype, d in sorted(by_call_type.items(), key=lambda x: -x[1]["cost"]):
        print(f"  {ctype:<20} {d['tokens']:>8,} tokens  ${d['cost']:.4f}  {d['calls']} calls")

    print("\n── By Skill (optimizer requests) ───────────────────────────")
    for skill, count in sorted(by_skill.items(), key=lambda x: -x[1]):
        print(f"  {skill:<25} {count:>5} requests")

    if latencies:
        avg_ms = sum(latencies) / len(latencies)
        print(f"\n── Latency ─────────────────────────────────────────────────")
        print(f"  Avg: {avg_ms:.0f}ms  |  Min: {min(latencies)}ms  |  Max: {max(latencies)}ms")

    print("\n" + "─" * W)
    print(f"  Total calls  : {grand_calls:,}")
    print(f"  Total tokens : {grand_tokens:,}")
    print(f"  Total cost   : ${grand_cost:.4f}  (~${grand_cost * 30 / last_n_days:.2f}/month projected)")
    print("=" * W)


if __name__ == "__main__":
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    report(last_n_days=days)
