# Prmpt — System Architecture

## 1. System Overview

Prmpt is a **cross-platform desktop application** for **Windows and macOS** that optimizes AI prompts in real-time. It is a coordinated system of **six distinct runtime environments**, each solving a problem the others cannot:

- **Electron Main Process** — orchestrator, IPC hub, window lifecycle, analytics, offline queue, login items, dock control
- **App Window** — React SPA for full chat, history, library, settings, and Spaces (`hiddenInset` title bar on macOS, frameless on Windows)
- **Overlay Window** — frameless always-on-top floating panel for instant in-context optimization (`visibleOnAllWorkspaces` on macOS so it follows the user across Spaces / Mission Control)
- **Python AI Service** — FastAPI server (port 8001): LLM streaming, clarification, task planning, voice transcription, OTP auth
- **Code Intelligence Service** — separate FastAPI microservice (port 8002): hybrid retrieval (vector + full-text + concept + path) with HNSW pgvector, query preprocessing, call-graph expansion, GitHub sync, optional ARQ workers
- **Rust Native Module (`platform-core`)** — single N-API crate, **two platform backends**: keyboard hook (`WH_KEYBOARD_LL` on Windows / `CGEventTap` on macOS) and text replacement (`SendInput` on Windows / `CGEventPost` + clipboard restore on macOS)

```
┌───────────────────────────────────────────────────────────────────────┐
│                           User / OS                                    │
│  Types "@prompt" anywhere   │  Presses Ctrl/Cmd+5  │  Clicks tray     │
└──────────────┬──────────────┴───────┬───────────┴──────────────────────┘
               │                      │
    ┌──────────▼─────────────┐        │
    │   Rust Native Hook     │        │
    │ Win: WH_KEYBOARD_LL    │        │
    │ macOS: CGEventTap      │        │
    └──────────┬─────────────┘        │
               │ TriggerAnchor        │
               │ (HWND on Win,        │
               │  PID on macOS)       │
               └──────────────────────▼──────────────────────┐
                                                             │
                             ┌───────────────────────────────▼──────┐
                             │        Electron Main Process          │
                             │  (index-new.ts — IPC Hub)             │
                             │  Analytics · Guardrails · Offline Q   │
                             │  LoginItems · Dock (mac)              │
                             └──┬────────────────────┬──────────────┘
                                │                    │
              ┌─────────────────▼──┐     ┌──────────▼────────────┐
              │    App Window       │     │    Overlay Window      │
              │  React · hiddenInset│     │  React · always-on-top │
              │  (mac) / frameless  │     │  visibleOnAllWorkspaces│
              │  (win)              │     │  (mac)                 │
              └─────────────────────┘     └───────────────────────┘
                             │
              ┌──────────────┼──────────────┬──────────────────┐
              │              │              │                  │
   ┌──────────▼──┐  ┌────────▼──────┐  ┌───▼──────────┐  ┌───▼────────────┐
   │  Supabase    │  │ Python Service │  │ Code Intel   │  │   Cloudinary   │
   │  Postgres +  │  │ FastAPI :8001  │  │ Service      │  │  (Avatars +    │
   │  pgvector    │  │ Whisper + LLM  │  │ FastAPI :8002│  │   Attachments) │
   │  HNSW + RLS  │  │ Sentry SDK     │  │ Sentry+FastApi  │             │
   └─────────────┘  └───────────────┘  └──────────────┘  └────────────────┘
```

**Observability (Sentry) spans four runtime surfaces**: Electron main, React App Window, React Overlay (both with replay + browser tracing), the Python optimization service, and the Python Code Intelligence service (with `FastApiIntegration` for automatic route spans). PII and prompt content are scrubbed via `beforeSend` before transmission. See §14.

---

## 2. Trigger Flows

There are three ways to open the overlay:

### 2.1. `@prompt` Native Hook (Primary Trigger)

1. User types `@prompt` in **any** application on either OS.
2. The Rust native module installs a global keyboard hook — **`WH_KEYBOARD_LL` via `SetWindowsHookExW` on Windows**, **`CGEventTap` (`kCGSessionEventTap`, listen-only) attached to the main `CFRunLoop` on macOS**.
3. A ring buffer in `buffer.rs` accumulates characters from translated key events. The same `on_char_keydown` handler is shared by both backends. When `@prompt` is detected at the buffer tail, it fires `TriggerData { hwnd, trigger_len }` to Node.js via a thread-safe N-API callback.
4. **`TriggerData.hwnd` is platform-overloaded**: a raw HWND on Windows, the frontmost-application **PID** on macOS (resolved via `NSWorkspace.frontmostApplication`).
5. Electron main (`index-new.ts`) receives the callback and calls `overlayManager.open()`.
6. Simultaneously, `TextReplacer` removes `@prompt` from the text field — **Backspace via `SendInput` on Windows**, **clipboard-swap + `Cmd+V` paste via `CGEventPost` on macOS** (the Mac path saves the existing pasteboard, sends N backspaces, paste, then restores).
7. The overlay opens positioned near the cursor, pre-focused and ready for input.

