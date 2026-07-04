"""
OpenRouter cost reconciliation.

PRMPT's own spend (indexing, optimizer, agentic loop) goes through OpenRouter.
The streamed `usage.cost` and litellm's local `completion_cost()` are ESTIMATES
and can be up to ~4x under the real billed amount on tier-priced models. The
authoritative figure is the per-generation record:

    GET https://openrouter.ai/api/v1/generation?id=<gen_id>  ->  data.total_cost

This module takes the generation ids captured during a run and overwrites the
estimated PRMPT cost with the authoritative billed total. Run it after a batch
(the generation endpoint is eventually-consistent, so a short delay helps).

Usage:
    python -m benchmarks.reconcile --results ./results/<batch>
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

import requests

from benchmarks.metrics import RunRecord

_GEN_URL = "https://openrouter.ai/api/v1/generation"


def fetch_generation_cost(gen_id: str, api_key: str, retries: int = 5, backoff: float = 1.5) -> float | None:
    """Return authoritative total_cost for a generation id, or None if unavailable."""
    headers = {"Authorization": f"Bearer {api_key}"}
    for attempt in range(retries):
        try:
            r = requests.get(_GEN_URL, params={"id": gen_id}, headers=headers, timeout=20)
            if r.status_code == 404:
                # Not yet consistent; wait and retry.
                time.sleep(backoff ** attempt)
                continue
            r.raise_for_status()
            data = r.json().get("data") or {}
            cost = data.get("total_cost")
            if cost is not None:
                return float(cost)
        except (requests.RequestException, ValueError):
            time.sleep(backoff ** attempt)
    return None


def reconcile_record(rec: RunRecord, api_key: str) -> RunRecord:
    """Replace estimated PRMPT cost with authoritative OpenRouter totals.

    We can only attribute the authoritative total to a single bucket without
    per-id stage tagging, so the reconciled total lands in agent_loop_cost_usd
    as the catch-all PRMPT cost and the per-stage estimates are zeroed except
    where the run already split them. The report only uses prmpt total_cost_usd.
    """
    ids = rec.prmpt_usage.generation_ids
    if not ids:
        rec.prmpt_usage.reconciled = True
        return rec

    total = 0.0
    missing = 0
    for gid in ids:
        c = fetch_generation_cost(gid, api_key)
        if c is None:
            missing += 1
            continue
        total += c

    if missing == 0 or total > 0:
        # Collapse authoritative total into one bucket; estimates were per-stage.
        rec.prmpt_usage.index_cost_usd = 0.0
        rec.prmpt_usage.optimize_cost_usd = 0.0
        rec.prmpt_usage.agent_loop_cost_usd = round(total, 6)
    rec.prmpt_usage.reconciled = (missing == 0)
    return rec


def reconcile_batch(results_dir: Path, api_key: str) -> int:
    files = sorted(results_dir.glob("*.json"))
    n = 0
    for f in files:
        try:
            rec = RunRecord.from_dict(json.loads(f.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, KeyError):
            continue
        if rec.prmpt_usage.reconciled:
            continue
        rec = reconcile_record(rec, api_key)
        f.write_text(rec.to_json(), encoding="utf-8")
        n += 1
    return n


def main() -> None:
    ap = argparse.ArgumentParser(description="Reconcile PRMPT OpenRouter costs.")
    ap.add_argument("--results", required=True, help="batch results dir")
    ap.add_argument("--api-key-env", default="OPENROUTER_API_KEY")
    args = ap.parse_args()

    api_key = os.environ.get(args.api_key_env, "")
    if not api_key:
        raise SystemExit(f"{args.api_key_env} not set")

    results_dir = Path(args.results)
    if not results_dir.is_dir():
        raise SystemExit(f"not a directory: {results_dir}")

    n = reconcile_batch(results_dir, api_key)
    print(f"reconciled {n} records in {results_dir}")


if __name__ == "__main__":
    main()
