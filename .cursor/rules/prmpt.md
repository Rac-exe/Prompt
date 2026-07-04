# PRMPT — Project Rules for AI Agents

## What This Repo Is

PRMPT is a CLI coding agent built around a proprietary code-intelligence retrieval pipeline.
The core differentiator is the retrieval layer — not the agent loop itself.

## Active Codebase (focus here)

- `code-intelligence-service/` — The retrieval brain. FastAPI service on port 8002.
  Handles indexing, hybrid search (vector + FTS + concept + file-path), reranking,
  graph expansion, and context generation. This is the moat. Do not simplify or remove
  any retrieval logic without explicit instruction.

- `prmpt-cli/` — Current CLI prototype built on Pi SDK. Used for benchmarking.
  The agent loop here will be replaced with a custom implementation, but the
  retrieval integration pattern (`src/prmpt-extension.ts`) and benchmark harness
  (`harness/`) are reference implementations.

## Legacy Codebase (do not explore unless explicitly asked)

Everything inside `legacy/` is from the previous Electron desktop app product direction.
This includes `legacy/app-ui/`, `legacy/electron/`, `legacy/python-service/`,
`legacy/native/`, `legacy/supabase/`, `legacy/mcp-ahh/`, `legacy/mcp-shi/`, etc.

If the user asks you to look at something in `legacy/`, go ahead. Otherwise, ignore it.

## Key Architecture Facts

- The CLI calls `code-intelligence-service` at `/api/context` for file retrieval.
- Auth is bypassed in dev via `PRMPT_ALLOW_DEV_CLI_AUTH=1`.
- Project indexes live in `code-intelligence-service/projects/<project_id>/index.db` (local SQLite).
- No user code ever goes to the cloud. All indexing and retrieval is local.
- The benchmark compares three arms: Claude Code raw, PRMPT CLI raw, PRMPT CLI optimized.

## What Is Being Built Next

A custom CLI coding agent (replacing the Pi SDK harness) with:
- Own agent turn loop (not forked from Pi, OpenCode, or any other harness)
- Own tool calling and context management
- code-intelligence-service as the retrieval layer (unchanged)
- Optimization engine on top of the base agent

## Coding Standards

- TypeScript for the CLI agent.
- Python for the code-intelligence-service and benchmark harness.
- Keep the retrieval service and CLI agent fully decoupled — communicate only via HTTP.
- Never store user code in any remote service.
