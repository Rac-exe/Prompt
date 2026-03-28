# Prmpt — AI Prompt Optimizer

A Windows desktop application that optimizes AI prompts in real-time. Type `@prompt` anywhere on your system, press `Ctrl+5`, or click the tray icon to open a floating overlay that instantly refines your prompt using a multi-step LLM pipeline — without leaving whatever app you are working in.

**Website**: [tryprmpt.vercel.app](https://tryprmpt.vercel.app/)

---

## Two Windows, One App

Prmpt has two distinct windows that serve different use cases:

| | App Window | Overlay |
|---|---|---|
| **How to open** | Launch the app / tray → "Open App" | `@prompt` anywhere, `Ctrl+5`, or tray → "Open Overlay" |
| **Style** | Regular resizable window with sidebar | Frameless floating panel, always on top, near cursor |
| **Primary use** | Full chat sessions, history, library, settings | Quick one-off prompt optimization without leaving another app |
| **Persists** | Always visible while open | Closes after use (or click-away) |

---

## Features

### App Window
- **Full Chat Interface** — Multi-turn conversation with the optimizer. Each chat has a title, persists to Supabase, and is accessible from the sidebar history.
- **Sidebar Navigation** — Switch between Chat, History, Library, and Settings from a persistent left sidebar.
- **Chat History** — Browse, rename, delete, and resume any past session.
- **Version Navigator** — When you edit or retry a message, navigate between versions with `← 1/3 →` controls on each bubble.
- **Feedback** — Thumbs-up / thumbs-down on any assistant response.
- **Prompt Library** — Save optimized results to named collections. Mark favorites, edit titles/content, delete.
- **Share Pages** — `/share/:token` and `/share/prompt/:token` are public routes requiring no login, so anyone can view a shared collection or prompt.
- **Settings** — Light / dark mode, font size, optimizer model, custom instructions that are injected into every optimization.
- **Memory View** — Inspect, edit, or delete individual inferred memory entries (domain + writing style).
- **User Profile** — Change display name and avatar (resized and stored on Cloudinary). Sign out.
- **Onboarding** — First-run flow that collects display name and custom instructions immediately after signup.

### Overlay & Triggers
- **`@prompt` Trigger** — Type `@prompt` in any application on Windows. A native Rust keyboard hook detects it, erases the trigger text from your app, and opens the overlay ready to optimize.
- **`Ctrl+5` Shortcut** — Toggle the overlay from anywhere with a global keyboard shortcut.
- **System Tray** — Access the app and toggle the overlay from the Windows system tray.
- **Overlay Window** — Frameless, always-on-top floating panel positioned near your cursor, with a mouse-following emerald border glow effect. Preloaded hidden on startup for instant open.
- **Insert Result** — After optimizing, click "Insert" to paste the result directly back into the originating application.
- **Continue in App** — Open any overlay chat as a full session in the App Window.

### Prompt Optimization
- **Adaptive Real-time Streaming** — Buffered streaming engine that adapts delivery speed to network conditions, eliminating chunky rendering.
- **Multi-step Pipeline** — Decision Taker → Skill Selector → Context Summarizer → Prompt Optimizer. Automatically classifies input as `NEW`, `REFINEMENT`, or `ADDITION` and applies the right strategy.
- **Skill Selection** — Choose a specialization (Coding, Creative, Business, Email, etc.) via the Plus menu or `/` slash command.
- **Fast / Thinking Mode** — Switch between a fast cheap model and a slower, higher-quality model.
- **Guardrails** — Built-in system prompt safeguards ensure the AI improves *your prompt*, not writes content for you.
- **Smart Auto-titles** — Chat sessions are automatically titled based on content.

### Input
- **File Attachments** — Attach PDFs and images (PNG, JPG, WEBP) up to 5 files × 10 MB each. PDFs are text-extracted via PyMuPDF; images are processed by vision models.
- **Image Paste** — Paste images directly from the clipboard (`Ctrl+V`).
- **Voice Input** — Real-time microphone dictation via faster-Whisper with Silero VAD, streamed live as you speak.
- **Edit & Retry** — Edit any sent message or retry with unchanged content.
- **Stop Generation** — Cancel mid-stream at any time.

### Library & Sharing
- **Prompt Library** — Save optimized prompts into named collections with favorites.
- **Shareable Collections** — Generate a public link to share an entire collection. Recipients can browse and save to their own library.
- **Shareable Prompts** — Share individual prompts via unique links.
- **Full Chat History** — Rename, delete, and manage past sessions from the sidebar.

### Intelligence & Personalization
- **User Memory** — Automatically infers your domain expertise (Backend Dev, ML, Frontend, etc.) and writing style from your prompt history using exponential recency decay scoring. Stored in Supabase and prepended to future optimization context.
- **Custom Instructions** — Set persistent instructions that are injected into every optimization.
- **Theme & Font** — Light / dark mode, font size, and spacing preferences synced to the cloud.

### Infrastructure
- **Offline Mode** — Local JSON cache serves recent chats and messages when offline. Writes queue locally and sync on reconnect.
- **User Profiles** — Cloud-synced avatar (Cloudinary), display name, and preferences via Supabase.
- **Auth** — Email/password authentication with persistent session. Overlay and App Window stay in sync on login/logout.
- **Error Monitoring** — Sentry integrated in Electron main, React renderer, and Python service. Prompt content is automatically redacted from all error reports.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18+ | For Electron and the React frontend |
| Python | 3.10+ | For the AI / transcription service |
| OpenRouter API key | — | [openrouter.ai/keys](https://openrouter.ai/keys) — provides access to all LLM models |
| Supabase project | — | Auth, chat history, library, memory |
| Cloudinary account | — | Avatar and file attachment storage |
| Rust + `cargo` | stable | Only needed to rebuild the native Windows module |

> **Note**: The pre-compiled native module (`windows-core.win32-x64-msvc.node`) is included in the repo. You only need Rust if you modify the native code.

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
# Open .env and fill in your credentials (see Environment Variables below)
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

# ── LLM Models (via OpenRouter) ───────────────────────────────────────────────
OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPTIMIZER_MODEL=openrouter/anthropic/claude-haiku-4.5   # Main streaming model
SUMMARIZER_MODEL=openrouter/openai/gpt-4o-mini          # Cheap model for summaries/titles/memory

# ── Cloudinary (avatar + file uploads) ───────────────────────────────────────
VITE_CLOUDINARY_CLOUD_NAME=your-cloud-name
VITE_CLOUDINARY_UPLOAD_PRESET=your-upload-preset
CLOUDINARY_API_KEY=your-cloudinary-api-key
CLOUDINARY_API_SECRET=your-cloudinary-api-secret

# ── App Environment ───────────────────────────────────────────────────────────
NODE_ENV=development
APP_ENV=development

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
│       │   ├── auth/         # LoginPage, SignupPage, OnboardingPage, AuthWrapper
│       │   ├── chat/         # ChatView, MessageBubble, PlusMenu, SkillPicker, VersionNavigator
│       │   ├── feedback/     # FeedbackModal, FeedbackWidget
│       │   ├── layout/       # AppLayout, Sidebar, ProfileMenu
│       │   ├── library/      # PromptLibrary, SharedLibraryView, share modals
│       │   ├── profile/      # AvatarUploadModal
│       │   ├── settings/     # SettingsView, MemoryView
│       │   └── ui/           # Shadcn UI primitives + Logo component
│       ├── context/          # AuthContext
│       ├── hooks/            # useSmoothStreaming, useInitializeSettings, useMessageTree, etc.
│       ├── lib/              # utils, settings, skillIcons
│       ├── overlay/          # Overlay-specific React app (separate Vite entry point)
│       │   └── components/   # ChatArea, InputSection, Header, ChatPicker, AuthGate
│       ├── pages/            # Index.tsx (main orchestrator), SharePage, NotFound
│       └── types/            # electron.d.ts (window.electronAPI typings)
│
├── electron/
│   ├── main/                 # Electron main process (TypeScript)
│   │   ├── api/              # PythonClient (WebSocket), TranscriptionClient
│   │   ├── context/          # WindowTracker (active window context)
│   │   ├── database/
│   │   │   └── services/     # ChatService, MemoryService, PromptLibraryService, etc.
│   │   ├── ipc-handlers/     # chat, overlay, auth, skill, prompt-library handlers
│   │   ├── optimization/     # AI guardrails, response validator, session state
│   │   ├── overlay/          # OverlayWindowManager
│   │   ├── text/             # TextReplacer (@prompt text removal)
│   │   ├── utils/            # auth-state, native-bridge, network-monitor, validation
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
│   │   └── main.py           # FastAPI server: /optimize, /health, /ws/optimize, /ws/transcribe
│   ├── pipeline_v2/          # LLM pipeline
│   │   ├── optimizer.py      # Decision Taker → Skill Selector → Summarizer → Optimizer
│   │   ├── document_parser.py# PDF text extraction, image vision, file validation
│   │   ├── fast_mode.py      # Fast mode strategy
│   │   ├── context.py        # Chat context management
│   │   ├── config.py         # Model names, API keys from env
│   │   ├── skills.py         # Skill file loader
│   │   └── usage_logger.py   # Token usage logging
│   └── requirements.txt
│
└── supabase/
    └── migrations/           # Ordered SQL migration files
```

---

## Architecture

| Layer | Technology |
|---|---|
| App Window | Electron Renderer · React 18 · Vite · TypeScript · Tailwind CSS · Shadcn UI |
| Overlay Window | Electron Renderer · React 18 (separate Vite entry) |
| Electron Main | Node.js · TypeScript · IPC |
| Native Hook | Rust · N-API (`napi-rs`) · WH_KEYBOARD_LL |
| AI Service | Python · FastAPI · WebSocket · LiteLLM · faster-Whisper · Silero VAD |
| Database | Supabase (PostgreSQL + Auth + RLS) |
| File Storage | Cloudinary (avatars, attachments) |
| Error Monitoring | Sentry (Electron main, React renderer, Python service) |
| Local Cache | Electron-side JSON cache + write queue for offline support |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a full deep-dive into every subsystem, IPC contract, data flows, and key algorithms.

---

## Contributing

Please read [ARCHITECTURE.md](./ARCHITECTURE.md) before making significant changes.

## License

MIT
