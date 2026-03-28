# Prmpt — System Architecture

## 1. System Overview

Prmpt is a Windows desktop application that optimizes AI prompts in real-time. It consists of five cooperating subsystems:

- **Electron Main Process** — orchestrator, IPC hub, window lifecycle
- **App Window** — React UI for full chat, history, library, and settings
- **Overlay Window** — React UI in a frameless always-on-top floating panel
- **Python AI Service** — FastAPI server for LLM streaming, voice transcription
- **Rust Native Module** — global keyboard hook and text replacement via Win32 API

```
┌──────────────────────────────────────────────────────────────────────┐
│                          User / OS                                    │
│   Types "@prompt" anywhere   │   Presses Ctrl+5   │  Clicks tray     │
└───────────────┬──────────────┴────────┬───────────┴──────────────────┘
                │                       │
     ┌──────────▼────────┐              │
     │  Rust Native Hook  │             │
     │  (WH_KEYBOARD_LL) │             │
     └──────────┬─────────┘            │
                │ TriggerAnchor         │
                └──────────────────────▼──────────────────────┐
                                                              │
                              ┌───────────────────────────────▼──────┐
                              │        Electron Main Process          │
                              │  (index-new.ts — IPC Hub)             │
                              └──┬───────────────────────┬────────────┘
                                 │                       │
               ┌─────────────────▼──┐        ┌──────────▼────────────┐
               │    App Window       │        │    Overlay Window      │
               │  (React SPA)        │        │  (React, frameless,   │
               │  app-ui/src/        │        │   always-on-top)      │
               └─────────────────────┘        └───────────────────────┘
                              │
               ┌──────────────┼──────────────┐
               │              │              │
    ┌──────────▼──┐  ┌────────▼──────┐  ┌───▼──────────────┐
    │  Supabase    │  │ Python Service │  │   Cloudinary     │
    │  (Postgres + │  │ FastAPI+       │  │  (Avatars +      │
    │   Auth)      │  │ Whisper + LLM  │  │   Attachments)   │
    └─────────────┘  └───────────────┘  └──────────────────┘
```

---

## 2. Trigger Flows

There are three ways to open the overlay:

### 2.1. `@prompt` Native Hook (Primary Trigger)

1. User types `@prompt` in **any** Windows application.
2. The Rust native module (`native/windows-core`) runs a `WH_KEYBOARD_LL` global keyboard hook that monitors every keystroke system-wide.
3. A ring buffer in `buffer.rs` accumulates characters. When the sequence `@prompt` + space/Enter/Tab is detected, it fires a `TriggerAnchor` callback to Node.js via a thread-safe N-API function.
4. `TriggerAnchor` contains the HWND of the originating window and the trigger text length.
5. Electron main (`index-new.ts`) receives the callback and calls `overlayManager.open()`.
6. Simultaneously, `TextReplacer` sends `Backspace` keystrokes to the originating window to erase `@prompt` from the text field.
7. The overlay opens positioned near the cursor, pre-focused and ready for input.

### 2.2. `Ctrl+5` Global Shortcut

1. Electron registers `Ctrl+5` via `globalShortcut.register()` on app ready.
2. Press toggles `overlayManager.toggle()` — open if closed, close if open.

### 2.3. System Tray

1. `SystemTray` creates a tray icon with a context menu.
2. Clicking "Open Overlay" calls `overlayManager.open()`.
3. Clicking "Open App" shows the main App Window.

---

## 3. App Window (React Frontend)

**Technology**: React 18, TypeScript, Vite, Tailwind CSS, Shadcn UI (Radix primitives)
**Source**: `app-ui/src/`
**Vite entry**: `app-ui/index.html` → `src/main.tsx`
**Build output**: `electron/renderer/app-ui/` (generated — git-ignored)

The App Window is the full-featured main window of Prmpt. It is a regular, resizable `BrowserWindow` (not frameless) that opens when you launch the app or click "Open App" in the tray. It provides everything the overlay does — plus persistent chat history, the prompt library, settings, and user profile management.

### 3.1. View / Navigation Structure

The sidebar (`Sidebar.tsx`) drives navigation between four primary views, all rendered inside `AppLayout.tsx` with `Index.tsx` as the root orchestrator:

```
AppLayout
├── Sidebar
│   ├── [Chat]      → active chat (ChatView + MessageBubble list)
│   ├── [History]   → past chat sessions (HistoryView)
│   ├── [Library]   → prompt collections (PromptLibrary)
│   └── [Settings]  → preferences + memory (SettingsView + MemoryView)
└── Main content area
    └── renders whichever view is active
```

The sidebar also lists recent chats. Clicking one loads it and switches to the Chat view.

### 3.2. Auth Flow

All routes inside `AppLayout` are wrapped by `AuthWrapper`, which checks the session via `auth:check` IPC on mount.

```
App startup
  └── AuthWrapper.check()
        ├── Authenticated → load user profile → show AppLayout
        └── Not authenticated
              └── LoginPage
                    ├── "Sign in" → auth:login → success → AppLayout
                    ├── "Sign up" → SignupPage → auth:signup → OnboardingPage
                    └── OnboardingPage → save display name + custom instructions → AppLayout
```

