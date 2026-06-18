"""
Reranker speed & quality test.
Validates that ASK/BUG modes run fast (local ONNX reranker, no agentic loop)
and that scores are real cross-encoder values (not synthetic 5%-step scores).

Run: python test_reranker_speed.py
"""

import json
import urllib.request
import time

BASE_URL = "http://127.0.0.1:8002"
PROJECT_ID = "c6cb5168-b909-41bf-890b-68407594bb69"

CASES = [
    # (query, mode, max_expected_ms, min_real_results)
    ("how does authentication work",            "ask",      5000,   5),
    ("token validation failing",                "bug",      5000,   5),
    ("video upload not working",                "bug",      5000,   3),
    ("how does playlist creation work",         "ask",      5000,   3),
    ("password change flow",                    "ask",      5000,   3),
]

PASS = "\033[92m✓\033[0m"
WARN = "\033[93m~\033[0m"
FAIL = "\033[91m✗\033[0m"


def post(payload: dict, timeout: int = 30) -> dict:
    # Always disable answer generation — we want pure retrieval+reranker latency
    payload.setdefault("generate_answer", False)
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/api/debug/retrieve",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def is_synthetic_scores(results: list) -> bool:
    """Detect the agentic loop's synthetic 5%-step scores (100/95/90...)."""
    if len(results) < 3:
        return False
    pcts = [r["similarity_pct"] for r in results[:5]]
    diffs = [round(pcts[i] - pcts[i+1], 1) for i in range(len(pcts)-1)]
    return all(abs(d - 5.0) < 0.5 for d in diffs)


def run():
    print(f"Target : {BASE_URL}")
    print(f"Project: {PROJECT_ID}")
    print(f"{'─'*75}")
    print(f"  {'Status':<6} {'Query':<42} {'Mode':<5} {'Time':>7}  {'Scores'}")
    print(f"{'─'*75}")

    passed = failed = warned = 0

    for query, mode, max_ms, min_results in CASES:
        t0 = time.perf_counter()
        try:
            resp = post({"project_id": PROJECT_ID, "query": query, "mode": mode, "limit": 10})
        except Exception as e:
            print(f"  {FAIL}  [{query[:40]}]  ERROR: {e}")
            failed += 1
            continue

        elapsed_ms = (time.perf_counter() - t0) * 1000
        results = resp.get("results", [])
        synthetic = is_synthetic_scores(results)

        speed_ok = elapsed_ms <= max_ms
        count_ok = len(results) >= min_results
        reranker_ok = not synthetic  # real scores = local reranker ran

        if speed_ok and count_ok and reranker_ok:
            status = PASS
            passed += 1
        elif not speed_ok:
            status = FAIL if elapsed_ms > max_ms * 3 else WARN
            if elapsed_ms > max_ms * 3:
                failed += 1
            else:
                warned += 1
        else:
            status = WARN
            warned += 1

        # Show top-3 actual scores to confirm real reranker output
        top_scores = []
        for r in results[:3]:
            s = r["scores"]
            score = s.get("rerank_score") or s.get("final_score") or s.get("_find_raw")
            if score is not None:
                top_scores.append(f"{score:.3f}")

        score_type = "SYNTHETIC(agentic?)" if synthetic else "real"
        speed_flag = "" if speed_ok else f"  ⚠ SLOW (limit={max_ms}ms)"

        print(
            f"  {status}  {query[:40]:<42} {mode:<5} {elapsed_ms:>6.0f}ms  "
            f"[{', '.join(top_scores)}] {score_type}{speed_flag}"
        )
        if not reranker_ok:
            print(f"       ⚠ synthetic 5%-step scores detected — agentic loop may still be active")

    print(f"{'─'*75}")
    print(f"Results: {passed} passed  {warned} warned  {failed} failed")
    if warned or failed:
        print("\nIf timings are >5s or scores are synthetic:")
        print("  1. Confirm AGENTIC_RETRIEVAL_ENABLED=false in .env")
        print("  2. Restart the server to pick up the env change")
        print("  3. Check server logs for 'Local reranker ready'")


if __name__ == "__main__":
    run()
