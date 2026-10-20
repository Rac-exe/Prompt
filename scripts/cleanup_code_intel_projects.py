"""
Code-intel project registry maintenance.

Over time the local code-intel store accumulates dead project entries:
  - EMPTY:      registered but never indexed (0 chunks)
  - ERROR:      index_status == 'error' and no usable data
  - DUPLICATE:  the same project name indexed more than once (older copies)

This utility classifies every project directory under
<code-intel-root>/projects/<uuid>/index.db and can prune the dead ones.

SAFE BY DEFAULT: runs as a dry-run and only PRINTS what it would do. Nothing is
deleted unless you pass --apply (empty/error dirs) and/or --apply-duplicates
(older copies of duplicated names, keeping the most recently indexed one).

Usage (from repo root):
  python scripts/cleanup_code_intel_projects.py                 # dry-run
  python scripts/cleanup_code_intel_projects.py --apply         # delete empty/error
  python scripts/cleanup_code_intel_projects.py --apply --apply-duplicates
  python scripts/cleanup_code_intel_projects.py --root "C:/path/to/code-intel"
"""

from __future__ import annotations

import argparse
import glob
import os
import shutil
import sqlite3
from collections import defaultdict

DEFAULT_ROOT = os.environ.get(
    "CODE_INTEL_DB_ROOT",
    os.path.join(os.environ.get("APPDATA", ""), "prompt-optimizer", "code-intel"),
)


def _scalar(conn: sqlite3.Connection, sql: str, default=0):
    try:
        row = conn.execute(sql).fetchone()
        return row[0] if row and row[0] is not None else default
    except Exception:
        return default


def inspect(db_path: str) -> dict:
    uid = os.path.basename(os.path.dirname(db_path))
    info = {"uid": uid, "db": db_path, "name": None, "status": "?", "chunks": 0,
            "edges": 0, "last_indexed": None, "dims": None}
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        try:
            row = conn.execute("SELECT * FROM projects_local LIMIT 1").fetchone()
            if row:
                d = dict(row)
                info["name"] = d.get("name")
                info["status"] = d.get("index_status") or d.get("status") or "?"
                info["last_indexed"] = d.get("last_indexed_at") or d.get("updated_at")
                info["dims"] = d.get("embedding_dimensions")
        except Exception:
            pass
        info["chunks"] = _scalar(conn, "SELECT COUNT(*) FROM code_chunks")
        info["edges"] = _scalar(conn, "SELECT COUNT(*) FROM code_relationships")
        conn.close()
    except Exception as e:
        info["error"] = str(e)[:160]
    return info


def classify(rows: list[dict]) -> dict[str, list[dict]]:
    buckets: dict[str, list[dict]] = {"empty": [], "error": [], "ok": []}
    for r in rows:
        if r["chunks"] == 0:
            if str(r["status"]).lower() == "error":
                buckets["error"].append(r)
            else:
                buckets["empty"].append(r)
        else:
            buckets["ok"].append(r)
    return buckets


def find_duplicates(ok_rows: list[dict]) -> list[dict]:
    """Return older duplicates (keep the most recently indexed per name)."""
    by_name: dict[str, list[dict]] = defaultdict(list)
    for r in ok_rows:
        key = (r["name"] or r["uid"]).strip().lower()
        by_name[key].append(r)
    older: list[dict] = []
    for name, group in by_name.items():
        if len(group) < 2:
            continue
        group_sorted = sorted(group, key=lambda r: str(r["last_indexed"] or ""), reverse=True)
        keep = group_sorted[0]
        for r in group_sorted[1:]:
            r["_keep_instead"] = keep["uid"]
            older.append(r)
    return older


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=DEFAULT_ROOT)
    ap.add_argument("--apply", action="store_true", help="delete EMPTY and ERROR project dirs")
    ap.add_argument("--apply-duplicates", action="store_true", help="delete older duplicate-name dirs")
    args = ap.parse_args()

    projects_dir = os.path.join(args.root, "projects")
    dbs = sorted(glob.glob(os.path.join(projects_dir, "*", "index.db")))
    if not dbs:
        print(f"No project DBs found under {projects_dir!r}")
        return

    rows = [inspect(db) for db in dbs]
    buckets = classify(rows)
    duplicates = find_duplicates(buckets["ok"])

    print(f"Root: {args.root}")
    print(f"Found {len(rows)} project(s)\n" + "=" * 72)
    for r in rows:
        tag = "OK"
        if r in buckets["empty"]:
            tag = "EMPTY"
        elif r in buckets["error"]:
            tag = "ERROR"
        elif r in duplicates:
            tag = f"DUPLICATE (keep {r['_keep_instead'][:8]})"
        print(f"[{tag:>22}] {r['uid'][:8]}  name={r['name']!r:24} status={r['status']:8} "
              f"chunks={r['chunks']:>5} edges={r['edges']:>5} dims={r['dims']} indexed={r['last_indexed']}")

    to_delete: list[dict] = []
    if args.apply:
        to_delete += buckets["empty"] + buckets["error"]
    if args.apply_duplicates:
        to_delete += duplicates

    print("=" * 72)
    if not to_delete:
        print("Dry-run (no deletions). Re-run with --apply and/or --apply-duplicates to prune.")
        return

    for r in to_delete:
        proj_dir = os.path.dirname(r["db"])
        try:
            shutil.rmtree(proj_dir)
            print(f"DELETED {r['uid'][:8]} ({r['name']!r}) -> {proj_dir}")
        except Exception as e:
            print(f"FAILED  {r['uid'][:8]}: {e}")


if __name__ == "__main__":
    main()
