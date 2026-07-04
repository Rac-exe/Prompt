#!/usr/bin/env python3
"""Smoke-test prompt_mcp_server.py without Claude Code."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


MCP_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = MCP_ROOT.parent
SERVER = MCP_ROOT / "benchmark-runs" / "prompt_mcp_server.py"
CONTEXT = MCP_ROOT / "examples" / "prompt-mcp-context.example.json"
CALL_LOG = MCP_ROOT / "smoke-mcp-calls.jsonl"
TRACE_LOG = MCP_ROOT / "smoke-mcp-trace.jsonl"


def send(proc: subprocess.Popen[str], request: dict) -> dict:
    assert proc.stdin is not None
    assert proc.stdout is not None
    proc.stdin.write(json.dumps(request) + "\n")
    proc.stdin.flush()
    line = proc.stdout.readline()
    if not line:
        stderr = proc.stderr.read() if proc.stderr else ""
        raise RuntimeError(f"MCP server closed stdout. stderr={stderr!r}")
    return json.loads(line)


def main() -> int:
    env = {
        **os.environ,
        "PRMPT_CONTEXT_FILE": str(CONTEXT),
        "PRMPT_MCP_CALL_LOG": str(CALL_LOG),
        "PRMPT_MCP_TRACE_LOG": str(TRACE_LOG),
    }

    for path in (CALL_LOG, TRACE_LOG):
        if path.exists():
            path.unlink()

    proc = subprocess.Popen(
        [sys.executable, "-u", str(SERVER)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(REPO_ROOT),
        env=env,
        text=True,
        bufsize=1,
    )

    try:
        init_resp = send(proc, {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "smoke-test", "version": "0.1.0"},
            },
        })
        print("[ok] initialize:", init_resp.get("result", {}).get("serverInfo", {}))

        proc.stdin.write(
            json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})
            + "\n"
        )
        proc.stdin.flush()

        tools_resp = send(proc, {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {},
        })
        tool_names = [t["name"] for t in tools_resp.get("result", {}).get("tools", [])]
        print("[ok] tools:", tool_names)
        expected = {"prmpt_optimize_task", "prmpt_retrieve_context", "prmpt_get_test_plan"}
        if not expected.issubset(set(tool_names)):
            print("[fail] missing expected tools")
            return 1

        call_resp = send(proc, {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "prmpt_optimize_task",
                "arguments": {
                    "task": "imported workspaces are corrupting lead assignment and workspace visibility, fix it and run the tests",
                    "prompt_id": "p4",
                },
            },
        })
        text = call_resp.get("result", {}).get("content", [{}])[0].get("text", "")
        payload = json.loads(text)
        print("[ok] optimize_task primary files:", [loc.get("file") for loc in payload.get("primary", [])])

        if not CALL_LOG.exists() or CALL_LOG.stat().st_size == 0:
            print("[fail] MCP call log was not written")
            return 1

        print("[ok] call log:", CALL_LOG)
        print("Smoke test passed.")
        return 0
    finally:
        proc.stdin.close()
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