`AuthContext` holds the live session state (user ID, email, display name, avatar URL, preferences) and is consumed by all components that need it. On login/logout, Electron main broadcasts `auth:state-changed` to all windows so the overlay stays in sync.

### 3.3. All Components

**Auth (`components/auth/`)**

| Component | Responsibility |
|---|---|
| [`AuthWrapper.tsx`](app-ui/src/components/auth/AuthWrapper.tsx) | Route guard — shows login flow if no active session |
| [`LoginPage.tsx`](app-ui/src/components/auth/LoginPage.tsx) | Email + password sign-in form with error feedback |
| [`SignupPage.tsx`](app-ui/src/components/auth/SignupPage.tsx) | Account creation form |
| [`OnboardingPage.tsx`](app-ui/src/components/auth/OnboardingPage.tsx) | Post-signup step — collects display name and custom optimization instructions |

**Chat (`components/chat/`)**

| Component | Responsibility |
|---|---|
| [`ChatView.tsx`](app-ui/src/components/chat/ChatView.tsx) | Chat input bar, file attachment zone, skill picker trigger, voice input button, auto-scroll container |
| [`MessageBubble.tsx`](app-ui/src/components/chat/MessageBubble.tsx) | Renders a single user or assistant message — Markdown, image thumbnails, lightbox, edit/retry buttons |
| [`PlusMenu.tsx`](app-ui/src/components/chat/PlusMenu.tsx) | Popover triggered by `+` button — file upload (PDF, image) and skill selection |
| [`SkillPicker.tsx`](app-ui/src/components/chat/SkillPicker.tsx) | Searchable, keyboard-navigable skill list; opens via Plus menu or `/` slash command in the input |
| [`VersionNavigator.tsx`](app-ui/src/components/chat/VersionNavigator.tsx) | `← 1/3 →` navigator shown on messages that have edit/retry versions |
| [`SavePromptModal.tsx`](app-ui/src/components/chat/SavePromptModal.tsx) | Modal to save an optimized result to a library collection |
| [`FeedbackWidget.tsx`](app-ui/src/components/chat/FeedbackWidget.tsx) | Thumbs-up / thumbs-down reaction on assistant messages |
| [`FilePreviewModal.tsx`](app-ui/src/components/chat/FilePreviewModal.tsx) | Full-screen lightbox for image attachments |

**Layout (`components/layout/`)**

| Component | Responsibility |
|---|---|
| [`AppLayout.tsx`](app-ui/src/components/layout/AppLayout.tsx) | Outer shell — sidebar + content area + custom frameless title-bar controls (minimize / maximize / close) |
| [`Sidebar.tsx`](app-ui/src/components/layout/Sidebar.tsx) | Navigation tabs (Chat / History / Library / Settings), recent chat list with rename and delete context menus, new chat button |
| [`ProfileMenu.tsx`](app-ui/src/components/layout/ProfileMenu.tsx) | Dropdown in the sidebar footer — shows avatar, display name, links to Settings, and sign-out |
| [`NavLink.tsx`](app-ui/src/components/NavLink.tsx) | Styled navigation link pill used in the sidebar tab bar |

**Library (`components/library/`)**

| Component | Responsibility |
|---|---|
| [`PromptLibrary.tsx`](app-ui/src/components/library/PromptLibrary.tsx) | Grid of prompt collections; create, rename, and delete collections; shows saved prompt cards |
| [`PromptCard.tsx`](app-ui/src/components/library/PromptCard.tsx) | Single saved prompt — displays title, content preview, favorite toggle, copy button |
| [`PromptPreviewModal.tsx`](app-ui/src/components/library/PromptPreviewModal.tsx) | Full-content view of a saved prompt |
| [`EditPromptModal.tsx`](app-ui/src/components/library/EditPromptModal.tsx) | Edit title and content of a saved prompt |
| [`DeleteConfirmModal.tsx`](app-ui/src/components/library/DeleteConfirmModal.tsx) | Confirmation dialog for destructive delete actions |
| [`SharePromptModal.tsx`](app-ui/src/components/library/SharePromptModal.tsx) | Generates and displays a shareable link for a prompt |
| [`SharePromptLinkModal.tsx`](app-ui/src/components/library/SharePromptLinkModal.tsx) | Displays the generated share URL with a copy button |
| [`ShareCollectionModal.tsx`](app-ui/src/components/library/ShareCollectionModal.tsx) | Generates and displays a shareable link for an entire collection |
| [`SharedLibraryView.tsx`](app-ui/src/components/library/SharedLibraryView.tsx) | Read-only view of a shared collection accessed by a recipient via share token |
| [`SharedPromptPage.tsx`](app-ui/src/components/library/SharedPromptPage.tsx) | Stand-alone view for a single shared prompt (accessed via URL) |

**Settings (`components/settings/`)**

| Component | Responsibility |
|---|---|
| [`SettingsView.tsx`](app-ui/src/components/settings/SettingsView.tsx) | Theme (light/dark), font size, optimizer model selection, custom optimization instructions |
| [`MemoryView.tsx`](app-ui/src/components/settings/MemoryView.tsx) | Table of inferred user memory entries (domain, style, score, observation count) with inline edit and delete |

