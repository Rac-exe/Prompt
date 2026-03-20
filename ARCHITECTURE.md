# Prmpt — System Architecture

## 1. System Overview

Prmpt is a desktop application that optimizes AI prompts in real-time. It combines a React-based Electron frontend, a Python FastAPI backend for LLM processing, and Supabase for cloud persistence.

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Interaction                          │
└──────────────────────────┬──────────────────────────────────────┘
                           │
          ┌────────────────┴────────────────┐
          │                                 │
   ┌──────▼──────┐                  ┌───────▼──────┐
   │  App Window  │                  │ Overlay Window│
   │  (React UI)  │                  │ (overlay.html)│
   └──────┬──────┘                  └───────┬──────┘
          │  contextBridge (IPC)            │  contextBridge (IPC)
          └────────────────┬────────────────┘
                           │
              ┌────────────▼────────────┐
              │   Electron Main Process  │
              │   (IPC Handlers)         │
              └──┬──────────┬───────────┘
                 │          │
        ┌────────▼──┐  ┌────▼──────────┐
        │  Supabase  │  │ Python Service │
        │  (Cloud DB)│  │ (FastAPI/WS)   │
        └────────────┘  └───────────────┘
```

---

## 2. Component Details

### 2.1. App Window Frontend (Electron Renderer — React)

**Technology**: React 18, TypeScript, Vite, Tailwind CSS, Shadcn UI (Radix)

**Key Components:**

| Component | Responsibility |
|---|---|
| [`Index.tsx`](app-ui/src/pages/Index.tsx) | Main orchestrator — manages all state, IPC listeners, view routing |
| [`ChatView.tsx`](app-ui/src/components/chat/ChatView.tsx) | Chat input bar, file attachments, skill selection, voice input, auto-scroll |
| [`MessageBubble.tsx`](app-ui/src/components/chat/MessageBubble.tsx) | User/assistant message rendering, image thumbnails, lightbox, edit/retry |
| [`PlusMenu.tsx`](app-ui/src/components/chat/PlusMenu.tsx) | Popover for file upload and skill selection |
| [`SkillPicker.tsx`](app-ui/src/components/chat/SkillPicker.tsx) | Searchable skill list with keyboard navigation |
| [`Sidebar.tsx`](app-ui/src/components/layout/Sidebar.tsx) | Navigation, chat history, rename/delete context menus |
| [`PromptLibrary.tsx`](app-ui/src/components/library/PromptLibrary.tsx) | Collections, saved prompts, share collection modal |
| [`SharedLibraryView.tsx`](app-ui/src/components/library/SharedLibraryView.tsx) | Read-only view of a shared collection via token |
| [`SettingsView.tsx`](app-ui/src/components/settings/SettingsView.tsx) | Theme, font, custom instructions, model settings |
| [`MemoryView.tsx`](app-ui/src/components/settings/MemoryView.tsx) | View/edit/delete inferred user memory entries |
| [`AuthContext.tsx`](app-ui/src/context/AuthContext.tsx) | Centralized auth state (user profile + preferences) |

**Key Hooks:**

| Hook | Purpose |
|---|---|
| [`useSmoothStreaming`](app-ui/src/hooks/useSmoothStreaming.ts) | Adaptive buffered streaming engine |
| [`useInitializeSettings`](app-ui/src/hooks/useInitializeSettings.ts) | Loads and applies user settings on auth |

---

### 2.2. Overlay Window

**File**: [`electron/renderer/overlay.html`](electron/renderer/overlay.html) — 2,300+ line self-contained HTML/JS/CSS file.

The overlay is a separate, always-on-top `BrowserWindow` (520×600px, transparent, frameless). It provides instant prompt optimization without leaving the current application.

**Features:**
- Triggered via `Ctrl+5` or tray icon
- Positions near the cursor (Raycast-style)
- Full chat interface (streaming, edit, retry, save to library)
- Fast/Thinking mode selector
- Voice input
- Offline banner
- Mouse-following emerald border glow effect (IPC cursor polling at ~60fps)
- Auth guard — shows login prompt if not authenticated

**IPC Contract (Overlay ↔ Main):**

| Direction | Channel | Purpose |
|---|---|---|
| Renderer → Main | `overlay:optimize` | Start streaming optimization |
| Renderer → Main | `overlay:save` | Save prompt to library |
| Renderer → Main | `overlay:insert` | Replace text in originating window |
| Renderer → Main | `overlay:close` | Hide overlay |
| Main → Renderer | `overlay:optimization-chunk` | Streaming token |
| Main → Renderer | `overlay:optimization-complete` | Final result |
| Main → Renderer | `overlay:cursor-pos` | Global cursor position (for glow effect) |
| Main → Renderer | `overlay:opened` | Auth state on open |

---

### 2.3. Electron Main Process

**Technology**: Electron (Node.js), TypeScript

**IPC Handlers** (`electron/main/ipc-handlers/`):

| File | Handles |
|---|---|
| [`chat-handlers.ts`](electron/main/ipc-handlers/chat-handlers.ts) | App window: send message, load/create/delete/rename chats, file validation |
| [`overlay-ipc-handlers.ts`](electron/main/ipc-handlers/overlay-ipc-handlers.ts) | Overlay: optimize, save, insert, cursor polling |
| [`auth-handlers.ts`](electron/main/ipc-handlers/auth-handlers.ts) | Sign in, sign up, session management |
| [`prompt-library-handlers.ts`](electron/main/ipc-handlers/prompt-library-handlers.ts) | Collections CRUD, prompt CRUD, share tokens |
| [`skill-handlers.ts`](electron/main/ipc-handlers/skill-handlers.ts) | List skill files from `files/skill_*.md` |
| [`settings-handlers.ts`](electron/main/ipc-handlers/settings-handlers.ts) | Load/save user settings |
| [`user-handlers.ts`](electron/main/ipc-handlers/user-handlers.ts) | Profile updates, avatar upload |
| [`avatar-handlers.ts`](electron/main/ipc-handlers/avatar-handlers.ts) | Avatar image processing and upload |

**Services** (`electron/main/database/services/`):

| Service | Responsibility |
|---|---|
| [`ChatService`](electron/main/database/services/chat-service.ts) | CRUD for chats and messages |
| [`PromptLibraryService`](electron/main/database/services/prompt-library-service.ts) | Collections, prompts, share tokens |
| [`MemoryService`](electron/main/database/services/memory-service.ts) | Read/write user memory entries |
| [`MemoryAnalyzer`](electron/main/database/services/memory-analyzer.ts) | Infer domain + style from prompt history |
| [`UserService`](electron/main/database/services/user-service.ts) | Profile and preferences |
| [`SettingsService`](electron/main/database/services/settings-service.ts) | User settings persistence |
| [`OptimizationService`](electron/main/database/services/optimization-service.ts) | Optimization metadata tracking |

**Other:**

| Module | Purpose |
|---|---|
| [`OverlayWindowManager`](electron/main/overlay/overlay-window-manager.ts) | Create, show, hide, position overlay window |
| [`PythonClient`](electron/main/api/python-client.ts) | WebSocket client to Python service |
| [`TranscriptionClient`](electron/main/api/transcription-client.ts) | Voice transcription integration |
| [`localCache`](electron/main/database/local-cache.ts) | In-memory + disk cache for offline support |
| [`offlineQueue`](electron/main/database/offline-queue.ts) | Queue writes when offline, flush on reconnect |
| [`networkMonitor`](electron/main/ipc-handlers/network-monitor-singleton.ts) | Online/offline detection |

---

### 2.4. Python AI Service

**Technology**: Python, FastAPI, WebSocket, LiteLLM

**Entry point**: [`python-service/app/main.py`](python-service/app/main.py)

**Pipeline** (`python-service/pipeline_v2/`):

| Module | Role |
|---|---|
| [`optimizer.py`](python-service/pipeline_v2/optimizer.py) | Main LLM orchestrator — Decision Taker, Skill Selector, Context Summarizer, Prompt Optimizer |
| [`document_parser.py`](python-service/pipeline_v2/document_parser.py) | File processing — PDF text extraction (PyMuPDF), image vision API, magic-byte validation, 10MB/8K token limits |
| [`skills.py`](python-service/pipeline_v2/skills.py) | Load and parse `files/skill_*.md` skill files |
| [`fast_mode.py`](python-service/pipeline_v2/fast_mode.py) | Fast mode prompt type detection and strategy |
| [`context.py`](python-service/pipeline_v2/context.py) | Chat context management |
| [`usage_logger.py`](python-service/pipeline_v2/usage_logger.py) | LLM token usage logging |

**Optimizer Pipeline Steps:**
1. **Decision Taker** — Classifies input as `NEW` / `REFINEMENT` / `ADDITION`
2. **Skill Selector** — Loads matching skill file (or auto-detects from memory)
3. **Context Summarizer** — Compresses chat context if > 3,000 tokens (uses a cheap/fast model)
4. **Prompt Optimizer** — Sends full context to LLM, streams result via WebSocket

**Vision Model Support:**
Auto-detected from model name. Supported: GPT-4o/mini, Claude 3.5 Sonnet/Haiku, Claude 4.x Haiku, Gemini 1.5 Flash/Pro.

---

### 2.5. Data Persistence (Supabase)

**Tables:**

| Table | Purpose |
|---|---|
| `user_profiles` | User identity, avatar, display name |
| `user_preferences` | Theme, font, model settings, custom instructions |
| `chats` | Chat session metadata (title, timestamps) |
| `messages` | Individual messages with role, content, metadata |
| `prompt_collections` | Named collections with share tokens |
| `saved_prompts` | Individual saved prompts with collection FK |
| `user_memory` | Inferred user memory (domain, style, context) |

**Views:**
- `user_full_profile` — Aggregates profile + preferences for efficient single-fetch

---

## 3. Key Workflows

### 3.1. Adaptive Buffered Streaming

Solves "bursty" network packets causing clumpy text rendering:

1. **Producer**: `onOptimizationChunk` IPC event adds tokens to a hidden `StreamBuffer` (React Ref — no re-render).
2. **Consumer**: A `requestAnimationFrame` loop reads from the buffer and updates visible state.
3. **Adaptive Logic** (in [`useSmoothStreaming.ts`](app-ui/src/hooks/useSmoothStreaming.ts)):
   - Buffer < 10 chars → 1 char/tick (smooth, natural feel)
   - Buffer 10–50 chars → 2–3 chars/tick (catch up)
   - Buffer > 50 chars → 5+ chars/tick (fast-forward)
4. **Synchronization**: When the final DB message arrives, the UI waits for the visual stream to complete before swapping the temp ID with the real DB ID.

### 3.2. File Attachment Flow

1. User selects files via Plus menu or pastes from clipboard.
2. Files are converted to base64 in the renderer.
3. On send, `chat-handlers.ts` validates (type, size, count limits).
4. Validated files are forwarded to `pythonClient.optimizeStream()` as `attached_files`.
5. Python's `document_parser.py` extracts text from PDFs or passes images to vision API.
6. File metadata is stored in the message's Supabase `metadata` JSON column.
7. On reload, file metadata is restored from DB (thumbnails show icon pills if base64 not stored).

### 3.3. User Memory System

Runs in the background every 5 optimizations:

1. `MemoryAnalyzer.maybeRun()` is called after each optimization.
2. Fetches the last 50 optimization prompts from Supabase.
3. Applies **exponential recency decay** scoring (`weight = e^(-0.06 * index)`).
4. Detects domains (Backend Dev, ML, Frontend, etc.) and writing styles (concise, technical, etc.).
5. Stores top-scoring domains and styles in `user_memory` table.
6. On next optimization, memory context is prepended to the system prompt.

### 3.4. Prompt Library Sharing

**Share a Collection:**
1. User clicks Share on a collection → `promptLibrary.getShareLink(collectionId)`.
2. Main process generates a UUID `share_token` and stores it in `prompt_collections`.
3. Returns a URL: `https://tryprmpt.vercel.app/share/{token}`.
4. Recipient opens URL → web app or Electron fetches collection via `getSharedCollection(token)`.
5. Recipient can save the entire collection to their own library.

