# PRMPT

**A CLI coding agent with a proprietary code-intelligence retrieval layer.**

PRMPT indexes your codebase locally and retrieves only the files that matter — giving the agent precise context instead of burning tokens on noise. No code leaves your machine.

---

## How It Works

```
prmpt --prompt "fix the auth bug" --cwd ./my-repo
  → code-intelligence-service indexes the repo locally
  → agent calls prmpt_retrieve to get relevant files
  → agent edits, re-queries on miss, verifies
  → done
```

---

## Setup

**1. Clone**

```bash
git clone https://github.com/Rac-exe/Prompt.git
cd Prompt
```

**2. Install dependencies**

```bash
# Windows
npm run code-intel:install

# macOS / Linux
npm run code-intel:install:mac
```

**3. Configure**

```bash
cp code-intelligence-service/.env.example code-intelligence-service/.env
# Fill in OPENAI_API_KEY and OPENROUTER_API_KEY
```

**4. Start**

```bash
# Windows
npm run code-intel:dev

# macOS / Linux
npm run code-intel:dev:mac
```

Service runs on `http://localhost:8002`.

---

## Environment Variables

Copy `.env.example` to `.env`. Minimum required:

| Variable | What |
|---|---|
| `OPENROUTER_API_KEY` | LLM provider key for the CLI agent |
| `OPENAI_API_KEY` | Used by code-intel for embeddings |

See `.env.example` for all options.

---

## Repository Structure

```
├── code-intelligence-service/   # Retrieval brain (FastAPI, port 8002) — production-ready
│   ├── app/
│   │   ├── routes/              # projects, ingest, retrieve, context
│   │   ├── services/            # search, embedding, reranker, summarizer
│   │   └── db/                  # local SQLite store + storage backend
│   └── requirements.txt
│
├── prmpt-cli/                   # CLI agent + benchmark harness
│   ├── src/                     # Agent source
│   └── harness/                 # 3-arm benchmark runner, bootstrap, aggregator
│
├── legacy/                      # Previous Electron desktop app (archived, not deleted)
│
├── .cursor/rules/prmpt.md       # Agent rules for this repo (shared via git)
└── .env.example                 # Environment variable template
```

---

## Benchmark Results

A 3-arm benchmark (Claude Code raw vs PRMPT raw vs PRMPT optimized) was run on 9 JS tasks across 3 repos. See `prmpt-cli/README.md` and `prmpt-cli/report/` for full results.

---

## Legacy Code

The previous Electron desktop app (keyboard hook, overlay, optimization pipeline) lives in `legacy/`. Fully preserved and revivable. Agents won't explore it by default — ask explicitly if you need something from it.
