# Prmpt — System Architecture

## 1. System Overview

Prmpt is a Windows desktop application that optimizes AI prompts in real-time. It is a coordinated system of **six distinct runtime environments**, each solving a problem the others cannot:

- **Electron Main Process** — orchestrator, IPC hub, window lifecycle, analytics, offline queue
- **App Window** — React SPA for full chat, history, library, settings, and Spaces
- **Overlay Window** — frameless always-on-top floating panel for instant in-context optimization
- **Python AI Service** — FastAPI server: LLM streaming, clarification, task planning, voice transcription, OTP auth
- **Code Intelligence Service** — separate FastAPI microservice for codebase indexing, pgvector semantic search, call graph analysis
- **Rust Native Module** — global keyboard hook and text replacement via Win32 API

```
┌───────────────────────────────────────────────────────────────────────┐
│                           User / OS                                    │
│  Types "@prompt" anywhere   │  Presses Ctrl+5  │  Clicks tray         │
└──────────────┬──────────────┴───────┬───────────┴──────────────────────┘
               │                      │
    ┌──────────▼────────┐             │
    │  Rust Native Hook  │            │
    │  (WH_KEYBOARD_LL) │            │
    └──────────┬─────────┘           │
               │ TriggerAnchor        │
               └──────────────────────▼──────────────────────┐
                                                             │
                             ┌───────────────────────────────▼──────┐
                             │        Electron Main Process          │
                             │  (index-new.ts — IPC Hub)             │
                             │  Analytics · Guardrails · Offline Q   │
                             └──┬────────────────────┬──────────────┘
                                │                    │
              ┌─────────────────▼──┐     ┌──────────▼────────────┐
              │    App Window       │     │    Overlay Window      │
              │  (React SPA)        │     │  (React, frameless,   │
              │  Chat·Spaces·Lib    │     │   always-on-top)      │
              └─────────────────────┘     └───────────────────────┘
                             │
              ┌──────────────┼──────────────┬──────────────────┐
              │              │              │                  │
   ┌──────────▼──┐  ┌────────▼──────┐  ┌───▼──────────┐  ┌───▼────────────┐
   │  Supabase    │  │ Python Service │  │ Code Intel   │  │   Cloudinary   │
   │  (Postgres + │  │ FastAPI+       │  │ Service      │  │  (Avatars +    │
   │   Auth+RLS)  │  │ Whisper + LLM  │  │ pgvector     │  │   Attachments) │
   └─────────────┘  └───────────────┘  └──────────────┘  └────────────────┘
```

---

## 2. Trigger Flows

There are three ways to open the overlay:

### 2.1. `@prompt` Native Hook (Primary Trigger)

1. User types `@prompt` in **any** Windows application.
2. The Rust native module runs a `WH_KEYBOARD_LL` global keyboard hook that monitors every keystroke system-wide.
3. A ring buffer in `buffer.rs` accumulates characters. When `@prompt` + space/Enter/Tab is detected, it fires a `TriggerAnchor` callback to Node.js via a thread-safe N-API function.
4. `TriggerAnchor` contains the HWND of the originating window and the trigger text length.
5. Electron main (`index-new.ts`) receives the callback and calls `overlayManager.open()`.
6. Simultaneously, `TextReplacer` sends `Backspace` keystrokes to erase `@prompt` from the text field.
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

### 3.1. View / Navigation Structure

The sidebar (`Sidebar.tsx`) drives navigation between five primary views, all rendered inside `AppLayout.tsx` with `Index.tsx` as the root orchestrator:

```
AppLayout
├── Sidebar
│   ├── [Chat]      → active chat (ChatView + MessageBubble list + ClarificationCard)
│   ├── [History]   → past sessions grouped by date (HistoryView)
│   ├── [Spaces]    → project workspaces (ProjectsView → SpacesList → SpaceWorkspace)
│   ├── [Library]   → prompt collections (PromptLibrary)
│   └── [Settings]  → preferences + memory (SettingsView + MemoryView)
└── Main content area
    └── renders whichever view is active
```

### 3.2. Auth Flow

All routes inside `AppLayout` are wrapped by `AuthWrapper`. OTP-based email verification is now supported alongside email/password auth.

```
App startup
  └── AuthWrapper.check()
        ├── Authenticated → load user profile → show AppLayout
        └── Not authenticated
              └── LoginPage
                    ├── "Sign in" → auth:login → success → AppLayout
                    ├── "Sign up" → SignupPage → OtpVerification → OnboardingPage → AppLayout
                    └── "Forgot password" → OTP reset flow → AppLayout
```

`AuthContext` holds the live session state and is consumed by all components. On login/logout, Electron main broadcasts `auth:state-changed` to all windows so the overlay stays in sync.

### 3.3. All Components

**Auth (`components/auth/`)**

| Component | Responsibility |
|---|---|
| `AuthWrapper.tsx` | Route guard — shows login flow if no active session |
| `LoginPage.tsx` | Email + password sign-in form with error feedback |
| `SignupPage.tsx` | Account creation form |
| `OtpVerification.tsx` | OTP code entry UI for email verification and password reset |
| `OnboardingPage.tsx` | Post-signup step — display name and custom instructions |

**Chat (`components/chat/`)**

| Component | Responsibility |
|---|---|
| `ChatView.tsx` | Chat input bar, file attachment zone, skill picker trigger, voice input button, auto-scroll container |
| `MessageBubble.tsx` | Renders a single user or assistant message — Markdown, image thumbnails, lightbox, edit/retry buttons |
| `ClarificationCard.tsx` | Animated multi-choice question card shown before optimization for complex prompts; supports multi-select, "Other" freetext, delivery format selection, extra notes field |
| `ClarificationSummaryCard.tsx` | Read-only summary card showing submitted clarification answers with edit capability |
| `PlusMenu.tsx` | Popover triggered by `+` button — file upload and skill selection |
| `SkillPicker.tsx` | Searchable, keyboard-navigable skill list; opens via Plus menu or `/` slash command |
| `VersionNavigator.tsx` | `← 1/3 →` navigator shown on messages with edit/retry versions |
| `SavePromptModal.tsx` | Modal to save an optimized result to a library collection |
| `FeedbackWidget.tsx` | Thumbs-up / thumbs-down reaction on assistant messages |
| `FilePreviewModal.tsx` | Full-screen lightbox for image attachments |

**History (`components/history/`)**

| Component | Responsibility |
|---|---|
| `HistoryView.tsx` | Dedicated history view — groups past sessions by Today / Yesterday / Weekday / Date, shows title, preview, message count, and a clickable row to resume |

**Layout (`components/layout/`)**

