# Contributing to PRMPT

## First-time Setup

### Requirements

- Node.js 20+
- Python 3.11+
- Git

### Steps

**1. Clone and enter the repo**

```bash
git clone https://github.com/Rac-exe/Prompt.git
cd Prompt
```

**2. Set up environment variables**

```bash
cp .env.example .env
```

Open `.env` and fill in:

- `OPENROUTER_API_KEY` — get one at [openrouter.ai](https://openrouter.ai/keys)
- `OPENAI_API_KEY` — used by code-intel for embeddings

Then set up the code-intel service env:

```bash
cp code-intelligence-service/.env.example code-intelligence-service/.env
```

Fill in the same keys inside `code-intelligence-service/.env`.

**3. Install and start the Code Intelligence Service**

This is the only service that is fully production-ready right now.

```bash
# Windows
npm run code-intel:install
npm run code-intel:dev

# macOS / Linux
npm run code-intel:install:mac
npm run code-intel:dev:mac
```

Keep this running in a terminal. It starts the retrieval service on port 8002.

---

## Project Structure

| Folder | What to know |
|---|---|
| `code-intelligence-service/` | The retrieval brain. FastAPI on port 8002. Production-ready. Do not simplify the retrieval pipeline. |
| `prmpt-cli/src/` | Benchmark prototype of the CLI agent (Pi SDK based). Being replaced with a proper custom CLI. |
| `prmpt-cli/harness/` | 3-arm benchmark runner. See `prmpt-cli/README.md` for how to run. |
| `legacy/` | Old Electron desktop app. Archived. Don't edit. Read if you need reference. |
| `.cursor/rules/prmpt.md` | Agent rules — read this to understand what the repo is and what to focus on. |

---

## Current State

- `code-intelligence-service/` is complete and battle-tested.
- `prmpt-cli/` contains a benchmark prototype built on Pi SDK. This prototype proved PRMPT's retrieval advantage in a 3-arm benchmark against Claude Code and Codex.
- The proper CLI coding agent is being built from scratch — custom agent loop, not forked from any existing harness, with code-intel as the retrieval layer.

---

## Things to Know

- **No code goes to the cloud.** All indexing and retrieval runs on localhost.
- **Auth is bypassed in dev.** `PRMPT_ALLOW_DEV_CLI_AUTH=1` in `.env` lets the CLI hit code-intel without a Supabase session.
- **`legacy/` is not dead code.** It's the old product, fully working, just archived. Git history is intact.
