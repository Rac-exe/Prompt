"""
Quick retrieval test script.
Run: python test_retrieve.py
"""

import json
import urllib.request
import urllib.error
import time

BASE_URL = "http://localhost:8002"
PROJECT_ID = "c6cb5168-b909-41bf-890b-68407594bb69"

QUERIES = [
    ("user login controller",         "find"),
    ("register new user",             "find"),
    ("how does authentication work",  "ask"),
    ("token validation failing",      "bug"),
]


def post(endpoint: str, payload: dict) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{BASE_URL}{endpoint}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def print_result(resp: dict) -> None:
    print(f"\n  mode={resp['mode']}  elapsed={resp['elapsed_ms']}ms  "
          f"results={resp['total_results']}  intent={resp['query_intent']}")
    print(f"  timing: {resp['timing']}")
    for chunk in resp["results"]:
        scores = chunk["scores"]
        print(
            f"  #{chunk['rank']:>2}  {chunk['similarity_pct']:5.1f}%  "
            f"{chunk['file_path']}  [{chunk['name']}]  "
            f"L{chunk['start_line']}-{chunk['end_line']}"
        )
        score_parts = []
        for k in ("rrf_score", "rerank_score", "structure_similarity", "_find_raw"):
            if k in scores:
                score_parts.append(f"{k}={scores[k]:.3f}")
        if score_parts:
            print(f"       └─ {' | '.join(score_parts)}")


if __name__ == "__main__":
    print(f"Target: {BASE_URL}")
    print(f"Project: {PROJECT_ID}\n")

    for query, mode in QUERIES:
        print(f"{'─'*60}")
        print(f"Query : {query!r}")
        print(f"Mode  : {mode}")
        try:
            resp = post("/api/debug/retrieve", {
                "project_id": PROJECT_ID,
                "query": query,
                "mode": mode,
                "limit": 10,
            })
            print_result(resp)
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            print(f"  ERROR {e.code}: {body}")
        except Exception as e:
            print(f"  ERROR: {e}")

    print(f"\n{'─'*60}")
    print("Done.")