| Component | Responsibility |
|---|---|
| `AppLayout.tsx` | Outer shell — sidebar + content area + custom frameless title-bar controls |
| `Sidebar.tsx` | Navigation tabs (Chat / History / Spaces / Library / Settings), recent chat list with rename/delete context menus, new chat button |
| `ProfileMenu.tsx` | Dropdown in the sidebar footer — shows avatar, display name, links to Settings, sign-out |
| `ZoomIndicator.tsx` | Floating indicator showing current zoom level when the user adjusts font size |
| `NavLink.tsx` | Styled navigation link pill used in the sidebar tab bar |

**Spaces / Projects (`components/projects/`)**

| Component | Responsibility |
|---|---|
| `ProjectsView.tsx` | Root orchestrator for the Spaces feature — renders SpacesList or SpaceWorkspace; persists spaces to `localStorage` |
| `SpacesList.tsx` | Grid of all created spaces with create/rename/delete; sorts by `lastUsedAt` |
| `SpaceWorkspace.tsx` | Inside a space: attach local code projects, query the Code Intelligence Service for relevant code chunks, compose a context-rich prompt, and optionally send to the main chat optimizer |
| `types.ts` | `Space`, `SpaceProject`, `SpaceMessage`, `RetrievedChunk` interfaces; `loadSpaces`/`saveSpaces` localStorage helpers; `buildTailoredPrompt` that assembles a context-rich prompt from code chunks |

**Library (`components/library/`)**

| Component | Responsibility |
|---|---|
| `PromptLibrary.tsx` | Grid of prompt collections; create, rename, delete; shows saved prompt cards |
| `PromptCard.tsx` | Single saved prompt — title, content preview, favorite toggle, copy button |
| `PromptPreviewModal.tsx` | Full-content view of a saved prompt |
| `EditPromptModal.tsx` | Edit title and content of a saved prompt |
| `DeleteConfirmModal.tsx` | Confirmation dialog for destructive delete actions |
| `SharePromptModal.tsx` | Generates and displays a shareable link for a prompt |
| `SharePromptLinkModal.tsx` | Displays the generated share URL with a copy button |
| `ShareCollectionModal.tsx` | Generates and displays a shareable link for an entire collection |
| `SharedLibraryView.tsx` | Read-only view of a shared collection accessed via share token |
| `SharedPromptPage.tsx` | Stand-alone view for a single shared prompt |

**Settings (`components/settings/`)**

| Component | Responsibility |
|---|---|
| `SettingsView.tsx` | Theme, font size, optimizer model selection, custom optimization instructions, account deletion request |
| `MemoryView.tsx` | Table of inferred user memory entries with inline edit and delete |

**Profile (`components/profile/`)**

| Component | Responsibility |
|---|---|
| `AvatarUploadModal.tsx` | Drag-and-drop or file-picker avatar upload — resizes client-side before `avatar:upload` IPC |

**Feedback (`components/feedback/`)**

| Component | Responsibility |
|---|---|
| `FeedbackModal.tsx` | Multi-step feedback form (rating + freetext) triggered from `FeedbackWidget` |

**Pages (`pages/`)**

| Page | Route | Description |
|---|---|---|
| `Index.tsx` | `/*` | Root orchestrator — owns all IPC listeners, global chat state, view routing |
| `NotFound.tsx` | `*` | 404 fallback |
| `SharePage.tsx` | `/share/:token` | Public shared collection viewer — no auth required |
| `SharePromptPage.tsx` | `/share/prompt/:token` | Public shared individual prompt viewer — no auth required |

### 3.4. Key Hooks

| Hook | Purpose |
|---|---|
| `useSmoothStreaming` | Adaptive buffered streaming engine — drains tokens at variable speed via `requestAnimationFrame` |
| `useInitializeSettings` | Loads user preferences after login and applies them to document root |
| `useMessageTree` | Manages the branching message tree for edit/retry version history |
| `useScrollController` | Smart auto-scroll — follows stream output, pauses when user scrolls up |
| `useChatUIState` | All transient chat UI state: loading flags, streaming flag, selected skill, attached files |
| `useIsDark` | Reactive boolean that watches the `data-theme` attribute on `<html>` |
| `useTurns` | Manages overlay's turn-based conversation state |
| `use-mobile` | Detects mobile viewport breakpoint |

---

## 4. Overlay Window

**Source**: `app-ui/src/overlay/` (separate Vite entry point — `overlay.html`)
**Built output**: `electron/renderer/app-ui/overlay.html`

The overlay is a separate, always-on-top `BrowserWindow` (520 × 600 px, transparent, frameless). Preloaded hidden at startup for instant open.

### 4.1. Overlay Components

| Component | Role |
|---|---|
| `overlay/App.tsx` | Root — mounts AuthGate, routing between ChatArea and ChatPicker |
| `overlay/components/AuthGate.tsx` | Shows login prompt if user is not authenticated |
| `overlay/components/Header.tsx` | App logo, Fast/Thinking mode toggle, close button |
| `overlay/components/ChatArea.tsx` | Message list, streaming display, save-to-library and insert buttons |
| `overlay/components/InputSection.tsx` | Text input, file attachments, voice button, skill picker, send/stop |
| `overlay/components/ChatPicker.tsx` | List of recent chats to continue in the overlay |
| `overlay/components/CollectionPicker.tsx` | Pick a library collection when saving an optimized prompt |
| `overlay/components/OfflineBanner.tsx` | Amber banner shown when offline |
| `overlay/components/ProjectStatus.tsx` | Shows currently active Space/project context and indexed status |
| `overlay/lib/constants.ts` | Overlay-specific constants (window dimensions, animation timings) |
| `overlay/lib/types.ts` | Overlay-specific TypeScript interfaces |
| `overlay/lib/utils.ts` | Overlay utility functions |

### 4.2. Overlay IPC Contract

#### Renderer → Main (send — fire-and-forget)

| Channel | Payload | Purpose |
|---|---|---|
| `overlay:optimize` | `{ text, isRegenerate, mode, chatId, attachedFiles, forcedSkill, previousOutput, wantsSections, clarificationAnswers, … }` | Start streaming optimization |
| `overlay:submit-clarification` | `{ answers, wantsSections, clarificationChoices }` | Resume paused optimization with clarification answers |
| `overlay:copy` | `{ text }` | Copy text to system clipboard |
| `overlay:close` | — | Hide the overlay window |
| `overlay:open-app` | — | Show main app window (e.g. for unauthenticated users) |
| `overlay:new-session` | — | Clear in-memory overlay conversation history |
| `overlay:truncate-history` | `{ keepCount }` | Sync backend history after user edits/retries |
| `overlay:stop-generation` | — | Abort current streaming optimization |

#### Renderer → Main (invoke — returns a value)