> **macOS prerequisite — Accessibility permission.** `CGEventTap` and `CGEventPost` require Accessibility access. On startup, `index-new.ts` calls `ensureAccessibilityPermission()` (in `utils/native-bridge.ts`). If missing, the user is shown a dialog with a deep-link to System Settings → Privacy & Security → Accessibility. The hook is not started until the permission is granted (the main process polls for the change).

### 2.2. `CommandOrControl+5` Global Shortcut

1. Electron registers `globalShortcut.register('CommandOrControl+5', …)` on app ready — this resolves to **`Ctrl+5` on Windows** and **`Cmd+5` on macOS**.
2. Press toggles `overlayManager.toggle()` — open if closed, close if open.
3. The tray menu label is platform-aware (`Cmd+5` on macOS, `Ctrl+5` on Windows).

### 2.3. System Tray

1. `SystemTray` creates a tray icon with a context menu. The icon source is platform-aware:
   - **macOS**: `build/tray-iconTemplate.png` (template image — Electron auto-inverts for light/dark menu bars; `@2x` variant for Retina)
   - **Windows**: `build/tray-icon.png` (full color)
2. Clicking "Open Overlay" calls `overlayManager.open()`.
3. Clicking "Open App" shows the main App Window.
4. The "Start at Login" checkbox toggles `app.setLoginItemSettings({ openAtLogin, openAsHidden: true, … })` — Windows additionally passes `path: process.execPath, args: ['--hidden']`.

### 2.4. Silent Auto-Launch at Login

When the user enables "Start at Login":

- **macOS** boots Prmpt with `wasOpenedAsHidden = true` (since `openAsHidden: true` was set on the login item).
- **Windows** boots Prmpt with `process.argv` containing `--hidden` (the arg added when the login item was registered).

`index-new.ts` defines:

```ts
function isSilentLaunch(): boolean {
  if (process.platform === 'darwin') return app.getLoginItemSettings().wasOpenedAsHidden;
  return process.argv.includes('--hidden');
}
```

If `isSilentLaunch()` returns true, the main process skips `appWindowManager.show()` and the app sits in the tray only. The user opens the App Window manually from the tray. A breadcrumb is logged to Sentry (`category: 'startup', message: 'Silent launch — window hidden'`).

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
  → [macOS only] app.dock.setIcon(build/dock-icon.png in dev,
                                   resourcesPath/icon.icns in packaged)
  → [macOS only] ensureAccessibilityPermission()   (poll → guided dialog if missing)
  → SupabaseClientManager.initialize()
  → AppWindowManager.preload()             (hidden BrowserWindow)
  → OverlayWindowManager.preload()         (hidden BrowserWindow;
                                            visibleOnAllWorkspaces=true on macOS)
  → PythonClient.healthCheck() + .connect()
  → CodeIntelClient.healthCheck()          (optional — Spaces feature)
  → networkMonitor.start()
  → TranscriptionClient.initialize()
  → checkAndRestoreSession()               (auto-login if session cookie exists)
  → analyticsService.initialize(userId)    (starts EventBuffer + session)
  → register all IPC handlers
  → startKeystrokeDetection()              (Rust native hook — gated on accessibility on macOS)
  → globalShortcut.register('CommandOrControl+5')
  → SystemTray.create()                    (template image on macOS, full color on Windows)
  → if (!isSilentLaunch()) appWindowManager.show()
                                          (silent launch → stay in tray)
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

