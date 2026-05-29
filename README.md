<div align="center">

# Prmpt

### The AI Prompt Optimizer That Lives Inside Your Operating System

**Type `@prompt` in any app. Get an optimized prompt. Paste it anywhere.**

[Website](https://tryprmpt.vercel.app/) · [Architecture Deep Dive](./ARCHITECTURE.md) · [Full Technical Docs](./DEEP_DOCUMENTATION.md)

---

</div>

You type rough prompts. LLMs hallucinate. Prmpt fixes that at the source.

Prmpt is a **cross-platform desktop application for Windows and macOS** that intercepts your prompts before they reach any AI — and transforms them using a multi-step LLM pipeline that understands context, asks smart clarifying questions, retrieves your actual codebase, and produces prompts so precise that the output is structurally different from what you'd get without it.

It runs in your system tray. It hooks into your keyboard at the OS level. It boots silently with your machine. It's always one keystroke away.

---

## Project Overview

Prmpt is built around three connected systems: **Prompt**, **Overlay**, and **Spaces**. Prompt is the intelligence layer, Overlay is the operating-system layer, and Spaces is the code-context layer.

### 1. Prompt — The Optimization Engine

Prompt is the core product loop: take a rough instruction, understand what the user is actually trying to do, and turn it into a structured prompt that produces better model output with less wasted context.

When a user submits a prompt, Prmpt routes it through a Python/FastAPI optimization service. The pipeline can classify the prompt, detect missing information, ask clarifying questions, attach files, apply custom instructions, use memory, and stream the final optimized result back to the desktop app. For simple prompts it stays fast; for complex implementation requests it can produce task-style output with ordered steps, constraints, and dependencies.

The Prompt layer includes:
- **Prompt optimization** — rewrites vague or under-specified prompts into precise, model-ready instructions.
- **Clarification** — asks targeted questions before optimization when the input is missing important details.
- **Task planning** — breaks complex requests into ordered implementation sections instead of one messy blob.
- **Streaming output** — returns tokens through WebSocket so the user sees progress immediately.
- **Memory and custom instructions** — learns stable preferences and applies user-defined rules across future optimizations.
- **Prompt library** — saves useful outputs into collections that can be reused, edited, shared, and copied later.
- **History and versioning** — keeps previous conversations, regenerated answers, edits, and feedback.

Production users do not provide model keys. Prmpt manages provider routing, billing, and model access through our own backend services. Development builds can use local `.env` values for contributor testing.

### 2. Overlay — The OS Layer and How Everything Connects

Overlay is what makes Prmpt feel native instead of like another chat tab. A Rust/N-API native module installs platform-specific keyboard hooks: `WH_KEYBOARD_LL` on Windows and `CGEventTap` on macOS. When the user types `@prompt` anywhere, Prmpt detects the trigger, removes it from the active application, opens a small floating overlay near the cursor, and keeps the user in the same workflow.

The overlay is a frameless, always-on-top Electron window. It is preloaded in the background so it opens quickly, supports text input, clarification cards, attachments, voice input, streaming output, and one-click insertion back into the originating application. Text insertion uses OS-level APIs: `SendInput` on Windows and `CGEventPost` with clipboard restore on macOS.

The connection flow is:

```text
User types @prompt in any app
  -> native keyboard hook detects the trigger
  -> Electron main process opens the Overlay
  -> Overlay sends the prompt to the Python optimization service
  -> Prompt pipeline clarifies, plans, optimizes, and streams output
  -> User clicks Insert
  -> Electron main process writes the optimized text back into the original app
```

Overlay also stays connected to the main app window. Auth state, active project status, Python service availability, offline state, and code-intel project updates are broadcast through IPC so the overlay can show whether Prmpt is ready, indexing, offline, or using an active Space as context.

> **macOS note:** On first launch, macOS prompts for **Accessibility** permission in System Settings → Privacy & Security → Accessibility. The keyboard hook and text replacement require this. Prmpt detects the permission state and surfaces a guided prompt.

### 3. Spaces — Code Context and Local Intelligence

Spaces are named workspaces connected to local repositories. They let Prmpt understand the user's actual codebase instead of optimizing prompts in isolation. A Space can index a project, watch it for changes, retrieve relevant files/functions, and feed that context into the prompt pipeline.

Electron owns the local filesystem side. It watches project folders with Chokidar, parses files with Tree-sitter WASM, extracts functions/classes/methods/imports/callees/signatures/line ranges, and skips unchanged files using SHA-256 hash checks. The code-intelligence service owns the indexing and retrieval logic: summarization, embeddings, hybrid search, reranking, graph expansion, and answer generation.

Phase 1 local code-intel stores the heavy index locally instead of in Supabase:
- **Local SQLite per project** — `code-intel/projects/<project_id>/index.db` stores chunk metadata, embeddings, summaries, relationships, communities, retrieval logs, FTS index, and file hashes.
- **No full source bodies in DB** — the DB stores `file_path`, `start_line`, and `end_line`; code snippets are read from the user's filesystem at retrieval time.
- **Live freshness** — file watchers update changed files, and Find mode can run a hash-diff freshness scan before retrieval so stale line ranges are repaired.
- **Server-side provider keys** — embeddings and LLM operations go through Prmpt-controlled services/proxy APIs; provider keys are not bundled into the desktop app.
- **Supabase stays lightweight** — auth, user data, chat history, prompt library, settings, analytics, and slim project metadata can remain remote. Heavy code chunks, vectors, relationships, and graph search data stay local.

Spaces has four user-facing modes:
- **Find** — fast code lookup with files, symbols, and exact line ranges.
- **Ask** — answers questions about the codebase with probable source locations.
- **Bug** — retrieves likely bug locations and related context for debugging prompts.
- **Optimize** — builds a context-rich implementation prompt from the most relevant code.

Spaces connects back into Prompt and Overlay. The main app is where users manage Spaces, add repositories, and inspect results. The overlay can show the active Space status and use indexed context when optimizing a prompt. The result is a desktop prompt optimizer that understands both what the user typed and the codebase they are working inside.

---

## The Stack (And Why Every Choice Was Made)

| Layer | Technology | Why |
|---|---|---|
| **Desktop Shell** | Electron v32 · Node.js | Global keyboard hooks, system tray, offline filesystem, transparent frameless windows — impossible in a browser |
| **UI** | React 18 · TypeScript · Vite · Tailwind CSS · Radix UI | Concurrent rendering handles 30+ state updates/second during streaming without jank |
| **AI Pipeline** | Python · FastAPI · WebSocket · LiteLLM | Python-native AI ecosystem (LiteLLM, PyMuPDF, faster-whisper, torch, scipy) — no Node equivalents exist |
| **Code Indexing (Electron-side)** | Tree-sitter WASM · Chokidar · local SQLite hash cache | Parses your repo into structural chunks in the desktop process, watches for file changes, hash-skips unchanged files, and ships only deltas to the code-intel runtime |
| **Code Intelligence Service** | Python · FastAPI · local SQLite · FTS5 · embeddings via Prmpt AI proxy | Hybrid retrieval: vector + full-text + concept + path search → RRF → rerank → graph expansion, with heavy code-intel data stored locally |
| **Database** | Supabase · PostgreSQL · RLS + local SQLite | Supabase handles auth, product data, chats, library, settings, and analytics. Local SQLite handles per-project code-intel indexes |
| **OS Integration** | Rust · N-API (napi-rs) · WH_KEYBOARD_LL (Win) · CGEventTap (macOS) | One memory-safe crate, two platform backends behind the same `TriggerAnchor` API. Selective text replacement with thread-safe N-API callback into Node |
| **Voice Input** | faster-Whisper · Silero VAD | Local transcription — no cloud API key required; VAD filters silence so Whisper only sees speech frames |
| **Error Tracking & Tracing** | Sentry (4 surfaces: Electron main, React app, React overlay, both Python services) | Spans, breadcrumbs, tags, session replay (renderers), `FastApiIntegration` (Python). All prompt content scrubbed via `beforeSend` before transmission |
| **Analytics** | Custom EventBuffer → Supabase | Batched, offline-resilient event tracking; crash-recovery session detection via `duration_seconds: null` |
| **Auto-launch** | Electron `setLoginItemSettings` | Silent boot in tray on macOS (`openAsHidden`) and Windows (`--hidden` arg). User-toggleable from the tray menu |

---

## Features

### The Overlay — Instant Optimization Without Leaving Your App

The overlay is a 520×600 px frameless, transparent, always-on-top Chromium window. It's preloaded hidden at startup so it opens in under 50ms. It tracks your cursor with a mouse-following emerald border glow effect (polling `screen.getCursorScreenPoint()` at ~60fps). It closes when you click away, unless you're mid-input.

- **`@prompt` anywhere** — Rust hook detects the trigger in any application
- **`Ctrl+5` global shortcut** — toggle the overlay from anywhere
- **Streaming output** — tokens appear with an adaptive buffered typewriter that adjusts drain speed to network conditions
- **Insert result** — one click replaces `@prompt` in the originating app with the optimized text
- **Clarification questions** — multi-choice questions appear when your prompt is ambiguous, then vanish when answered
- **File attachments** — PDFs and images, parsed inline
- **Voice input** — speak your prompt, watch it transcribe in real-time
- **Project status** — shows active Space and indexed code context

### The App Window — Full Power Interface

The App Window is a 1400×900 SPA with a custom title bar and sidebar navigation. On Windows it's fully **frameless** (custom controls); on macOS it uses `titleBarStyle: 'hiddenInset'` with native traffic-light buttons positioned at `(12, 12)` so the chrome looks native on each platform. The window appears in the **Dock and `Cmd+Tab` switcher only while it's visible** — when you close to tray, `app.dock.hide()` removes it from the switcher so Prmpt behaves as a true background app.

**Chat**
- Multi-turn conversation with the optimizer, persisted to Supabase
- Branching version history — regenerate any response and navigate between versions with `← 1/3 →` controls
- Clarification cards with staggered animation — questions appear one by one, multiple-choice with "Other" freetext, progress bar, extra notes field
- Task-sectioned output for complex builds — ordered implementation phases with dependency declarations
- Auto-generated chat titles, feedback (thumbs up/down), stop generation mid-stream

**Spaces (Code Intelligence)**
- Create named workspaces and attach local code repositories
- Tree-sitter parses your codebase into functions, classes, and methods with signatures and call graphs
- File watcher incrementally re-indexes changed files (2s debounce, hash-checked to skip unchanged)
- Hybrid local search retrieves the most relevant code metadata and hydrates current snippets from the filesystem
- Branch-aware context flags files modified in the current branch
- Compose a context-rich prompt and send it to the full optimizer

**History**
- All past sessions grouped by Today / Yesterday / Weekday / Date
- Click any entry to resume

**Prompt Library**
- Save optimized prompts to named collections
- Star favorites, edit, delete
- Share collections and individual prompts via cryptographically signed public links
- Recipients can browse and deep-copy to their own library — no account required to view

**Settings**
- Light / dark mode, font size (with zoom indicator)
- Optimizer model selection
- Custom instructions injected into every optimization
- Memory system toggle

**User Profile**
- Avatar upload (resized client-side, stored on Cloudinary)
- Display name, account management
- GDPR-compliant account deletion — 30-day grace period with cancellation

### Intelligence & Personalization

**User Memory System**
Runs automatically in the background every 5 optimizations. Analyzes your last 50 prompts using exponential recency decay weighting (`e^(-0.06 × index)`). Detects your domain expertise (Backend Dev, ML Engineering, Frontend, Data Science, DevOps) and writing style (concise, technical, verbose, creative, formal). Stores inferred facts in Supabase. Prepends them to future optimizations — so you never have to repeat "I'm a senior backend engineer who works in Python" again.

**AI Guardrails**
Built-in spam prevention: 10-character minimum, 90% Levenshtein similarity threshold (skips near-duplicate requests), 3-second cooldown, max 1 in-flight request per session.

**Custom Instructions**
Set once in Settings. Injected into every optimization. "I'm building a SaaS in Next.js 14 with Supabase and Tailwind. I prefer concise, typed code with no comments." Done.

### Infrastructure

**Silent Auto-Launch at Login**
Toggle "Start at Login" from the tray menu. When enabled, Prmpt boots with your machine into the system tray only — the main window stays hidden until you click the tray icon. Implemented via `app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true })` on macOS, plus `path: process.execPath, args: ['--hidden']` on Windows. The main process detects silent launches via `app.getLoginItemSettings().wasOpenedAsHidden` (macOS) or `process.argv.includes('--hidden')` (Windows) and skips `appWindowManager.show()` on boot.

**Offline Mode**
Network monitor polls every 10 seconds. On connectivity loss: amber banner appears, send button disables, writes queue locally. On reconnect: queue drains to Supabase in order. Recent chats and messages served from a local JSON cache. Analytics events persisted to disk and replayed on next successful flush.

**Auth**
Email/password with persistent session cookie. OTP-based email verification for signup and password reset. Overlay and App Window stay in sync on login/logout via `auth:state-changed` IPC broadcast to all windows.

**Error Monitoring & Tracing (Sentry)**
Sentry instruments **four runtime surfaces**: Electron main process (`@sentry/electron/main`), React App Window, React Overlay (both via `@sentry/react` with replay + browser tracing), Python optimization service (`sentry-sdk` + `LoggingIntegration` + WebSocket trace continuation), and the Python Code Intelligence service (`sentry-sdk` + `FastApiIntegration` for automatic route spans). Captures cover errors, performance traces, breadcrumbs (`code-intel`, `auto-launch`, `startup`, `analytics_session`, etc.), component tags, and renderer session replay. All prompt content and PII are redacted via `beforeSend` before leaving the machine.

**Analytics**
Session tracking with crash recovery detection. Granular usage events batched to Supabase with offline resilience. Daily usage summaries updated by a Supabase trigger. Crash-recovered sessions (where `duration_seconds IS NULL`) are excluded from session counts to prevent inflated metrics.

### Code Intelligence Service (Spaces)

A separate FastAPI service at `code-intelligence-service/` (port `8002`) is the retrieval brain of Spaces. Electron owns parsing and watching; the service owns summarization, embeddings, search, reranking, graph expansion, and answer generation.

- **Route groups** under `/api`: `projects`, `index/ingest`, `retrieve`, `context`, `sync`, `webhooks/github`, `feedback`, `pipeline`, and graph visualization
- **Local storage**: per-project SQLite `index.db` with chunks, summaries, embeddings, relationships, communities, FTS5, retrieval logs, and file hashes
- **No code bodies stored**: source snippets are hydrated from the local filesystem using `file_path + start_line + end_line`
- **Hybrid retrieval pipeline**: query preprocessing → multi-query decomposition → vector search + FTS5 + concept + file-path search → Reciprocal Rank Fusion → rerank → call-graph expansion
- **Freshness model**: Chokidar detects saves/renames/deletes, SHA-256 hashes skip unchanged files, and Find mode can run a hash-diff scan before returning results
- **Provider boundary**: embeddings and LLM calls route through Prmpt-controlled services/proxy APIs so provider keys stay server-side

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| OS | Windows 10/11 (x64) **or** macOS 12+ (Apple Silicon recommended) | Native `.node` artifacts shipped for both |

Prmpt handles everything else under the hood. All AI models, embedding services, database infrastructure, and cloud storage are managed by us. No API keys, no third-party accounts, no configuration required from the user.

> **macOS Accessibility:** the keyboard hook (`CGEventTap`) and text replacement (`CGEventPost`) require **Accessibility** permission. Grant it once in System Settings → Privacy & Security → Accessibility. The app polls for the permission and surfaces a dialog if missing.

### For Contributors

If you're building from source, see the [Development Setup](#development-setup) section below for the full stack requirements (Node.js, Python, Rust, etc.).

---

## Installation

Download the latest installer from [tryprmpt.com](https://tryprmpt.com):

- **Windows:** `.exe` installer (x64)
- **macOS:** `.dmg` installer (Apple Silicon / Intel)

Install, sign up, and you're ready to go.

---

<a id="development-setup"></a>

## Development Setup

> For contributors building from source only. End users should use the installer above.

```bash
# 1. Clone the repository
git clone https://github.com/MrRaccooon/Prompt.git
cd Prompt

# 2. Install root Node dependencies (Electron)
npm install

# 3. Install React frontend dependencies
npm run install:ui

# 4. Set up the Python virtual environments and install dependencies
#    On Windows:
npm run python:install
npm run code-intel:install
#    On macOS:
npm run python:install:mac
#    (The code-intel install script currently uses Windows-style paths;
#     on macOS create the venv manually:)
cd code-intelligence-service && python3 -m venv .venv && \
  ./.venv/bin/python -m pip install -r requirements.txt && cd ..

# 5. Configure environment variables
cp .env.example .env
cp code-intelligence-service/.env.example code-intelligence-service/.env
# Fill in your development credentials (see .env.example for details)
```

---

## Environment Variables

> **For development only.** Production builds ship with managed credentials. Contributors building from source need their own keys.

Copy `.env.example` to `.env` and fill in all values:

```env
# ── Supabase ─────────────────────────────────────────────────────────────────
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here

# ── Python Service ────────────────────────────────────────────────────────────
PYTHON_SERVICE_URL=http://127.0.0.1:8001

# ── Code Intelligence Service (optional — enables Spaces feature) ─────────────
CODE_INTELLIGENCE_SERVICE_URL=http://127.0.0.1:8002

# ── LLM Models (via OpenRouter) ───────────────────────────────────────────────
OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPTIMIZER_MODEL=openrouter/anthropic/claude-haiku-4.5   # Main streaming model
SUMMARIZER_MODEL=openrouter/openai/gpt-4o-mini          # Clarification / summaries / titles / memory
TITLE_MODEL=openrouter/openai/gpt-4o-mini               # Chat title generation
MEMORY_MODEL=openrouter/openai/gpt-4o-mini              # Memory extraction

# ── Voice (optional — cloud transcription fallback) ───────────────────────────
DEEPGRAM_API_KEY=your-deepgram-key                      # Used as fallback to local Whisper

# ── Cloudinary (avatar + file uploads) ───────────────────────────────────────
VITE_CLOUDINARY_CLOUD_NAME=your-cloud-name
VITE_CLOUDINARY_UPLOAD_PRESET=your-upload-preset
CLOUDINARY_API_KEY=your-cloudinary-api-key
CLOUDINARY_API_SECRET=your-cloudinary-api-secret

# ── App Environment ───────────────────────────────────────────────────────────
NODE_ENV=development
APP_ENV=development
APP_VERSION=0.0.0-dev

# ── Sentry (optional, for error monitoring + performance tracing) ─────────────
SENTRY_DSN=https://...                # Electron main process
VITE_SENTRY_DSN=https://...           # React renderers (App Window + Overlay; replay enabled)
SENTRY_PYTHON_DSN=https://...         # Optimization Python service (port 8001)
SENTRY_AUTH_TOKEN=sntrys_...          # For sourcemap upload at build time
SENTRY_ORG=your-org-slug
SENTRY_PROJECT=your-project-slug
```

The Code Intelligence service has its own `.env` at `code-intelligence-service/.env` (template at `.env.example`):

```env
# ── Supabase ──────────────────────────────────────────────────────────────────
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=...

# ── Embedding + summarization ─────────────────────────────────────────────────
OPENAI_API_KEY=sk-...                 # Required for text-embedding-3-small (512 dim)
OPENROUTER_API_KEY=sk-or-v1-...       # Optional fallback / summarizer routing
SUMMARIZER_MODEL=openrouter/openai/gpt-4.1-nano
QUERY_DECOMPOSE_MODEL=openrouter/openai/gpt-4o-mini

# ── Background workers (optional) ─────────────────────────────────────────────
REDIS_URL=redis://localhost:6379       # If unset/unreachable, falls back to inline async
GITHUB_WEBHOOK_SECRET=...              # Optional — for /api/webhooks/github

# ── Observability ─────────────────────────────────────────────────────────────
SENTRY_DSN=https://...                # FastApiIntegration auto-spans every route
APP_ENV=development                   # dev → traces_sample_rate=1.0, prod → 0.2
APP_VERSION=1.0.1
```

---

## Database Setup

> **For development only.** Production database is managed by the Prmpt team.

Apply the Supabase migrations to your project:

```bash
npm run supabase:migrate
```

Or apply them manually from `supabase/migrations/` in your Supabase SQL editor.

---

## Running the App

### Development

Open three terminals (the Code Intelligence service is optional but required for Spaces):

**Terminal 1 — Python Optimization Service** (port 8001):
```bash
npm run python:dev          # Windows
npm run python:dev:mac      # macOS / Linux
```

**Terminal 2 — Code Intelligence Service** (port 8002, powers Spaces):
```bash
npm run code-intel:dev      # Windows
npm run code-intel:dev:mac  # macOS / Linux
```

**Terminal 3 — Electron App:**
```bash
npm run dev
```

The Electron app compiles TypeScript and launches. The React frontend is served from the pre-built files in `electron/renderer/app-ui/`. To develop the frontend with hot reload, run `npm run dev:ui` in a fourth terminal.

> If Redis is running locally on the default port, the Code Intelligence service will use ARQ for background ingest. Otherwise it falls back to inline async tasks.

### Production Build

```bash
npm run build        # Builds React frontend + compiles Electron TypeScript
npm run electron     # Launches Electron from the compiled output
```

Or in one command:
```bash
npm start
```

### Packaging Installers

```bash
npm run package:win    # NSIS installer (Windows x64)
npm run package:mac    # DMG installer (macOS — universal/arm64 per electron-builder config)
```

The mac build uses `build/entitlements.mac.plist` (microphone, JIT) and runs hardened. Both packages bundle the platform-specific native `.node` files plus brand assets (`build/icon.icns`, `build/icon.ico`, `build/dock-icon.png`, `build/tray-iconTemplate.png` for macOS, `build/tray-icon.png` for Windows) declared under `extraResources` in `package.json`.

---

## npm Scripts Reference

| Script | Description |
|---|---|
| `npm run dev` | Compile Electron TS + launch Electron |
| `npm run dev:ui` | Start Vite dev server for the React frontend |
| `npm run dev:full` | Build everything (UI + Electron) then launch |
| `npm run build` | Build React frontend + compile Electron TypeScript |
| `npm run build:ui` | Build only the React frontend (Vite) |
| `npm run build:electron` | Compile only Electron TypeScript (`tsc`) |
| `npm run electron` | Launch Electron (requires prior build) |
| `npm start` | Full build + launch (same as `dev:full`) |
| `npm run python:dev` | Start the optimization Python service with hot reload (Windows) |
| `npm run python:dev:mac` | Start the optimization Python service with hot reload (macOS / Linux) |
| `npm run python:install` | Create venv and install Python deps for the optimizer (Windows) |
| `npm run python:install:mac` | Create venv and install Python deps for the optimizer (macOS / Linux) |
| `npm run code-intel:dev` | Start the Code Intelligence service with hot reload (Windows, port 8002) |
| `npm run code-intel:dev:mac` | Start the Code Intelligence service with hot reload (macOS / Linux, port 8002) |
| `npm run code-intel:install` | Create venv and install deps for the Code Intelligence service (Windows) |
| `npm run install:ui` | Install React frontend npm dependencies |
| `npm run native:build` | Build the Rust native module for the host platform (release) |
| `npm run native:build:mac` | Build the Rust native module on macOS (release) |
| `npm run native:build:debug` | Build the Rust native module (debug) |
| `npm run package:win` | Build NSIS installer (Windows x64) |
| `npm run package:mac` | Build DMG installer (macOS) |
| `npm run supabase:migrate` | Push Supabase migrations |
| `npm run clean` | Delete `dist/` and `electron/renderer/app-ui/` |

---

## Project Structure

```
├── .env.example              # Environment variable template
├── package.json              # Root: Electron config and scripts
│
├── app-ui/                   # React frontend (Vite + TypeScript)
│   └── src/
│       ├── components/
│       │   ├── auth/         # LoginPage, SignupPage, OtpVerification, OnboardingPage, AuthWrapper
│       │   ├── chat/         # ChatView, MessageBubble, ClarificationCard, ClarificationSummaryCard,
│       │   │                 # PlusMenu, SkillPicker, VersionNavigator, FeedbackWidget, SavePromptModal
│       │   ├── feedback/     # FeedbackModal
│       │   ├── history/      # HistoryView (date-grouped past sessions)
│       │   ├── layout/       # AppLayout, Sidebar, ProfileMenu, ZoomIndicator
│       │   ├── library/      # PromptLibrary, SharedLibraryView, share modals
│       │   ├── profile/      # AvatarUploadModal
│       │   ├── projects/     # ProjectsView, SpacesList, SpaceWorkspace, types.ts
│       │   ├── settings/     # SettingsView, MemoryView
│       │   └── ui/           # Shadcn UI primitives + Logo, MarkdownContent
│       ├── context/          # AuthContext
│       ├── hooks/            # useSmoothStreaming, useInitializeSettings, useMessageTree, etc.
│       ├── lib/              # utils, settings, skillIcons
│       ├── overlay/          # Overlay React app (separate Vite entry point)
│       │   ├── components/   # ChatArea, InputSection, Header, ChatPicker, AuthGate,
│       │   │                 # CollectionPicker, OfflineBanner, ProjectStatus
│       │   ├── hooks/        # useTurns
│       │   └── lib/          # constants, types, utils
│       ├── pages/            # Index.tsx (main orchestrator), SharePage, NotFound
│       └── types/            # electron.d.ts (window.electronAPI typings)
│
├── electron/
│   ├── main/                 # Electron main process (TypeScript)
│   │   ├── analytics/        # AnalyticsService, EventBuffer (session + event tracking)
│   │   ├── api/              # PythonClient (WebSocket), TranscriptionClient, CodeIntelClient
│   │   ├── context/          # WindowTracker (active window tracking)
│   │   ├── database/
│   │   │   ├── services/     # ChatService, MemoryService, PromptLibraryService,
│   │   │   │                 # AuthService, DeletionService, RateLimitService, etc.
│   │   │   ├── local-cache.ts        # Recent chat cache (JSON)
│   │   │   ├── local-project-cache.ts# File hash cache (SQLite) for incremental indexing
│   │   │   ├── offline-queue.ts      # Deferred Supabase writes
│   │   │   └── error-log.ts          # Local error log
│   │   ├── ipc-handlers/     # chat, overlay, auth, skill, prompt-library, feedback,
│   │   │                     # deletion, project handlers + network monitor
│   │   ├── optimization/     # AIGuardrails, ResponseValidator, SessionState, StabilityTracker
│   │   ├── overlay/          # OverlayWindowManager
│   │   ├── services/         # CodeParser (tree-sitter), FileWatcher (chokidar),
│   │   │                     # GitService, ActiveWindowDetector, EmailService
│   │   ├── text/             # TextReplacer (@prompt text removal)
│   │   ├── types/            # user-types.ts (analytics event types, shared interfaces)
│   │   ├── utils/            # auth-state, native-bridge, network-monitor, validation,
│   │   │                     # windows-key-sender, window-detector
│   │   └── windows/          # AppWindowManager, SystemTray
│   ├── renderer/
│   │   ├── design-system.css # Shared CSS design tokens
│   │   └── app-ui/           # Built React app output (git-ignored, generated by build)
│   └── preload.ts            # contextBridge — exposes window.electronAPI to renderers
│
├── native/
│   └── platform-core/         # Rust N-API native module (cross-platform: Windows + macOS)
│       ├── platform-core.win32-x64-msvc.node    # Pre-built Windows binary
│       ├── platform-core.darwin-arm64.node      # Pre-built macOS Apple Silicon binary
│       ├── index.js                            # Loader that picks the right .node per platform
│       └── src/
│           ├── lib.rs         # Exported N-API functions; platform dispatch (Win32 / NSWorkspace)
│           ├── hook.rs        # Keyboard hook — WH_KEYBOARD_LL (Win) + CGEventTap (macOS)
│           ├── replacement.rs # Text replacement — SendInput (Win) + CGEventPost/clipboard (mac)
│           ├── buffer.rs      # Keystroke ring buffer
│           └── keymap.rs      # Key code mapping (Windows-only; mac path uses CGKeyCode)
│
├── python-service/
│   ├── app/
│   │   ├── main.py           # FastAPI server: all HTTP + WebSocket endpoints (port 8001)
│   │   ├── auth.py           # JWT validation middleware
│   │   ├── email_otp.py      # OTP-based email verification + password reset
│   │   └── skills/           # Skill prompt files (skill_coding.md, skill_email.md, etc.)
│   ├── pipeline_v2/          # LLM pipeline
│   │   ├── optimizer.py      # Decision Taker → Skill Selector → Summarizer → Optimizer
│   │   ├── clarifier.py      # LLM clarification question generator
│   │   ├── task_planner.py   # Pre-pass task graph for complex sectioned builds
│   │   ├── project_context.py# Fetches + formats Code Intelligence context
│   │   ├── document_parser.py# PDF text extraction, image vision, file validation
│   │   ├── fast_mode.py      # Fast mode keyword-based prompt classification
│   │   ├── context.py        # Chat context management
│   │   ├── config.py         # Model names, API keys from env
│   │   ├── skills.py         # Skill file loader
│   │   └── usage_logger.py   # Token usage logging to daily .jsonl files
│   └── requirements.txt
│
├── code-intelligence-service/  # Spaces backend (port 8002, FastAPI)
│   └── app/
│       ├── main.py             # FastAPI bootstrap, Sentry init (FastApiIntegration), CORS, rate limit
│       ├── config.py           # 512-dim embeddings, model names, retrieval limits, Redis URL
│       ├── auth.py             # Supabase JWT verification
│       ├── routes/             # projects, ingest, retrieve, context, sync, webhooks (GitHub)
│       ├── services/           # search (hybrid + RRF + rerank), embedding, summarizer,
│       │                       # query_analyzer, query_preprocessor, code_analyzer, project_summary
│       ├── workers/            # arq_worker (queue), index_worker (batch embed), sync_worker (GitHub poll)
│       └── db/                 # Supabase client + queries
│
├── build/                     # Brand assets shipped via electron-builder extraResources
│   ├── icon.icns              # macOS app icon (Prmpt logo)
│   ├── icon.ico               # Windows app icon
│   ├── dock-icon.png          # macOS dev-mode dock icon (used by app.dock.setIcon in dev)
│   ├── tray-iconTemplate.png  # macOS tray icon (template image — auto inverts in dark/light menu bar)
│   ├── tray-iconTemplate@2x.png
│   ├── tray-icon.png          # Windows tray icon (full color)
│   └── entitlements.mac.plist # macOS hardened-runtime entitlements (microphone, JIT)
│
└── supabase/
    └── migrations/           # Ordered SQL migration files (schema + RLS + triggers + HNSW vector index)
```

---

## Architecture

| Layer | Technology |
|---|---|
| App Window | Electron Renderer · React 18 · Vite · TypeScript · Tailwind CSS · Shadcn UI · `hiddenInset` (mac) / frameless (win) |
| Overlay Window | Electron Renderer · React 18 (separate Vite entry) · `visibleOnAllWorkspaces` (mac) |
| Electron Main | Node.js · TypeScript · IPC · Analytics · Guardrails · Offline Queue · Login Items · Dock control (mac) |
| Native Hook | Rust · N-API (`napi-rs`) · WH_KEYBOARD_LL (Win) · CGEventTap + Accessibility (mac) |
| Native Text Replace | SendInput (Win) · CGEventPost + clipboard restore (mac) |
| AI Service | Python · FastAPI · WebSocket · LiteLLM · Clarifier · Task Planner · faster-Whisper · Silero VAD (port 8001) |
| Code Intelligence (server) | Python · FastAPI · OpenAI embeddings (512-dim) · pgvector HNSW · ARQ + Redis (optional) (port 8002) |
| Code Intelligence (Electron) | Tree-sitter WASM (CodeParser) · Chokidar (FileWatcher) · SQLite hash cache · Git CLI introspection · CodeIntelClient HTTP |
| Active project detection | `active-win` npm package (window-title heuristics → project resolution) |
| Database | Supabase (PostgreSQL + Auth + RLS + Edge Functions + pgvector HNSW for chunks) |
| File Storage | Cloudinary (avatars, attachments) |
| Auto-launch at Login | Electron `setLoginItemSettings` — `openAsHidden` (mac), `--hidden` arg (Windows) |
| Observability | Sentry across 4 surfaces (Electron main, React App, React Overlay, both Python services) — spans, breadcrumbs, replay, FastApiIntegration; PII scrubbed |
| Local Cache | JSON chat cache + SQLite project hash cache + offline write queue + offline analytics buffer |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the complete deep-dive into every subsystem, IPC contract, data flow, and algorithm.

See [DEEP_DOCUMENTATION.md](./DEEP_DOCUMENTATION.md) for the exhaustive technical monograph — every implementation detail from first principles.

---

## Contributing

Read [ARCHITECTURE.md](./ARCHITECTURE.md) before making significant changes.

## License

MIT
