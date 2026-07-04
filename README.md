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

Two services, fully local:

| Service | Port | What it does |
|---|---|---|
| `code-intelligence-service` | 8002 | Indexes your repo, answers retrieval queries |
| `prmpt-cli` | — | The CLI agent that calls the retrieval service and drives the LLM |

---

## Quickstart

### 1. Clone

```bash
git clone https://github.com/Rac-exe/Prompt.git
cd Prompt
```

### 2. Set up the Code Intelligence Service

```bash
# Windows
npm run code-intel:install

# macOS / Linux
npm run code-intel:install:mac
```

Copy the env template and fill in your keys:

```bash
cp code-intelligence-service/.env.example code-intelligence-service/.env
```

Start the service:

```bash
# Windows
npm run code-intel:dev

# macOS / Linux
npm run code-intel:dev:mac
```

### 3. Set up the CLI

```bash
npm run cli:install
cp .env.example .env
# Fill in OPENROUTER_API_KEY (minimum required)
```

### 4. Run

```bash
cd prmpt-cli
npx prmpt --prompt "your task here" --cwd /path/to/repo
```

---

## Environment Variables

Copy `.env.example` to `.env`. Minimum required:

| Variable | What |
|---|---|
| `OPENROUTER_API_KEY` | LLM provider key (get one at openrouter.ai) |
| `OPENAI_API_KEY` | Used by code-intel for embeddings |

See `.env.example` for all options.

---

## Repository Structure

```
├── code-intelligence-service/   # Retrieval brain (FastAPI, port 8002)
│   ├── app/
│   │   ├── routes/              # projects, ingest, retrieve, context
│   │   ├── services/            # search, embedding, reranker, summarizer
│   │   └── db/                  # local SQLite store + storage backend
│   └── requirements.txt
│
├── prmpt-cli/                   # CLI agent + benchmark harness
│   ├── src/
│   │   ├── index.ts             # CLI entry point
│   │   └── prmpt-extension.ts   # prmpt_retrieve tool + retrieval integration
│   └── harness/
│       ├── run_3arm.py          # 3-arm benchmark runner
│       ├── bootstrap_index.py   # Index repos once before benchmark
│       └── aggregate.py         # Aggregate results + generate report
│
├── legacy/                      # Previous Electron desktop app (archived)
│   └── ...                      # app-ui, electron, native, python-service, etc.
│
├── .cursor/rules/prmpt.md       # Agent rules for this repo (shared via git)
├── .env.example                 # Environment variable template
└── prmpt-cli-investability-report.md
```

---

## Benchmark

The `prmpt-cli/harness/` folder contains a 3-arm benchmark comparing:

- **Arm A** — Claude Code (raw)
- **Arm B** — PRMPT CLI (raw prompt)
- **Arm C** — PRMPT CLI (optimized prompt)

See [`prmpt-cli/README.md`](./prmpt-cli/README.md) for full benchmark setup instructions.

---

## Legacy Code

The previous Electron desktop app (keyboard hook, overlay, optimization pipeline) lives in `legacy/`. It is preserved for reference and can be revived. If you need to look at any of it, ask the agent explicitly — it won't explore it by default.