| Module | Path | Purpose |
|---|---|---|
| `OverlayWindowManager` | `electron/main/overlay/overlay-window-manager.ts` | Create, position, show, hide, toggle the overlay `BrowserWindow`. On macOS sets `visibleOnAllWorkspaces`, `setVisibleOnAllWorkspaces({ visibleOnFullScreen: true })`, uses `showInactive()` and `moveTop()` so the overlay appears above whatever app the user is in without stealing focus from the source app's caret |
| `AppWindowManager` | `electron/main/windows/app-window-manager.ts` | Create and manage the main app `BrowserWindow`. **macOS** uses `titleBarStyle: 'hiddenInset'` + `trafficLightPosition: { x: 12, y: 12 }`; **Windows** uses `frame: false`. Wires `app.dock.show()` on `create()`/`show()` and `app.dock.hide()` on `hide()` and the `close` event so the App Window appears in the macOS Dock and `Cmd+Tab` switcher only while visible |
| `SystemTray` | `electron/main/windows/system-tray.ts` | Cross-platform system tray. Loads `tray-iconTemplate.png` on macOS (template image) or `tray-icon.png` on Windows. Menu includes Open Overlay, Open App, **Start at Login** (checkbox bound to `app.getLoginItemSettings().openAtLogin`), Quit. Menu label dynamically shows `Cmd+5` (macOS) or `Ctrl+5` (Windows) |
| `PythonClient` | `electron/main/api/python-client.ts` | WebSocket client to Python service (`/ws/optimize-stream`); exposes `optimizeStream()`, `clarify()`, `generateTitle()`, `abortLatestStream()` |
| `CodeIntelClient` | `electron/main/api/code-intel-client.ts` | HTTP client for the Code Intelligence Service (port 8002). All public methods wrapped in `Sentry.startSpan` (`codeIntel.ingestSkeleton`, `codeIntel.retrieve`); health check sets `Sentry.setTag('code_intel.healthy', …)`; successful retrieval emits a `code-intel` breadcrumb with project_id and chunk count |
| `TranscriptionClient` | `electron/main/api/transcription-client.ts` | WebSocket client to Python transcription endpoint |
| `localCache` | `electron/main/database/local-cache.ts` | In-memory + disk JSON cache (top 5 recent chats) |
| `LocalProjectCache` | `electron/main/database/local-project-cache.ts` | SQLite-backed (better-sqlite3) per-project file content hash store. `Sentry.captureException` if `better-sqlite3` fails to load |
| `offlineQueue` | `electron/main/database/offline-queue.ts` | Buffers Supabase writes when offline; flushes on reconnect |
| `authState` | `electron/main/utils/auth-state.ts` | Singleton — current auth state (userId, email, isAuthenticated, accessToken) shared across handlers |
| `native-bridge` | `electron/main/utils/native-bridge.ts` | Wraps the Rust `native/platform-core/` module via `index.js` (which loads the correct `.node` per platform). Provides `checkAccessibilityPermission()` (macOS-only) and graceful fallback if the binary is unavailable |
| `TextReplacer` | `electron/main/text/text-replacer.ts` | Removes `@prompt` trigger text. On Windows: `replaceAtLastAnchor` via `SendInput` (Backspace + Unicode injection). On macOS: clipboard-swap paste via `CGEventPost` (saves pasteboard, deletes N chars, paste, restores) |
| `WindowTracker` | `electron/main/context/window-tracker.ts` | Tracks the last focused non-Prmpt window (used for overlay insert target) |
| `ActiveWindowDetector` | `electron/main/services/active-window-detector.ts` | Polls active window via the **`active-win`** npm package (not a separate native module). Used to surface project context relevant to the user's current application; lazy-required, with `Sentry.captureException` on require failure and breadcrumbs on start/stop |
| `ErrorLog` | `electron/main/database/error-log.ts` | Local error log file written to `userData/error-log.json`; surfaces critical errors that can't reach Sentry |

---

## 6. Rust Native Module — `platform-core`

There is **one** Rust crate at `native/platform-core/` — a **cross-platform N-API module** with two compiled targets and platform-dispatched implementations behind a single API surface.

**Source**: `native/platform-core/src/`
**Outputs**: `native/platform-core/platform-core.win32-x64-msvc.node` (Windows x64), `native/platform-core/platform-core.darwin-arm64.node` (macOS Apple Silicon)
**Loader**: `native/platform-core/index.js` — picks the right `.node` for the current platform/arch
**Build**: `npm run native:build` (host platform, release) · `npm run native:build:mac` (macOS) · `npm run native:build:debug` (debug)
**Wrapper**: `electron/main/utils/native-bridge.ts` — provides graceful no-op fallback if the binary is unavailable, plus `checkAccessibilityPermission()` (macOS-only).

### 6.1. Exported N-API Functions