**Profile (`components/profile/`)**

| Component | Responsibility |
|---|---|
| [`AvatarUploadModal.tsx`](app-ui/src/components/profile/AvatarUploadModal.tsx) | Drag-and-drop or file-picker avatar upload — resizes client-side before sending to `avatar:upload` IPC |

**Feedback (`components/feedback/`)**

| Component | Responsibility |
|---|---|
| [`FeedbackModal.tsx`](app-ui/src/components/feedback/FeedbackModal.tsx) | Multi-step feedback form (rating + freetext) triggered from `FeedbackWidget` |

**Pages (`pages/`)**

| Page | Route | Description |
|---|---|---|
| [`Index.tsx`](app-ui/src/pages/Index.tsx) | `/*` | Root orchestrator — owns all IPC event listeners, global chat state, view routing |
| [`NotFound.tsx`](app-ui/src/pages/NotFound.tsx) | `*` (catch-all) | 404 fallback page |
| [`SharePage.tsx`](app-ui/src/pages/SharePage.tsx) | `/share/:token` | Web-accessible shared collection viewer — no auth required |
| [`SharePromptPage.tsx`](app-ui/src/pages/SharePromptPage.tsx) | `/share/prompt/:token` | Web-accessible shared individual prompt viewer — no auth required |

> The `/share/*` routes are intentionally placed **outside** `AuthWrapper` in `App.tsx` so recipients can view shared content without logging in.

### 3.4. Key Hooks

| Hook | Purpose |
|---|---|
| [`useSmoothStreaming`](app-ui/src/hooks/useSmoothStreaming.ts) | Adaptive buffered streaming engine — drains incoming tokens at variable speed via `requestAnimationFrame` |
| [`useInitializeSettings`](app-ui/src/hooks/useInitializeSettings.ts) | Loads user preferences (theme, font, model) after login and applies them to the document root |
| [`useMessageTree`](app-ui/src/hooks/useMessageTree.ts) | Manages the branching message tree for edit/retry version history |
| [`useScrollController`](app-ui/src/hooks/useScrollController.ts) | Smart auto-scroll — follows stream output, pauses when the user manually scrolls up |
| [`useChatUIState`](app-ui/src/hooks/useChatUIState.ts) | All transient chat UI state: loading flags, streaming flag, selected skill, attached files |
| [`useIsDark`](app-ui/src/hooks/useIsDark.ts) | Reactive boolean that watches the `data-theme` attribute on `<html>` |
| [`useTurns`](app-ui/src/overlay/hooks/useTurns.ts) | Manages the overlay's turn-based conversation state (shared between ChatArea and InputSection) |
| [`use-mobile`](app-ui/src/hooks/use-mobile.tsx) | Detects mobile viewport breakpoint (used by responsive layout components) |

### 3.5. Utilities (`lib/`)

| File | Purpose |
|---|---|
| [`lib/utils.ts`](app-ui/src/lib/utils.ts) | `cn()` — Tailwind class merge helper (`clsx` + `tailwind-merge`) |
| [`lib/settings.ts`](app-ui/src/lib/settings.ts) | Helpers to read/write user settings via `window.electronAPI.settings` |
| [`lib/skillIcons.tsx`](app-ui/src/lib/skillIcons.tsx) | Maps skill names to their icon components (used by `SkillPicker` and `PlusMenu`) |

### 3.6. Chat Message Send Flow

This is the end-to-end path for a single optimization request in the App Window:

```
User types prompt → clicks Send (or presses Enter)
        │
        ▼
ChatView.tsx
  → validates input (non-empty, files < 10 MB)
  → calls window.electronAPI.chat.send({ prompt, chatId, skill, files, model })
        │
        ▼  (IPC: chat:send)
chat-handlers.ts (Electron main)
  → creates / resolves chatId in Supabase via ChatService
  → validates files via file-upload-service.ts
  → saves user message to Supabase (messages table)
  → calls pythonClient.optimizeStream(payload)
        │
        ▼  (WebSocket: /ws/optimize)
Python optimizer pipeline
  → Decision Taker → Skill Selector → Context Summarizer → Prompt Optimizer
  → streams tokens back over WebSocket
        │
        ▼
pythonClient receives chunk
  → fires appWindowManager.send('chat:optimization-chunk', { chunk, tempId })
        │
        ▼  (IPC: chat:optimization-chunk)
Index.tsx / useSmoothStreaming
  → buffer → requestAnimationFrame loop → setDisplayedText()
        │
        ▼
Stream ends → pythonClient fires 'chat:optimization-complete'
  → chat-handlers.ts saves assistant message to Supabase
  → sends { messageId, title } back to renderer
  → renderer swaps tempId → real messageId
  → MemoryAnalyzer.maybeRun() called in background (every 5 optimizations)
```

---

## 4. Overlay Window

**Source**: `app-ui/src/overlay/` (separate Vite entry point — `overlay.html`)
**Built output**: `electron/renderer/app-ui/overlay.html`

The overlay is a separate, always-on-top `BrowserWindow` (520 × 600 px, transparent, frameless). It provides instant prompt optimization without leaving the current application.

### 4.1. Overlay Components

