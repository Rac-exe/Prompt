<div align="center">

# Prmpt

### The AI Prompt Optimizer That Lives Inside Your Operating System

**Type `@prompt` in any app. Get an optimized prompt. Paste it anywhere.**

[Architecture Deep Dive](./ARCHITECTURE.md) · [Code Intelligence (RAG) Pipeline](./code-intelligence-service/README.md) · [Help & Docs](./docs/help-and-docs.md)

---

</div>

You type rough prompts. LLMs hallucinate. Prmpt fixes that at the source.

Prmpt is an open-source **desktop application for Windows and macOS** that intercepts your prompts before they reach any AI and rewrites them with a multi-step LLM pipeline. The pipeline understands context, asks clarifying questions, retrieves relevant code from your own repositories, and produces prompts precise enough that the model's output is structurally different from what you'd get without it.

It runs in your system tray. It hooks into your keyboard at the OS level. It boots silently with your machine. It's always one keystroke away.

**Local-first, bring your own key.** There is no account and no hosted backend. Your chats, prompt library, memory, settings, attachments and code indexes are stored on your computer. You paste in your own [OpenRouter](https://openrouter.ai/keys) API key on first launch and choose which models to use.

---

## Project Overview

Prmpt is built around three connected systems: **Prompt**, **Overlay**, and **Spaces**. Prompt is the intelligence layer, Overlay is the operating-system layer, and Spaces is the code-context layer.

### 1. Prompt — The Optimization Engine

Prompt is the core product loop: take a rough instruction, understand what the user is actually trying to do, and turn it into a structured prompt that produces better model output with less wasted context.

When you submit a prompt, Prmpt routes it through a local Python/FastAPI optimization service. The pipeline can classify the prompt, detect missing information, ask clarifying questions, read attached files, apply custom instructions, use memory, and stream the optimized result back to the desktop app. Simple prompts stay fast. Complex implementation requests can come back as task-style output with ordered steps, constraints and dependencies.

The Prompt layer includes:
- **Prompt optimization** — rewrites vague or under-specified prompts into precise, model-ready instructions.
- **Clarification** — asks targeted questions before optimizing when the input is missing important details.
- **Task planning** — breaks complex requests into ordered implementation sections instead of one messy blob.
- **Streaming output** — returns tokens over a WebSocket so you see progress immediately.
- **Memory and custom instructions** — learns stable preferences and applies your own rules to future optimizations.
- **Prompt library** — saves useful outputs into collections you can reuse, edit, download and copy later.
- **History and versioning** — keeps previous conversations, regenerated answers, edits and feedback.

You choose the models. The **optimizer model** handles prompt optimization. The **RAG model** handles the code-intelligence answers and the agentic retrieval loop, so it must support tool calling. Both are any model on OpenRouter, picked from a searchable list in the app.

### 2. Overlay — The OS Layer and How Everything Connects

Overlay is what makes Prmpt feel native instead of like another chat tab. A Rust/N-API native module installs platform-specific keyboard hooks: `WH_KEYBOARD_LL` on Windows and `CGEventTap` on macOS. When you type `@prompt` anywhere, Prmpt detects the trigger, removes it from the active application, opens a small floating overlay near the cursor, and keeps you in the same workflow.

The overlay is a frameless, always-on-top Electron window. It is preloaded in the background so it opens quickly. It supports text input, clarification cards, attachments, voice input, streaming output, and one-click insertion back into the originating application. Text insertion uses OS-level APIs: `SendInput` on Windows and `CGEventPost` with clipboard restore on macOS.

The connection flow is:

```text
User types @prompt in any app
  -> native keyboard hook detects the trigger
  -> Electron main process opens the Overlay
  -> Overlay sends the prompt to the local Python optimization service
  -> Prompt pipeline clarifies, plans, optimizes, and streams output
  -> User clicks Insert
  -> Electron main process writes the optimized text back into the original app
```

Overlay stays connected to the main app window. Setup state, active project status, Python service availability, online/offline state and code-intel project updates are broadcast over IPC, so the overlay can show whether Prmpt is ready, indexing, offline, or using an active Space as context.

> **macOS note:** On first launch, macOS prompts for **Accessibility** permission in System Settings → Privacy & Security → Accessibility. The keyboard hook and text replacement require it. Prmpt detects the permission state and shows a guided prompt.

### 3. Spaces — Code Context and Local Intelligence

Spaces are named workspaces connected to local repositories. They let Prmpt understand your actual codebase instead of optimizing prompts in isolation. A Space can index a project, watch it for changes, retrieve relevant files and functions, and feed that context into the prompt pipeline.

Electron owns the filesystem side. It watches project folders with Chokidar, parses files with Tree-sitter WASM, extracts functions/classes/methods/imports/callees/signatures/line ranges, and skips unchanged files using SHA-256 hash checks. The code-intelligence service owns indexing and retrieval: summarization, embeddings, hybrid search, reranking, graph expansion, an agentic multi-hop retrieval loop, and answer generation.

The index is fully local:
- **Local SQLite per project** — `code-intel/projects/<project_id>/index.db` stores chunk metadata, embeddings, summaries, relationships, communities, retrieval logs, an FTS5 index and file hashes.
- **No source bodies in the DB** — it stores `file_path`, `start_line` and `end_line`. Snippets are read from your filesystem at retrieval time.
- **On-device embeddings and reranking** — ONNX models (`bge-small-en-v1.5` embeddings, `bge-reranker-base` reranker) run on your CPU. They are downloaded from Hugging Face on first use and cached.
- **Live freshness** — file watchers update changed files, and Find mode can run a hash-diff scan before retrieval so stale line ranges are repaired.

Spaces has four modes:
- **Find** — fast code lookup with files, symbols and exact line ranges.
- **Ask** — answers questions about the codebase, with source locations.
- **Bug** — retrieves likely bug locations and related context for debugging prompts.
- **Optimize** — builds a context-rich implementation prompt from the most relevant code.

Spaces connects back into Prompt and Overlay. The main app is where you manage Spaces, add repositories and inspect results. The overlay shows the active Space and uses its indexed context when optimizing a prompt.

---

## What stays on your machine

| Data | Where it lives |
|---|---|
| Chats, messages, prompt library, settings, profile, memory | One SQLite file, `prmpt.db`, in the app's user-data folder |
| Attachments (images, PDFs) | `attachments/` in the user-data folder |
| Code indexes | `code-intel/projects/<id>/index.db` in the user-data folder |
| Your OpenRouter / Deepgram keys | The local database. On Windows they're encrypted with the OS keystore (Electron `safeStorage`); on macOS they're stored unencrypted to avoid a Keychain prompt on every launch. The UI only ever sees a masked preview. |

What leaves your machine:
- **OpenRouter** receives what the models need: your prompts and attachments, and for Spaces the code snippets used for chunk summaries (at index time) and for answers. Requests go straight from the local services to OpenRouter with your key.
- **Deepgram** receives microphone audio, only if you add a Deepgram key and use voice input.
- **Hugging Face** serves the embedding and reranker model downloads on first use.

There is no telemetry, analytics or crash reporting. The two Python services listen on `127.0.0.1` only and reject requests from web pages (browser `Origin` headers).

---

## The Stack (And Why Every Choice Was Made)

| Layer | Technology | Why |
|---|---|---|
| **Desktop Shell** | Electron v32 · Node.js | Global keyboard hooks, system tray, filesystem access, transparent frameless windows — impossible in a browser |
| **UI** | React 18 · TypeScript · Vite · Tailwind CSS · Radix UI | Concurrent rendering handles 30+ state updates/second during streaming without jank |
| **Local Data** | SQLite (better-sqlite3) | One file for chats, library, settings and memory. No server, no account |
| **AI Pipeline** | Python · FastAPI · WebSocket · LiteLLM → OpenRouter | Python-native AI ecosystem (LiteLLM, PyMuPDF). OpenRouter gives one key for every major model |
| **Code Indexing (Electron-side)** | Tree-sitter WASM · Chokidar · local SQLite hash cache | Parses your repo into structural chunks in the desktop process, watches for file changes, hash-skips unchanged files, and sends only deltas to the code-intel service |
| **Code Intelligence Service** | Python · FastAPI · SQLite + FTS5 · ONNX Runtime | Hybrid retrieval: vector + full-text + concept + path search → RRF → rerank → graph expansion → agentic multi-hop loop |
| **OS Integration** | Rust · N-API (napi-rs) · WH_KEYBOARD_LL (Win) · CGEventTap (macOS) | One memory-safe crate, two platform backends behind the same `TriggerAnchor` API. Selective text replacement with a thread-safe N-API callback into Node |
| **Voice Input (optional)** | Deepgram streaming, with your own key | Real-time transcription relayed through the local Python service |
| **Auto-launch** | Electron `setLoginItemSettings` | Silent boot in tray on macOS (`openAsHidden`) and Windows (`--hidden` arg). Toggle from the tray menu |

---

## Features

### The Overlay — Instant Optimization Without Leaving Your App

The overlay is a 520×600 px frameless, transparent, always-on-top Chromium window. It's preloaded hidden at startup so it opens in under 50ms. It tracks your cursor with a mouse-following emerald border glow (polling `screen.getCursorScreenPoint()` at ~60fps). It closes when you click away, unless you're mid-input.

- **`@prompt` anywhere** — the Rust hook detects the trigger in any application
- **`Ctrl+5` global shortcut** — toggle the overlay from anywhere
- **Streaming output** — tokens appear with an adaptive buffered typewriter that adjusts drain speed to network conditions
- **Insert result** — one click replaces `@prompt` in the originating app with the optimized text
- **Clarification questions** — multiple-choice questions appear when your prompt is ambiguous
- **File attachments** — PDFs and images, parsed inline
- **Voice input** — speak your prompt and watch it transcribe in real time (needs a Deepgram key)
- **Project status** — shows the active Space and its indexed code context

### The App Window — Full Interface

The App Window is a 1400×900 SPA with a custom title bar and sidebar navigation. On Windows it's fully **frameless** (custom controls). On macOS it uses `titleBarStyle: 'hiddenInset'` with native traffic-light buttons positioned at `(12, 12)`. The window appears in the **Dock and `Cmd+Tab` switcher only while it's visible**: when you close to tray, `app.dock.hide()` removes it so Prmpt behaves as a true background app.

**Chat**
- Multi-turn conversation with the optimizer, saved locally
- Branching version history — regenerate any response and move between versions with `← 1/3 →` controls
- Clarification cards — questions appear one by one, multiple choice with an "Other" free-text option, a progress bar and an extra-notes field
- Task-sectioned output for complex builds — ordered implementation phases with dependency declarations
- Auto-generated chat titles, feedback (thumbs up/down), stop generation mid-stream

**Spaces (Code Intelligence)**
- Create named workspaces and attach local code repositories
- Tree-sitter parses your codebase into functions, classes and methods with signatures and call graphs
- File watcher re-indexes changed files incrementally (2s debounce, hash-checked to skip unchanged files)
- Hybrid local search retrieves the most relevant code and reads current snippets from disk
- Branch-aware context flags files modified on the current branch
- Compose a context-rich prompt and send it to the full optimizer

**History**
- All past sessions grouped by Today / Yesterday / Weekday / Date
- Click any entry to resume

**Prompt Library**
- Save optimized prompts to named collections
- Star favorites, edit, delete, download as text

**Settings**
- **AI provider** — OpenRouter key, optimizer model, RAG model, optional Deepgram key
- Light / dark mode, font size (with zoom indicator)
- Custom instructions injected into every optimization
- Memory toggle and memory viewer

**Profile**
- Display name and avatar, stored locally

### Intelligence & Personalization

**User Memory System**
Runs automatically in the background every 5 optimizations. It analyzes your last 50 prompts with exponential recency weighting (`e^(-0.06 × index)`), detects your domain (Backend Dev, ML Engineering, Frontend, Data Science, DevOps) and writing style (concise, technical, verbose, creative, formal), stores the inferred facts in the local database, and adds them to future optimizations. You never have to repeat "I'm a senior backend engineer who works in Python" again.

**Custom Instructions**
Set once in Settings and they're added to every optimization. "I'm building a SaaS in Next.js 14 with Tailwind. I prefer concise, typed code with no comments." Done.

**Silent Auto-Launch at Login**
Toggle "Start at Login" from the tray menu. When enabled, Prmpt boots into the system tray only; the main window stays hidden until you click the tray icon. Implemented with `app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true })` on macOS, plus `path: process.execPath, args: ['--hidden']` on Windows. The main process detects silent launches via `app.getLoginItemSettings().wasOpenedAsHidden` (macOS) or `process.argv.includes('--hidden')` (Windows) and skips showing the window on boot.

### Code Intelligence Service (Spaces)

A separate FastAPI service in `code-intelligence-service/` (port `8002`) is the retrieval brain of Spaces. Electron owns parsing and watching; the service owns summarization, embeddings, search, reranking, graph expansion and answer generation.

- **Route groups** under `/api`: `projects`, `index/ingest`, `retrieve`, `context`, `feedback`, `pipeline`, and graph visualization
- **Local storage**: per-project SQLite `index.db` with chunks, summaries, embeddings, relationships, communities, FTS5, retrieval logs and file hashes
- **No code bodies stored**: snippets are read from disk using `file_path + start_line + end_line`
- **Hybrid retrieval pipeline**: query preprocessing → multi-query decomposition → vector search + FTS5 + concept + file-path search → Reciprocal Rank Fusion → rerank → call-graph expansion
- **Agentic retrieval**: for Ask, Bug and Optimize, the RAG model can run a multi-hop tool-calling loop over the index before answering (on by default; Find never uses it)
- **Freshness**: Chokidar detects saves/renames/deletes, SHA-256 hashes skip unchanged files, and Find mode can run a hash-diff scan before returning results

See [code-intelligence-service/README.md](./code-intelligence-service/README.md) for the full pipeline.

---

## Getting Started

Prmpt runs from source: the Electron app plus two local Python services.

### Requirements

| Requirement | Notes |
|---|---|
| Windows 10/11 (x64) or macOS 12+ (Apple Silicon) | Prebuilt native hook binaries are included for these two. Other targets need a Rust toolchain to build `native/platform-core` |
| Node.js 18+ and npm | Tested with Node 24 |
| Python 3.12 | For the two local services |
| An [OpenRouter API key](https://openrouter.ai/keys) | Entered in the app, not in a file |
| A [Deepgram API key](https://console.deepgram.com) (optional) | Only for voice input |

> **macOS Accessibility:** the keyboard hook (`CGEventTap`) and text replacement (`CGEventPost`) require **Accessibility** permission. Grant it once in System Settings → Privacy & Security → Accessibility.

### Install

```bash
# 1. Clone the repository
git clone https://github.com/Rac-exe/Prompt.git
cd Prompt

# 2. Install Electron dependencies (also rebuilds native modules for Electron)
npm install

# 3. Install the React frontend dependencies
npm run install:ui

# 4. Create the Python virtual environments
#    Windows:
npm run python:install
npm run code-intel:install
#    macOS:
npm run python:install:mac
npm run code-intel:install:mac
```

No `.env` file is needed. See [Configuration](#configuration) for optional overrides.

### Run

Start the two local services, each in its own terminal:

```bash
# Terminal 1 — prompt optimization service (port 8001)
npm run python:dev          # Windows
npm run python:dev:mac      # macOS

# Terminal 2 — code intelligence service (port 8002, powers Spaces)
npm run code-intel:dev      # Windows
npm run code-intel:dev:mac  # macOS
```

Then build and launch the app in a third terminal:

```bash
npm start
```

`npm start` builds the React UI and the Electron TypeScript, then launches Electron. Electron loads the built UI from `electron/renderer/app-ui/`, so after changing UI code run `npm run build:ui` (or `npm start` again). When you only changed Electron code, `npm run dev` is enough.

### First launch

1. Pick a theme.
2. **AI provider**: paste your OpenRouter key (it's checked with OpenRouter before it's saved), then choose an optimizer model and a RAG model. You can skip this; the app asks again at the next launch, and you can always change it in **Settings → AI provider**. Until a key is set, the overlay shows a setup prompt.
3. A short feature tour, then you're in. Type `@prompt` in any text field, or press `Ctrl+5`.

To index a repository, open **Spaces**, create a Space and add a folder. The first index downloads the embedding and reranker models (one-time) and calls the LLM to summarize code chunks, so a mid-sized repo takes a couple of minutes.

### Packaging

```bash
npm run package:win    # NSIS installer (Windows x64)
npm run package:mac    # DMG (macOS)
```

The installer contains the Electron app only. The two Python services still need to be running locally (see [Run](#run)).

The mac build uses `build/entitlements.mac.plist` (microphone, JIT) and runs hardened. Both packages bundle the platform-specific native `.node` files and brand assets (`build/icon.icns`, `build/icon.ico`, `build/dock-icon.png`, `build/tray-iconTemplate.png` for macOS, `build/tray-icon.png` for Windows), declared under `extraResources` in `package.json`.

---

## Configuration

Everything here is optional. The app sends your key and model choices to the local services with every request, so neither service needs a key of its own.

**Root `.env`** (read by the Electron app and the optimization service; template: [`.env.example`](./.env.example)):

| Variable | Default | Purpose |
|---|---|---|
| `PYTHON_SERVICE_URL` | `http://127.0.0.1:8001` | Where the app finds the optimization service |
| `CODE_INTELLIGENCE_SERVICE_URL` | `http://127.0.0.1:8002` | Where the app finds the code intelligence service |
| `OPENROUTER_API_KEY` | — | Fallback key, only for calling the services directly (scripts, curl) |
| `DEEPGRAM_API_KEY` | — | Fallback Deepgram key, same idea |
| `OPTIMIZER_MODEL` | `openrouter/openai/gpt-4o-mini` | Optimizer model when a request doesn't name one |
| `SUMMARIZER_MODEL` | `openrouter/openai/gpt-4o-mini` | Small helper model for titles, summaries and memory extraction |
| `ALLOWED_ORIGINS` | — | Extra browser origins allowed to call the API (the app needs none) |
| `PRMPT_USER_DATA_DIR` | Electron's default | Use a different user-data folder (handy for testing with a clean profile) |

**`code-intelligence-service/.env`** (template: [`code-intelligence-service/.env.example`](./code-intelligence-service/.env.example)): agentic retrieval on/off, the knowledge-graph pipeline, helper model ids and the index location. The RAG model chosen in the app overrides `ANSWER_MODEL` and `AGENT_MODEL`.

The app prints its data folder at startup (`[Main] Data folder: ...`).

---

## npm Scripts Reference

| Script | Description |
|---|---|
| `npm start` | Full build (UI + Electron) and launch |
| `npm run dev` | Compile Electron TS and launch Electron (uses the last UI build) |
| `npm run dev:ui` | Start the Vite dev server (browser preview only; the desktop app loads the built UI) |
| `npm run dev:full` | Same as `npm start` |
| `npm run build` | Build the React frontend and compile Electron TypeScript |
| `npm run build:ui` | Build only the React frontend (Vite) |
| `npm run build:electron` | Compile only Electron TypeScript (`tsc`) |
| `npm run electron` | Launch Electron (requires a prior build) |
| `npm run python:dev` / `python:dev:mac` | Start the optimization service with hot reload (port 8001) |
| `npm run python:install` / `python:install:mac` | Create the optimization service venv and install its deps |
| `npm run code-intel:dev` / `code-intel:dev:mac` | Start the code intelligence service with hot reload (port 8002) |
| `npm run code-intel:install` / `code-intel:install:mac` | Create the code intelligence venv and install its deps |
| `npm run install:ui` | Install the React frontend's npm dependencies |
| `npm run rebuild:native` | Rebuild native Node modules (better-sqlite3 etc.) for Electron; runs automatically after `npm install` |
| `npm run native:build` | Build the Rust native module for the host platform (release) |
| `npm run native:build:mac` | Build the Rust native module on macOS (release) |
| `npm run native:build:debug` | Build the Rust native module (debug) |
| `npm run package:win` | Build the NSIS installer (Windows x64) |
| `npm run package:mac` | Build the DMG (macOS) |
| `npm test` | Run the Electron unit and integration tests (Vitest) |
| `npm run clean` | Delete `dist/` and `electron/renderer/app-ui/` |

---

## Project Structure

```
├── .env.example              # Optional environment overrides
├── package.json              # Root: Electron config and scripts
│
├── app-ui/                   # React frontend (Vite + TypeScript)
│   └── src/
│       ├── components/
│       │   ├── auth/         # AuthWrapper (startup gate), OnboardingPage (incl. AI provider step)
│       │   ├── chat/         # ChatView, MessageBubble, ClarificationCard, ClarificationSummaryCard,
│       │   │                 # PlusMenu, SkillPicker, VersionNavigator, FeedbackWidget, SavePromptModal
│       │   ├── history/      # HistoryView (date-grouped past sessions)
│       │   ├── layout/       # AppLayout, Sidebar, ProfileMenu, ZoomIndicator
│       │   ├── library/      # PromptLibrary, PromptCard, edit/preview/delete modals
│       │   ├── profile/      # AvatarUploadModal
│       │   ├── projects/     # ProjectsView, SpacesList, SpaceWorkspace, IndexingProgressBar
│       │   ├── settings/     # SettingsView, AIProviderForm, ModelPicker, MemoryView
│       │   └── ui/           # Shadcn UI primitives + Logo, MarkdownContent
│       ├── context/          # AuthContext (local profile)
│       ├── hooks/            # useSmoothStreaming, useInitializeSettings, useMessageTree, etc.
│       ├── lib/              # utils, settings, skillIcons
│       ├── overlay/          # Overlay React app (separate Vite entry point)
│       │   ├── components/   # ChatArea, InputSection, Header, ChatPicker, SetupGate,
│       │   │                 # SpacePicker, OfflineBanner, ProjectStatus
│       │   ├── hooks/        # useTurns
│       │   └── lib/          # constants, types, utils
│       ├── pages/            # Index.tsx (main orchestrator), NotFound
│       └── types/            # electron.d.ts (window.electronAPI typings)
│
├── electron/
│   ├── main/                 # Electron main process (TypeScript)
│   │   ├── api/              # PythonClient (HTTP + WebSocket), TranscriptionClient, CodeIntelClient
│   │   ├── database/
│   │   │   ├── local-db.ts           # The app database (SQLite): chats, library, settings, memory
│   │   │   ├── services/     # ChatService, PromptLibraryService, SettingsService, MemoryService,
│   │   │   │                 # MemoryAnalyzer, UserService, OptimizationService, AISettingsService
│   │   │   ├── local-project-cache.ts# File hash cache for incremental indexing
│   │   │   ├── code-intel-local-store.ts # Code-intel index location
│   │   │   └── error-log.ts          # Local error log
│   │   ├── ipc-handlers/     # chat, overlay, session, ai-settings, settings, user, avatar, skill,
│   │   │                     # prompt-library, project, spaces-bridge handlers, attachments, network monitor
│   │   ├── menu/             # Application menu
│   │   ├── overlay/          # OverlayWindowManager
│   │   ├── services/         # CodeParser (tree-sitter), FileWatcher (chokidar), GitService,
│   │   │                     # ActiveWindowDetector, SpaceStreamStore
│   │   ├── utils/            # auth-state (local user), native-bridge, network-monitor,
│   │   │                     # window-detector, auto-launch
│   │   └── windows/          # AppWindowManager, SystemTray
│   ├── renderer/
│   │   ├── design-system.css # Shared CSS design tokens
│   │   └── app-ui/           # Built React app output (git-ignored, generated by build)
│   └── preload.ts            # contextBridge — exposes window.electronAPI to renderers
│
├── native/
│   └── platform-core/        # Rust N-API native module (Windows + macOS)
│       ├── platform-core.win32-x64-msvc.node    # Prebuilt Windows binary
│       ├── platform-core.darwin-arm64.node      # Prebuilt macOS Apple Silicon binary
│       ├── index.js                             # Loader that picks the right .node per platform
│       └── src/
│           ├── lib.rs         # Exported N-API functions; platform dispatch (Win32 / NSWorkspace)
│           ├── hook.rs        # Keyboard hook — WH_KEYBOARD_LL (Win) + CGEventTap (macOS)
│           ├── replacement.rs # Text replacement — SendInput (Win) + CGEventPost/clipboard (mac)
│           ├── buffer.rs      # Keystroke ring buffer
│           └── keymap.rs      # Key code mapping (Windows-only; mac path uses CGKeyCode)
│
├── python-service/           # Prompt optimization service (port 8001, FastAPI)
│   ├── app/
│   │   ├── main.py           # All HTTP + WebSocket endpoints
│   │   ├── origin_guard.py   # Rejects browser-origin requests
│   │   └── skills/           # Skill prompt files (skill_coding.md, skill_email.md, etc.)
│   ├── pipeline_v2/          # LLM pipeline
│   │   ├── optimizer.py      # Decision Taker → Skill Selector → Summarizer → Optimizer
│   │   ├── clarifier.py      # Clarification question generator
│   │   ├── task_planner.py   # Pre-pass task graph for complex sectioned builds
│   │   ├── project_context.py# Fetches + formats code intelligence context
│   │   ├── document_parser.py# PDF text extraction, image vision, file validation
│   │   ├── fast_mode.py      # Fast-mode keyword-based prompt classification
│   │   ├── context.py        # Chat context management
│   │   ├── config.py         # Models, per-request provider settings (key + models)
│   │   ├── skills.py         # Skill file loader
│   │   └── usage_logger.py   # Token usage logging to daily .jsonl files
│   └── requirements.txt
│
├── code-intelligence-service/  # Spaces backend (port 8002, FastAPI)
│   └── app/
│       ├── main.py             # FastAPI bootstrap, request context, origin guard
│       ├── llm.py              # Per-request OpenRouter key + RAG model
│       ├── config.py           # Embedding/reranker models, retrieval limits, feature flags
│       ├── routes/             # projects, ingest, retrieve, context, feedback, pipeline, graph_viz, debug
│       ├── services/           # search (hybrid + RRF + rerank), embedding, reranker, summarizer,
│       │                       # agent_loop, answer_generator, graph_builder, query_analyzer, ...
│       ├── workers/            # index_worker (batch embed)
│       └── db/                 # local_store (SQLite per project), queries
│
└── build/                    # Brand assets shipped via electron-builder extraResources
    ├── icon.icns              # macOS app icon
    ├── icon.ico               # Windows app icon
    ├── dock-icon.png          # macOS dev-mode dock icon
    ├── tray-iconTemplate.png  # macOS tray icon (template image)
    ├── tray-iconTemplate@2x.png
    ├── tray-icon.png          # Windows tray icon
    └── entitlements.mac.plist # macOS hardened-runtime entitlements (microphone, JIT)
```

---

## Architecture

| Layer | Technology |
|---|---|
| App Window | Electron Renderer · React 18 · Vite · TypeScript · Tailwind CSS · Shadcn UI · `hiddenInset` (mac) / frameless (win) |
| Overlay Window | Electron Renderer · React 18 (separate Vite entry) · `visibleOnAllWorkspaces` (mac) |
| Electron Main | Node.js · TypeScript · IPC · local SQLite (better-sqlite3) · Login Items · Dock control (mac) |
| Native Hook | Rust · N-API (`napi-rs`) · WH_KEYBOARD_LL (Win) · CGEventTap + Accessibility (mac) |
| Native Text Replace | SendInput (Win) · CGEventPost + clipboard restore (mac) |
| AI Service | Python · FastAPI · WebSocket · LiteLLM → OpenRouter · Clarifier · Task Planner · Deepgram relay (port 8001) |
| Code Intelligence (service) | Python · FastAPI · SQLite + FTS5 per project · ONNX embeddings + reranker · agentic retrieval (port 8002) |
| Code Intelligence (Electron) | Tree-sitter WASM (CodeParser) · Chokidar (FileWatcher) · SQLite hash cache · Git CLI introspection · CodeIntelClient HTTP |
| Active project detection | `active-win` npm package (window-title heuristics → project resolution) |
| Storage | Local SQLite app database + local attachments folder |
| Auto-launch at Login | Electron `setLoginItemSettings` — `openAsHidden` (mac), `--hidden` arg (Windows) |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the deep dive into every subsystem, IPC contract, data flow and algorithm, [code-intelligence-service/README.md](./code-intelligence-service/README.md) for how the retrieval (RAG) pipeline works, and [GRAPH_ARCHITECTURE.md](./code-intelligence-service/GRAPH_ARCHITECTURE.md) for the knowledge-graph design.

---

## Contributing

Issues and pull requests are welcome. Read [ARCHITECTURE.md](./ARCHITECTURE.md) before making significant changes, and run `npm test` before opening a PR.

## License

MIT
