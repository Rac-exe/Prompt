#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import select
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def log_call(record: dict) -> None:
    path = os.environ.get("CLEAN_MCP_CALL_LOG")
    if not path:
        return
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with Path(path).open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def main() -> int:
    clean_python = os.environ["CLEAN_MCP_PYTHON"]
    clean_cwd = os.environ.get("CLEAN_MCP_CWD", str(Path(clean_python).parents[1]))
    proc = subprocess.Popen(
        [clean_python, "-m", "clean.local.mcp_server"],
        cwd=clean_cwd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={**os.environ, "CLEAN_SHOW_PROGRESS_BAR": "false"},
    )

    while True:
        ready, _, _ = select.select([sys.stdin.buffer, proc.stdout, proc.stderr], [], [])
        if sys.stdin.buffer in ready:
            line = sys.stdin.buffer.readline()
            if not line:
                break
            try:
                msg = json.loads(line)
                if msg.get("method") == "tools/call":
                    params = msg.get("params") or {}
                    log_call({
                        "ts": datetime.now(timezone.utc).isoformat(),
                        "tool": params.get("name"),
                        "arguments": params.get("arguments"),
                    })
            except Exception:
                pass
            proc.stdin.write(line)
            proc.stdin.flush()
        if proc.stdout in ready:
            line = proc.stdout.readline()
            if not line:
                break
            sys.stdout.buffer.write(line)
            sys.stdout.buffer.flush()
        if proc.stderr in ready:
            line = proc.stderr.readline()
            if line:
                sys.stderr.buffer.write(line)
                sys.stderr.buffer.flush()

    proc.terminate()
    try:
        proc.wait(timeout=2)
    except subprocess.TimeoutExpired:
        proc.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