| Component | Role |
|---|---|
| [`overlay/App.tsx`](app-ui/src/overlay/App.tsx) | Root — mounts AuthGate, routing between ChatArea and ChatPicker |
| [`overlay/components/AuthGate.tsx`](app-ui/src/overlay/components/AuthGate.tsx) | Shows login prompt if user is not authenticated |
| [`overlay/components/Header.tsx`](app-ui/src/overlay/components/Header.tsx) | App logo, Fast/Thinking mode toggle, close button |
| [`overlay/components/ChatArea.tsx`](app-ui/src/overlay/components/ChatArea.tsx) | Message list, streaming display, save-to-library and insert buttons |
| [`overlay/components/InputSection.tsx`](app-ui/src/overlay/components/InputSection.tsx) | Text input, file attachments, voice button, skill picker, send/stop |
| [`overlay/components/ChatPicker.tsx`](app-ui/src/overlay/components/ChatPicker.tsx) | List of recent chats to continue in the overlay |
| [`overlay/components/CollectionPicker.tsx`](app-ui/src/overlay/components/CollectionPicker.tsx) | Pick a library collection when saving an optimized prompt |
| [`overlay/components/OfflineBanner.tsx`](app-ui/src/overlay/components/OfflineBanner.tsx) | Amber banner shown when offline |

### 4.2. Overlay Behaviour

- Preloaded (hidden) at app startup for instant open — `OverlayWindowManager.preload()`.
- Positioned at the global cursor position on open (Raycast-style).
- Mouse-following emerald border glow: main process polls `screen.getCursorScreenPoint()` at ~60 fps and sends `overlay:cursor-pos` IPC events; the renderer applies a `radial-gradient` background on a 1 px padding wrapper.
- The glow fades to nothing after 1.5 s of cursor inactivity.
- Closes when focus is lost (click-away) unless the user is mid-input.

### 4.3. Overlay IPC Contract

| Direction | Channel | Payload | Purpose |
|---|---|---|---|
| Renderer → Main | `overlay:optimize` | `{ prompt, chatId, skill, files, model, sessionId }` | Start streaming optimization |
| Renderer → Main | `overlay:save` | `{ prompt, result, collectionId }` | Save prompt to library |
| Renderer → Main | `overlay:insert` | `{ text }` | Replace text in originating window |
| Renderer → Main | `overlay:close` | — | Hide the overlay |
| Renderer → Main | `overlay:get-chats` | — | Fetch recent chat list |
| Main → Renderer | `overlay:optimization-chunk` | `{ chunk }` | Streaming token |
| Main → Renderer | `overlay:optimization-complete` | `{ messageId, title }` | Final result + DB ID |
| Main → Renderer | `overlay:cursor-pos` | `{ x, y }` | Global cursor (for glow) |
| Main → Renderer | `overlay:opened` | `{ isAuthenticated, user }` | Auth state on open |
| Main → Renderer | `overlay:error` | `{ message }` | Error from main/python |

---

## 5. Electron Main Process

**Entry point**: `electron/main/index-new.ts` → compiled to `dist/main/index-new.js`

### 5.1. Startup Sequence

```
app.whenReady()
  → SupabaseClientManager.initialize()
  → AppWindowManager.preload()         (hidden BrowserWindow)
  → OverlayWindowManager.preload()     (hidden BrowserWindow)
  → PythonClient.healthCheck() + .connect()
  → networkMonitor.start()
  → TranscriptionClient.initialize()
  → checkAndRestoreSession()           (auto-login if session cookie exists)
  → register all IPC handlers
  → startKeystrokeDetection()          (Rust native hook)
  → globalShortcut.register('Ctrl+5')
  → SystemTray.create()
```

### 5.2. IPC Handlers (`electron/main/ipc-handlers/`)

| File | IPC Channels Handled |
|---|---|
| [`chat-handlers.ts`](electron/main/ipc-handlers/chat-handlers.ts) | `chat:send`, `chat:load`, `chat:list`, `chat:create`, `chat:delete`, `chat:rename`, `chat:stop`, `chat:get-message-versions` |
| [`overlay-ipc-handlers.ts`](electron/main/ipc-handlers/overlay-ipc-handlers.ts) | `overlay:optimize`, `overlay:save`, `overlay:insert`, `overlay:get-chats`, cursor polling |
| [`auth-handlers.ts`](electron/main/ipc-handlers/auth-handlers.ts) | `auth:login`, `auth:signup`, `auth:logout`, `auth:check`, session restoration |
| [`prompt-library-handlers.ts`](electron/main/ipc-handlers/prompt-library-handlers.ts) | Collections CRUD, prompt CRUD, share token generation and resolution |
| [`skill-handlers.ts`](electron/main/ipc-handlers/skill-handlers.ts) | `skill:list` — reads `python-service/app/skills/skill_*.md` |
| [`settings-handlers.ts`](electron/main/ipc-handlers/settings-handlers.ts) | `settings:load`, `settings:save` |
| [`user-handlers.ts`](electron/main/ipc-handlers/user-handlers.ts) | `user:get-profile`, `user:update-profile` |
| [`avatar-handlers.ts`](electron/main/ipc-handlers/avatar-handlers.ts) | `avatar:upload` — resize + upload to Cloudinary |
| [`file-upload-service.ts`](electron/main/ipc-handlers/file-upload-service.ts) | `file:validate`, file size/type/count enforcement |
| [`network-monitor-singleton.ts`](electron/main/ipc-handlers/network-monitor-singleton.ts) | Singleton `networkMonitor` — broadcasts `network-status` to all windows |