| Channel | Payload | Return | Purpose |
|---|---|---|---|
| `overlay:insert` | `{ text }` | `{ success }` | Close overlay + replace `@prompt` in source window via `replaceAtLastAnchor`, fallback to `pasteTextToWindow` |
| `overlay:insert-section` | `{ text }` | `{ success }` | Paste one task section without closing overlay; auto-sends Enter in chat windows |
| `overlay:save` | `{ title, content, collectionId? }` | `{ promptId, collectionId }` | Save to prompt library (offline-queued if disconnected) |
| `overlay:check-auth` | — | `{ isAuthenticated }` | Check current auth state |
| `overlay:get-settings` | — | user settings | Fetch + cache user settings for overlay styling |
| `overlay:get-collections` | — | collections[] | Collections for save picker (offline falls back to cache) |
| `overlay:create-collection` | `{ name, icon? }` | collection | Create new collection (offline-queued) |
| `overlay:get-chats` | — | `{ id, title }[]` | Chat list for context picker (offline falls back to cache) |
| `overlay:save-to-chat` | `{ chatId, content }` | `{ messageId }` | Append optimized prompt as assistant message to an existing chat |
| `overlay:get-source-info` | — | `{ hwnd, title, detectedMode, confidence, appName }` | Source window metadata (used for UI mode detection) |

#### Main → Renderer (pushed to overlay window)

| Channel | Payload | Purpose |
|---|---|---|
| `overlay:opened` | `{ isAuthenticated, user }` | Auth state pushed on every open |
| `overlay:auth-state` | `{ isAuthenticated }` | Auth state change while overlay is open |
| `overlay:clarification-required` | `{ should_clarify, questions[], is_complex, suggested_sections }` | Pauses optimization, presents clarification UI |
| `overlay:optimization-chunk` | `{ chunk, accumulated }` | Streaming token delta |
| `overlay:optimization-complete` | `{ original, optimized }` | Optimization finished |
| `overlay:optimization-error` | `{ error }` | Humanized error message |
| `overlay:cursor-pos` | `{ x, y }` | Global cursor pos relative to overlay (60fps, drives emerald glow) |
| `overlay:upload-partial-failure` | `{ failedFiles }` | Some file uploads failed; partial success |
| `overlay:messages-appended` | `{ chatId, messages[] }` | Real-time push to app window when overlay saves into a context chat |

---

## 5. Electron Main Process

**Entry point**: `electron/main/index-new.ts` → compiled to `dist/main/index-new.js`

### 5.1. Startup Sequence

```
app.whenReady()
  → SupabaseClientManager.initialize()
  → AppWindowManager.preload()             (hidden BrowserWindow)
  → OverlayWindowManager.preload()         (hidden BrowserWindow)
  → PythonClient.healthCheck() + .connect()
  → CodeIntelClient.healthCheck()          (optional — Spaces feature)
  → networkMonitor.start()
  → TranscriptionClient.initialize()
  → checkAndRestoreSession()               (auto-login if session cookie exists)
  → analyticsService.initialize(userId)    (starts EventBuffer + session)
  → register all IPC handlers
  → startKeystrokeDetection()              (Rust native hook)
  → globalShortcut.register('Ctrl+5')
  → SystemTray.create()
```

### 5.2. IPC Handlers (`electron/main/ipc-handlers/`)

| File | IPC Channels Handled |
|---|---|
| `chat-handlers.ts` | `chat:send`, `chat:load`, `chat:list`, `chat:create`, `chat:delete`, `chat:rename`, `chat:stop`, `chat:get-message-versions` |
| `overlay-ipc-handlers.ts` | `overlay:optimize`, `overlay:submit-clarification`, `overlay:save`, `overlay:insert`, `overlay:insert-section`, `overlay:copy`, `overlay:close`, `overlay:open-app`, `overlay:check-auth`, `overlay:get-settings`, `overlay:get-collections`, `overlay:create-collection`, `overlay:get-chats`, `overlay:save-to-chat`, `overlay:get-source-info`, `overlay:new-session`, `overlay:truncate-history`, `overlay:stop-generation`, cursor polling |
| `auth-handlers.ts` | `auth:login`, `auth:signup`, `auth:logout`, `auth:check`, session restoration, OTP send/verify |
| `prompt-library-handlers.ts` | Collections CRUD, prompt CRUD, share token generation and resolution |
| `skill-handlers.ts` | `skill:list` — reads `python-service/app/skills/skill_*.md` |
| `settings-handlers.ts` | `settings:load`, `settings:save` |
| `user-handlers.ts` | `user:get-profile`, `user:update-profile` |
| `avatar-handlers.ts` | `avatar:upload` — resize + upload to Cloudinary |
| `feedback-handlers.ts` | `feedback:submit` — stores rating + freetext feedback in Supabase |
| `deletion-handlers.ts` | `account:request-deletion`, `account:cancel-deletion` — GDPR deletion scheduling |
| `project-handlers.ts` | `project:create`, `project:list`, `project:index`, `project:retrieve`, `project:watch`, `project:unwatch`, `project:git-info` — Spaces + Code Intelligence IPC |
| `file-upload-service.ts` | File validation: allowed MIME types, max 10 MB each, max 5 files, magic-byte verification |
| `network-monitor-singleton.ts` | Singleton `networkMonitor` — broadcasts `network-status` to all windows |

### 5.3. Services (`electron/main/database/services/`)

| Service | Responsibility |
|---|---|
| `ChatService` | CRUD for chats and messages in Supabase |
| `PromptLibraryService` | Collections, saved prompts, share tokens |
| `MemoryService` | Read/write/delete user memory entries |
| `MemoryAnalyzer` | Infer domain expertise and writing style from prompt history; exponential recency decay scoring |
| `UserService` | Profile reads and updates |
| `SettingsService` | Persist user settings to Supabase |
| `AuthService` | Supabase auth — sign in, sign up, sign out, session, OTP |
| `OptimizationService` | Track optimization metadata (model, skill, token count) |
| `DeletionService` | GDPR account deletion: schedule, cancel, and execute deletion requests |
| `RateLimitService` | Daily usage cap enforcement — checks and increments per-user daily counters |

### 5.4. Analytics System (`electron/main/analytics/`)

| Module | Responsibility |
|---|---|
| `AnalyticsService` | Singleton — manages app sessions in `app_sessions` Supabase table; calls `startSession()` on login, `endSession()` on logout/quit; crash-recovery: closes any sessions left open by a previous crash (sets `duration_seconds: null` to distinguish clean vs crash endings) |
| `EventBuffer` | In-memory queue for `usage_events`; auto-flushes every 10 s or when 50 events accumulate; on flush failure, serializes events to a per-user JSON file in `userData/offline-cache/`; drains offline file on next successful connection |

Analytics is fire-and-forget — no analytics failure can break the user-facing app flow.