| Function | Description |
|---|---|
| `startHook(callback)` | Installs the keyboard hook. Windows: `WH_KEYBOARD_LL` on a dedicated message-pump thread. macOS: `CGEventTap` (`kCGSessionEventTap`, listen-only) added to the main `CFRunLoop`. Fires `TriggerData { hwnd, trigger_len }` on `@prompt` detection |
| `stopHook()` | Removes the hook and shuts down the hook thread / disables the event tap |
| `checkAccessibilityPermission()` | **macOS-only**. Calls `AXIsProcessTrustedWithOptions`. Returns true when the user has granted Accessibility access. Returns true on Windows (no-op) |
| `getActiveWindowTitle()` | Returns the title of the currently focused window. Windows: `GetForegroundWindow` + `GetWindowTextW`. macOS: `osascript` against System Events (with frontmost app name as fallback) |
| `replaceAtLastAnchor(text)` | Removes the trigger and inserts replacement text. Windows: foreground via `SetForegroundWindow`, select trigger with Shift+Left, inject via `KEYEVENTF_UNICODE`. macOS: `CGEventPost` Backspace × N, then clipboard swap + `Cmd+V` paste, then restore the original pasteboard |
| `pasteTextToWindow(hwnd, text)` | Pastes text at the current caret. Windows: targets HWND; macOS: targets the frontmost PID |
| `sendEnterToWindow(hwnd)` | Sends an Enter keystroke (auto-submit in chat apps) |
| `forceFocusWindow(hwnd)` | Brings a window to the foreground. Windows: `SetForegroundWindow` with attach-thread-input dance. macOS: `osascript` `tell process X to activate` against the PID |

> **`TriggerData.hwnd` is platform-overloaded.** On Windows it's a raw HWND. On macOS it's the **PID** of the frontmost application (resolved via `NSWorkspace.frontmostApplication`). Code paths in Electron (`overlay:insert`, `overlay:insert-section`, `WindowTracker`) treat it as an opaque integer "anchor" and forward it back to the same native function, so the abstraction holds.

### 6.2. Source Layout

| File | Role |
|---|---|
| `lib.rs` | N-API exports + platform dispatch (`#[cfg(target_os = …)]` for `win32` and `macos_util` modules) |
| `hook.rs` | Shared `on_char_keydown` handler + per-OS hook installation: `WH_KEYBOARD_LL` thread (Windows) and `CGEventTap` on the main `CFRunLoop` (macOS) |
| `buffer.rs` | Fixed-size ring buffer; same code on both platforms |
| `keymap.rs` | Win32 virtual key code → character mapping (Windows-only — gated by `#[cfg(target_os = "windows")]`). The macOS path uses `CGKeyCode` lookups inline |
| `replacement.rs` | Text replacement — `SendInput` path on Windows, `CGEventPost` + clipboard restore path on macOS |

### 6.3. Hook Detection Algorithm

1. Every translated key-down event calls `on_char_keydown(ch)`.
2. The shared ring buffer checks if its tail matches `@prompt`.
3. On match, the platform module reads the foreground identifier (HWND on Windows / PID on macOS) and emits `TriggerData { hwnd, trigger_len: 7 }` via a thread-safe N-API callback.
4. The hook thread / `CFRunLoop` is isolated from the Node.js event loop — the `ThreadsafeFunction` marshals data safely across threads.
5. On trigger: the overlay opens, `setSourceWindow(hwnd, title)` stores the anchor for later use by `overlay:insert` and `overlay:insert-section`.

### 6.4. macOS-Specific Behavior Summary

| Concern | Implementation |
|---|---|
| Permission gate | `AXIsProcessTrustedWithOptions` (no prompt — Electron asks via `systemPreferences.isTrustedAccessibilityClient(true)` from JS) |
| Hook | `CGEventTap` added to `CFRunLoopGetMain`; events are read-only and pass through unchanged |
| Text removal | `CGEventCreateKeyboardEvent(kVK_Delete, true/false)` × N |
| Text insertion | Clipboard swap: save `NSPasteboard.general`, set new contents, post `Cmd+V`, sleep ~30ms, restore original pasteboard |
| Active app/window title | `osascript` against System Events (no need for full Accessibility permissions to read names) |
| Force focus | `osascript` `tell application process "X" to activate` |

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

**Technology**: Separate FastAPI microservice — `code-intelligence-service/`
**Port**: `127.0.0.1:8002`
**Database**: Supabase PostgreSQL + `pgvector` extension (HNSW index)
**Optional**: Redis (`REDIS_URL`) for ARQ background workers; the service runs without it but ingest is then inline async

### 8.1. Architecture

The service is a thin FastAPI app (`app/main.py`) with:
- `RequestIDMiddleware` (echoes/sets `X-Request-ID`)
- `SlowAPIMiddleware` rate limiter (`120/min` default per IP)
- CORS limited to `localhost`/`127.0.0.1` (override via `ALLOWED_ORIGINS`)
- **Sentry** initialized with `LoggingIntegration` + **`FastApiIntegration`** — every route gets an automatic span; logs at ERROR level become Sentry events
- Six route groups under `/api`, plus `/health`, `/health/ready`, `/`

### 8.2. Routes

