<div align="center">

# Prmpt

### The AI Prompt Optimizer That Lives Inside Your Operating System

**Type `@prompt` in any app. Get an optimized prompt. Paste it anywhere.**

[Website](https://tryprmpt.vercel.app/) · [Architecture Deep Dive](./ARCHITECTURE.md) · [Full Technical Docs](./DEEP_DOCUMENTATION.md)

---

</div>

You type rough prompts. LLMs hallucinate. Prmpt fixes that at the source.

Prmpt is a **Windows desktop application** that intercepts your prompts before they reach any AI — and transforms them using a multi-step LLM pipeline that understands context, asks smart clarifying questions, retrieves your actual codebase, and produces prompts so precise that the output is structurally different from what you'd get without it.

It runs in your system tray. It hooks into your keyboard at the OS level. It's always one keystroke away.

---

## How It Actually Works

### Type `@prompt` Anywhere

A Rust-compiled, low-level `WH_KEYBOARD_LL` Windows keyboard hook monitors every keystroke across the entire operating system. When you type `@prompt` in VS Code, Slack, Notion, a browser text field, Discord — anywhere — the hook fires, erases the trigger text from your app using Win32 `SendInput`, and opens a floating overlay panel near your cursor. Optimized result → click "Insert" → it's back in your original app. No window switching. No copy-paste.

### Smart Clarification Before Optimization

Before optimizing, the pipeline runs a fast LLM analysis pass to detect what your prompt is missing. For a vague prompt like "fix this button hover", it asks: what framework? React + Tailwind? Vanilla CSS? Vue? The optimizer fabricates these details if you don't specify — Prmpt prevents that. For complex multi-part builds, it generates a structured task graph and produces a prompt broken into ordered, dependency-aware implementation sections.

### Your Codebase as Context

The **Spaces** feature indexes your local code repositories using Tree-sitter AST parsing and pgvector semantic search. When you write a prompt about a bug or feature in your codebase, Prmpt retrieves the exact functions, classes, and files relevant to your query — with actual code bodies, call graphs, and branch diff context — and injects them directly into the optimizer's system prompt. Your AI coding assistant finally has the context it needs.

---

## The Stack (And Why Every Choice Was Made)

| Layer | Technology | Why |
|---|---|---|
| **Desktop Shell** | Electron v32 · Node.js | Global keyboard hooks, system tray, offline filesystem, transparent frameless windows — impossible in a browser |
| **UI** | React 18 · TypeScript · Vite · Tailwind CSS · Radix UI | Concurrent rendering handles 30+ state updates/second during streaming without jank |
| **AI Pipeline** | Python · FastAPI · WebSocket · LiteLLM | Python-native AI ecosystem (LiteLLM, PyMuPDF, faster-whisper, torch, scipy) — no Node equivalents exist |
| **Code Indexing** | Tree-sitter WASM · Chokidar · pgvector | Language-agnostic CST parsing, incremental file watching, sub-100ms semantic retrieval |
| **Database** | Supabase · PostgreSQL · RLS | Managed Postgres with Row-Level Security, built-in auth, edge functions — no custom API server needed |
| **OS Integration** | Rust · N-API (napi-rs) · WH_KEYBOARD_LL | Memory-safe Win32 hook with thread-safe N-API callback to Node.js; `uiohook-napi` alternative can't do selective text replacement |
| **Voice Input** | faster-Whisper · Silero VAD | Local transcription — no cloud API key required; VAD filters silence so Whisper only sees speech frames |
| **Error Tracking** | Sentry | All prompt content is automatically scrubbed from error reports before transmission |
| **Analytics** | Custom EventBuffer → Supabase | Batched, offline-resilient event tracking; crash-recovery session detection via `duration_seconds: null` |

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

The App Window is a 1400×900 frameless SPA with a custom title bar and sidebar navigation.

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
- Semantic search retrieves the most relevant code — with actual code bodies — for any query
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

**Offline Mode**
Network monitor polls every 10 seconds. On connectivity loss: amber banner appears, send button disables, writes queue locally. On reconnect: queue drains to Supabase in order. Recent chats and messages served from a local JSON cache. Analytics events persisted to disk and replayed on next successful flush.

**Auth**
Email/password with persistent session cookie. OTP-based email verification for signup and password reset. Overlay and App Window stay in sync on login/logout via `auth:state-changed` IPC broadcast to all windows.

**Error Monitoring**
Sentry integrated in Electron main process, React renderer (both App Window and Overlay), and Python service. All prompt content is redacted from every error report — in breadcrumbs, extra data, request bodies, and stack frame variables — before leaving the machine.

**Analytics**
Session tracking with crash recovery detection. Granular usage events batched to Supabase with offline resilience. Daily usage summaries updated by a Supabase trigger. Crash-recovered sessions (where `duration_seconds IS NULL`) are excluded from session counts to prevent inflated metrics.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18+ | For Electron and the React frontend |
| Python | 3.10+ | For the AI / transcription service |
| OpenRouter API key | — | [openrouter.ai/keys](https://openrouter.ai/keys) — access to all LLM models |
| Supabase project | — | Auth, chat history, library, memory, code intelligence |
| Cloudinary account | — | Avatar and file attachment storage |
| Rust + `cargo` | stable | Only needed to rebuild the native Windows module |

> The pre-compiled native module (`windows-core.win32-x64-msvc.node`) is included in the repo. You only need Rust if you modify native code.

---

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/MrRaccooon/Prompt.git
cd Prompt

# 2. Install root Node dependencies (Electron)
npm install

# 3. Install React frontend dependencies
npm run install:ui

# 4. Set up the Python virtual environment and install dependencies
npm run python:install

# 5. Configure environment variables
cp .env.example .env
# Open .env and fill in your credentials
```

---

## Environment Variables

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

# ── Sentry (optional, for error monitoring) ───────────────────────────────────
SENTRY_DSN=https://...
VITE_SENTRY_DSN=https://...
SENTRY_PYTHON_DSN=https://...
SENTRY_AUTH_TOKEN=sntrys_...
SENTRY_ORG=your-org-slug
SENTRY_PROJECT=your-project-slug
```

---

## Database Setup

Apply the Supabase migrations to your project:

```bash
npm run supabase:migrate
```

Or apply them manually from `supabase/migrations/` in your Supabase SQL editor.

---

## Running the App

### Development

Open two terminals:

**Terminal 1 — Python AI Service:**
```bash
npm run python:dev
```

**Terminal 2 — Electron App:**
```bash
npm run dev
```

The Electron app compiles TypeScript and launches. The React frontend is served from the pre-built files in `electron/renderer/app-ui/`. To develop the frontend with hot reload, run `npm run dev:ui` in a third terminal.

### Production Build

```bash
npm run build        # Builds React frontend + compiles Electron TypeScript
npm run electron     # Launches Electron from the compiled output
```

Or in one command:
```bash
npm start
```

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
| `npm run python:dev` | Start Python service with hot reload (Windows) |
| `npm run python:dev:mac` | Start Python service with hot reload (macOS/Linux) |
| `npm run python:install` | Create venv and install Python dependencies |
| `npm run install:ui` | Install React frontend npm dependencies |
| `npm run native:build` | Build the Rust native module (release) |
| `npm run native:build:debug` | Build the Rust native module (debug) |
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
│   │   ├── overlay.html      # Legacy self-contained overlay (fallback)
│   │   ├── design-system.css # Shared CSS design tokens
│   │   └── app-ui/           # Built React app output (git-ignored, generated by build)
│   └── preload.ts            # contextBridge — exposes window.electronAPI to renderers
│
├── native/
│   └── windows-core/         # Rust N-API native module
│       └── src/
│           ├── lib.rs         # Exported N-API functions
│           ├── hook.rs        # WH_KEYBOARD_LL global keyboard hook
│           ├── replacement.rs # Text replacement (removes @prompt trigger)
│           ├── buffer.rs      # Keystroke ring buffer
│           └── keymap.rs      # Key code mapping
│
├── python-service/
│   ├── app/
│   │   ├── main.py           # FastAPI server: all HTTP + WebSocket endpoints
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
└── supabase/
    └── migrations/           # Ordered SQL migration files (schema + RLS + triggers)
```

---

## Architecture

| Layer | Technology |
|---|---|
| App Window | Electron Renderer · React 18 · Vite · TypeScript · Tailwind CSS · Shadcn UI |
| Overlay Window | Electron Renderer · React 18 (separate Vite entry) |
| Electron Main | Node.js · TypeScript · IPC · Analytics · Guardrails · Offline Queue |
| Native Hook | Rust · N-API (`napi-rs`) · WH_KEYBOARD_LL |
| AI Service | Python · FastAPI · WebSocket · LiteLLM · Clarifier · Task Planner · faster-Whisper · Silero VAD |
| Code Intelligence | Python · FastAPI · Tree-sitter WASM · Chokidar · pgvector · SQLite |
| Database | Supabase (PostgreSQL + Auth + RLS + Edge Functions) |
| File Storage | Cloudinary (avatars, attachments) |
| Error Monitoring | Sentry (Electron main, React renderer, Python service — prompt content redacted) |
| Local Cache | JSON chat cache + SQLite project hash cache + offline write queue + offline analytics buffer |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the complete deep-dive into every subsystem, IPC contract, data flow, and algorithm.

See [DEEP_DOCUMENTATION.md](./DEEP_DOCUMENTATION.md) for the exhaustive technical monograph — every implementation detail from first principles.

---

## Contributing

Read [ARCHITECTURE.md](./ARCHITECTURE.md) before making significant changes.

## License

MIT
