import sys
sys.path.insert(0, '.')
from pathlib import Path
from benchmarks.adapters.command_code_adapter import _estimate_usage_from_session

raw_session = Path(r'C:\Users\Prabhat\.commandcode\projects\c-users-prabhat-desktop-prompt-mcp-ahh-worktrees-demo-atlas-p3-raw-1090063c\31f35733-d7e1-43ec-b28d-830d09bd139c.jsonl')
u = _estimate_usage_from_session(raw_session, 'deepseek/deepseek-v4-pro')
print(f"Input tokens : {u.input_tokens:,}")
print(f"Output tokens: {u.output_tokens:,}")
print(f"Total tokens : {u.total_tokens:,}")
print(f"Cost est USD : ${u.cost_usd:.6f}")
print(f"Turns        : {u.turns}")
print(f"MCP calls    : {u.mcp_tool_calls}")
print(f"Native search: {u.native_search_calls}")
print()
print("Studio shows ~4 visible rows at ~15-22K input + 200-600 output each")
print("Expected session total: ~70-90K input tokens")

# Also try prmpt session
import os, glob
proj = Path.home() / ".commandcode" / "projects"
sessions = list(proj.rglob("*.jsonl"))
print(f"\nAll sessions found: {len(sessions)}")
for s in sessions:
    u2 = _estimate_usage_from_session(s, 'deepseek/deepseek-v4-pro')
    print(f"  {s.parent.name[-30:]} -> in={u2.input_tokens:,} out={u2.output_tokens:,} cost=${u2.cost_usd:.4f} turns={u2.turns}")