| Method · Path | Module | Purpose |
|---|---|---|
| `POST/GET /api/projects` | `routes/projects.py` | Create / list / get / delete a Space project |
| `POST /api/index/ingest` | `routes/ingest.py` | Receive a parsed skeleton from Electron and enqueue chunks for embedding |
| `GET /api/retrieve` | `routes/retrieve.py` | Hybrid retrieval — query + project_id + branch → ranked chunks + related |
| `POST /api/context` | `routes/context.py` | Higher-level context assembly call used by the optimizer service |
| `POST /api/sync` | `routes/sync.py` | Manual GitHub sync trigger (alternative to webhooks) |
| `POST /api/webhooks/github` | `routes/webhooks.py` | GitHub webhook endpoint (push events trigger background re-sync) |

### 8.3. Embeddings & Storage

- **Model**: OpenAI `text-embedding-3-small`
- **Dimensions**: **512** (reduced from the default 1536 — see migration `20260414_reduce_embedding_dims.sql` — for HNSW efficiency at small project scales)
- **Vector index**: pgvector **HNSW** with `m = 16, ef_construction = 64` (migration `20260414_fix_vector_index.sql`; replaced the original IVFFlat index which suffered poor recall on small projects)
- **Per-ingest budget**: `MAX_CHUNKS_PER_INGEST = 10_000`, `UPSERT_BATCH_SIZE = 50`, `SUMMARIZER_BATCH_SIZE = 5`, `SUMMARIZER_CONCURRENCY = 15`
- **Summarization**: `SUMMARIZER_MODEL` (default `openrouter/openai/gpt-4.1-nano`), `SUMMARY_MAX_TOKENS = 150`

### 8.4. Services Layer (`app/services/`)

| Module | Role |
|---|---|
| `embedding.py` | Batched calls to the embedding provider with retries + Sentry capture |
| `summarizer.py` | Per-chunk natural-language summary generation (used as an additional retrievable signal) |
| `code_analyzer.py` | Server-side code analysis utilities (additional metadata extraction beyond the Electron parser) |
| `query_preprocessor.py` | Cleans and normalizes user queries before retrieval (strips noise, expands acronyms, etc.) |
| `query_analyzer.py` | Decides retrieval strategy: simple (≤ `SIMPLE_QUERY_WORD_THRESHOLD` words) vs decomposed-multi-query for complex prompts (uses `QUERY_DECOMPOSE_MODEL`) |
| `search.py` | The hybrid retrieval pipeline (next section) |
| `project_summary.py` | Caches a project-level summary used as a fallback when retrieval is empty |

### 8.5. Workers (`app/workers/`)

| Worker | Trigger | Role |
|---|---|---|
| `arq_worker.py` | `arq` runner | Hosts the async task queue (Redis-backed). Initializes its own Sentry SDK because it runs in a separate process |
| `index_worker.py` | Enqueued by `ingest.py` | Batch-embeds new/changed chunks, upserts to `code_chunks` and `chunk_embeddings`, dedup by content hash |
| `sync_worker.py` | Polled / webhook | Pulls latest from GitHub for projects with a remote, enqueues re-ingest |

### 8.6. Hybrid Retrieval Pipeline

When a user sends a prompt in a Space with attached projects:

```
User prompt (in SpaceWorkspace)
        │
        ▼
CodeIntelClient.retrieve({ project_id, query, branch, limit })
  → GET /api/retrieve
        │
        ▼  query_preprocessor.normalize(query)
        ▼  query_analyzer.classify(query)
        │       ├── simple → single-query path
        │       └── complex → QUERY_DECOMPOSE_MODEL → 2-4 sub-queries
        ▼
  Parallel retrieval (all sub-queries):
    1. Vector ANN  (pgvector HNSW; ef_search tuned per query)
    2. Full-text   (Postgres tsvector on chunk bodies + signatures)
    3. Concept     (signatures, names, types via similarity)
    4. File-path   (path-substring + identifier-in-path heuristics)
        │
        ▼  Reciprocal Rank Fusion (RRF)
        ▼  Rerank top-K by composite score
        ▼  Call-graph expansion (depth ≤ GRAPH_MAX_DEPTH=2,
                                  ≤ GRAPH_MAX_RELATED=20,
                                  similarity ≥ GRAPH_SIMILARITY_THRESHOLD=0.25)
        ▼  Branch overlay — flag chunks modified in current branch (GitService input)
        │
        ▼
  Returns { ranked_chunks, related_chunks, branch_context }
        │
        ▼
buildTailoredPrompt() (client-side in SpaceWorkspace)
  OR
project_context.py (server-side via Python optimization service)
  → formats as [CODEBASE CONTEXT] block → optimizer system prompt
```

