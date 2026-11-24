<div align="center">

# Prmpt

**Type `@prompt` in any app on your computer and get a better prompt back, right where you were typing.**

Local-first desktop app for Windows and macOS · bring your own OpenRouter key · open source

[How it works](#how-it-works) · [Install on Windows](#install-and-run-on-windows) · [Code intelligence engine](#the-code-intelligence-engine) · [Benchmark](#benchmark) · [Architecture deep dive](./ARCHITECTURE.md)

</div>

<!-- DEMO GIF: record @prompt → overlay → optimize → insert in a real app, save as assets/demo.gif (docs/ is git-ignored), and replace this comment with:
<p align="center"><img src="assets/demo.gif" alt="Typing @prompt in an editor, optimizing in the overlay and inserting the result" width="760"></p>
-->

You write a rough prompt in ChatGPT, Claude, Cursor, Slack or a plain text box. Prmpt catches the `@prompt` trigger at the OS level, opens a small overlay next to your work, asks a clarifying question if it needs one, and rewrites the prompt with an LLM pipeline. If you've connected a code repository, it adds the relevant files and functions first. Then one click replaces `@prompt` with the result in the app you came from.

- **Works in any app.** A Rust keyboard hook (`WH_KEYBOARD_LL` on Windows, `CGEventTap` on macOS) watches for the trigger, so there's no plugin per app.
- **Knows your code.** Spaces index your local repos with Tree-sitter, on-device ONNX embeddings and a hybrid search + call-graph engine, so prompts about your code come with the right context.
- **Local-first.** No account, no hosted backend, no telemetry. Chats, settings and code indexes live in SQLite files on your machine. Model calls go straight from your computer to OpenRouter with your own key.

---

## How it works

Prmpt is three connected systems: **Prompt** (the optimizer), **Overlay** (the OS layer) and **Spaces** (code context).

```text
you type "@prompt" in any app
  → Rust keyboard hook spots the trigger and remembers the window
  → Electron opens the Overlay next to your text caret
  → Overlay streams the prompt to the local optimizer service (Python, port 8001)
      ↳ if a Space is active: code-intelligence service (port 8002) retrieves relevant code
  → optimizer clarifies, plans and rewrites, streaming tokens back
  → you click Insert
  → Rust module puts focus back on your app, removes "@prompt" and inserts the result
```

### Prompt: the optimizer

A local FastAPI service runs a multi-step pipeline (decision → skill selection → optional clarification → optimization). It:
- rewrites vague prompts into precise, model-ready instructions;
- asks multiple-choice clarifying questions when something important is missing;
- turns large build requests into ordered task sections with dependencies;
- applies your custom instructions and a memory of your stable preferences.

Output streams over a WebSocket. You choose the models: an **optimizer model** for rewriting and a **RAG model** (must support tool calling) for code questions and agentic retrieval. Both can be any model on OpenRouter.

### Overlay: the OS layer

The overlay is a frameless, always-on-top Electron window that's kept warm in the background so it opens instantly. It supports clarification cards, attachments (PDFs, images), optional voice input (Deepgram, your key), streaming output, and insertion back into the source app.

On Windows, insertion tries three methods in order, so it works across very different text controls:
1. `EM_REPLACESEL` for classic Win32 edit controls;
2. UI Automation `TextPattern` to select the trigger, then paste;
3. backspace over the trigger, then a clipboard paste. Everything that was on your clipboard (text, images, files) is restored afterwards, unless you copied something new in the meantime, and the inserted prompt is kept out of Win+V clipboard history.

`Ctrl+5` opens the overlay without typing the trigger; Insert then pastes at the caret of the app you were in. Closing the overlay (`Esc`) returns focus to that app.

### Spaces: code context

A Space is a named workspace connected to one or more local repositories. Electron watches the folders (Chokidar), parses changed files with Tree-sitter WASM, skips unchanged files by SHA-256 hash, and sends only the changes to the code-intelligence service. Spaces have four modes:

| Mode | What you get |
|---|---|
| **Find** | Files and symbols with exact line ranges |
| **Ask** | An answer about your codebase, with source locations |
| **Bug** | Likely bug locations and the surrounding context |
| **Optimize** | An implementation prompt built from the most relevant code |

The overlay shows the active Space and uses it when optimizing.

---

## The code-intelligence engine

`code-intelligence-service/` is a standalone FastAPI service (port 8002). It has no dependency on the desktop app beyond its HTTP API, so it can be reused on its own.

- **Indexing.** Tree-sitter chunks (functions, classes, methods, imports, call edges) get short LLM summaries and on-device embeddings (`bge-small-en-v1.5`, ONNX, CPU). They're stored in one SQLite file per project, with an FTS5 full-text index. **No source code is stored in the index:** only paths and line ranges. Snippets are read from disk at query time, so they're never stale.
- **Hybrid retrieval.** Query analysis and multi-query decomposition run first. Then vector, full-text, concept and file-path search are fused with Reciprocal Rank Fusion, reranked by a local cross-encoder (`bge-reranker-base`, ONNX), and expanded along the call graph.
- **Graph.** PageRank-weighted symbol ranking and community detection over the call graph.
- **Agentic retrieval.** For Ask, Bug and Optimize, the RAG model can run a bounded multi-hop tool loop (`find_definitions`, `get_callers`, `get_callees`, search) before answering.
- **Freshness.** File watchers update changed files; Find can run a hash-diff scan first so line ranges are always current.

Details: [code-intelligence-service/README.md](./code-intelligence-service/README.md) and [GRAPH_ARCHITECTURE.md](./code-intelligence-service/GRAPH_ARCHITECTURE.md).

---

## Install and run on Windows

Run Prmpt from source as below, or build a self-contained installer (see [Packaging](#packaging)). Either way, the app starts its two local Python services itself. These steps were run end to end on Windows 11; timings are from that run.

### Requirements

| | |
|---|---|
| Windows 10/11 x64 | A prebuilt keyboard-hook binary is included. macOS 12+ (Apple Silicon) works too: see [macOS](#macos). |
| [Node.js](https://nodejs.org) 18+ | Tested with Node 24 |
| [Python](https://www.python.org/downloads/) 3.11 or 3.12 | Tested with 3.11. `python` must be on your PATH. |
| An [OpenRouter API key](https://openrouter.ai/keys) | You paste it into the app on first launch; it never goes in a file |
| About 2 GB of free disk | Mostly the local embedding and reranker models |
| Optional: [Rust](https://rustup.rs) + Visual Studio Build Tools (C++) | Only to rebuild the keyboard hook from source (`npm run native:build`) |

### Install (about 8 minutes)

```powershell
git clone https://github.com/Rac-exe/Prompt.git
cd Prompt

npm install                 # Electron deps; rebuilds better-sqlite3 for Electron (~40 s)
npm run install:ui          # React UI deps (~40 s)
npm run python:install      # optimizer service venv (~3 min)
npm run code-intel:install  # code-intelligence service venv (~3 min)
```

No `.env` file is needed.

### Run

```powershell
npm start
```

`npm start` builds the UI and the Electron code (about 30 s), then opens the app. The app starts both Python services from their venvs (about 2 s for the optimizer and 9 s for code intelligence) and stops them when you quit. Their output goes to `logs/optimizer.log` and `logs/code-intel.log` in the app's data folder. After the first build, `npm run dev` relaunches faster if you only changed Electron code.

The first time the code-intelligence service starts, it downloads its local models (about 1.2 GB) from Hugging Face. After that it starts in a few seconds.

Working on the Python code? Start a service yourself with hot reload (`npm run python:dev` or `npm run code-intel:dev`) before launching the app; the app reuses a service that's already running instead of starting its own.

### First launch

1. Pick light or dark.
2. **Connect your AI provider:** paste your OpenRouter key (it's checked against OpenRouter before it's saved), then pick the optimizer and RAG models. You can skip this and add the key later in **Settings → AI provider**. Until then, the overlay shows a setup prompt instead of optimizing.
3. After a short tour you're in. Type `@prompt` in any text field, or press `Ctrl+5`.

To index a repository, open **Spaces**, create a Space and add a folder. Indexing summarizes code chunks with a small model, so a mid-sized repo takes a couple of minutes.

If a service stops, the app says so and reconnects by itself once it's back.

### macOS

Use the `:mac` variants: `npm run python:install:mac`, `npm run code-intel:install:mac`, `npm run python:dev:mac`, `npm run code-intel:dev:mac`. The keyboard hook and text insertion need **Accessibility** permission (System Settings → Privacy & Security → Accessibility). The app detects this and walks you through it.

### Packaging

```powershell
npm run package:win    # NSIS installer (Windows x64), with both services bundled
npm run package:mac    # DMG (macOS)
```

On Windows, `package:win` first runs `npm run build:services`, which freezes each Python service into a standalone folder with PyInstaller (`scripts/build-services.ps1`, about 5 minutes). The installer ships them, so it needs no Python or source checkout. The macOS package doesn't bundle the services yet.

---

## Benchmark

We also asked a harder question: **does giving a coding agent this retrieval engine make it better?** We wired the engine into a small CLI coding agent and ran it head-to-head against Claude Code, Cursor's CLI and Codex on identical tasks. Each run started from fresh copies of three generated TypeScript repos (`atlas-commerce`, `nova-support`, `orbit-crm`). Each task was a vague bug report such as *"auth isnt working and some leads are acting weird, fix it and run the tests"*, and it was scored by the repo's own `npm test`.

**Warm-session run:** 3 repos × 3 sequential prompts × 3 repeats = 27 turns per agent. Claude Code, Cursor and the Prmpt agent all ran Claude Sonnet 4.6.

| Agent | Tasks passed | Total tokens (incl. cache) | Wall time |
|---|---:|---:|---:|
| Claude Code | 27 / 27 | 10.04 M | 63.0 min |
| **Prmpt agent (raw prompt)** | **27 / 27** | **6.56 M** (−34.7%) | **39.9 min** (−36.6%) |
| Cursor CLI | 27 / 27 | 9.99 M | 28.1 min |
| Codex CLI (gpt-5.5)¹ | 27 / 27 | 22.93 M | 50.9 min |

**What we learned:**
- **Every agent solved every task.** Prmpt matched the others on correctness while using about a third fewer tokens than Claude Code on the same model.
- **The agents barely used the retrieval engine.** In the earlier cold-start run (81 runs), the best-scoring Prmpt configuration (25/27) averaged **0.07 retrieval calls per task**. The configuration that retrieved most (1.6 calls per task) passed one task fewer. On small repos, a good model finds what it needs with `grep` and file reads. The savings came from the agent loop, not from retrieval. This is the honest headline, and it's why the engine's next home is very large legacy codebases, where `grep` stops working.

**How the numbers were counted:**
- Token totals include cache reads and cache writes, which are 70–95% of real usage. They're summed from each run's raw usage logs, not from summaries.
- ¹ Codex reports cached tokens as part of input (OpenAI's convention), and it runs a different model with a different tokenizer, so its token count isn't directly comparable with the Sonnet rows.
- Cursor and Codex ran on subscriptions, so cost isn't compared.

**Limitations:**
- Synthetic repos and only 27 turns per agent.
- The Prmpt agent started a fresh process for each turn, while the other agents resumed their sessions.
- A third configuration, which fed the agent prompts pre-optimized by Prmpt, used even fewer tokens. It's left out of the table because the optimization step's own tokens weren't counted in it.

The harness, task files and raw per-run logs are on the [`feat/prmpt-cli`](https://github.com/Rac-exe/Prompt/tree/feat/prmpt-cli/prmpt-cli/harness) branch for now.

---

## What stays on your machine

| Data | Where it lives |
|---|---|
| Chats, prompt library, settings, profile, memory | `prmpt.db` (SQLite) in the app's user-data folder |
| Attachments | `attachments/` in the user-data folder |
| Code indexes | `code-intel/projects/<id>/index.db` in the user-data folder |
| Your OpenRouter / Deepgram keys | The local database. Encrypted with the OS keystore on Windows (Electron `safeStorage`); stored unencrypted on macOS to avoid a Keychain prompt on every launch. The UI only sees a masked preview. |

What leaves your machine:
- **OpenRouter** receives your prompts and attachments, and, for Spaces, the code snippets used for summaries and answers.
- **Deepgram** receives microphone audio, only if you add a Deepgram key and use voice input.
- **Hugging Face** serves the embedding and reranker model downloads on first use.

Both Python services listen on `127.0.0.1` only and reject requests that carry a browser `Origin` header.

---

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 32, TypeScript |
| UI | React 18, Vite, Tailwind CSS, Radix/shadcn |
| Local data | SQLite (better-sqlite3) |
| Optimizer service | Python, FastAPI, WebSocket streaming, LiteLLM → OpenRouter |
| Code intelligence | Python, FastAPI, SQLite + FTS5, ONNX Runtime (bge-small embeddings, bge-reranker), Tree-sitter WASM, Chokidar |
| OS integration | Rust, napi-rs: `WH_KEYBOARD_LL` + `EM_REPLACESEL` / UI Automation / `SendInput` (Windows), `CGEventTap` + `CGEventPost` (macOS) |
| Voice (optional) | Deepgram streaming, your own key |

---

## Configuration

Everything here is optional. The app sends your key and model choices to the local services with each request, so neither service needs a key of its own.

**Root `.env`** (template: [`.env.example`](./.env.example)):

| Variable | Default | Purpose |
|---|---|---|
| `PYTHON_SERVICE_URL` | `http://127.0.0.1:8001` | Where the app finds the optimizer service |
| `CODE_INTELLIGENCE_SERVICE_URL` | `http://127.0.0.1:8002` | Where the app finds the code-intelligence service |
| `OPENROUTER_API_KEY` | — | Fallback key, only for calling the services directly (scripts, curl) |
| `DEEPGRAM_API_KEY` | — | Fallback Deepgram key, same idea |
| `OPTIMIZER_MODEL` | `openrouter/openai/gpt-4o-mini` | Optimizer model when a request doesn't name one |
| `SUMMARIZER_MODEL` | `openrouter/openai/gpt-4o-mini` | Small helper model for titles, summaries and memory |
| `ALLOWED_ORIGINS` | — | Extra browser origins allowed to call the API (the app needs none) |
| `PRMPT_USER_DATA_DIR` | Electron's default | Use another user-data folder, for example to test a clean first run |
| `PRMPT_MANAGE_SERVICES` | `1` | Set to `0` to stop the app from starting the Python services itself |

**`code-intelligence-service/.env`** (template: [`code-intelligence-service/.env.example`](./code-intelligence-service/.env.example)) covers agentic retrieval on/off, the knowledge-graph pipeline, helper models and the index location. The RAG model chosen in the app overrides `ANSWER_MODEL` and `AGENT_MODEL`.

The app prints its data folder at startup (`[Main] Data folder: ...`).

---

## npm scripts

| Script | What it does |
|---|---|
| `npm start` | Build UI + Electron, then launch |
| `npm run dev` | Compile Electron only and launch (reuses the last UI build) |
| `npm run build` / `build:ui` / `build:electron` | Build everything / the React UI / the Electron TypeScript |
| `npm run python:install` / `python:dev` | Create the optimizer venv / run it with hot reload (port 8001) |
| `npm run code-intel:install` / `code-intel:dev` | Create the code-intelligence venv / run it with hot reload (port 8002) |
| `npm run install:ui` | Install the React UI's dependencies |
| `npm run native:build` | Build the Rust keyboard-hook module (needs Rust + MSVC on Windows) |
| `npm run build:services` | Freeze both Python services with PyInstaller (Windows) |
| `npm run package:win` / `package:mac` | Build the installer |
| `npm test` | Electron unit and integration tests (Vitest) |

macOS variants of the Python scripts end in `:mac`.

---

## Project structure

```
app-ui/                     React UI (main window + overlay, two Vite entry points)
electron/
  main/                     Main process: windows, IPC, local SQLite, overlay manager,
                            Python/code-intel clients, file watcher, Tree-sitter parser
  preload.ts                contextBridge API for both renderers
native/platform-core/       Rust N-API module
  src/hook.rs               Global keyboard hook and @prompt detection
  src/replacement.rs        Text insertion back into the source app
python-service/             Prompt optimizer (FastAPI, port 8001)
  pipeline_v2/              Decision → skills → clarifier → task planner → optimizer
code-intelligence-service/  Spaces backend (FastAPI, port 8002)
  app/services/             Hybrid search, embeddings, reranker, graph, agent loop
build/                      Icons and installer assets
tests/                      Vitest unit + e2e tests with mock services
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for every subsystem, IPC contract and data flow.

---

## Contributing

Issues and pull requests are welcome. Read [ARCHITECTURE.md](./ARCHITECTURE.md) before larger changes, and run `npm test` before opening a PR.

## Team

Prmpt is built by **Prabhat Bajpai**, **Aarush Dhingra** and **Nihal Rahman**.

## License

A license hasn't been chosen yet and will be added soon. Until then, standard copyright applies.
