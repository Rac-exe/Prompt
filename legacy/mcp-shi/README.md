# mcp-shi

Local Prompt MCP benchmark package for this repo.

Start here:

- **[MCP_GUIDE.md](./MCP_GUIDE.md)** — full setup, smoke tests, full benchmark run, env vars, and historical results.
- **[REPOS.md](./REPOS.md)** — bundled benchmark workspaces, prompts, and git setup.

Quick start:

```bash
# From Prompt repo root
pip install -r mcp-shi/requirements.txt
./mcp-shi/scripts/setup_benchmark_repo_git.sh
npm run python:dev:mac
npm run code-intel:dev:mac

# Smoke-test the MCP server only (no Claude required)
python3 mcp-shi/scripts/smoke_mcp_server.py
```

What lives here:

| Path | Purpose |
|------|---------|
| `benchmark-runs/` | Harness scripts + local Prompt MCP server |
| `test-repo/` | Bundled benchmark workspaces (CRM, commerce, support) |
| `examples/` | Sample MCP context payloads |
| `results/` | Historical benchmark result snapshots |
| `scripts/` | Smoke tests + repo git setup |

What you still need externally:

- `claude` CLI (and optionally `codex`) for full agent benchmarks
- Python optimizer on `:8001` and Code Intel on `:8002`