Defaults: `RETRIEVAL_DEFAULT_LIMIT = 15`, `RETRIEVAL_MAX_LIMIT = 50`, `MAX_CODE_BODY_LEN = 3000`.

### 8.7. Ingestion Pipeline (Cross-Process)

The Electron main process owns parsing and watching; the service owns embedding, indexing, and storage:

```
Local Project Directory
        │
        ▼  [Electron]  FileWatcher (chokidar, debounced 2s)
        │              skips node_modules / .git / dist / build / venv / target
        │
        ▼  [Electron]  CodeParser (tree-sitter WASM)
        │              extracts ChunkData[] (functions, classes, methods, imports, callees, signatures)
        │              computes SHA-256 content hash
        │
        ▼  [Electron]  LocalProjectCache (SQLite) — skip if hash unchanged
        │
        ▼  [Electron]  CodeIntelClient.ingestSkeleton(payload)  ← Sentry span: codeIntel.ingestSkeleton
        │              POST /api/index/ingest  (Bearer JWT)
        │
        ▼  [Service]   routes/ingest.py
        │              ── if Redis available: enqueue to arq → index_worker.py
        │              ── else: inline asyncio task
        │
        ▼  [Service]   index_worker
        │              dedup vs existing content_hash → embedding.py batch call
        │              upsert into code_chunks + chunk_embeddings (HNSW)
        │              update call_graph_edges
        │              mark project index_status=ready
```

### 8.8. Supported Languages

Driven by **Electron-side** Tree-sitter WASM grammars under `tree-sitter-wasms/`. Currently bundled: TypeScript/JavaScript, Python, Go, Rust, Java, Ruby, C, C++, C# (10 grammars across 11 file extensions). The service itself is language-agnostic — it just stores chunks and embeddings.

### 8.9. Branch Awareness

The `GitService` (Electron) reads `currentBranch`, `defaultBranch`, `aheadCount`, `behindCount`, and recent commit history. The branch is sent on every `retrieve` call. Chunks modified in the current branch (diverged from default) are flagged with `branch_diverged: true` in the response and surface a `⚠ Modified in current branch` warning in the formatted context.

### 8.10. Observability

- `app/main.py` initializes Sentry with `FastApiIntegration` — every route automatically becomes a span
- Every route handler has its `except` block calling `sentry_sdk.capture_exception(e)`
- Each service module (`search`, `embedding`, `summarizer`, `code_analyzer`, `query_analyzer`, `query_preprocessor`) does the same
- `arq_worker.py` initializes a separate Sentry SDK because it runs in a separate process
- `index_worker.py` captures exceptions on batch embedding failures
- Electron's `CodeIntelClient` wraps every call in `Sentry.startSpan` with operation tags (`code-intel.ingest`, `code-intel.search`)

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

**Code Intelligence Tables** (created by `supabase/migrations/20260407_add_project_context.sql` and later migrations)

| Table | Key Columns | Purpose |
|---|---|---|
| `projects` | `id`, `user_id`, `name`, `local_path`, `index_status`, `current_branch`, `default_branch` | Indexed Space project registry |
| `code_chunks` | `id`, `project_id`, `file_path`, `start_line`, `end_line`, `chunk_type`, `name`, `signature`, `language`, `code_body`, `summary`, `content_hash` | AST-extracted code chunks (with optional summary from `summarizer.py`) |
| `chunk_embeddings` | `chunk_id`, `embedding` (`vector(512)`) | pgvector embeddings; **HNSW index** (`m=16, ef_construction=64`) per `20260414_fix_vector_index.sql` |
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

### 10.9. Silent Auto-Launch at Login