### 5.3. Services (`electron/main/database/services/`)

| Service | Responsibility |
|---|---|
| [`ChatService`](electron/main/database/services/chat-service.ts) | CRUD for chats and messages in Supabase |
| [`PromptLibraryService`](electron/main/database/services/prompt-library-service.ts) | Collections, saved prompts, share tokens |
| [`MemoryService`](electron/main/database/services/memory-service.ts) | Read/write/delete user memory entries |
| [`MemoryAnalyzer`](electron/main/database/services/memory-analyzer.ts) | Infer domain expertise and writing style from prompt history |
| [`UserService`](electron/main/database/services/user-service.ts) | Profile reads and updates |
| [`SettingsService`](electron/main/database/services/settings-service.ts) | Persist user settings to Supabase |
| [`AuthService`](electron/main/database/services/auth-service.ts) | Supabase auth — sign in, sign up, sign out, session |
| [`OptimizationService`](electron/main/database/services/optimization-service.ts) | Track optimization metadata (model, skill, token count) |

### 5.4. Other Modules

| Module | Purpose |
|---|---|
| [`OverlayWindowManager`](electron/main/overlay/overlay-window-manager.ts) | Create, position, show, hide, and toggle the overlay `BrowserWindow` |
| [`AppWindowManager`](electron/main/windows/app-window-manager.ts) | Create and manage the main app `BrowserWindow` |
| [`SystemTray`](electron/main/windows/system-tray.ts) | Windows system tray icon and context menu |
| [`PythonClient`](electron/main/api/python-client.ts) | WebSocket client to Python service (`/ws/optimize`) |
| [`TranscriptionClient`](electron/main/api/transcription-client.ts) | WebSocket client to Python transcription endpoint (`/ws/transcribe`) |
| [`localCache`](electron/main/database/local-cache.ts) | In-memory + disk JSON cache (top 5 recent chats) |
| [`offlineQueue`](electron/main/database/offline-queue.ts) | Buffer Supabase writes when offline; flush on reconnect |
| [`authState`](electron/main/utils/auth-state.ts) | Singleton — current auth state (userId, email, isAuthenticated) shared across handlers |
| [`native-bridge`](electron/main/utils/native-bridge.ts) | Wraps the Rust `windows-core.node` module; graceful fallback if unavailable |
| [`TextReplacer`](electron/main/text/text-replacer.ts) | Removes `@prompt` trigger text from originating window via `Backspace` key simulation |
| [`WindowTracker`](electron/main/context/window-tracker.ts) | Tracks the last focused non-Prmpt window (used for overlay insert target) |

---

## 6. Rust Native Module

**Source**: `native/windows-core/src/`
**Output**: `native/windows-core/windows-core.win32-x64-msvc.node`
**Build**: `npm run native:build` (requires Rust + `cargo`)

The native module is a Rust N-API (`napi-rs`) library compiled to a `.node` file that Electron loads like any `require()` module.

### 6.1. Exported Functions

| Function | Signature | Description |
|---|---|---|
| `startHook(callback)` | `(cb: (anchor: TriggerAnchor) => void) => void` | Installs `WH_KEYBOARD_LL` global hook; fires callback when `@prompt` is typed |
| `stopHook()` | `() => void` | Removes the hook and shuts down the hook thread |
| `getActiveWindowTitle()` | `() => string` | Returns the Win32 title bar text of the currently focused window |
| `replaceText(hwnd, len)` | `(hwnd: number, len: number) => void` | Sends `len` Backspace keystrokes to `hwnd` to erase the trigger text |

### 6.2. Internal Structure

| File | Role |
|---|---|
| `lib.rs` | N-API exports — thin wrappers that bridge Rust functions to JS |
| `hook.rs` | `WH_KEYBOARD_LL` hook installation, hook thread, `@prompt` sequence detection |
| `buffer.rs` | Fixed-size ring buffer accumulating recent characters |
| `keymap.rs` | Win32 virtual key code → character mapping |
| `replacement.rs` | `SendInput` calls to simulate Backspace keystrokes |

### 6.3. Hook Detection Algorithm

1. Every `WM_KEYDOWN` event adds the character to the ring buffer (`buffer.rs`).
2. The buffer checks if its tail matches `@prompt`.
3. On match, it reads the HWND of the foreground window and emits a `TriggerData { hwnd, trigger_len: 7 }` via the thread-safe N-API callback.
4. The hook thread is isolated from the Node.js event loop — the callback marshals the data safely across threads.

---

## 7. Python AI Service

**Entry point**: `python-service/app/main.py`
**Runtime**: `python-service/venv/` (git-ignored)
**Port**: `127.0.0.1:8001`

### 7.1. HTTP / WebSocket Endpoints

