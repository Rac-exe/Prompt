"""
Source validation test — runs a broad set of queries across all modes,
then cross-checks EVERY top-5 result against the actual source files on disk.

For each result it verifies:
  1. The file exists in the source tree
  2. The claimed function name appears at the claimed line range
  3. The line range is within the file's actual length

Run: python test_source_validation.py
"""

import json
import urllib.request
import time
import os
import re

BASE_URL = "http://127.0.0.1:8002"
PROJECT_ID = "c6cb5168-b909-41bf-890b-68407594bb69"
SOURCE_ROOT = r"C:\Users\aarus\OneDrive\Desktop\chai-backend-main"

QUERIES = [
    # (query, mode)
    ("loginUser",                           "find"),
    ("registerUser",                        "find"),
    ("verifyJWT",                           "find"),
    ("toggleSubscription",                  "find"),
    ("publishVideo",                        "find"),
    ("how does video upload work",          "ask"),
    ("subscription model schema",           "find"),
    ("comment on video implementation",     "ask"),
    ("JWT refresh token expired",           "bug"),
    ("avatar upload cloudinary",            "find"),
]

PASS = "\033[92m✓\033[0m"
FAIL = "\033[91m✗\033[0m"
SKIP = "\033[90m-\033[0m"


def post(payload: dict, timeout: int = 30) -> dict:
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


_file_cache: dict[str, list[str]] = {}

def _load_file(path: str) -> list[str] | None:
    if path in _file_cache:
        return _file_cache[path]
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
        _file_cache[path] = lines
        return lines
    except Exception:
        return None


def find_source_file(file_path_fragment: str) -> str | None:
    """Walk source tree and find a file whose path contains the fragment."""
    norm = file_path_fragment.replace("\\", "/").lower()
    # Strip any leading project prefix up to the known subdirs
    for prefix in ("chai-backend-main/", "frontend/"):
        idx = norm.find(prefix)
        if idx != -1:
            norm = norm[idx:]
            break
    for root, _, files in os.walk(SOURCE_ROOT):
        for fname in files:
            full = os.path.join(root, fname)
            full_norm = full.replace("\\", "/").lower()
            if norm in full_norm or full_norm.endswith(norm):
                return full
    return None


def validate_chunk(chunk: dict) -> tuple[str, str]:
    """
    Returns (status, detail):
      status: 'pass', 'fail', 'skip'
    """
    file_path = chunk.get("file_path", "")
    name = chunk.get("name", "")
    start = int(chunk.get("start_line") or 0)
    end = int(chunk.get("end_line") or 0)

    src_file = find_source_file(file_path)
    if src_file is None:
        return "skip", f"source not found for '{file_path}'"

    lines = _load_file(src_file)
    if lines is None:
        return "skip", "could not read source"

    # Check line range is within file
    if end > len(lines) + 5:  # +5 tolerance for off-by-one
        return "fail", f"line range L{start}-{end} exceeds file length {len(lines)}"

    # Check function/symbol name appears somewhere in the claimed range
    snippet = "".join(lines[max(0, start - 1):min(end, len(lines))])
    # For file-level chunks the name is often the filename stem — skip name check
    file_stem = os.path.splitext(os.path.basename(src_file))[0].lower()
    name_lower = name.lower().replace("-", ".").replace("_", ".")
    if name_lower == file_stem or name_lower == file_stem.replace(".", ""):
        return "pass", f"file-level chunk ({os.path.basename(src_file)})"

    # Check if the name appears (case-insensitive) in the snippet
    if re.search(re.escape(name), snippet, re.IGNORECASE):
        return "pass", f"'{name}' found in L{start}-{end}"

    return "fail", f"'{name}' not found in L{start}-{end} of {os.path.basename(src_file)}"


def run():
    print(f"Target : {BASE_URL}")
    print(f"Project: {PROJECT_ID}")
    print(f"Source : {SOURCE_ROOT}")
    print(f"{'─'*75}\n")

    total_chunks = 0
    chunk_pass = chunk_fail = chunk_skip = 0
    query_results = []

    for query, mode in QUERIES:
        t0 = time.perf_counter()
        try:
            resp = post({"project_id": PROJECT_ID, "query": query, "mode": mode, "limit": 5})
        except Exception as e:
            print(f"  Query '{query}' [{mode}] — REQUEST ERROR: {e}\n")
            continue

        elapsed_ms = (time.perf_counter() - t0) * 1000
        results = resp.get("results", [])
        print(f"Query : '{query}'  [{mode}]  {elapsed_ms:.0f}ms  → {len(results)} results")

        q_pass = q_fail = q_skip = 0
        for chunk in results[:5]:
            rank = chunk["rank"]
            fp = chunk["file_path"].replace("\\", "/")
            name = chunk["name"]
            start = chunk["start_line"]
            end = chunk["end_line"]
            pct = chunk["similarity_pct"]

            status, detail = validate_chunk(chunk)

            sym = PASS if status == "pass" else (FAIL if status == "fail" else SKIP)
            print(f"  {sym} #{rank}  {pct:5.1f}%  {fp.split('/')[-1]:35s}  [{name}]  L{start}-{end}")
            if status != "pass":
                print(f"         └─ {detail}")

            total_chunks += 1
            if status == "pass":
                q_pass += 1; chunk_pass += 1
            elif status == "fail":
                q_fail += 1; chunk_fail += 1
            else:
                q_skip += 1; chunk_skip += 1

        query_results.append((query, mode, q_pass, q_fail, q_skip))
        print()

    print(f"{'─'*75}")
    print(f"Chunk validation: {chunk_pass} pass  {chunk_skip} skip  {chunk_fail} FAIL  (of {total_chunks} checked)")
    print()
    print(f"{'Query':<45} {'Mode':<6} {'Pass':>5} {'Fail':>5} {'Skip':>5}")
    print(f"{'─'*70}")
    for q, m, p, f, s in query_results:
        flag = "" if f == 0 else "  ← ISSUES"
        print(f"  {q:<43} {m:<6} {p:>5} {f:>5} {s:>5}{flag}")


if __name__ == "__main__":
    run()