```
[Tray menu] User toggles "Start at Login"
        ▼
app.setLoginItemSettings({
  openAtLogin: checked,
  openAsHidden: true,                                  // macOS
  ...(process.platform === 'win32' && {                // Windows
    path: process.execPath,
    args: ['--hidden'],
  }),
})
        ▼
[Sentry] addBreadcrumb({ category: 'auto-launch', message: 'Start at login enabled/disabled' })

──── Next boot ────

[OS auto-starts Prmpt at login]
        ▼
isSilentLaunch():
  darwin → app.getLoginItemSettings().wasOpenedAsHidden
  win32  → process.argv.includes('--hidden')
        ▼
      true → skip appWindowManager.show(); stay in tray
      false → appWindowManager.show() (normal launch)
```

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
| `window.electronAPI.onSentryUser` | Event listener — Sentry user identity propagation (forwarded from main on auth state change) |
| `window.electronAPI.onActiveProjectChanged` | Event listener — fires when `ActiveWindowDetector` resolves a different Space project from the focused app |

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
| `SENTRY_DSN` | Electron main · Code Intelligence service | Each reads its own `SENTRY_DSN` from its own `.env` (root for Electron, `code-intelligence-service/.env` for the service) |
| `VITE_SENTRY_DSN` | React renderer | Sentry DSN for renderer errors (inlined at build time; used by both App Window and Overlay entry points with replay enabled) |
| `SENTRY_PYTHON_DSN` | Python optimization service | Distinct DSN for the optimization service (port 8001). Note: the Code Intelligence service uses `SENTRY_DSN` from its own env file, not this var |
| `SENTRY_AUTH_TOKEN` | Build pipeline | For source-map upload during production builds |
| `SENTRY_ORG` | Build pipeline | Sentry organization slug |
| `SENTRY_PROJECT` | Build pipeline | Sentry project slug |
| `OPENAI_API_KEY` | Code Intelligence service | Required for `text-embedding-3-small` (512-dim) |
| `SUPABASE_SERVICE_ROLE_KEY` | Code Intelligence service | Service-role key (server-side) for upserting chunks/embeddings |
| `SUPABASE_JWT_SECRET` | Code Intelligence service | For verifying user JWTs forwarded by the Electron client |
| `REDIS_URL` | Code Intelligence service | Optional — enables ARQ background workers; falls back to inline async if absent |
| `GITHUB_WEBHOOK_SECRET` | Code Intelligence service | Optional — verifies GitHub webhook payloads |
| `QUERY_DECOMPOSE_MODEL` | Code Intelligence service | Model used for multi-query decomposition (default `openrouter/openai/gpt-4o-mini`) |
| `ALLOWED_ORIGINS` | Both Python services | Comma-separated CORS allowlist; defaults to `localhost`/`127.0.0.1` |

---

## 13. Observability (Sentry)

Sentry instruments **four runtime surfaces**. Each has its own DSN; each scrubs PII via `beforeSend` before transmission.

### 13.1. Surfaces

| Surface | Init site | DSN env | Notable integrations |
|---|---|---|---|
| Electron main | `electron/main/index-new.ts` (top of file) | `SENTRY_DSN` (root `.env`) | `@sentry/electron/main` — process errors, IPC traces, child-process capture |
| React App Window | `app-ui/src/main.tsx` | `VITE_SENTRY_DSN` | `@sentry/react` — `browserTracingIntegration`, `replayIntegration`, `ErrorBoundary` |
| React Overlay | `app-ui/src/overlay/main.tsx` | `VITE_SENTRY_DSN` | Same as App Window — separate Sentry client, separate session replay |
| Python optimization service | `python-service/app/main.py` | `SENTRY_PYTHON_DSN` | `LoggingIntegration` (ERROR → events), WebSocket trace continuation from incoming `sentry-trace` headers |
| Python Code Intelligence service | `code-intelligence-service/app/main.py` | `SENTRY_DSN` (service `.env`) | `LoggingIntegration` + **`FastApiIntegration`** — every route is automatically a span. Workers initialize their own SDK |

### 13.2. Spans, Tags, Breadcrumbs

Selected named spans / tags / breadcrumb categories actually emitted by the codebase:

| Where | Operation / Tag / Category |
|---|---|
| `CodeIntelClient.ingestSkeleton` | span `codeIntel.ingestSkeleton` (op `code-intel.ingest`) |
| `CodeIntelClient.retrieve` | span `codeIntel.retrieve` (op `code-intel.search`) + breadcrumb `code-intel: Context retrieved` |
| `CodeIntelClient.healthCheck` | tag `code_intel.healthy = true|false` |
| `CodeParser.initialize` | tag `parser.initialized = true|false` |
| `FileWatcher.startWatching` | breadcrumb `file-watcher: Watch start/stop` |
| `ActiveWindowDetector` | breadcrumbs `active-window: Detection start/stop` |
| `GitService.getBranchInfo` | breadcrumb `git: branch info` |
| `project-handlers.setActiveProject` | tag `active_project = <project_id>` + breadcrumb on creation |
| `analyticsService.startSession` | tag `analytics_session = <sessionId>` |
| `system-tray.startAtLogin` | breadcrumb `auto-launch: Start at login enabled/disabled` |
| `index-new.initialize` | breadcrumb `startup: Silent launch — window hidden` (when applicable) |
| `code-intelligence-service` routes | every `except` block calls `sentry_sdk.capture_exception(e)` |

### 13.3. PII Scrubbing

`beforeSend` hooks remove prompt content and user-identifying fields from every event before it leaves the machine:
- breadcrumbs scrubbed of `prompt`, `text`, `content`, `messages` keys
- request bodies redacted
- stack frame local variables redacted for the same keys

