"""
FIND mode precision test — validates that exact function names return the correct
backend implementation as #1, and that the result actually exists in the source.

Ground truth is derived from:
  C:/Users/aarus/OneDrive/Desktop/chai-backend-main/chai-backend-main/src/

Run: python test_find_functions.py
"""

import json
import urllib.request
import urllib.error
import time
import os

BASE_URL = "http://127.0.0.1:8002"
PROJECT_ID = "c6cb5168-b909-41bf-890b-68407594bb69"
SOURCE_ROOT = r"C:\Users\aarus\OneDrive\Desktop\chai-backend-main\chai-backend-main\src"

# (query, expected_file_fragment, expected_function_name)
# expected_file_fragment: substring that must appear in the #1 result's file_path
FIND_CASES = [
    ("loginUser",                   "controllers/user.controller",  "loginUser"),
    ("registerUser",                "controllers/user.controller",  "registerUser"),
    ("verifyJWT",                   "middlewares/auth.middleware",   "verifyJWT"),
    ("refreshAccessToken",          "controllers/user.controller",  "refreshAccessToken"),
    ("publishVideo",                "controllers/video.controller", "publishVideo"),
    ("toggleSubscription",          "controllers/subscription",     "toggleSubscription"),
    ("createPlaylist",              "controllers/playlist",         "createPlaylist"),
    ("toggleVideoLike",             "controllers/like",             "toggleVideoLike"),
    ("getUserChannelProfile",       "controllers/user.controller",  "getUserChannelProfile"),
    ("changeCurrentPassword",       "controllers/user.controller",  "changeCurrentPassword"),
]


def post(payload: dict, timeout: int = 30) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/api/debug/retrieve",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def verify_source_file(file_fragment: str, func_name: str, start_line: int, end_line: int) -> tuple[bool, str]:
    """Check that func_name actually exists at the claimed lines in the source."""
    # Find matching file in source root
    for root, _, files in os.walk(SOURCE_ROOT):
        for f in files:
            full = os.path.join(root, f)
            norm = full.replace("\\", "/")
            if file_fragment.replace("\\", "/") in norm:
                try:
                    with open(full, encoding="utf-8", errors="replace") as fh:
                        lines = fh.readlines()
                    snippet = "".join(lines[max(0, start_line - 1):end_line])
                    found = func_name in snippet
                    return found, f"({os.path.relpath(full, SOURCE_ROOT)})"
                except Exception as e:
                    return False, f"read error: {e}"
    return False, "file not found in source"


PASS = "\033[92m✓\033[0m"
FAIL = "\033[91m✗\033[0m"


def run():
    print(f"Target : {BASE_URL}")
    print(f"Project: {PROJECT_ID}")
    print(f"Source : {SOURCE_ROOT}")
    print(f"{'─'*70}")

    passed = 0
    failed = 0
    total_ms = 0.0

    for query, expected_file, expected_func in FIND_CASES:
        t0 = time.perf_counter()
        try:
            resp = post({"project_id": PROJECT_ID, "query": query, "mode": "find", "limit": 5})
        except Exception as e:
            print(f"  {FAIL}  [{query}]  REQUEST ERROR: {e}")
            failed += 1
            continue

        elapsed = (time.perf_counter() - t0) * 1000
        total_ms += elapsed
        results = resp.get("results", [])

        if not results:
            print(f"  {FAIL}  [{query:35s}]  no results  ({elapsed:.0f}ms)")
            failed += 1
            continue

        top = results[0]
        file_path = top["file_path"].replace("\\", "/")
        name = top["name"]
        start = top["start_line"]
        end = top["end_line"]
        raw = top["scores"].get("_find_raw", 0)

        file_ok = expected_file.replace("\\", "/") in file_path
        name_ok = name.lower() == expected_func.lower()

        # Cross-check against actual source file
        src_ok, src_note = verify_source_file(expected_file, expected_func, start, end)

        status = PASS if (file_ok and name_ok and src_ok) else FAIL
        if file_ok and name_ok and src_ok:
            passed += 1
        else:
            failed += 1

        issues = []
        if not file_ok:
            issues.append(f"file mismatch (got {file_path})")
        if not name_ok:
            issues.append(f"name mismatch (got '{name}', want '{expected_func}')")
        if not src_ok:
            issues.append(f"source check failed {src_note}")

        issue_str = " | ".join(issues) if issues else src_note
        print(
            f"  {status}  [{query:35s}]  "
            f"#{1} {name} @ {file_path.split('/')[-1]} L{start}-{end}  "
            f"raw={raw:.3f}  {elapsed:.0f}ms"
            + (f"\n       issues: {issue_str}" if issues else "")
        )

    print(f"{'─'*70}")
    print(f"Results: {passed}/{passed+failed} passed  |  avg latency: {total_ms/(passed+failed):.0f}ms")


if __name__ == "__main__":
    run()