**Share a Prompt:**
1. Same flow but for individual prompts via `getPromptShareLink(promptId)`.
2. Stored in `saved_prompts.share_token`.

### 3.5. Overlay Cursor Glow

1. `startCursorPolling()` in `overlay-ipc-handlers.ts` polls `screen.getCursorScreenPoint()` at ~60fps.
2. Calculates cursor position relative to the overlay window bounds.
3. Sends `overlay:cursor-pos` IPC event to the renderer.
4. Renderer updates the `.panel-glow-wrapper` background with a `radial-gradient` centred on the cursor.
5. The wrapper's 1px padding is the only visible part — the panel's dark background covers the interior.
6. Glow fades out after 1.5s of inactivity.

### 3.6. Offline Mode

1. `networkMonitor` detects connectivity changes and broadcasts `network-status` IPC events.
2. On disconnect: UI shows amber offline banner; send button is disabled.
3. Chat/message loads fall back to `localCache` (in-memory + disk).
4. Top 5 recent chats are pre-cached on every online load.
5. Write operations are queued in `offlineQueue` and flushed on reconnect.

---

## 4. IPC Bridge (preload.ts)

[`electron/preload.ts`](electron/preload.ts) exposes a typed `window.electronAPI` object via `contextBridge`. All renderer ↔ main communication goes through this bridge. Key namespaces:

- `window.electronAPI.overlay.*` — Overlay operations
- `window.electronAPI.transcription.*` — Voice input
- `window.electronAPI.promptLibrary.*` — Library CRUD + sharing
- `window.electronAPI.memory.*` — User memory read/write/delete
- `window.electronAPI.windowControls.*` — Frameless window controls
- `window.electronAPI.onNetworkStatus` — Connectivity events

---

## 5. Design System

The app uses a custom Tailwind design system defined in [`app-ui/src/index.css`](app-ui/src/index.css):

- **Light mode**: Warm peach canvas (`#FFF4ED`) with blue brand accent mapped to `--emerald` tokens.
- **Dark mode**: Deep slate background with true emerald green accent.
- **Custom tokens**: `--surface`, `--surface-hover`, `--surface-elevated`, `--emerald`, `--emerald-soft`, `--emerald-muted`.
- **Animations**: `animate-slide-up`, `animate-fade-in`, `transition-smooth`, `transition-button`.