Sentry user identity is propagated to renderers via the `sentry:set-user` IPC channel (`onSentryUser` in the preload namespace).

---

## 14. Platform-Specific Behavior (macOS vs Windows)

| Concern | Windows | macOS |
|---|---|---|
| Native hook | `WH_KEYBOARD_LL` via `SetWindowsHookExW`, dedicated message-pump thread | `CGEventTap` (`kCGSessionEventTap`, listen-only) on the main `CFRunLoop` |
| Permission | None | **Accessibility** — `AXIsProcessTrustedWithOptions`, `systemPreferences.isTrustedAccessibilityClient(true)`. App polls + shows guided dialog |
| Trigger anchor | HWND (raw handle) | PID (frontmost app via `NSWorkspace.frontmostApplication`) |
| Text removal/insert | `SendInput` Backspace + Unicode injection | `CGEventPost` Backspace × N + clipboard-swap `Cmd+V` paste + restore |
| Active window title | `GetForegroundWindow` + `GetWindowTextW` | `osascript` against System Events |
| Force focus | `SetForegroundWindow` (with attach-thread-input) | `osascript tell process "X" to activate` |
| Global shortcut | `CommandOrControl+5` → `Ctrl+5` | `CommandOrControl+5` → `Cmd+5`. Tray menu label reflects this |
| App window chrome | `frame: false`, custom title bar | `titleBarStyle: 'hiddenInset'`, `trafficLightPosition: { x: 12, y: 12 }`, native traffic lights |
| Overlay stacking | Always-on-top, frameless | Always-on-top, frameless, **`visibleOnAllWorkspaces`** + `setVisibleOnAllWorkspaces({ visibleOnFullScreen: true })`, `showInactive()` + `moveTop()` so it follows the user across Spaces / Mission Control without stealing caret focus |
| Tray icon asset | `build/tray-icon.png` (full color) | `build/tray-iconTemplate.png` (template; auto inverts in dark/light menu bar) + `@2x` |
| App icon | `build/icon.ico` | `build/icon.icns` |
| Dock visibility | n/a | `app.dock.show()` on app window `create()`/`show()`; `app.dock.hide()` on `hide()` and the window's `close` event so Prmpt only shows in the Dock and `Cmd+Tab` switcher while visible |
| Dock icon (dev) | n/a | Set in `app.whenReady()` from `build/dock-icon.png` (PNG loads more reliably than `.icns` in dev mode) |
| Dock icon (packaged) | n/a | Set from `process.resourcesPath/icon.icns` |
| Login items | `setLoginItemSettings({ openAtLogin, path: process.execPath, args: ['--hidden'] })` | `setLoginItemSettings({ openAtLogin, openAsHidden: true })` |
| Silent-launch detection | `process.argv.includes('--hidden')` | `app.getLoginItemSettings().wasOpenedAsHidden` |
| Installer | NSIS (`npm run package:win`) — x64 | DMG (`npm run package:mac`) — uses `build/entitlements.mac.plist` (microphone, JIT) and `hardenedRuntime: true` |
| Native binary shipped | `platform-core.win32-x64-msvc.node` | `platform-core.darwin-arm64.node` |

---

## 15. Brand Assets and Packaging

All assets live under `build/` and are declared in `package.json` → `build.extraResources`.

| File | Purpose |
|---|---|
| `build/icon.icns` | macOS app icon (Prmpt logo). Used by electron-builder for the packaged `.app` and by `app.dock.setIcon()` in packaged builds |
| `build/icon.ico` | Windows app icon. Used by electron-builder for the NSIS installer and the executable |
| `build/dock-icon.png` | macOS dev-mode dock icon (512×512 PNG). Loaded by `app.dock.setIcon()` in dev because `.icns` doesn't always render reliably under `electron .` from source |
| `build/tray-iconTemplate.png` + `@2x` | macOS tray icons (template images — Electron auto-inverts) |
| `build/tray-icon.png` | Windows tray icon (full color) |
| `build/entitlements.mac.plist` | macOS hardened-runtime entitlements: microphone (voice transcription), JIT (Electron requires it), allow-unsigned-executable-memory |

`electron-builder` config in `package.json` declares:
- `productName: "Prmpt"`
- `appId: "com.prmpt.app"`
- `mac.target: dmg`, `mac.icon: build/icon.icns`, `mac.hardenedRuntime: true`, `mac.entitlements: build/entitlements.mac.plist`
- `win.target: nsis`, `win.icon: build/icon.ico`
- `extraResources` lists the native `.node` binaries plus tray and dock icons so they're discoverable at `process.resourcesPath` in packaged builds

---

## 16. Design System

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
