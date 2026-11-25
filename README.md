<div align="center">

# Prmpt

**Type `@prompt` in any app on your computer and get a better prompt back, right where you were typing.**

Local-first desktop app for Windows and macOS · bring your own OpenRouter key · open source

[Why](#why-we-built-it) · [Numbers](#numbers) · [How it works](#how-it-works) · [Getting started](#getting-started) · [Code intelligence engine](#the-code-intelligence-engine) · [Benchmark](#benchmark) · [Architecture deep dive](./ARCHITECTURE.md)

</div>

<!-- DEMO GIF: record @prompt → overlay → optimize → insert in a real app, save as assets/demo.gif (docs/ is git-ignored), and replace this comment with:
<p align="center"><img src="assets/demo.gif" alt="Typing @prompt in an editor, optimizing in the overlay and inserting the result" width="760"></p>
-->

Type `@prompt` wherever you're about to ask an AI something: ChatGPT, Claude, Cursor, Slack, an email draft. A small window opens at your cursor. Write what you want the way you normally would. Prmpt turns it into a clear, complete prompt, asking you one quick question first if something important is missing, and Insert puts the result back where you typed `@prompt`.

It works in any app because it runs at the OS level: a small Rust keyboard hook (`WH_KEYBOARD_LL` on Windows, `CGEventTap` on macOS) watches for the trigger. If you connect a code repo, Prmpt indexes it on your machine and adds the relevant files and functions to prompts about your code. There's no account and no server of ours involved. Your chats and indexes are SQLite files on your computer, and model calls go from your machine to OpenRouter with your own key.

---

## Why we built it

Most prompts are one rushed line. The model fills in whatever's missing with guesses, and you spend the next few messages steering it back. Writing a better prompt isn't hard, just tedious: what you're doing and for whom, what you already have, what a good answer looks like, and what format you want it in.

Prmpt does that part without making you leave the app you're in. A few things we cared about:

- It works in any text box, not one website, so there's no copying, pasting and switching back.
- If something important is missing, it asks a quick multiple-choice question instead of making something up.
- A big request ("build me a landing page with auth and payments") comes back as ordered steps you can work through one at a time.
- With a code Space connected, prompts about your code name the actual files, functions and line numbers.
- It's free, open source and local, and it works with any model on OpenRouter.

### Some examples

| Who | What they type | What Prmpt writes instead |
|---|---|---|
| A developer | "my react app re-renders like crazy when I type in the search box, fix it" | A debugging prompt: the component, the likely files from your repo, what to check first, and what to hand back (a fix plus an explanation) |
| Someone using a coding agent (Claude Code, Cursor, Codex) | "support ticket routing is buggy and sla deadlines are weird, fix it" | A brief that points the agent at the right files and line ranges before it starts searching. In our benchmark this halved the agent's token use ([numbers](#numbers)). |
| A student | "explain the krebs cycle for my exam" | A study prompt that sets your level and asks for the steps in order, a memory aid and practice questions |
| A job seeker | "write a cover letter for a marketing job" | A prompt with the role, placeholders for your experience, tone, length and structure, so the letter isn't generic |
| A marketer or founder | "write a linkedin post about our new feature" | A brief with the audience, hook, key points, tone, length and call to action |
| Anyone at work | "tell my manager the project is delayed" | A prompt that covers the situation, the new date, what you need from them and the right tone |
| A designer or creator | "a logo for my bakery" | An image prompt with style, colours, composition and what to avoid |

## Numbers

Measured on a Windows 11 laptop with the installer build.

| What | Result |
|---|---|
| Type `@prompt` → overlay open and focused | 73 ms median, 89 ms p95 (100 runs) |
| `Ctrl+5` → overlay open | 101 ms median, 115 ms p95 (100 runs) |
| `Esc` → back in the app you were typing in | 12 ms median (200 runs) |
| Keystrokes lost when the overlay opens | 0 in 100 runs |
| Insert replaces exactly `@prompt`, or pastes at the cursor after `Ctrl+5` | 200 of 200 runs, in two kinds of Windows text box |
| An image on your clipboard is still there after Insert | 200 of 200 runs |
| Inserting the result back into your app | about 0.2 s |
| Spaces: plain-English Find on a 20-file project, no API key | right function ranked first for 4 of 4 questions, about 0.5 s each |
| App start | optimizer ready in about 2 s, code intelligence in about 11 s |
| A coding agent given a Prmpt-optimized prompt instead of the raw one | 49% fewer tokens (3.32 M vs 6.56 M) and 12% less time, same agent and model, 2 more missed tasks out of 27 ([details](#benchmark)) |

How these were measured:
- Overlay and insert: a script typed into test windows (a standard .NET text box and a RichEdit box), triggered the overlay, inserted a known string and checked the text and the clipboard afterwards. Both ways of opening wait about 80 ms on purpose, so keys you've just typed reach your app before the overlay takes focus.
- Insert time: Prmpt's native paste into Notepad.
- Everyday prompts (cover letters, study plans, emails): we haven't measured answer quality yet. The benchmark is ready in [`bench/prompt-quality/`](./bench/prompt-quality/).

---

## How it works

Prmpt has three parts: Prompt (the optimizer), Overlay (the OS layer) and Spaces (code context).

```text
you type "@prompt" in any app, then your rough request in the overlay
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

Output streams over a WebSocket. You choose the models: an optimizer model for rewriting and a RAG model (must support tool calling) for code questions and agentic retrieval. Both can be any model on OpenRouter.

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

- Indexing: Tree-sitter chunks (functions, classes, methods, imports, call edges) get short LLM summaries and on-device embeddings (`bge-small-en-v1.5`, ONNX, CPU). They're stored in one SQLite file per project, with an FTS5 full-text index. The index stores no source code, only paths and line ranges. Snippets are read from disk at query time, so they're never stale.
- Hybrid retrieval: Query analysis and multi-query decomposition run first. Then vector, full-text, concept and file-path search are fused with Reciprocal Rank Fusion, reranked by a local cross-encoder (`bge-reranker-base`, ONNX), and expanded along the call graph.
- Graph: PageRank-weighted symbol ranking and community detection over the call graph.
- Agentic retrieval: For Ask, Bug and Optimize, the RAG model can run a bounded multi-hop tool loop (`find_definitions`, `get_callers`, `get_callees`, search) before answering.
- Freshness: File watchers update changed files; Find can run a hash-diff scan first so line ranges are always current.

Details: [code-intelligence-service/README.md](./code-intelligence-service/README.md) and [GRAPH_ARCHITECTURE.md](./code-intelligence-service/GRAPH_ARCHITECTURE.md).

---

## Getting started

There are two ways to run Prmpt:

- [Use the installer](#option-a-use-the-installer-windows) if you just want the app. You don't need Node, Python or Git.
- [Run from source](#option-b-run-from-source) if you want to change the code. This takes about 12 minutes the first time.

Either way you need an [OpenRouter API key](https://openrouter.ai/keys). You paste it into the app on first launch, and it never goes in a file. There's no account to create and no sign-in.

### Option A: use the installer (Windows)

1. Download the latest `Prmpt Setup <version>.exe` from [Releases](https://github.com/Rac-exe/Prompt/releases).
2. Run it. The installer isn't code-signed yet, so Windows SmartScreen warns you about it: click **More info → Run anyway**.
3. Open Prmpt from the Start menu, then go to [First launch](#first-launch).

The installer is about 230 MB and takes about 800 MB on disk. It includes both local services, so you don't need to install anything else. On first launch, Prmpt downloads its local search models (about 1.2 GB) in the background, once.

### Option B: run from source

These steps were run end to end on a clean Windows 11 machine, and the timings come from that run.

#### 1. Install the tools

| Tool | Version | What it's for | Check with |
|---|---|---|---|
| [Git](https://git-scm.com/downloads) | Any | Cloning the repo | `git --version` |
| [Node.js](https://nodejs.org) (includes npm) | 18 or newer (tested with 24) | The Electron app, the React UI and the build tools | `node -v` |
| [Python](https://www.python.org/downloads/) | 3.11 or 3.12 (tested with 3.11) | The two local services | `python --version` |

You also need about 3 GB of free disk: about 1.5 GB for dependencies and about 1.2 GB for the local search models.

When you install Python on Windows, tick **"Add python.exe to PATH"**. If `python --version` opens the Microsoft Store instead, turn off the `python.exe` alias in **Settings → Apps → Advanced app settings → App execution aliases**.

You don't need Rust or a C++ compiler. The Windows keyboard-hook binary is checked in, and `better-sqlite3` downloads a prebuilt binary. You only need them for the cases under [Optional tools](#optional-tools).

#### 2. Get the code

```powershell
git clone https://github.com/Rac-exe/Prompt.git
cd Prompt
```

#### 3. Install the dependencies (about 11 minutes)

Run these four commands from the repo root, in this order:

```powershell
npm install                 # Electron app (~40 s). Also rebuilds better-sqlite3 for Electron.
npm run install:ui          # React UI (~40 s)
npm run python:install      # Optimizer service: creates python-service/venv (~5 min)
npm run code-intel:install  # Code-intelligence service: creates code-intelligence-service/.venv (~5 min)
```

Each Python service gets its own virtual environment, so nothing goes into your global Python. You don't need a `.env` file.

#### 4. Start the app

```powershell
npm start
```

`npm start` builds the UI and the Electron code (about 30 s), then opens the app. The app starts both Python services from their venvs and stops them when you quit, so you don't need extra terminals. It's ready when the Prmpt icon appears in the system tray and the main window opens.

The first time the code-intelligence service starts, it downloads its local models (about 1.2 GB) from Hugging Face. After that, it starts in a few seconds.

After the first build, `npm run dev` relaunches faster if you only changed Electron code.

#### 5. Check that it works

1. Finish [First launch](#first-launch) and add your OpenRouter key.
2. Open Notepad and type `@prompt`. The overlay should open next to your text.
3. In the overlay, type a rough request such as `make me a study plan, exams in 3 weeks` and press `Enter`. When the optimized prompt appears, click **Insert**. It should replace `@prompt` in Notepad.

### First launch

1. Pick light or dark.
2. **Connect your AI provider.** Paste your OpenRouter key, then pick the optimizer and RAG models. The key is checked with OpenRouter before it's saved. You can skip this step and add the key later in **Settings → AI provider**; until you do, the overlay shows a setup message instead of optimizing.
3. After a short tour, you're in. Type `@prompt` in any text field, or press `Ctrl+5`, then write your request in the overlay.

To index a repository, open **Spaces**, create a Space and add a folder. Indexing summarizes code chunks with a small model, so a mid-sized repo takes a couple of minutes.

If a service stops, the app tells you and reconnects by itself once the service is back.

### Troubleshooting

| Problem | Fix |
|---|---|
| `python` isn't recognized, or it opens the Microsoft Store | Reinstall Python with **"Add python.exe to PATH"** ticked, or turn off the Store alias (see [step 1](#1-install-the-tools)). Then delete the half-made `venv` / `.venv` folder and rerun the install script. |
| `npm install` fails while building `better-sqlite3` | No prebuilt binary matched your setup. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Desktop development with C++** workload, then run `npm install` again. |
| The app says the local AI service isn't running | Open `logs/optimizer.log` or `logs/code-intel.log` in the data folder. The app prints that folder's path at startup as `[Main] Data folder: ...`. A missing venv means one of the step 3 install scripts didn't finish. |
| Port 8001 or 8002 is already in use | If an older Prmpt service is using it, the app reuses it. Otherwise, stop the other program or point the app at other ports (see [Configuration](#configuration)). |
| `@prompt` does nothing in one app | That app may be running as administrator. Windows stops a normal app from reading keys typed into an elevated app or typing into it, so run Prmpt as administrator too. |

### Optional tools

| You want to… | You also need |
|---|---|
| Change the Rust keyboard hook (`native/platform-core`) and run `npm run native:build` | [Rust](https://rustup.rs) and Visual Studio Build Tools (C++) |
| Build the Windows installer (`npm run package:win`) | Nothing extra. PyInstaller is installed into the service venvs automatically. |
| Work on a Python service with hot reload | Nothing extra. Run `npm run python:dev` or `npm run code-intel:dev` before launching the app; the app reuses a service that's already running. |

### macOS

You need the same tools as in Option B, plus the Xcode Command Line Tools (`xcode-select --install`). Use the `:mac` scripts:

```bash
npm install
npm run install:ui
npm run python:install:mac
npm run code-intel:install:mac
npm start
```

The keyboard hook and text insertion need **Accessibility** permission (System Settings → Privacy & Security → Accessibility). The app detects when it's missing and walks you through it. macOS hasn't been tested as thoroughly as Windows yet.

### Packaging

```powershell
npm run package:win    # NSIS installer (Windows x64), with both services bundled
npm run package:mac    # DMG (macOS)
```

On Windows, `package:win` first runs `npm run build:services`. That uses PyInstaller to freeze each Python service into a standalone folder (`scripts/build-services.ps1`, about 5 minutes). The installer ships those folders, so it needs no Python and no source checkout. The macOS package doesn't bundle the services yet.

### What gets installed

The four install commands pull in the packages below. None of them talk to a server of ours: there's no account system, no analytics and no error reporting.

**Electron app** (`package.json`):

| Package | Used for |
|---|---|
| `electron` | The desktop shell |
| `better-sqlite3` | The local database (chats, settings, prompt library) |
| `web-tree-sitter` | Parsing code in Spaces (the grammar files are in `tree-sitter-wasms/`) |
| `chokidar` | Watching Space folders for changes |
| `active-win` | Knowing which app you were typing in |
| `axios`, `ws` | Talking to the local services over HTTP and WebSocket |
| `file-type` | Checking attachment types |
| `dotenv` | Reading the optional `.env` |
| Dev only: `typescript`, `vitest`, `electron-builder`, `cross-env`, `express` and `tsx` (mock services for tests) | Building, testing and packaging |

**React UI** (`app-ui/package.json`):
- React 18, Vite and Tailwind CSS;
- Radix UI primitives (through shadcn);
- `@phosphor-icons/react` and `motion`;
- `react-markdown` and `remark-gfm`;
- `pdfjs-dist` for PDF previews;
- `sonner` for toasts;
- `@tanstack/react-query` and `react-router-dom`.

**Optimizer service** (`python-service/requirements.txt`):
- FastAPI, Uvicorn and Pydantic;
- `websockets` for streaming;
- LiteLLM, which calls OpenRouter;
- `httpx`, `cachetools` and `numpy`;
- PyMuPDF and Pillow, for reading PDF and image attachments.

**Code-intelligence service** (`code-intelligence-service/requirements.txt`):
- FastAPI, Uvicorn, Pydantic, LiteLLM and `python-dotenv`;
- ONNX Runtime, `tokenizers` and `huggingface-hub` for the local embeddings and reranker;
- `numpy`;
- `igraph` and `leidenalg` for call-graph ranking and communities.

**Keyboard hook** (`native/platform-core`): Rust, with napi-rs and the `windows` crate. A prebuilt `platform-core.win32-x64-msvc.node` is checked in.

---

## Benchmark

We also wanted to know whether this retrieval engine makes a coding agent better. We wired the engine into a small CLI coding agent and ran it head-to-head against Claude Code, Cursor's CLI and Codex on identical tasks. Each run started from fresh copies of three generated TypeScript repos (`atlas-commerce`, `nova-support`, `orbit-crm`). Each task was a vague bug report such as *"auth isnt working and some leads are acting weird, fix it and run the tests"*, and it was scored by the repo's own `npm test`.

Warm-session run: 3 repos × 3 sequential prompts × 3 repeats = 27 turns per agent. Claude Code, Cursor and the Prmpt agent all ran Claude Sonnet 4.6.

| Agent | Tasks passed | Total tokens (incl. cache) | Wall time |
|---|---:|---:|---:|
| Claude Code | 27 / 27 | 10.04 M | 63.0 min |
| Prmpt agent (raw prompt) | 27 / 27 | 6.56 M (−34.7%) | 39.9 min (−36.6%) |
| Prmpt agent + Prmpt-optimized prompt² | 25 / 27 | 3.32 M (−66.9%) | 35.3 min (−44.0%) |
| Cursor CLI | 27 / 27 | 9.99 M | 28.1 min |
| Codex CLI (gpt-5.5)¹ | 27 / 27 | 22.93 M | 50.9 min |

What we took away from it:

Every agent solved every task. Ours matched the others on correctness and used about a third fewer tokens than Claude Code on the same model.

The bigger effect came from the prompt. Same agent, same model: swapping the raw bug report for the prompt Prmpt writes when a code Space is connected cut tokens by 49% (6.56 M to 3.32 M) and time by 12%. That prompt lists the files and line ranges to check first, so the agent spends less time searching. It cost us 2 missed tasks out of 27.

The agents themselves hardly ever called the retrieval tool. In the earlier cold-start run (81 runs), the best-scoring configuration (25/27) averaged 0.07 retrieval calls per task, and the one that retrieved the most (1.6 calls per task) passed one task fewer. On repos this small, a good model finds what it needs with `grep` and reading files. Retrieval helped when it was done up front and written into the prompt. We think it'll matter more on very large codebases, where `grep` stops being enough, and that's where we want to test it next.

How the numbers were counted:
- Token totals include cache reads and cache writes, which are 70–95% of real usage. They're summed from each run's raw usage logs, not from summaries.
- ¹ Codex reports cached tokens as part of input (OpenAI's convention), and it runs a different model with a different tokenizer, so its token count isn't directly comparable with the Sonnet rows.
- Cursor and Codex ran on subscriptions, so cost isn't compared.

Limitations:
- Synthetic repos and only 27 turns per agent.
- The Prmpt agent started a fresh process for each turn, while the other agents resumed their sessions.
- ² The optimized-prompt row leaves out the optimizer's own tokens. The prompts came from Prmpt's code optimizer (the template in [`files/system_prompt_code_optimizer.md`](./files/system_prompt_code_optimizer.md) plus code-intelligence retrieval). They were made once per task (9 in total), then reused across the 3 repeats. Both misses were the same task (`nova-support`, prompt 1: 5 of 6 tests passing). That task passed 2 out of 2 on a rerun.

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
- OpenRouter receives your prompts and attachments, and, for Spaces, the code snippets used for summaries and answers.
- Deepgram receives microphone audio, only if you add a Deepgram key and use voice input.
- Hugging Face serves the embedding and reranker model downloads on first use.

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

Prmpt is built by Prabhat Bajpai, Aarush Dhingra and Nihal Rahman.

## License

MIT. See [LICENSE](./LICENSE).