| Endpoint | Type | Description |
|---|---|---|
| `GET /` | HTTP | Service info and endpoint listing |
| `GET /health` | HTTP | Health check — returns `{ status: "healthy" }` |
| `POST /optimize` | HTTP | Single-shot (non-streaming) prompt optimization |
| `WS /ws/optimize` | WebSocket | Streaming prompt optimization (primary path) |
| `WS /ws/transcribe` | WebSocket | Real-time voice transcription |

### 7.2. Optimization Pipeline (`pipeline_v2/`)

Every streaming optimization request goes through four sequential steps:

```
User Prompt + Chat History + Files
         │
         ▼
  ┌─────────────────┐
  │  Decision Taker  │  LLM call — classifies as NEW / REFINEMENT / ADDITION
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │  Skill Selector  │  Loads matching skill_*.md (or auto-detects from user memory)
  └────────┬────────┘
           │
           ▼
  ┌──────────────────────┐
  │  Context Summarizer   │  If context > 3,000 tokens → cheap model compresses it
  └────────┬─────────────┘
           │
           ▼
  ┌──────────────────────┐
  │   Prompt Optimizer    │  Streams result token-by-token via WebSocket
  └──────────────────────┘
```

| Module | Role |
|---|---|
| [`optimizer.py`](python-service/pipeline_v2/optimizer.py) | Orchestrates all four pipeline steps |
| [`document_parser.py`](python-service/pipeline_v2/document_parser.py) | PDF text extraction (PyMuPDF), image vision API calls, 10 MB / 8 K token limits, magic-byte validation |
| [`fast_mode.py`](python-service/pipeline_v2/fast_mode.py) | Fast mode — keyword-based prompt type detection; applies a targeted system prompt |
| [`context.py`](python-service/pipeline_v2/context.py) | `ChatContext` — maintains ordered message history for the pipeline |
| [`config.py`](python-service/pipeline_v2/config.py) | Reads `OPTIMIZER_MODEL`, `SUMMARIZER_MODEL`, `OPENROUTER_API_KEY` from env |
| [`skills.py`](python-service/pipeline_v2/skills.py) | Loads and parses `skill_*.md` files from `python-service/app/skills/` |
| [`usage_logger.py`](python-service/pipeline_v2/usage_logger.py) | Appends per-request token usage to daily `.jsonl` log files |

### 7.3. Prompt Type Detection (Fast Mode)

`fast_mode.py` uses keyword matching to classify the input into one of eight categories — `coding`, `email`, `analysis`, `creative`, `image`, `documentation`, `business`, `general` — and selects a specialized system prompt template for that type.

### 7.4. Vision Model Support

Detected automatically from the model name string. Supported models for image inputs:

- OpenAI: `gpt-4o`, `gpt-4o-mini`
- Anthropic: `claude-3-5-sonnet`, `claude-3-5-haiku`, `claude-haiku-4`, `claude-sonnet-4`
- Google: `gemini-1.5-flash`, `gemini-1.5-pro`

### 7.5. Voice Transcription

**Stack**: faster-Whisper (OpenAI Whisper, CTranslate2 backend) + Silero VAD

**Flow**:
1. Electron sends `{ action: "start", session_id }` to `/ws/transcribe`.
2. Python opens a PyAudio microphone stream in a background thread.
3. Silero VAD filters non-speech frames to reduce Whisper load.
4. Audio is resampled to 16 kHz and fed to faster-Whisper in chunks.
5. Transcription results stream back as `{ type: "partial" | "final", text }` JSON frames.
6. Electron sends `{ action: "stop" }` to drain the final segment; Python waits up to 30 s for the transcription thread to finish before sending `{ type: "status", status: "stopped" }`.

Both Whisper and Silero VAD models are preloaded at startup to eliminate cold-start latency.

---

## 8. Data Persistence

### 8.1. Supabase (PostgreSQL)

All cloud data is stored in Supabase with Row-Level Security (RLS) enforced on every table.

| Table | Columns (key) | Purpose |
|---|---|---|
| `user_profiles` | `id`, `email`, `display_name`, `avatar_url`, `role` | User identity and avatar |
| `user_preferences` | `user_id`, `theme`, `font_size`, `model`, `custom_instructions`, `memory_enabled` | Synced UI preferences |
| `chats` | `id`, `user_id`, `title`, `created_at`, `updated_at` | Chat session metadata |
| `messages` | `id`, `chat_id`, `role`, `content`, `metadata`, `parent_id`, `version` | Messages with branching support |
| `prompt_collections` | `id`, `user_id`, `name`, `share_token` | Named prompt collections |
| `saved_prompts` | `id`, `collection_id`, `title`, `content`, `share_token`, `is_favorite` | Individual saved prompts |
| `user_memory` | `id`, `user_id`, `domain`, `style`, `score`, `observation_count` | Inferred user expertise/style |

**Views**:
- `user_full_profile` — joins `user_profiles` + `user_preferences` for a single-fetch profile load

**Storage buckets** (Supabase Storage):
- `attachments` — user file uploads (PDFs, images) per-user prefixed

**Migrations**: `supabase/migrations/` — applied in order via `npm run supabase:migrate`.

### 8.2. Cloudinary

Used for avatars (resized to 200 × 200 px before upload) and attachment thumbnails that exceed Supabase storage policy. The Electron main process handles the upload via `avatar-handlers.ts`.

