"""
PRMPT integration hooks for the benchmark harness.

Two subcommands the runner shells out to:
  - index    : index a repo into the local code-intelligence store
  - optimize : turn a raw prompt into the PRMPT-optimized prompt

Both print ONE JSON line to stdout with this contract (read by the runner):
    {"generation_ids": [...], "tokens": <int>, "cost_usd": <float>, "result": <str|null>}

How generation ids are captured
-------------------------------
PRMPT's LLM calls go through OpenRouter via litellm. To make spend auditable,
the PRMPT services must, when BENCH_MODE=1, surface the OpenRouter generation id
of every call they make for this request. Two supported transports:

  1. Response body: services include a `_bench` block:
         {"_bench": {"generation_ids": [...], "tokens": <int>, "cost_usd": <float>}}
  2. Response header: `x-openrouter-generation-id` (single id per call).

reconcile.py later turns these ids into authoritative billed cost. The cost_usd
printed here is only a local estimate and is overwritten at reconcile time.

This client is transport-only; point PRMPT_INDEX_URL / PRMPT_OPTIMIZE_URL at the
real endpoints (code-intelligence-service + python-service). If an endpoint is
unreachable it exits non-zero so the runner records the cell as a harness error
rather than a fake $0 success.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import requests


def _emit(generation_ids, tokens, cost_usd, result=None) -> None:
    print(json.dumps({
        "generation_ids": list(generation_ids or []),
        "tokens": int(tokens or 0),
        "cost_usd": float(cost_usd or 0.0),
        "result": result,
    }))


def _extract_bench(resp: requests.Response) -> tuple[list[str], int, float]:
    gen_ids: list[str] = []
    tokens = 0
    cost = 0.0
    hdr = resp.headers.get("x-openrouter-generation-id")
    if hdr:
        gen_ids.append(hdr)
    try:
        body = resp.json()
    except ValueError:
        return gen_ids, tokens, cost
    bench = (body or {}).get("_bench") or {}
    gen_ids += list(bench.get("generation_ids") or [])
    tokens = int(bench.get("tokens") or 0)
    cost = float(bench.get("cost_usd") or 0.0)
    return gen_ids, tokens, cost


def cmd_index(args: argparse.Namespace) -> int:
    url = os.environ.get("PRMPT_INDEX_URL")
    if not url:
        print("PRMPT_INDEX_URL not set", file=sys.stderr)
        return 2
    payload = {"repo_path": args.repo, "run_id": args.run_id, "bench": True}
    headers = {"x-bench-run-id": args.run_id}
    r = requests.post(url, json=payload, headers=headers, timeout=args.timeout)
    r.raise_for_status()
    gen_ids, tokens, cost = _extract_bench(r)
    _emit(gen_ids, tokens, cost, result="indexed")
    return 0


def cmd_optimize(args: argparse.Namespace) -> int:
    url = os.environ.get("PRMPT_OPTIMIZE_URL")
    if not url:
        print("PRMPT_OPTIMIZE_URL not set", file=sys.stderr)
        return 2
    payload = {
        "raw_prompt": args.prompt,
        "repo_path": args.repo,
        "run_id": args.run_id,
        "mode": args.mode,
        "bench": True,
    }
    headers = {"x-bench-run-id": args.run_id}
    r = requests.post(url, json=payload, headers=headers, timeout=args.timeout)
    r.raise_for_status()
    gen_ids, tokens, cost = _extract_bench(r)
    body = r.json() if r.content else {}
    optimized = body.get("optimized_prompt") or body.get("result") or args.prompt
    _emit(gen_ids, tokens, cost, result=optimized)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="PRMPT benchmark hooks")
    ap.add_argument("--timeout", type=int, default=300)
    sub = ap.add_subparsers(dest="cmd", required=True)

    pi = sub.add_parser("index")
    pi.add_argument("--repo", required=True)
    pi.add_argument("--run-id", required=True)
    pi.add_argument("--out", default=None)
    pi.set_defaults(func=cmd_index)

    po = sub.add_parser("optimize")
    po.add_argument("--repo", required=True)
    po.add_argument("--prompt", required=True)
    po.add_argument("--run-id", required=True)
    po.add_argument("--mode", default="bug")
    po.add_argument("--out", default=None)
    po.set_defaults(func=cmd_optimize)

    args = ap.parse_args()
    try:
        return args.func(args)
    except requests.RequestException as e:
        print(f"prmpt hook failed: {e}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