### 5.5. Optimization Subsystem (`electron/main/optimization/`)

| Module | Responsibility |
|---|---|
| `AIGuardrails` | Prevents spam and duplicate requests: enforces 10-char minimum, 90% Levenshtein similarity threshold (skips near-duplicate prompts), 3-second cooldown between requests, max 1 in-flight request per session |
| `ResponseValidator` | Validates that the optimization response is substantively different from the input and meets quality criteria |
| `SessionState` | Session state machine (`IDLE → CLARIFYING → OPTIMIZING → COMPLETE → ERROR`) managing the lifecycle of a single optimization turn |
| `StabilityTracker` | Tracks connection stability to the Python service; adjusts retry strategy based on consecutive failure counts |

### 5.6. Code Intelligence System (`electron/main/services/` + `api/code-intel-client.ts`)

The Code Intelligence system enables Spaces — a feature where users attach local code repositories to a workspace and receive semantically-retrieved code context that is automatically injected into their prompts.

| Module | Responsibility |
|---|---|
| `CodeIntelClient` | Axios HTTP client for the Code Intelligence Service (port 8002); attaches the user's Supabase JWT on every request; methods: `createProject`, `listProjects`, `getProject`, `deleteProject`, `ingestSkeleton`, `retrieve`, `syncProject`, `deleteChunksForFile` |
| `CodeParser` | Tree-sitter WASM-based code parser; lazy-loads language grammars (TypeScript, Python, Go, Rust, Java, Ruby, C/C++, C#); extracts function/class/method definitions with signatures, line ranges, imports, and callee references as `ChunkData` objects; computes SHA-256 content hashes |
| `FileWatcher` | Chokidar-based directory watcher; debounces file changes (2 s); skips `node_modules`, `.git`, `dist`, `build`, `venv`, `target`; checks content hash against `LocalProjectCache` before re-sending to avoid redundant re-indexing; handles file add/change/delete events |
| `GitService` | Executes `git` CLI commands in a child process; reads `currentBranch`, `defaultBranch`, `aheadCount`, `behindCount`, and recent commit history; used to provide branch context to the Code Intelligence Service |
| `LocalProjectCache` | SQLite-backed (better-sqlite3) per-project hash cache: stores file path → content hash pairs; checked before every re-index to skip unchanged files; cleared on project deletion |
| `ActiveWindowDetector` | Polls the currently focused window title using the Rust native module; used by the overlay to surface project context relevant to the user's current application |

### 5.7. Other Modules

| Module | Purpose |
|---|---|
| `OverlayWindowManager` | Create, position, show, hide, and toggle the overlay `BrowserWindow` |
| `AppWindowManager` | Create and manage the main app `BrowserWindow` |
| `SystemTray` | Windows system tray icon and context menu |
| `PythonClient` | WebSocket client to Python service (`/ws/optimize-stream`); exposes `optimizeStream()`, `clarify()`, `generateTitle()`, `abortLatestStream()` |
| `TranscriptionClient` | WebSocket client to Python transcription endpoint |
| `localCache` | In-memory + disk JSON cache (top 5 recent chats) |
| `offlineQueue` | Buffers Supabase writes when offline; flushes on reconnect |
| `authState` | Singleton — current auth state (userId, email, isAuthenticated, accessToken) shared across handlers |
| `native-bridge` | Wraps the Rust `windows-core.node` module; graceful fallback if unavailable |
| `TextReplacer` | Removes `@prompt` trigger text from originating window via Backspace key simulation |
| `WindowTracker` | Tracks the last focused non-Prmpt window (used for overlay insert target) |
| `ErrorLog` | Local error log file written to `userData/error-log.json`; surfaces critical errors that can't reach Sentry |

---

## 6. Rust Native Modules

There are **two** separate Rust native modules, each targeting a different concern:

---

### 6A. `windows-core` — Keyboard Hook + Text Injection

**Source**: `native/windows-core/src/`
**Output**: `native/windows-core/windows-core.win32-x64-msvc.node`
**Build**: `npm run native:build` (requires Rust + `cargo`)

The primary keystroke-interception module. A Rust N-API (`napi-rs`) library compiled to a `.node` file that Electron loads like any `require()` module. Wrapped by `electron/main/utils/native-bridge.ts`, which provides graceful fallback if the binary is unavailable.

#### 6A.1. Exported Functions

| Function | Signature | Description |
|---|---|---|
| `startHook(callback)` | `(cb: (anchor: TriggerAnchor) => void) => void` | Installs `WH_KEYBOARD_LL` global hook; fires callback when `@prompt` is typed |
| `stopHook()` | `() => void` | Removes the hook and shuts down the hook thread |
| `getActiveWindowTitle()` | `() => string` | Returns the Win32 title bar text of the currently focused window |
| `replaceAtLastAnchor(text)` | `(text: string) => boolean` | Sets foreground window, selects trigger with Shift+Left, injects replacement via `KEYEVENTF_UNICODE` |
| `pasteTextToWindow(hwnd, text)` | `(hwnd: number, text: string) => boolean` | Pastes text to a specific HWND at current cursor position |
| `sendEnterToWindow(hwnd)` | `(hwnd: number) => boolean` | Sends an Enter keystroke to a specific HWND (for auto-submitting in chat apps) |
| `forceFocusWindow(hwnd)` | `(hwnd: number) => void` | Forces foreground focus to a specific HWND |

#### 6A.2. Internal Structure

| File | Role |
|---|---|
| `lib.rs` | N-API exports — thin wrappers bridging Rust functions to JS |
| `hook.rs` | `WH_KEYBOARD_LL` hook installation, hook thread, `@prompt` sequence detection |
| `buffer.rs` | Fixed-size ring buffer accumulating recent characters |
| `keymap.rs` | Win32 virtual key code → character mapping |
| `replacement.rs` | `SendInput` calls — Backspace erasure + Unicode text injection |

#### 6A.3. Hook Detection Algorithm

1. Every `WM_KEYDOWN` event adds the character to the ring buffer.
2. The buffer checks if its tail matches `@prompt`.
3. On match, it reads the HWND of the foreground window and emits `TriggerData { hwnd, trigger_len: 7 }` via a thread-safe N-API callback.
4. The hook thread is isolated from the Node.js event loop — the callback marshals data safely across threads.
5. On trigger: the overlay opens, `setSourceWindow(hwnd, title)` stores the HWND for later use by `overlay:insert` and `overlay:insert-section`.

---

### 6B. `platform-core` — Cross-Platform Capabilities

**Source**: `native/platform-core/`
**Build**: `napi-rs` toolchain (`@napi-rs/cli`)

A second, newer Rust module built with the `napi-rs` build system. Uses a richer dependency set including `@octokit`, `@emnapi`, and `es-toolkit`. Provides platform-level capabilities beyond Win32 keyboard hooks, including active window detection used by `ActiveWindowDetector` and other platform abstractions intended to support future cross-platform expansion. Compiled separately from `windows-core`.

---

## 7. Python AI Service

**Entry point**: `python-service/app/main.py`
**Runtime**: `python-service/venv/` (git-ignored)
**Port**: `127.0.0.1:8001`

### 7.1. HTTP / WebSocket Endpoints

| Endpoint | Type | Auth | Description |
|---|---|---|---|
| `GET /` | HTTP | — | Service info and endpoint listing |
| `GET /health` | HTTP | — | Liveness probe — `{ status: "ok" }` |
| `GET /health/ready` | HTTP | — | Readiness probe — checks LLM API key, model, Whisper model |
| `POST /optimize` | HTTP | JWT | Single-shot (non-streaming) prompt optimization with TTL cache |
| `WS /ws/optimize-stream` | WebSocket | JWT | **Primary** streaming optimization — receives chunks over WebSocket |
| `WS /ws/transcribe-stream` | WebSocket | JWT | Deepgram Nova-2 streaming transcription proxy (primary voice path) |
| `POST /transcribe-audio` | HTTP | JWT | Batch WAV transcription via local faster-Whisper (upload mode) |
| `POST /clarify` | HTTP | JWT | LLM-driven clarification question generation |
| `POST /generate-title` | HTTP | JWT | Auto-generate 3-5 word chat title (TITLE_MODEL, temp 0.3, 20 tokens) |
| `POST /extract-memory-facts` | HTTP | JWT | Extract user/behavioral/context memory facts (MEMORY_MODEL, temp 0.1) |
| `POST /auth/send-signup-otp` | HTTP | — | Send OTP for email verification during signup |
| `POST /auth/verify-signup-otp` | HTTP | — | Verify OTP and complete signup |
| `POST /auth/send-reset-otp` | HTTP | — | Send OTP for password reset |
| `POST /auth/reset-password` | HTTP | — | Reset password with valid OTP |

All authenticated endpoints verify the user's Supabase JWT (ES256 / HS256) via `app/auth.py`. Rate limiting via SlowAPI (`60/minute` default per IP, `10000/minute` application-wide). CORS is restricted to `localhost`/`127.0.0.1` by default (override via `ALLOWED_ORIGINS` env var). In production, `/docs`, `/redoc`, and `/openapi.json` are disabled.

### 7.2. Optimization Pipeline (`pipeline_v2/`)

Every streaming optimization request goes through four sequential steps:

```
User Prompt + Chat History + Files + Clarification Answers + Project Context
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
| `optimizer.py` | Orchestrates all four pipeline steps; injects clarification answers, project context, and user memory into the system prompt |
| `clarifier.py` | LLM-driven clarification question generator: analyzes the prompt for missing context, returns 2–4 structured multiple-choice questions; detects complex multi-part builds and adds a delivery format question; temperature=0.2, `json_object` response format |
| `task_planner.py` | Pre-pass for complex builds: when the user wants sectioned output, produces a structured task graph (3–12 ordered tasks with dependencies, concrete outputs, and state-after descriptions) before the optimizer writes sectioned output |
| `project_context.py` | Calls the Code Intelligence Service `/api/retrieve` to fetch semantically-relevant code chunks and formats them as a structured `[CODEBASE CONTEXT]` block injected into the optimizer's system prompt |
| `document_parser.py` | PDF text extraction (PyMuPDF), image vision API calls, 10 MB / 8 K token limits, magic-byte validation |
| `fast_mode.py` | Keyword-based prompt type detection; applies a targeted system prompt |
| `context.py` | `ChatContext` — maintains ordered message history for the pipeline |
| `config.py` | Reads `OPTIMIZER_MODEL`, `SUMMARIZER_MODEL`, `TITLE_MODEL`, `MEMORY_MODEL`, `OPENROUTER_API_KEY` from env |
| `skills.py` | Loads and parses `skill_*.md` files from `python-service/app/skills/` |
| `usage_logger.py` | Appends per-request token usage to daily `.jsonl` log files in `pipeline_v2/storage/usage/` |

### 7.3. Clarification Flow

When a user sends a new prompt, the `/clarify` endpoint is called **before** optimization:

```
User sends prompt
    │
    ▼
POST /clarify (SUMMARIZER_MODEL, temp=0.2, json_object)
    │
    ├── should_clarify: false → optimize immediately (simple prompts)
    └── should_clarify: true
          ├── is_complex: false → show 2-4 multiple-choice questions
          └── is_complex: true  → show questions + suggested build flow sections
                                  + delivery format question (one prompt vs sectioned tasks)
    │
    ▼
User answers questions (or skips)
    │
    ├── answers submitted → append answers to system prompt → optimize
    └── wantsSections: true → run task_planner.py first → optimizer writes sectioned output
```

### 7.4. Prompt Type Detection & Optimization Strategy

`detect_prompt_type()` in `main.py` uses keyword matching to classify input into one of eight categories: `coding`, `email`, `analysis`, `creative`, `image`, `documentation`, `business`, `general`. Each category maps to a **specialized system prompt** via `get_optimization_strategy()`:

| Category | Specialized System Prompt Strategy |
|---|---|
| `coding` | "Transform into a comprehensive technical specification PROMPT" — includes role context, requirements, edge cases, code quality, testing approach, output structure |
| `email` | "Transform into a structured communication PROMPT" — email structure, tone, call-to-action, audience |
| `analysis` | "Transform into a comprehensive analytical framework" — step-by-step approach, output structure, root causes → insights → recommendations |
| `creative` | "Transform into an inspiring PROMPT" — narrative arc, stanza format, style, sensory details, pacing |
| `image` | "Transform into a detailed visual specification" — lighting, composition, mood/atmosphere, subject details, technical specs |
| `documentation` | "Transform into a comprehensive doc structure" — sections, clarity, code examples, audience level |
| `business` | "Transform into a strategic, professional prompt" — situation→impact→action→outcome, stakeholder focus |
| `general` | "Transform into a clearer, more specific, and more effective version" — add structure, context, guidance |

On top of these, `SYSTEM_PROMPT` enforces strict behavioral rules: **output ONLY the improved prompt text**, no meta-commentary, no prefix phrases like "Here is...", no answering the prompt directly. This is enforced with explicit `DO NOT` / `DO` rules and three canonical examples.

After the LLM responds, `clean_optimized_text()` scrubs artifacts: removes markdown code fences, strips known prefix phrases ("Here is an optimized prompt:", etc.), and uses regex (`_CLEAN_ANALYSIS_RE`, `_CLEAN_LAST_SECTION_RE`) to strip any leaked internal analysis headers that the LLM may accidentally include in its output.

### 7.5. Vision Model Support

Detected automatically from the model name string. Supported models for image inputs:
- OpenAI: `gpt-4o`, `gpt-4o-mini`
- Anthropic: `claude-3-5-sonnet`, `claude-3-5-haiku`, `claude-haiku-4`, `claude-sonnet-4`
- Google: `gemini-1.5-flash`, `gemini-1.5-pro`

### 7.6. OTP Email Auth (`app/email_otp.py`)

Self-contained OTP service for email verification and password reset:
- Generates a 6-digit OTP, stores it in an in-memory dict with expiry (10 min).
- Sends the OTP via email using configured SMTP credentials.
- `verify_signup_otp` — verifies OTP, creates the Supabase user, and deletes the OTP record.
- `reset_password` — verifies OTP, calls Supabase Admin API to update password.
- `cleanup_expired` — runs every 5 minutes in a background asyncio task to remove expired OTPs.

### 7.7. Prompt Cache & Server-Side Rate Limiting

**Prompt Cache**: `TTLCache(maxsize=200, ttl=300)` — identical prompts within 5 minutes return the cached result instantly. Cache is bypassed for regeneration requests (which append a microsecond-precision `[REGENERATE_{id}]` suffix). Cache key is the raw prompt text; result is the cleaned optimized text.

**Rate Limiter**: In-memory per-user daily counter (`_rate_counters`, keyed as `"{user_id}:{YYYY-MM-DD}"`). Resets automatically at UTC midnight. Default limit: `DAILY_REQUEST_LIMIT=50` (env-configurable). Enforced both on `POST /optimize` (HTTP) and `/ws/optimize-stream` (WebSocket) — the WebSocket path checks the limit per-request inside the `while True:` receive loop, allowing the connection to stay alive and serving error frames rather than closing.

**Concurrency Semaphore**: `_optimize_semaphore = Semaphore(MAX_CONCURRENT_OPTIMIZATIONS=50)` — caps simultaneous LLM inference calls to prevent resource exhaustion.

### 7.8. Voice Transcription — Dual Stack

Prmpt supports two transcription backends depending on hardware availability:

#### Path A: Deepgram Nova-2 (Primary — `/ws/transcribe-stream`)
Real-time streaming proxy. FastAPI acts as a relay between the Electron WebSocket and Deepgram's cloud STT.

**Flow**:
1. Client sends `{ action: "start", session_id, sample_rate }` to establish the session.
2. Python opens a connection to `wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&interim_results=true&utterance_end_ms=1000&endpointing=300`.
3. Audio binary frames from Electron are forwarded directly to Deepgram.
4. `_deepgram_relay()` reads Deepgram JSON results, accumulates finalized segments, and pushes `{ type: "transcription", text, accumulated, is_final, speech_final }` back to the client.
5. Client sends `{ action: "stop" }` → Python sends `{ type: "CloseStream" }` to Deepgram → relay drains remaining results.

#### Path B: Local faster-Whisper (Fallback — `/transcribe-audio`)
Batch WAV upload path used when `torch` is not installed or for upload mode.

**Stack**: faster-Whisper `small` model (int8 quantization, CPU) + Silero VAD

**Whisper parameters**: `beam_size=5`, `temperature=0.0`, `no_speech_threshold=0.6`, `vad_filter=False` (VAD is done separately by Silero)

**Audio processing pipeline**:
1. Decode WAV: extract sample rate, channels, 16-bit PCM frames.
2. Stereo → mono: mean across channels.
3. Resample to 16 kHz using `scipy.signal.resample_poly` (polyphase, GCD-optimized for minimal aliasing).
4. Quality gates: `duration >= 0.3s`, `RMS >= MIN_INFER_RMS=0.0008`, Silero VAD must detect speech.
5. Silero VAD: 64ms window, `threshold=0.5`, `min_speech_duration_ms=250`, endpoint detection (not used as inference gate — failing VAD returns `True` to prevent silent audio drops).
6. faster-Whisper inference → join segment texts → return transcript.

**Speech window constants**:
- `MIN_SPEECH_S = 10s` — accumulates spoken audio before live partial trigger (processes as single chunk for maximum accuracy)
- `MAX_SPEECH_S = 30s` — hard cap to prevent memory growth
- `OVERLAP_SECONDS = 1.0s` — sliding window overlap for phonetic continuity at chunk boundaries

Both Whisper and Silero VAD models are preloaded at startup to eliminate cold-start latency.

---

## 8. Code Intelligence Service

**Technology**: Separate FastAPI microservice (not part of `python-service/`)
**Port**: `127.0.0.1:8002`
**Database**: Supabase PostgreSQL + `pgvector` extension

The Code Intelligence Service is a standalone microservice that indexes local codebases, stores structural AST chunks and their vector embeddings, and serves semantic retrieval queries for the Spaces feature.

### 8.1. Ingestion Pipeline

```
Local Project Directory
        │
        ▼
FileWatcher (chokidar, debounced 2s)
  → change detected
        │
        ▼
CodeParser (tree-sitter WASM)
  → parse file into ChunkData[]
  → extract: functions, classes, methods, imports, callees, signatures
  → compute SHA-256 content hash
        │
        ▼
LocalProjectCache (SQLite) — skip if hash unchanged
        │
        ▼
CodeIntelClient.ingestSkeleton(payload)
  → POST /api/index/ingest
        │
        ▼
Code Intelligence Service
  → store chunks in Supabase (code_chunks table)
  → store call graph in Supabase (call_graph_edges table)
  → generate embeddings → store in pgvector (chunk_embeddings table)
  → update project index_status
```

### 8.2. Retrieval Flow

When a user sends a prompt in a Space with attached projects:

```
User prompt (in SpaceWorkspace)
        │
        ▼
CodeIntelClient.retrieve({ project_id, query, branch, limit })
  → GET /api/retrieve
        │
        ▼
Code Intelligence Service
  → embed query via OpenRouter embedding model
  → pgvector ANN similarity search against chunk_embeddings
  → join with code_chunks for metadata + code_body
  → traverse call_graph_edges for related chunks
  → check branch divergence
  → return { ranked_chunks, related_chunks, branch_context }
        │
        ▼
buildTailoredPrompt() (client-side)
  → assembles ranked chunks (with code bodies) + related chunks
  → constructs structured prompt with file paths, line ranges, code blocks
        │
OR
        ▼
project_context.py (server-side via Python service)
  → formats as [CODEBASE CONTEXT] block
  → injected into optimizer system prompt automatically
```

### 8.3. Supported Languages

TypeScript/JavaScript, Python, Go, Rust, Java, Ruby, C, C++, C#

### 8.4. Branch Awareness

The `GitService` reads the current branch and passes it to the Code Intelligence Service. Chunks modified in the current branch (diverged from default) are flagged with `branch_diverged: true` in the retrieval response and surface a `⚠ Modified in current branch` warning in the formatted context.

---

## 9. Data Persistence

### 9.1. Supabase (PostgreSQL)

All cloud data is stored in Supabase with Row-Level Security (RLS) enforced on every table.

**Core Tables**

| Table | Key Columns | Purpose |
|---|---|---|
| `user_profiles` | `id`, `email`, `display_name`, `avatar_url`, `role` | User identity and avatar |
| `user_preferences` | `user_id`, `theme`, `font_size`, `model`, `custom_instructions`, `memory_enabled` | Synced UI preferences |
| `chats` | `id`, `user_id`, `title`, `created_at`, `updated_at` | Chat session metadata |
| `messages` | `id`, `chat_id`, `role`, `content`, `metadata`, `parent_id`, `version` | Messages with branching support |
| `prompt_collections` | `id`, `user_id`, `name`, `share_token` | Named prompt collections |
| `saved_prompts` | `id`, `collection_id`, `title`, `content`, `share_token`, `is_favorite` | Individual saved prompts |
| `user_memory` | `id`, `user_id`, `domain`, `style`, `score`, `observation_count` | Inferred user expertise/style |
| `deletion_requests` | `id`, `user_id`, `scheduled_for`, `cancelled_at` | GDPR deletion queue |

**Analytics Tables**

| Table | Key Columns | Purpose |
|---|---|---|
| `app_sessions` | `id`, `user_id`, `app_version`, `platform`, `ended_at`, `duration_seconds` | Per-login session tracking; `duration_seconds: null` = crash-recovered |
| `usage_events` | `id`, `user_id`, `event_type`, `metadata`, `created_at` | Granular feature usage events (batched via EventBuffer) |
| `daily_usage_summaries` | `user_id`, `date`, `optimization_count`, `total_sessions` | Daily rollup; updated by a Supabase trigger; crash-recovered sessions excluded from `total_sessions` |
| `download_events` | `id`, `platform`, `version`, `user_agent`, `created_at` | App installer download tracking |

**Code Intelligence Tables**

| Table | Key Columns | Purpose |
|---|---|---|
| `code_intel_projects` | `id`, `user_id`, `name`, `local_path`, `index_status`, `current_branch` | Indexed project registry |
| `code_chunks` | `id`, `project_id`, `file_path`, `start_line`, `end_line`, `chunk_type`, `name`, `signature`, `language`, `code_body`, `content_hash` | AST-extracted code chunks |
| `chunk_embeddings` | `chunk_id`, `embedding` (vector(768)) | pgvector embeddings for semantic search |
| `call_graph_edges` | `from_name`, `from_file`, `to_name`, `to_file`, `relationship_type` | Function call graph (`calls`, `imports`, `inherits`, `implements`) |

**Views**:
- `user_full_profile` — joins `user_profiles` + `user_preferences` for a single-fetch profile load

**Storage Buckets** (Supabase Storage):
- `attachments` — user file uploads (PDFs, images), per-user prefixed

**Migrations**: `supabase/migrations/` — applied in order via `npm run supabase:migrate`.

### 9.2. Cloudinary

Used for avatars (resized to 200 × 200 px before upload) and attachment thumbnails. The Electron main process handles uploads via `avatar-handlers.ts`.

### 9.3. Local Cache (Offline)

`localCache` (`electron/main/database/local-cache.ts`):
- In-memory store backed by a JSON file on disk.
- On every online chat load, the top 5 most recent chats and messages are written to cache.
- On offline, `ChatService` falls back to cache reads.
- `offlineQueue` buffers Supabase writes and flushes when connectivity is restored.

`LocalProjectCache` (`electron/main/database/local-project-cache.ts`):
- SQLite database (better-sqlite3) storing per-project file path → content hash mappings.
- Checked before every file re-index to skip unchanged files.
- Cleared on project deletion.

`EventBuffer` offline cache:
- Per-user JSON file at `userData/offline-cache/analytics-{userId}.json`.
- Events persisted here when Supabase is unreachable.
- Drained and replayed on next successful flush.

---

## 10. Key Workflows

### 10.1. Clarification → Optimization Flow (Enhanced)

```
User types prompt → Send
        │
        ▼
POST /clarify (SUMMARIZER_MODEL)
        │
        ├── should_clarify: false
        │       └── optimize directly
        └── should_clarify: true
                │
                ▼
        ClarificationCard renders with staggered animation
        (2-4 multiple-choice questions + extra notes textarea)
                │
                ├── User clicks "Skip" → optimize directly
                └── User selects options + clicks "Optimize"
                        │
                        ├── wantsSections: false → optimize with answers appended
                        └── wantsSections: true
                                │
                                ▼
                        POST /plan-tasks (SUMMARIZER_MODEL)
                        → 3-12 ordered task graph
                                │
                                ▼
                        Optimizer writes task-by-task structured output
```

### 10.2. Adaptive Buffered Streaming

Solves the "bursty network packet" problem where tokens arrive in uneven bursts:

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

### 10.3. Spaces / Code Intelligence Flow

```
User opens Spaces → Creates a Space → Attaches a local project
        │
        ▼
project-handlers.ts → CodeIntelClient.createProject()
  → FileWatcher.startWatching(projectPath)
  → Initial full-index: CodeParser parses all files
  → CodeIntelClient.ingestSkeleton(chunks, callGraph)
        │
        ▼ (on file save)
FileWatcher detects change (debounced 2s)
  → CodeParser.parseFile(changedFile)
  → LocalProjectCache.getCachedHash() — skip if unchanged
  → CodeIntelClient.ingestSkeleton(updatedChunk)
        │
        ▼ (when user sends a prompt in SpaceWorkspace)
CodeIntelClient.retrieve({ project_id, query: userPrompt })
  → Service performs pgvector ANN search
  → Returns ranked + related chunks with code bodies
  → buildTailoredPrompt() assembles context-rich prompt
  → User can send to main chat for full optimization
```

### 10.4. Analytics Session Lifecycle

```
User logs in
  → analyticsService.initialize(userId)
  → EventBuffer.drainOfflineQueue()    (replay any offline events)
  → analyticsService.startSession(appVersion)
       → Close any open sessions from previous crash (duration: null)
       → INSERT into app_sessions
  → Sentry.setTag('analytics_session', sessionId)
        │
User interacts
  → analyticsService.logEvent('optimization_run', { model, skill })
  → EventBuffer.push(event)
  → Auto-flush every 10s or 50 events
  → On flush failure: persist to offline-cache/analytics-{userId}.json
        │
User quits / logs out
  → analyticsService.shutdown()
       → analyticsService.endSession()   (UPDATE app_sessions with duration)
       → EventBuffer.flushSync()         (drain remaining events)
```

### 10.5. User Memory System

Runs automatically in the background every 5 optimizations:

1. After each optimization, `MemoryAnalyzer.maybeRun(userId)` is called.
2. Every 5th call, fetches the 50 most recent user prompts.
3. Applies **exponential recency decay**: `weight = e^(-0.06 × index)` where index 0 is most recent.
4. Detects domains (Backend Dev, ML Engineering, Frontend, Data Science, DevOps, etc.) and writing styles (concise, technical, verbose, creative, formal).
5. Upserts top-scoring entries into `user_memory` with `observation_count` increment.
6. On next optimization, memory entries are prepended to the system prompt.

### 10.6. GDPR Account Deletion

1. User clicks "Delete Account" in Settings → `account:request-deletion` IPC.
2. `DeletionService` inserts a row into `deletion_requests` with `scheduled_for = now() + 30 days`.
3. A Supabase edge function (cron) checks daily for past-due deletion requests and permanently removes all user data.
4. User can cancel within the 30-day window via `account:cancel-deletion`.

### 10.7. Overlay Cursor Glow

1. When the overlay opens, `startCursorPolling()` starts a `setInterval` at ~16 ms (~60 fps).
2. Each tick: `screen.getCursorScreenPoint()` → translated to overlay-relative coordinates.
3. `overlay:cursor-pos` IPC event sent to renderer.
4. Renderer updates `.panel-glow-wrapper` with `radial-gradient(circle at Xpx Ypx, <emerald>, transparent)`.
5. After 1.5 s of cursor inactivity, glow opacity fades to 0 via CSS transition.
6. Polling stops when the overlay is hidden.

### 10.8. Offline Mode

1. `networkMonitor` polls `https://www.google.com` every 10 s.
2. On connectivity loss: broadcasts `network-status: { online: false }` to all windows → UI shows amber offline banner; send button disabled.
3. Chat/message loads fall back to `localCache`.
4. Write operations queued in `offlineQueue`.
5. On reconnect: `network:reconnected` fires → queue flushed → Supabase writes replayed.

---

## 11. IPC Bridge (`preload.ts`)

[`electron/preload.ts`](electron/preload.ts) uses Electron's `contextBridge` to expose a typed `window.electronAPI` object. All renderer ↔ main communication flows through this bridge — direct `ipcRenderer` calls are never exposed.

### Namespace Map

| Namespace | Methods |
|---|---|
| `window.electronAPI.chat.*` | `send`, `load`, `list`, `create`, `delete`, `rename`, `stop`, `getMessageVersions` |
| `window.electronAPI.overlay.*` | `optimize`, `save`, `insert`, `close`, `getChats` |
| `window.electronAPI.auth.*` | `login`, `signup`, `logout`, `check`, `sendSignupOtp`, `verifySignupOtp`, `sendResetOtp`, `resetPassword` |
| `window.electronAPI.promptLibrary.*` | `getCollections`, `createCollection`, `savePrompt`, `deletePrompt`, `getShareLink`, `getSharedCollection`, `saveSharedCollection` |
| `window.electronAPI.memory.*` | `getMemory`, `updateMemory`, `deleteMemory` |
| `window.electronAPI.settings.*` | `load`, `save` |
| `window.electronAPI.user.*` | `getProfile`, `updateProfile` |
| `window.electronAPI.avatar.*` | `upload` |
| `window.electronAPI.transcription.*` | `start`, `stop` |
| `window.electronAPI.feedback.*` | `submit` |
| `window.electronAPI.account.*` | `requestDeletion`, `cancelDeletion` |
| `window.electronAPI.project.*` | `create`, `list`, `index`, `retrieve`, `watch`, `unwatch`, `gitInfo`, `deleteProject` |
| `window.electronAPI.windowControls.*` | `minimize`, `maximize`, `close` |
| `window.electronAPI.onNetworkStatus` | Event listener — `{ online: boolean }` |
| `window.electronAPI.onAuthStateChange` | Event listener — `{ isAuthenticated, user }` |
| `window.electronAPI.onSentryUser` | Event listener — Sentry user identity propagation |

---

## 12. Environment Variables

| Variable | Used by | Description |
|---|---|---|
| `SUPABASE_URL` | Electron main | Supabase project URL |
| `SUPABASE_ANON_KEY` | Electron main | Supabase anonymous (public) key |
| `PYTHON_SERVICE_URL` | Electron main | Python service base URL (default: `http://127.0.0.1:8001`) |
| `CODE_INTELLIGENCE_SERVICE_URL` | Electron main + Python service | Code Intelligence Service URL (default: `http://127.0.0.1:8002`) |
| `OPENROUTER_API_KEY` | Python service | API key for OpenRouter LLM gateway |
| `OPTIMIZER_MODEL` | Python service | Main streaming model (e.g. `openrouter/anthropic/claude-haiku-4.5`) |
| `SUMMARIZER_MODEL` | Python service | Cheap model for clarification/summaries/titles/memory (e.g. `openrouter/openai/gpt-4o-mini`) |
| `TITLE_MODEL` | Python service | Model for chat title generation |
| `MEMORY_MODEL` | Python service | Model for user memory extraction |
| `DEEPGRAM_API_KEY` | Python service | Deepgram API key for cloud speech-to-text (fallback for Whisper) |
| `VITE_CLOUDINARY_CLOUD_NAME` | React renderer | Cloudinary cloud name (inlined at build time) |
| `VITE_CLOUDINARY_UPLOAD_PRESET` | React renderer | Cloudinary unsigned upload preset |
| `CLOUDINARY_API_KEY` | Electron main | Cloudinary API key (signed uploads) |
| `CLOUDINARY_API_SECRET` | Electron main | Cloudinary API secret |
| `NODE_ENV` | Electron main + renderer | `development` or `production` — controls Sentry sample rate |
| `APP_ENV` | Python service | `development` or `production` — disables /docs in production |
| `APP_VERSION` | Python service | Semantic version string injected at build time for Sentry release tracking |
| `SENTRY_DSN` | Electron main | Sentry DSN for main process errors |
| `VITE_SENTRY_DSN` | React renderer | Sentry DSN for renderer errors (inlined at build time) |
| `SENTRY_PYTHON_DSN` | Python service | Sentry DSN for Python errors |
| `SENTRY_AUTH_TOKEN` | Build pipeline | For source-map upload during production builds |
| `SENTRY_ORG` | Build pipeline | Sentry organization slug |
| `SENTRY_PROJECT` | Build pipeline | Sentry project slug |

---

## 13. Design System

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

The app uses `Inter` (UI) and `Space Grotesk` (headings) loaded via Google Fonts. Font size and line-height are controlled by the `font_size` user preference and applied as a CSS variable at the root element.