### 8.3. Local Cache (Offline)

`localCache` (`electron/main/database/local-cache.ts`):
- In-memory store backed by a JSON file on disk.
- On every online chat load, the top 5 most recent chats and their messages are written to cache.
- On offline, `ChatService` falls back to cache reads.
- `offlineQueue` (`offline-queue.ts`) buffers all Supabase writes (new messages, prompt library changes) and flushes them when connectivity is restored via the `network:reconnected` event.

---

## 9. Key Workflows

### 9.1. Adaptive Buffered Streaming

Solves the "bursty network packet" problem where tokens arrive in uneven bursts, causing clumpy text rendering.

```
IPC: overlay:optimization-chunk
        │
        ▼
   StreamBuffer (React Ref — no re-render)
        │
        ▼
   requestAnimationFrame loop
        │
        ├─ buffer < 10 chars  → drain 1 char/tick   (smooth, natural)
        ├─ buffer 10–50 chars → drain 2–3 chars/tick (catch-up)
        └─ buffer > 50 chars  → drain 5+ chars/tick  (fast-forward)
        │
        ▼
   setDisplayedText() → re-render
```

When `overlay:optimization-complete` arrives (final DB message ID), the UI waits for the visual stream buffer to fully drain before swapping the temp message ID with the real Supabase ID. This prevents a flash of blank content.

### 9.2. File Attachment Flow

1. User selects files via Plus menu or pastes from clipboard.
2. Files are read as `ArrayBuffer` in the renderer and converted to base64.
3. On send, `file-upload-service.ts` validates: allowed MIME types, max 10 MB each, max 5 files.
4. Validated base64 payloads are forwarded to `PythonClient.optimizeStream()` as `attached_files`.
5. Python's `document_parser.py`:
   - PDF → PyMuPDF text extraction (up to 8,000 tokens)
   - Image → base64-encoded and sent to the vision LLM in the message
6. File metadata (name, type, size) is stored in the message's Supabase `metadata` JSONB column.
7. On chat reload, file metadata is restored (thumbnails show icon pills if full base64 is not re-stored).

### 9.3. User Memory System

Runs automatically in the background every 5 optimizations:

1. After each optimization, `MemoryAnalyzer.maybeRun(userId)` is called.
2. Every 5th call, it fetches the 50 most recent user prompts from Supabase.
3. Applies **exponential recency decay**: `weight = e^(-0.06 × index)` where index 0 is most recent.
4. Detects domains (Backend Dev, ML Engineering, Frontend, Data Science, DevOps, etc.) and writing styles (concise, technical, verbose, creative, formal) by matching prompt content against keyword sets.
5. Calculates weighted scores per domain and style across all prompts.
6. Upserts top-scoring entries into `user_memory` with an `observation_count` increment.
7. On the next optimization, memory entries are prepended to the system prompt as context.

Memory analysis can be disabled per-user via the `memory_enabled` preference.

### 9.4. Prompt Library Sharing

**Share a Collection:**
1. User clicks Share → `promptLibrary.getShareLink(collectionId)` IPC call.
2. `PromptLibraryService` generates a UUID `share_token` and stores it in `prompt_collections`.
3. Returns a URL: `https://tryprmpt.vercel.app/share/{token}`.
4. Recipient opens the URL → Electron or web app calls `getSharedCollection(token)`.
5. Recipient can save the entire collection to their own library (deep copy — new collection + new prompts).

**Share a Prompt:**
1. Same flow for individual prompts: `share_token` stored in `saved_prompts`.
2. URL: `https://tryprmpt.vercel.app/share/prompt/{token}`.

### 9.5. Overlay Cursor Glow

1. When the overlay opens, `startCursorPolling()` in `overlay-ipc-handlers.ts` starts a `setInterval` at ~16 ms (~60 fps).
2. Each tick: `screen.getCursorScreenPoint()` is called; position is translated to overlay-relative coordinates.
3. `overlay:cursor-pos` IPC event is sent to the overlay renderer.
4. Renderer updates `.panel-glow-wrapper` with `radial-gradient(circle at Xpx Ypx, <emerald>, transparent)`.
5. The wrapper has 1 px of padding — the gradient bleeds through that 1 px border on all sides.
6. The panel's dark background covers the interior, so only the 1 px edge is visible.
7. If the cursor has not moved for 1.5 s, the glow opacity fades to 0 via a CSS transition.
8. Polling stops when the overlay is hidden.

### 9.6. Offline Mode

1. `networkMonitor` (singleton) polls `https://www.google.com` every 10 s.
2. On connectivity loss: broadcasts `network-status: { online: false }` to all windows → UI shows amber offline banner; send button disabled.
3. Chat/message loads fall back to `localCache`.
4. Write operations (new messages, library changes) are enqueued in `offlineQueue`.
5. On reconnect: `network:reconnected` fires → offline queue flushed → Supabase writes replayed in order.

### 9.7. `@prompt` Text Replacement

After the native hook fires `TriggerAnchor { hwnd, triggerLen }`:

1. `TextReplacer.replace(hwnd, triggerLen)` is called.
2. It uses `SendInput` Win32 API to send `triggerLen` `VK_BACK` (Backspace) keystrokes to the target window's message queue.
3. This erases `@prompt` (and any trailing space/newline that triggered detection) from whatever text field the user was typing in.
4. The overlay then opens empty (or with any preceding text context that the user may have already written before `@prompt`).

---

## 10. IPC Bridge (`preload.ts`)

[`electron/preload.ts`](electron/preload.ts) uses Electron's `contextBridge` to expose a typed `window.electronAPI` object to renderer processes. All renderer ↔ main communication flows through this bridge — direct `ipcRenderer` calls are never exposed.

### Namespace Map

| Namespace | Methods |
|---|---|
| `window.electronAPI.chat.*` | `send`, `load`, `list`, `create`, `delete`, `rename`, `stop`, `getMessageVersions` |
| `window.electronAPI.overlay.*` | `optimize`, `save`, `insert`, `close`, `getChats` |
| `window.electronAPI.auth.*` | `login`, `signup`, `logout`, `check` |
| `window.electronAPI.promptLibrary.*` | `getCollections`, `createCollection`, `savePrompt`, `deletePrompt`, `getShareLink`, `getSharedCollection`, `saveSharedCollection` |
| `window.electronAPI.memory.*` | `getMemory`, `updateMemory`, `deleteMemory` |
| `window.electronAPI.settings.*` | `load`, `save` |
| `window.electronAPI.user.*` | `getProfile`, `updateProfile` |
| `window.electronAPI.avatar.*` | `upload` |
| `window.electronAPI.transcription.*` | `start`, `stop` |
| `window.electronAPI.windowControls.*` | `minimize`, `maximize`, `close` |
| `window.electronAPI.onNetworkStatus` | Event listener — `{ online: boolean }` |
| `window.electronAPI.onAuthStateChange` | Event listener — `{ isAuthenticated, user }` |
| `window.electronAPI.onSentryUser` | Event listener — Sentry user identity propagation |

---

## 11. Environment Variables

| Variable | Used by | Description |
|---|---|---|
| `SUPABASE_URL` | Electron main | Supabase project URL |
| `SUPABASE_ANON_KEY` | Electron main | Supabase anonymous (public) key |
| `PYTHON_SERVICE_URL` | Electron main | Python service base URL (default: `http://127.0.0.1:8001`) |
| `OPENROUTER_API_KEY` | Python service | API key for OpenRouter LLM gateway |
| `OPTIMIZER_MODEL` | Python service | Main streaming model (e.g. `openrouter/anthropic/claude-haiku-4.5`) |
| `SUMMARIZER_MODEL` | Python service | Cheap model for summarization, titles, memory (e.g. `openrouter/openai/gpt-4o-mini`) |
| `VITE_CLOUDINARY_CLOUD_NAME` | React renderer | Cloudinary cloud name (inlined at build time) |
| `VITE_CLOUDINARY_UPLOAD_PRESET` | React renderer | Cloudinary unsigned upload preset |
| `CLOUDINARY_API_KEY` | Electron main | Cloudinary API key (signed uploads) |
| `CLOUDINARY_API_SECRET` | Electron main | Cloudinary API secret |
| `NODE_ENV` | Electron main + renderer | `development` or `production` — controls Sentry sample rate |
| `APP_ENV` | Python service | `development` or `production` |
| `SENTRY_DSN` | Electron main | Sentry DSN for main process errors |
| `VITE_SENTRY_DSN` | React renderer | Sentry DSN for renderer errors (inlined at build time) |
| `SENTRY_PYTHON_DSN` | Python service | Sentry DSN for Python errors |
| `SENTRY_AUTH_TOKEN` | Build pipeline | For source-map upload during production builds |
| `SENTRY_ORG` | Build pipeline | Sentry organization slug |
| `SENTRY_PROJECT` | Build pipeline | Sentry project slug |

---

## 12. Design System

All design tokens are defined in [`app-ui/src/index.css`](app-ui/src/index.css) and extended in `app-ui/tailwind.config.ts`.

### Color Tokens

| Token | Light mode | Dark mode | Usage |
|---|---|---|---|
| `--background` | Warm peach `#FFF4ED` | Deep slate `#0A0A0F` | Page background |
| `--surface` | White | `#111118` | Card / panel background |
| `--surface-hover` | `#F5F5F5` | `#1A1A24` | Hover state |
| `--surface-elevated` | `#FAFAFA` | `#16161F` | Elevated panels |
| `--emerald` | Brand blue | True emerald green | Primary accent |
| `--emerald-soft` | Muted blue tint | Muted green tint | Soft accent backgrounds |
| `--emerald-muted` | Light blue wash | Dark green wash | Subtle highlights |

### Animation Utilities

| Class | Effect |
|---|---|
| `animate-slide-up` | Slide + fade in from below (messages, panels) |
| `animate-fade-in` | Opacity 0 → 1 |
| `transition-smooth` | 200 ms ease-in-out for general transitions |
| `transition-button` | 150 ms ease for interactive elements |

### Typography

The app uses `Inter` (UI) and `Space Grotesk` (headings) loaded via Google Fonts. Font size and line-height are controlled by the `font_size` user preference setting and applied as a CSS variable at the root element.
