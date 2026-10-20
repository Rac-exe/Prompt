# Prmpt — System Architecture

## 1. System Overview

Prmpt is a **cross-platform desktop application** for **Windows and macOS** that optimizes AI prompts in real-time. It is **local-first**: everything runs on the user's machine, there is no account or login, and the user brings their own OpenRouter API key. It is a coordinated system of **six distinct runtime environments**, each solving a problem the others cannot:

- **Electron Main Process** — orchestrator, IPC hub, window lifecycle, local SQLite database, AI provider settings (key storage), login items, dock control
- **App Window** — React SPA for full chat, history, library, settings, and Spaces (`hiddenInset` title bar on macOS, frameless on Windows)
- **Overlay Window** — frameless always-on-top floating panel for instant in-context optimization (`visibleOnAllWorkspaces` on macOS so it follows the user across Spaces / Mission Control)
- **Python AI Service** — FastAPI server (port 8001): LLM streaming via `litellm` → OpenRouter, clarification, task planning, voice transcription (Deepgram proxy)
- **Code Intelligence Service** — separate FastAPI microservice (port 8002), fully local: per-project SQLite index, on-device ONNX embeddings + reranker, mode-aware hybrid retrieval (vector + FTS5 full-text + concept + path), call-graph expansion, agentic multi-hop retrieval
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
                             │  Local SQLite · AI provider keys      │
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
         ┌───────────────────┼────────────────────┐
         │                   │                    │
┌────────▼─────────┐ ┌───────▼────────┐ ┌─────────▼─────────┐
│ Local data       │ │ Python Service │ │ Code Intel Service│
│ {userData}/      │ │ FastAPI :8001  │ │ FastAPI :8002     │
│   prmpt.db       │ │ litellm        │ │ per-project SQLite│
│   attachments/   │ │ Deepgram proxy │ │ ONNX embeddings + │
│   code-intel/    │ │                │ │ reranker          │
└──────────────────┘ └───────┬────────┘ └─────────┬─────────┘
                             │  user's key, sent  │
                             │  with each request │
                             ▼                    ▼
               OpenRouter (LLMs) · Deepgram (voice, optional)
```

**Local data, user's own key**: chats, the prompt library, settings, memory and the AI provider settings live in one SQLite file (`{userData}/prmpt.db`); attachments are files under `{userData}/attachments/`; code indexes live under `{userData}/code-intel/`. Both Python services listen on `127.0.0.1`, have no login (single local user), and receive the user's OpenRouter key with each request instead of storing it. Outbound calls go to OpenRouter (LLMs), Deepgram (voice input, only with a Deepgram key) and Hugging Face Hub (one-time ONNX model download). See §13.

---

## 2. Trigger Flows

There are three ways to open the overlay:

### 2.1. `@prompt` Native Hook (Primary Trigger)

1. User types `@prompt` in **any** application on either OS.
2. The Rust native module installs a global keyboard hook — **`WH_KEYBOARD_LL` via `SetWindowsHookExW` on Windows**, **`CGEventTap` (`kCGSessionEventTap`, listen-only) attached to the main `CFRunLoop` on macOS**.
3. A ring buffer in `buffer.rs` accumulates characters from translated key events. The same `on_char_keydown` handler is shared by both backends. When `@prompt` is detected at the buffer tail, it fires `TriggerData { hwnd, trigger_len }` to Node.js via a thread-safe N-API callback.
4. **`TriggerData.hwnd` is platform-overloaded**: a raw HWND on Windows, the frontmost-application **PID** on macOS (resolved via `NSWorkspace.frontmostApplication`).
5. Electron main (`index-new.ts`) receives the callback, stores the anchor with `setSourceWindow(hwnd, title)` and calls `overlayManager.open()`.
6. The `@prompt` text stays in the source field until the user inserts a result. `overlay:insert` then calls the native `replaceAtLastAnchor(text)`, which removes the trigger and inserts the replacement in one step — **Shift+Left selection + `KEYEVENTF_UNICODE` injection via `SendInput` on Windows**, **Backspace × N via `CGEventPost` + clipboard-swap `Cmd+V` paste on macOS** (the Mac path saves the existing pasteboard and restores it afterwards). See §6.1.
7. The overlay opens positioned near the cursor, pre-focused and ready for input.

> **macOS prerequisite — Accessibility permission.** `CGEventTap` and `CGEventPost` require Accessibility access. Before installing the hook, `index-new.ts` runs `ensureAccessibilityPermission()`, which calls `checkAccessibilityPermission()` from `utils/native-bridge.ts`. If missing, the user is shown a dialog whose **Open System Settings** button opens System Settings → Privacy & Security → Accessibility. The hook is not started until the permission is granted (the main process polls every 2 s for up to a minute).

### 2.2. `CommandOrControl+5` Global Shortcut

1. Electron registers `globalShortcut.register('CommandOrControl+5', …)` on app ready — this resolves to **`Ctrl+5` on Windows** and **`Cmd+5` on macOS**.
2. Press toggles `overlayManager.toggle()` — open if closed, close if open.
3. The tray menu label is platform-aware (`Cmd+5` on macOS, `Ctrl+5` on Windows).

### 2.3. System Tray

1. `SystemTray` creates a tray icon with a context menu. The icon source is platform-aware:
   - **macOS**: `build/tray-iconTemplate.png` (template image — Electron auto-inverts for light/dark menu bars; `@2x` variant for Retina)
   - **Windows**: `build/tray-icon.png` (full color)
2. Clicking the tray icon or "Open Prmpt" shows the main App Window.
3. "Toggle Overlay (Ctrl+5 / Cmd+5)" calls `overlayManager.toggle()`.
4. The "Start at Login" checkbox stores the preference (`utils/auto-launch.ts`, `{userData}/auto-launch.json`) and applies it with `app.setLoginItemSettings({ openAtLogin, openAsHidden: true, … })` — Windows additionally passes `path: process.execPath, args: ['--hidden']`. The same toggle is in Settings → Customize → Startup (`auto-launch:get` / `auto-launch:set`). The default is enabled, and `syncAutoLaunchOnStartup()` re-applies the stored preference on every start (OS registration is skipped in unpackaged dev builds).

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

If `isSilentLaunch()` returns true, the main process skips `appWindowManager.show()` and the app sits in the tray only. The user opens the App Window manually from the tray.

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

### 3.2. Startup & Onboarding

There is no login. `App.tsx` wraps the routes in `ErrorBoundary` → `AuthWrapper`; `AuthWrapper` is only a startup gate for the single local user.

```
App startup
  └── AuthWrapper → checkAuth() (auth:check)
        ├── main replies auth:state-changed with the local user (startLocalSession)
        │     └── error → "Could not open the local database" + Try again
        ├── aiSettings.get().configured === true → AppLayout
        └── no OpenRouter key yet
              ├── first launch → OnboardingPage:
              │     theme picker → AI provider step (key + models, skippable) → feature tour → AppLayout
              └── later launches → OnboardingPage aiProviderOnly (AI provider step, skippable) → AppLayout
```

Whether the full onboarding has been shown is remembered in `localStorage` (`prmpt-onboarding-completed`). `AuthContext` (the name is historical) holds `{ user, isLoading }` — the local profile and preferences — and is consumed by components such as `ProfileMenu` and `SettingsView`. On startup, `startLocalSession()` also pushes `chats-loaded` and `prompt-library:loaded`, and main tells the overlay `overlay:auth-state { isAuthenticated: true }`.

### 3.3. All Components

**Startup (`components/auth/`)**

| Component | Responsibility |
|---|---|
| `AuthWrapper.tsx` | Startup gate — loading/error screen, then onboarding (or the AI provider step alone) until an OpenRouter key is saved, then the app |
| `OnboardingPage.tsx` | First-run flow — theme picker, AI provider step (`AIProviderForm variant="onboarding"`, can be skipped), feature tour. With `aiProviderOnly` it shows just the AI provider step |

**Shared (`components/`)**

| Component | Responsibility |
|---|---|
| `ErrorBoundary.tsx` | Renders a fallback instead of a blank window when a child throws (wraps both the App Window and the Overlay) |
| `NavLink.tsx` | Styled navigation link pill used in the sidebar tab bar |

**Chat (`components/chat/`)**

| Component | Responsibility |
|---|---|
| `ChatView.tsx` | Chat input bar, file attachment zone, skill picker trigger, voice input button, auto-scroll container |
| `MessageBubble.tsx` | Renders a single user or assistant message — Markdown, image thumbnails, lightbox, edit/retry buttons |
| `StoredImage.tsx` | `useStoredFileUrl` / `StoredImage` — load a saved attachment from the local attachment store as a data URL (`storage:get-signed-url`) |
| `ClarificationCard.tsx` | Animated multi-choice question card shown before optimization for complex prompts; supports multi-select, "Other" freetext, delivery format selection, extra notes field |
| `ClarificationSummaryCard.tsx` | Read-only summary card showing submitted clarification answers with edit capability |
| `PlusMenu.tsx` | Popover triggered by `+` button — file upload and skill selection |
| `SkillPicker.tsx` | Searchable, keyboard-navigable skill list; opens via Plus menu or `/` slash command |
| `VersionNavigator.tsx` | `← 1/3 →` navigator shown on messages with edit/retry versions |
| `SavePromptModal.tsx` | Modal to save an optimized result to a library collection (also used by the overlay in `compact` mode) |
| `FeedbackWidget.tsx` | Thumbs-up / thumbs-down reaction on assistant messages (stored in the message metadata via `app:save-feedback`) |
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
| `ProfileMenu.tsx` | Dropdown in the sidebar footer — shows avatar and display name ("Stored on this computer"), links to Settings and Help & Docs |
| `ZoomIndicator.tsx` | Floating indicator showing current zoom level when the user adjusts font size |

**Spaces / Projects (`components/projects/`)**

| Component | Responsibility |
|---|---|
| `ProjectsView.tsx` | Root orchestrator for the Spaces feature — renders SpacesList or SpaceWorkspace; persists spaces to `localStorage` and publishes a snapshot to main for the overlay (`spaces:publish-snapshot`) |
| `SpacesList.tsx` | Grid of all created spaces with create/rename/delete; sorts by `lastUsedAt` |
| `SpaceWorkspace.tsx` | Inside a space: attach local code projects, query the Code Intelligence Service (Find / Ask / Bug / Optimize modes; Ask streams over SSE), compose a context-rich prompt, and optionally send it to the optimizer |
| `IndexingProgressBar.tsx` | Indeterminate progress bar shown while a project is being indexed |
| `types.ts` | `Space`, `SpaceProject`, `SpaceMessage`, `RetrievedChunk` interfaces; `loadSpaces`/`saveSpaces` localStorage helpers; `buildTailoredPrompt` that assembles a context-rich prompt from code chunks |

**Library (`components/library/`)**

| Component | Responsibility |
|---|---|
| `PromptLibrary.tsx` | Grid of prompt collections; create, rename, delete; shows saved prompt cards |
| `PromptCard.tsx` | Single saved prompt — title, content preview, favorite toggle, copy button |
| `PromptPreviewModal.tsx` | Full-content view of a saved prompt |
| `EditPromptModal.tsx` | Edit title and content of a saved prompt |
| `DeleteConfirmModal.tsx` | Confirmation dialog for destructive delete actions |

**Settings (`components/settings/`)**

| Component | Responsibility |
|---|---|
| `SettingsView.tsx` | Four tabs: **Profile** (name, avatar — stored only on this computer), **AI provider** (`AIProviderForm`), **Customize** (custom instructions, launch at login, theme, font size, font family), **Memory** (`MemoryView`) |
| `AIProviderForm.tsx` | OpenRouter API key (masked preview of the saved key only), optimizer model and RAG model pickers, optional Deepgram key (settings variant only); saving validates the key with OpenRouter. Used by onboarding and Settings |
| `ModelPicker.tsx` | Searchable picker over OpenRouter's model list with prices; free text allowed; `requireTools` limits the RAG picker to models that support tool calling |
| `MemoryView.tsx` | Table of inferred user memory entries with inline edit and delete |

**Profile (`components/profile/`)**

| Component | Responsibility |
|---|---|
| `AvatarUploadModal.tsx` | Drag-and-drop or file-picker avatar upload — resizes client-side before `avatar:upload` IPC (stored on the local profile as a data URL) |

**Pages (`pages/`)**

| Page | Route | Description |
|---|---|---|
| `Index.tsx` | `/` | Root orchestrator — owns all IPC listeners, global chat state, view routing |
| `NotFound.tsx` | `*` | 404 fallback |

### 3.4. Key Hooks

| Hook | Purpose |
|---|---|
| `useSmoothStreaming` | Adaptive buffered streaming engine — drains tokens at variable speed via `requestAnimationFrame` |
| `useInitializeSettings` | Applies cached preferences from `localStorage` immediately on startup, then loads them from the local database and applies them to the document root |
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
| `overlay/App.tsx` | Root — shows SetupGate until an AI provider is configured, then routes between ChatArea and ChatPicker (chat mode) and the Spaces mode |
| `overlay/components/SetupGate.tsx` | Shown instead of the composer until an OpenRouter key is saved ("Connect your AI provider"); its **Open Prmpt** button sends `overlay:open-app` |
| `overlay/components/Header.tsx` | App logo, Fast/Thinking mode toggle, close button |
| `overlay/components/ChatArea.tsx` | Message list, streaming display, save-to-library and insert buttons |
| `overlay/components/InputSection.tsx` | Text input, file attachments, voice button, skill picker, send/stop |
| `overlay/components/ChatPicker.tsx` | List of recent chats to continue in the overlay |
| `overlay/components/SpacePicker.tsx` | Pick a Space (from the snapshot relayed by `spaces:list`) whose projects provide codebase context |
| `SavePromptModal` (from `components/chat/`, `compact`) | Pick a library collection when saving an optimized prompt |
| `overlay/components/OfflineBanner.tsx` | Amber banner shown when offline |
| `overlay/components/ProjectStatus.tsx` | Shows currently active Space/project context and indexed status |
| `overlay/lib/constants.ts` | Overlay-specific constants (window dimensions, animation timings, attachment limits) |
| `overlay/lib/types.ts` | Overlay-specific TypeScript interfaces |
| `overlay/lib/utils.ts` | Overlay utility functions |

### 4.2. Overlay IPC Contract

#### Renderer → Main (send — fire-and-forget)

| Channel | Payload | Purpose |
|---|---|---|
| `overlay:optimize` | `{ text, isRegenerate, mode, chatId, attachedFiles, forcedSkill, previousOutput, wantsSections, clarificationAnswers, spaceMode, spaceId, … }` | Start streaming optimization. Refused with an error if no OpenRouter key is configured or the app is offline |
| `overlay:submit-clarification` | `{ answers, wantsSections, clarificationChoices }` | Resume paused optimization with clarification answers |
| `overlay:copy` | `{ text }` | Copy text to system clipboard |
| `overlay:close` | — | Hide the overlay window |
| `overlay:open-app` | — | Show main app window (e.g. from SetupGate to add an API key) |
| `overlay:new-session` | — | Clear in-memory overlay conversation history |
| `overlay:truncate-history` | `{ keepCount }` | Sync backend history after user edits/retries |
| `overlay:stop-generation` | — | Abort current streaming optimization |
| `overlay:ready` | — | Renderer has mounted and painted (ends the pre-heat fallback timer) |

#### Renderer → Main (invoke — returns a value)

| Channel | Payload | Return | Purpose |
|---|---|---|---|
| `overlay:insert` | `{ text }` | `{ success }` | Close overlay + replace `@prompt` in source window via `replaceAtLastAnchor`, fallback to `pasteTextToWindow` |
| `overlay:insert-section` | `{ text }` | `{ success }` | Paste one task section without closing overlay (first insert replaces `@prompt`, later ones paste at the caret); never auto-presses Enter |
| `overlay:save` | `{ title, content, collectionId? }` | `{ promptId, collectionId }` | Save to prompt library (auto-creates a "Quick Saves" collection when none is given); refreshes the App Window library |
| `overlay:check-auth` | — | `{ isAuthenticated }` | Always `true` (single local user) |
| `overlay:get-settings` | — | user settings | Fetch user settings for overlay styling |
| `overlay:get-collections` | — | collections[] | Collections for save picker |
| `overlay:create-collection` | `{ name, icon? }` | collection | Create new collection |
| `overlay:get-chats` | — | `{ id, title }[]` | Chat list for context picker |
| `overlay:save-to-chat` | `{ chatId, content }` | `{ messageId }` | Append optimized prompt as assistant message to an existing chat |
| `overlay:get-source-info` | — | `{ hwnd, title, detectedMode, confidence, appName }` | Source window metadata (used for UI mode detection) |

#### Main → Renderer (pushed to overlay window)

| Channel | Payload | Purpose |
|---|---|---|
| `overlay:opened` | `{ isAuthenticated, prefill, triggeredByHook }` | Sent on every open; `triggeredByHook` enables the Replace button |
| `overlay:auth-state` | `{ isAuthenticated }` | Session state (always authenticated as the local user) |
| `ai-settings:changed` | `AISettingsView` | AI provider settings changed; SetupGate is shown while `configured` is false |
| `overlay:settings-update` | settings | Theme / font changes relayed from the App Window |
| `overlay:project-status` | `{ projectId, name, status, auto }` or `null` | Project auto-detected (or lost) by `ActiveWindowDetector` |
| `overlay:clarification-required` | `{ should_clarify, questions[], is_complex, suggested_sections }` | Pauses optimization, presents clarification UI |
| `overlay:optimization-chunk` | `{ chunk, accumulated }` | Streaming token delta |
| `overlay:optimization-complete` | `{ original, optimized }` | Optimization finished |
| `overlay:optimization-error` | `{ error }` | Humanized error message |
| `overlay:cursor-pos` | `{ x, y }` | Global cursor pos relative to overlay (60fps, drives emerald glow) |
| `overlay:upload-partial-failure` | `{ failedFiles }` | Some attachments could not be saved; partial success |
| `overlay:messages-appended` | `{ chatId, messages[] }` | Real-time push to app window when overlay saves into a context chat |

---

## 5. Electron Main Process

**Entry point**: `electron/main/index-new.ts` → compiled to `dist/main/index-new.js`

### 5.1. Startup Sequence

```
dotenv: .env from the project root (dev) or resourcesPath/.env (packaged) — optional
PRMPT_USER_DATA_DIR set? → app.setPath('userData', …)
app.requestSingleInstanceLock()            (a second launch focuses the existing window)
app.whenReady()
  → [macOS packaged] ask for microphone access; pre-flight Automation (System Events) check
  → installApplicationMenu()               (no default reload / zoom / devtools accelerators)
  → [macOS only] app.dock.setIcon(build/dock-icon.png in dev,
                                   resourcesPath/icon.icns in packaged)
  → initialize():
      → installCSP()                       (connect-src: 'self' + python-service HTTP/WS)
      → getDb()                            (open + migrate {userData}/prmpt.db)
      → new AppWindowManager / OverlayWindowManager / PythonClient /
        TranscriptionClient / CodeIntelClient
      → register all IPC handlers          (session, ai-settings, user, settings, chat, overlay,
                                            skills, avatar, storage, project, spaces bridge,
                                            prompt library, transcription, window, auto-launch)
      → initializeParser()                 (tree-sitter WASM, in background)
      → AppWindowManager.preload()         (hidden BrowserWindow)
      → OverlayWindowManager.preload()     (hidden BrowserWindow;
                                            visibleOnAllWorkspaces=true on macOS)
      → PythonClient.connect() (background) + healthCheck()
      → 30 s health loop                   (python:unavailable / python:recovered)
      → networkMonitor.start()
      → startKeystrokeDetection()          (Rust native hook — gated on Accessibility on macOS)
      → globalShortcut.register('CommandOrControl+5')
      → SystemTray.create()                (template image on macOS, full color on Windows)
      → syncAutoLaunchOnStartup()
      → if (!isSilentLaunch()) appWindowManager.show()
                                           (silent launch → stay in tray)
      → startLocalSession()                (auth:state-changed with the local user,
                                            chats-loaded, prompt-library:loaded)
      → overlayManager.sendAuthState(true)
      → startCodeIntelProjectServices()    (listProjects → ActiveWindowDetector,
                                            restoreActiveProject)
```

### 5.2. IPC Handlers (`electron/main/ipc-handlers/`)

| File | IPC Channels Handled |
|---|---|
| `session-handlers.ts` | `auth:check` → `startLocalSession()`, which sends `auth:state-changed` (the local user), `chats-loaded`, `prompt-library:loaded`. There is no login |
| `ai-settings-handlers.ts` | `ai-settings:get`, `ai-settings:save`, `ai-settings:validate-key`, `ai-settings:list-models`; broadcasts `ai-settings:changed` to both windows (see §5.4) |
| `chat-handlers.ts` | `app:send-message`, `app:regenerate-response`, `app:submit-clarification`, `app:optimize-prompt`, `app:stop-generation`, `app:get-generation-status`, `app:load-chats`, `app:create-chat`, `app:load-messages`, `app:rename-chat`, `app:delete-chat`, `app:save-to-chat`, `app:copy-to-clipboard`, `app:save-feedback`, `spaces:get-active-stream`. Validates attachments (max 5 files, 10 MB each, MIME detected from magic bytes) and refuses to send without an OpenRouter key or while offline |
| `overlay-ipc-handlers.ts` | `overlay:optimize`, `overlay:submit-clarification`, `overlay:save`, `overlay:insert`, `overlay:insert-section`, `overlay:copy`, `overlay:close`, `overlay:open-app`, `overlay:check-auth`, `overlay:get-settings`, `overlay:get-collections`, `overlay:create-collection`, `overlay:get-chats`, `overlay:save-to-chat`, `overlay:get-source-info`, `overlay:new-session`, `overlay:truncate-history`, `overlay:stop-generation`, cursor polling |
| `prompt-library-handlers.ts` | `prompt-library:get-all`, `prompt-library:get-collections`, `prompt-library:create-collection`, `prompt-library:rename-collection`, `prompt-library:delete-collection`, `prompt-library:save-prompt`, `prompt-library:create-collection-and-save`, `prompt-library:update-prompt`, `prompt-library:delete-prompt`, `prompt-library:toggle-favorite` (registered on import) |
| `skill-handlers.ts` | `skills:list` — reads `files/skill_*.md` (`resourcesPath/files` in packaged builds) |
| `settings-handlers.ts` | `settings:load`, `settings:save`; relays `overlay:settings-update` to the overlay |
| `user-handlers.ts` | `app:request-user-data`, `user:update-profile`, `user:update-preferences`, `user:set-personalization-prompt`, `memory:get`, `memory:upsert`, `memory:delete`, `memory:get-enabled`, `memory:set-enabled` |
| `avatar-handlers.ts` | `avatar:upload` — validates a base64 image data URL (≤ 2 MB) and stores it on the local profile |
| `file-upload-service.ts` | Local attachment store — `saveAttachment()` (content-addressed under `{userData}/attachments/`), `storage:get-signed-url` (returns the file as a data URL), `storage:open-pdf` (opens it in the default viewer); paths outside the attachments folder are refused |
| `project-handlers.ts` | `project:add`, `project:remove`, `project:list`, `project:status`, `project:set-active`, `project:get-active`, `project:reindex`, `project:toggle-watching`, `project:is-watching`, `project:is-scanning`, `project:retrieve`, `project:context`, `project:context-stream` (+ `:abort`), `project:ensure-fresh` — Spaces + Code Intelligence IPC |
| `spaces-bridge-handlers.ts` | `spaces:publish-snapshot`, `spaces:list`, `spaces:append-messages` → `spaces:apply-append` — relays Spaces state between the App Window and the overlay |
| `network-monitor-singleton.ts` | Singleton `networkMonitor` — broadcasts `network:status` to all windows |

Handled inline in `index-new.ts`: `transcription:start`, `transcription:audio-chunk`, `transcription:stop`, `transcription:debug`, `window:minimize` / `window:maximize` / `window:close`, `shell:openExternal` (http/https only), `auto-launch:get` / `auto-launch:set`. `AppWindowManager` handles `zoom:get` / `zoom:set`.

### 5.3. Services (`electron/main/database/services/`)

All services read and write the local SQLite database (`database/local-db.ts`, §9.1) as the single local user.

| Service | Responsibility |
|---|---|
| `ChatService` | Chats and messages (`chats`, `messages`); message `metadata` holds attachments, edit/retry version info and feedback |
| `PromptLibraryService` | Collections and saved prompts (`prompt_collections`, `saved_prompts`); favorites are a flag in the prompt metadata |
| `MemoryService` | Read/write/delete `user_memory` entries; `buildMemoryContext()` for the optimizer |
| `MemoryAnalyzer` | Every 3rd optimization, sends the prompt + output to `/extract-memory-facts` and upserts the returned facts (explicit entries take priority) |
| `UserService` | The local `profile` row — name, avatar (data URL), personalization prompt, UI settings; created on first use |
| `SettingsService` | The `user_settings` row — theme, font size/family, custom instructions, memory toggle |
| `OptimizationService` | Local log of optimizations in `prompt_optimizations` (messages reference rows via `optimization_id`) |
| `AISettingsService` (`aiSettings`) | OpenRouter key, optimizer + RAG models, optional Deepgram key (§5.4) |

### 5.4. AI Provider Settings (`ai-settings-service.ts`)

Prmpt has no managed keys: the user enters their own OpenRouter API key, at first launch (onboarding AI provider step) or in Settings → AI provider.

| Setting | Default | Used for |
|---|---|---|
| OpenRouter API key | — (required for any LLM call) | Every LLM call in both Python services |
| Optimizer model | `anthropic/claude-haiku-4.5` | Prompt optimization (python-service) |
| RAG model | `anthropic/claude-haiku-4.5` | Code-intel answers and the agentic retrieval loop — must support tool calling |
| Deepgram API key | — (optional) | Voice input (`/ws/transcribe-stream`) |

- **Storage** — one JSON value under the `app_kv` key `ai_settings` in `prmpt.db`. Keys are encrypted with Electron `safeStorage` (OS keystore) on Windows/Linux when available, and stored as plain text on macOS (avoids Keychain prompts). A key that can no longer be decrypted is treated as missing.
- **Renderer view** — keys never leave the main process. The renderer only receives `AISettingsView`: `configured`, `hasApiKey`, `apiKeyPreview` (`…` + last 4 characters), the two models, `hasDeepgramKey`, `deepgramKeyPreview`.
- **Validation** — `ai-settings:save` with a new OpenRouter key first calls `GET https://openrouter.ai/api/v1/key`; a 401/403 rejects the save, so a typo cannot replace a working key.
- **Model list** — `ai-settings:list-models` fetches OpenRouter's public `GET https://openrouter.ai/api/v1/models` (cached for an hour) and maps it to id, name, context length, tool support and price per million tokens.
- **Change events** — every save broadcasts `ai-settings:changed` to the App Window and the overlay (the overlay's SetupGate reacts to it).
- **Readiness checks** — `chat-handlers.ts` (`aiReadinessError()`) and `overlay:optimize` refuse to send a request when no key is configured or `networkMonitor` reports offline.
- **Transport** — `pythonHeaders()`, `codeIntelHeaders()` and `llmPayload()` attach the key and models to each request (§13.2).

### 5.5. Code Intelligence System (`electron/main/services/` + `api/code-intel-client.ts`)

The Code Intelligence system enables Spaces — a feature where users attach local code repositories to a workspace and receive semantically-retrieved code context that is automatically injected into their prompts.

| Module | Responsibility |
|---|---|
| `CodeIntelClient` | Axios HTTP client for the Code Intelligence Service (port 8002, 300 s timeout); sends `X-Prmpt-Code-Intel-Root` plus the user's key and RAG model (`aiSettings.codeIntelHeaders()`) on every request; methods: `healthCheck`, `createProject`, `listProjects`, `getProject`, `deleteProject`, `deleteChunksForFile`, `ingestSkeleton`, `retrieve`, `context`, `contextStream` (SSE) |
| `CodeParser` | Tree-sitter WASM-based code parser; lazy-loads language grammars (TypeScript, Python, Go, Rust, Java, Ruby, C/C++, C#); extracts function/class/method definitions with signatures, line ranges, imports, and callee references as `ChunkData` objects; computes SHA-256 content hashes |
| `FileWatcher` | Chokidar-based directory watcher; debounces file changes (1.5 s); skips `node_modules`, `.git`, `dist`, `build`, `venv`/`.venv`, `target` and other build/cache folders; checks content hash against `LocalProjectCache` before re-sending to avoid redundant re-indexing; handles file add/change/delete events |
| `GitService` | Executes `git` CLI commands in a child process; reads `currentBranch`, `defaultBranch`, `aheadCount`, `behindCount`, and recent commit history; used to provide branch context to the Code Intelligence Service |
| `LocalProjectCache` | Per-project file path → content hash cache, stored in the `file_cache` table of that project's `index.db` (shared with the service); checked before every re-index to skip unchanged files; cleared on project deletion |
| `code-intel-local-store` | Opens `{userData}/code-intel/projects/<project_id>/index.db` (better-sqlite3, WAL) with the same schema the service uses; `getCodeIntelRoot()` is the root announced to the services |
| `ActiveWindowDetector` | Polls the focused window title every 2 s via the `active-win` npm package and matches it against known project names; used by the overlay to surface project context relevant to the user's current application |

### 5.6. Other Modules

| Module | Path | Purpose |
|---|---|---|
| `local-db` | `electron/main/database/local-db.ts` | Opens `{userData}/prmpt.db` (better-sqlite3, WAL, foreign keys on), runs the schema migration (`user_version`), exports `LOCAL_USER_ID` and the `app_kv` helpers (`kvGet` / `kvSet` / `kvDelete`) |
| `OverlayWindowManager` | `electron/main/overlay/overlay-window-manager.ts` | Create, position, show, hide, toggle the overlay `BrowserWindow`. On macOS sets `visibleOnAllWorkspaces`, `setVisibleOnAllWorkspaces({ visibleOnFullScreen: true })`, uses `showInactive()` and `moveTop()` so the overlay appears above whatever app the user is in without stealing focus from the source app's caret |
| `AppWindowManager` | `electron/main/windows/app-window-manager.ts` | Create and manage the main app `BrowserWindow`. **macOS** uses `titleBarStyle: 'hiddenInset'` + `trafficLightPosition: { x: 12, y: 12 }`; **Windows** uses `frame: false`. Wires `app.dock.show()` on `create()`/`show()` and `app.dock.hide()` on `hide()` and the `close` event so the App Window appears in the macOS Dock and `Cmd+Tab` switcher only while visible |
| `SystemTray` | `electron/main/windows/system-tray.ts` | Cross-platform system tray. Loads `tray-iconTemplate.png` on macOS (template image) or `tray-icon.png` on Windows. Menu: Open Prmpt, Toggle Overlay (`Cmd+5` / `Ctrl+5`), **Start at Login** (checkbox bound to the stored auto-launch preference), Quit |
| `PythonClient` | `electron/main/api/python-client.ts` | WebSocket client to Python service (`/ws/optimize-stream`, sends the `llm` settings object in every message) plus an HTTP client whose interceptor adds the key/model headers; exposes `optimizeStream()`, `clarify()`, `optimize()`, `generateTitle()`, `extractMemoryFacts()`, `healthCheck()`, `abortLatestStream()` |
| `TranscriptionClient` | `electron/main/api/transcription-client.ts` | WebSocket client to the Python transcription endpoint; the start message carries the user's Deepgram key |
| `authState` | `electron/main/utils/auth-state.ts` | Fixed session object — always authenticated as `LOCAL_USER_ID`; kept so handlers that read it stay unchanged |
| `native-bridge` | `electron/main/utils/native-bridge.ts` | Wraps the Rust `native/platform-core/` module via `index.js` (which loads the correct `.node` per platform). Provides `checkAccessibilityPermission()` (macOS-only) and graceful fallback if the binary is unavailable |
| `window-detector` | `electron/main/utils/window-detector.ts` | Classifies the source window as "chat" or "document" from its title (drives the section-insert UI) |
| `NetworkMonitor` | `electron/main/utils/network-monitor.ts` | Polls `net.isOnline()` every 5 s; broadcasts `network:status` and fires `network:reconnected` |
| `auto-launch` | `electron/main/utils/auto-launch.ts` | Start-at-login preference in `{userData}/auto-launch.json`; applies it to the OS login item (packaged builds only) |
| `application-menu` | `electron/main/menu/application-menu.ts` | Custom app menu: shows "Prmpt" on macOS, drops the View menu (no reload / zoom / devtools accelerators); no menu on Windows |
| `space-stream-store` | `electron/main/services/space-stream-store.ts` | In-memory buffer of the active Space stream per space, so SpaceWorkspace can resume rendering after remounting |
| `ErrorLog` | `electron/main/database/error-log.ts` | Local append-only error log written to `{userData}/error-log.json` (capped at 200 entries); captures non-fatal errors such as failed background saves |

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

> **`TriggerData.hwnd` is platform-overloaded.** On Windows it's a raw HWND. On macOS it's the **PID** of the frontmost application (resolved via `NSWorkspace.frontmostApplication`). Code paths in Electron (`setSourceWindow`, `overlay:insert`, `overlay:insert-section`) treat it as an opaque integer "anchor" and forward it back to the same native function, so the abstraction holds.

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

| Endpoint | Type | Provider settings from | Description |
|---|---|---|---|
| `GET /` | HTTP | — | Service info and endpoint listing |
| `GET /health` | HTTP | — | Liveness probe — `{ status: "ok" }` |
| `GET /health/ready` | HTTP | — | Readiness probe — checks the optimizer model config and, if `torch` is installed, the Whisper model (the API key arrives per request, so it is not checked) |
| `POST /optimize` | HTTP | Headers | Single-shot (non-streaming) prompt optimization with TTL cache |
| `WS /ws/optimize-stream` | WebSocket | `llm` object in each message | **Primary** streaming optimization — receives chunks over WebSocket |
| `WS /ws/transcribe-stream` | WebSocket | `deepgram_api_key` in the start message | Deepgram Nova-2 streaming transcription proxy (the voice path the app uses) |
| `POST /transcribe-audio` | HTTP | — | Batch WAV transcription via local faster-Whisper; returns 501 unless `torch` is installed |
| `POST /clarify` | HTTP | Headers | LLM-driven clarification question generation |
| `POST /generate-title` | HTTP | Headers | Auto-generate 3-5 word chat title (TITLE_MODEL, temp 0.3, 20 tokens) |
| `POST /extract-memory-facts` | HTTP | Headers | Extract user/behavioral/context memory facts (MEMORY_MODEL, temp 0.1) |

There is no authentication: the service binds to `127.0.0.1` and serves a single local user. `BrowserOriginGuard` (`app/origin_guard.py`, §13.3) rejects requests from web pages, and `RequestIDMiddleware` echoes/sets `X-Request-ID`. Provider settings are read per request (`X-Prmpt-OpenRouter-Key`, `X-Prmpt-Optimizer-Model`, `X-Prmpt-Rag-Model` headers, or the WebSocket `llm` object) and never stored; `OPENROUTER_API_KEY` from `.env` is only a fallback for calling the service directly. Errors are mapped to user-facing messages by `user_facing_error()` in `pipeline_v2/config.py` (missing key, rejected key, unknown model, rate/credit limit). In production (`APP_ENV=production`), `/docs`, `/redoc`, and `/openapi.json` are disabled.

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
| `project_context.py` | Calls the Code Intelligence Service `/api/context` (falling back to `/api/retrieve`) to fetch relevant code chunks, forwarding the user's key, RAG model and `X-Prmpt-Code-Intel-Root`; formats the result as a structured `[CODEBASE CONTEXT]` block injected into the optimizer's system prompt |
| `document_parser.py` | PDF text extraction (PyMuPDF), image vision API calls, 10 MB / 8 K token limits, magic-byte validation |
| `fast_mode.py` | Keyword-based prompt type detection; applies a targeted system prompt |
| `context.py` | `ChatContext` — maintains ordered message history for the pipeline |
| `config.py` | Default models from env (`OPTIMIZER_MODEL`, `SUMMARIZER_MODEL`, `TITLE_MODEL`, `MEMORY_MODEL`); `LLMSettings` (per-request key + models from headers or the WebSocket `llm` object); `provider_kwargs()` (request key, else the `OPENROUTER_API_KEY` fallback); `user_facing_error()` |
| `skills.py` | Loads and parses `skill_*.md` files from the repo-root `files/` directory |
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

### 7.6. Prompt Cache & Concurrency

**Prompt Cache**: `TTLCache(maxsize=200, ttl=300)` — identical prompts within 5 minutes return the cached result instantly. Cache is bypassed for regeneration requests (which append a microsecond-precision `[REGENERATE_{id}]` suffix). Cache key is the raw prompt text; result is the cleaned optimized text.

**Concurrency Semaphore**: `_optimize_semaphore = Semaphore(MAX_CONCURRENT_OPTIMIZATIONS=50)` — caps simultaneous LLM inference calls to prevent resource exhaustion.

There are no request quotas or rate limits in the service; usage is bounded only by the user's own OpenRouter account.

### 7.7. Voice Transcription — Dual Stack

Prmpt has two transcription backends. The desktop app uses Path A; Path B is an optional local fallback.

#### Path A: Deepgram Nova-2 (Primary — `/ws/transcribe-stream`)
Real-time streaming proxy. FastAPI acts as a relay between the Electron WebSocket and Deepgram's cloud STT, using the **user's own Deepgram key** (optional; entered in Settings → AI provider). Without a key, the service answers with "Voice input needs a Deepgram API key. Add one in Prmpt Settings > AI provider."

**Flow**:
1. Client sends `{ action: "start", session_id, sample_rate, deepgram_api_key }` to establish the session (`DEEPGRAM_API_KEY` from `.env` is only a fallback for local testing).
2. Python opens a connection to `wss://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=true&interim_results=true&utterance_end_ms=1000&vad_events=true&endpointing=300` with `Authorization: Token <key>`. A rejected key is reported as "Deepgram rejected the API key."
3. Audio binary frames from Electron are forwarded directly to Deepgram.
4. `_deepgram_relay()` reads Deepgram JSON results, accumulates finalized segments, and pushes `{ type: "transcription", text, accumulated, is_final, speech_final }` back to the client.
5. Client sends `{ action: "stop" }` → Python sends `{ type: "CloseStream" }` to Deepgram → relay drains remaining results.

#### Path B: Local faster-Whisper (Fallback — `/transcribe-audio`)
Batch WAV upload path. It only works when `torch`, `faster-whisper` and `scipy` are installed separately — none of them are in `requirements.txt` — and returns 501 otherwise. The desktop app does not call it (`PythonClient.transcribeAudio()` has no callers).

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

When `torch` is installed, the Whisper and Silero VAD models are preloaded in the background at startup to eliminate cold-start latency.

---

## 8. Code Intelligence Service

**Technology**: Separate FastAPI microservice — `code-intelligence-service/`
**Port**: `127.0.0.1:8002`
**Storage**: one local SQLite file per project (`<code-intel-root>/projects/<project_id>/index.db`) with FTS5 full-text search; no server database and no job queue
**Models**: embeddings and reranker run on-device via ONNX (`onnxruntime`, weights downloaded once from Hugging Face Hub); LLM steps go to OpenRouter through `litellm` with the user's key

### 8.1. Architecture

The service is a thin FastAPI app (`app/main.py`) with:
- `RequestContextMiddleware` — echoes/sets `X-Request-ID`, applies the index root announced in `X-Prmpt-Code-Intel-Root`, and puts the user's provider settings from `X-Prmpt-OpenRouter-Key` / `X-Prmpt-Rag-Model` into a contextvar for the request (`app/llm.py`)
- `BrowserOriginGuard` (`app/origin_guard.py`) — rejects requests from web pages (§13.3)
- No authentication — `app/auth.py` returns a fixed local user for every request
- Startup warmup — `warmup_local_store()` checks the index root is writable (ingest returns 503 until it succeeds); with `RERANKER_BACKEND=local` the ONNX reranker is loaded (falling back to the LLM reranker if it fails)
- Eight route groups under `/api`, plus `/health`, `/health/ready` (service ready + writable SQLite root + local reranker loaded), `/`

### 8.2. Routes

| Method · Path | Module | Purpose |
|---|---|---|
| `POST/GET /api/projects`, `GET/DELETE /api/projects/{id}` | `routes/projects.py` | Create / list / get / delete a Space project (project ids are UUIDs) |
| `GET /api/projects/{id}/graph-health` | `routes/projects.py` | Graph statistics for a project |
| `DELETE /api/projects/{id}/chunks` | `routes/projects.py` | Delete the chunks of one file (FileWatcher unlink events) |
| `POST /api/index/ingest` | `routes/ingest.py` | Receive a parsed skeleton from Electron; returns 202 and indexes in a background task |
| `GET /api/retrieve` | `routes/retrieve.py` | Mode-aware hybrid retrieval — query + project_id + branch + mode → ranked chunks + related + branch context |
| `POST /api/context` | `routes/context.py` | Probable code locations (plus a generated answer in Ask mode) — used by the optimizer service and `project:context` |
| `POST /api/context/stream` | `routes/context.py` | Streaming Ask over Server-Sent Events: `locations`, then `token` deltas, then `done` (or `error`) |
| `POST /api/chunks/expand` | `routes/context.py` | Full source for a list of chunk ids (read from disk) |
| `POST /api/feedback` | `routes/feedback.py` | Record retrieval feedback for a search (`retrieval_feedback`) |
| `GET /api/pipeline/status`, `GET /api/pipeline/compare` | `routes/pipeline.py` | Pipeline fingerprint and config values; compare retrieval across pipeline variants |
| `GET /api/graph/data/{id}`, `DELETE /api/graph/data/{id}/cache` | `routes/graph_viz.py` | Nodes, edges and communities for `scripts/graph_visualizer.html` |
| `GET /api/debug/projects`, `POST /api/debug/retrieve` | `routes/debug.py` | List locally indexed projects; full score breakdown for a retrieval |

### 8.3. Embeddings & Storage

- **Embedding model**: `Xenova/bge-small-en-v1.5` via ONNX (`EMBEDDING_LOCAL_MODEL`), **384** dimensions by default (768 for a `base` model). `EMBEDDING_BACKEND` must be `local`; no API key or network is needed after the model download
- **Reranker**: `Xenova/bge-reranker-base` via ONNX (`RERANKER_BACKEND=local`, default); any other backend uses an LLM reranker (`RERANKER_MODEL`)
- **Vectors**: each chunk stores a summary embedding and a structure embedding (plus concept-phrase embeddings when the graph builder runs); vector search is an in-process cosine scan over the project's chunks (numpy) — no vector extension
- **Full-text**: SQLite FTS5 table `chunks_fts` (porter + unicode61) over file path, name, signature, summaries and concepts; optional SPLADE sparse vectors (`SPLADE_ENABLED`, off by default) with FTS5 fallback
- **No source bodies stored**: code bodies are sent at ingest for summarizing/embedding only; snippets are read back from disk via the project's `local_path` + `file_path` + line range
- **Per-ingest budget**: `MAX_CHUNKS_PER_INGEST = 10_000`, `UPSERT_BATCH_SIZE = 50`, `SUMMARIZER_BATCH_SIZE = 8`, `SUMMARIZER_CONCURRENCY = 10`
- **Summarization**: `SUMMARIZER_MODEL` (default `openrouter/deepseek/deepseek-chat`), `SUMMARY_MAX_TOKENS = 240`; when the LLM call fails (e.g. no key), a heuristic fallback summary is used

### 8.4. Services Layer (`app/services/`)

| Module | Role |
|---|---|
| `embedding.py` | On-device ONNX embeddings (batched, query-embedding LRU cache) |
| `reranker.py` | Cross-encoder reranking — local ONNX model, or an LLM reranker |
| `summarizer.py` | Per-chunk natural-language summary + concept tags (used as additional retrievable signals) |
| `context_builder.py` | Adds file and hierarchy context to Electron's symbol-level chunks before summarizing/embedding |
| `query_preprocessor.py` | Extracts structured signals from raw queries (stack traces, file paths, error types, function names) |
| `query_analyzer.py` | Query decomposition into sub-queries + concept/intent tags (uses `QUERY_DECOMPOSE_MODEL`; fast path skips the LLM for simple queries) |
| `mode_router.py` | Per-mode retrieval config (FIND / ASK / BUG / OPTIMIZE): recall limits, rerank, MMR, graph expansion, refinement, answer generation |
| `search.py` | The retrieval pipeline (§8.6) |
| `agent_loop.py` + `agent_tools.py` | Agentic multi-hop retrieval: the RAG model calls local SQLite tools (`search_symbols`, `get_definition`, `find_callers`, `find_callees`, `expand_neighbors`, `grep`, `read_chunk`) within `AGENT_MAX_HOPS`, `AGENT_TIME_BUDGET_S` and `AGENT_MAX_CHUNKS` |
| `answer_generator.py` | Answers over the retrieved chunks (blocking or streamed) using the RAG model |
| `graph.py` / `graph_builder.py` / `community.py` | Call/import edges; knowledge-graph pipeline (PageRank, Leiden communities, LLM community reports and relationship summaries) when `GRAPH_BUILDER_ENABLED`; community report cache |
| `concepts.py` | Canonical concept vocabulary shared by the summarizer and the query analyzer |
| `prompt_cache.py` | Anthropic prompt-cache breakpoints for the repeated agent-loop prefix |
| `project_summary.py` | Deterministic tech-stack summary per project (no LLM) |
| `feedback.py` / `cache.py` | Search logging + feedback recording; in-process TTL cache |

### 8.5. Indexing Worker (`app/workers/index_worker.py`)

There is no separate worker process or queue. `POST /api/index/ingest` validates the request, marks the project `indexing`, and schedules `process_ingest_batch()` as a FastAPI background task in the same process. Because the task runs after the response is sent, the request's LLM settings (key + RAG model) are captured and re-applied inside the task. Pipeline: filter unchanged chunks (by content hash) → enrich context → batch summarize → multi-vector embed → batch upsert → call/import edges → stale cleanup → project summary → graph pipeline (when enabled) → project status `ready` (`partial` / `error` on failure).

### 8.6. Hybrid Retrieval Pipeline

When a user sends a prompt in a Space with attached projects:

```
User prompt (in SpaceWorkspace, or optimizer project context)
        │
        ▼
CodeIntelClient.retrieve / context / contextStream({ project_id, query, branch, mode })
  → GET /api/retrieve · POST /api/context · POST /api/context/stream
        │
        ▼  mode config (mode_router): FIND / ASK / BUG / OPTIMIZE
        │
        ├── AGENTIC_RETRIEVAL_ENABLED (default on) and mode ≠ FIND
        │       → agent_loop: RAG model drives local SQLite tools over a few hops
        │       → hydrate the chunks it relied on (falls back to one-shot on error/empty)
        │
        └── one-shot pipeline
              ▼  query_preprocessor signals + concept detection
              ▼  graph search paths when GRAPH_BUILDER_ENABLED (falls back to flat)
              ▼  Broad recall (per sub-query):
                   1. Vector       (cosine over local embeddings; not used in FIND)
                   2. Full-text    (SQLite FTS5, or SPLADE when enabled)
                   3. Concept      (concept-tag overlap)
                   4. File-path    (path patterns from query signals)
                   5. Identifier   (exact symbol-name match, FIND only)
              ▼  Reciprocal Rank Fusion (RRF)
              ▼  FIND: lexical/path scorer + PageRank weight
                 ASK/BUG/OPTIMIZE: ONNX rerank + structure similarity + MMR
              ▼  Low top score → decomposed sub-queries (QUERY_DECOMPOSE_MODEL)
                 or refined queries (QUERY_REFINER_MODEL) → second recall pass
              ▼  Call-graph expansion (seeds and depth per mode,
                                       e.g. depth 2 / ≤ 20 related for ASK and BUG)
              ▼  Answer generation (ASK only; streamed for /context/stream)
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

Defaults: `RETRIEVAL_DEFAULT_LIMIT = 15`, `RETRIEVAL_MAX_LIMIT = 50`, `MAX_CODE_BODY_LEN = 3000`. The RAG model chosen in the app overrides `ANSWER_MODEL` and `AGENT_MODEL`; the other steps use small helper models from env.

### 8.7. Ingestion Pipeline (Cross-Process)

The Electron main process owns parsing and watching; the service owns summarizing, embedding, and indexing. Both write to the same per-project `index.db`:

```
Local Project Directory
        │
        ▼  [Electron]  FileWatcher (chokidar, debounced 1.5s)
        │              skips node_modules / .git / dist / build / venv / target / …
        │
        ▼  [Electron]  CodeParser (tree-sitter WASM)
        │              extracts ChunkData[] (functions, classes, methods, imports, callees, signatures)
        │              computes SHA-256 content hash
        │
        ▼  [Electron]  LocalProjectCache (file_cache in index.db) — skip if hash unchanged
        │
        ▼  [Electron]  CodeIntelClient.ingestSkeleton(payload)
        │              POST /api/index/ingest  (X-Prmpt-Code-Intel-Root + key/RAG-model headers)
        │
        ▼  [Service]   routes/ingest.py → 202, FastAPI background task (same process)
        │
        ▼  [Service]   index_worker.process_ingest_batch
        │              dedup vs existing content_hash → summarize (OpenRouter) → embed (ONNX)
        │              upsert into code_chunks + chunks_fts
        │              update code_relationships (call/import edges)
        │              graph pipeline when enabled (PageRank, communities)
        │              mark project index_status=ready
```

### 8.8. Supported Languages

Driven by **Electron-side** Tree-sitter WASM grammars under `tree-sitter-wasms/`. Currently bundled: TypeScript/JavaScript, Python, Go, Rust, Java, Ruby, C, C++, C# (10 grammars across 14 file extensions). The service itself is language-agnostic — it just stores chunk metadata, summaries and embeddings.

### 8.9. Branch Awareness

The `GitService` (Electron) reads `currentBranch`, `defaultBranch`, `aheadCount`, `behindCount`, and recent commit history. The branch is sent with ingest and with every `retrieve` call; the service records the project's `current_branch` and returns `branch_context` (current + default branch). Chunks carry a `branch_diverged` field, and the optimizer context adds a "modified in current branch" note when it is set, but the local indexer currently always writes it as `false`.

---

## 9. Data Persistence

All user data is stored locally under Electron's `userData` folder (overridable with `PRMPT_USER_DATA_DIR`). Nothing is synced to a server, and there is no account to delete — removing the folder removes the data.

### 9.1. Local App Database (`{userData}/prmpt.db`)

One SQLite file opened by `electron/main/database/local-db.ts` (better-sqlite3, WAL, `foreign_keys = ON`, schema version in `PRAGMA user_version`). Rows keep a `user_id` column set to the single `LOCAL_USER_ID`.

| Table | Key Columns | Purpose |
|---|---|---|
| `profile` | `id`, `name`, `email`, `avatar_url`, `personalization_prompt`, `ui_settings` (JSON) | The local profile; the avatar is stored as a data URL |
| `user_settings` | `user_id`, `theme`, `font_size`, `font_family`, `prompt_instructions`, `memory_enabled` | UI preferences and custom instructions |
| `chats` | `id`, `user_id`, `title`, `is_pinned`, `metadata`, `created_at`, `updated_at` | Chat session metadata |
| `messages` | `id`, `chat_id` (cascade delete), `role`, `content`, `optimization_id`, `metadata` | Messages; `metadata` holds attachments, `groupId` / `versionIndex` for edit/retry branches, and feedback |
| `prompt_optimizations` | `id`, `original_text`, `optimized_text`, `source`, `applied`, `rating`, `metadata` | Local log of optimizations |
| `prompt_collections` | `id`, `user_id`, `name` (unique per user), `icon` | Named prompt collections |
| `saved_prompts` | `id`, `collection_id` (cascade delete), `title`, `content`, `metadata` | Individual saved prompts (favorite flag in `metadata`) |
| `user_memory` | `id`, `memory_type` (`user` / `behavioral` / `context`), `key`, `value`, `confidence`, `source` (`inferred` / `explicit`), `observation_count` | Inferred and user-edited memory |
| `app_kv` | `key`, `value` | App-level key/value state — holds the AI provider settings (`ai_settings`, §5.4) |

Data from the earlier hosted version of Prmpt is not migrated into this file.

### 9.2. Attachments & Avatars

- **Attachments** (images, PDFs) are saved by `file-upload-service.ts` under `{userData}/attachments/<sha256-16>/<sanitized filename>` — content-addressed, so the same file attached twice is stored once. Messages store `{ name, mimeType, sizeBytes, storagePath }`; the renderer loads them through `storage:get-signed-url` (data URL) or opens PDFs with `storage:open-pdf`. Paths that resolve outside the attachments folder are refused.
- **Avatars** are resized client-side and stored on the `profile` row as a data URL (max 2 MB).

### 9.3. Code Intelligence Indexes (`{userData}/code-intel/`)

- One SQLite file per project: `{userData}/code-intel/projects/<project_id>/index.db`. Electron (`code-intel-local-store.ts`) and the service (`app/db/local_store.py`) open the same file and create the same schema.
- Tables: `projects_local` (the project's registry row: name, local path, branches, index status, summary, embedding config), `file_cache` (file path → content hash, written by Electron's `LocalProjectCache`), `code_chunks` (chunk metadata, summaries, embeddings, concepts, PageRank/centrality, community), `code_relationships`, `communities`, `retrieval_searches`, `retrieval_feedback`, and the FTS5 table `chunks_fts`.
- The project list is built by scanning `projects/*/index.db`; project ids must be UUIDs (anything else is rejected so it cannot escape the projects folder).
- Index root resolution in the service: `CODE_INTEL_DB_ROOT` env → the root announced by the app in `X-Prmpt-Code-Intel-Root` → a per-OS default (`%APPDATA%/Prmpt/code-intel`, `~/Library/Application Support/Prmpt/code-intel`, `$XDG_CONFIG_HOME/Prmpt/code-intel`).

### 9.4. Other Local State

- `{userData}/auto-launch.json` — start-at-login preference (§2.3).
- `{userData}/error-log.json` — local error log (`ErrorLog`, capped at 200 entries).
- Renderer `localStorage` — the Spaces list (`ProjectsView`), a cached copy of UI settings for flash-free startup, and the onboarding-completed flag.
- `python-service/pipeline_v2/storage/usage/` — per-request token usage logs (`usage_logger.py`).

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
                        task_planner.plan_tasks() (SUMMARIZER_MODEL),
                        run inside the /ws/optimize-stream request
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
project:add → CodeIntelClient.createProject()   (git default branch detected)
  → performFullScan(): CodeParser parses all files
  → CodeIntelClient.ingestSkeleton(chunks, callGraph)
  → status poll until the index settles (project:status-update)
        │
        ▼ (on file save, when watching is on — project:toggle-watching)
FileWatcher detects change (debounced 1.5s)
  → CodeParser.parseFile(changedFile)
  → LocalProjectCache.getCachedHash() — skip if unchanged
  → CodeIntelClient.ingestSkeleton(updatedChunk)
        │
        ▼ (when user sends a prompt in SpaceWorkspace)
Find / Bug / Optimize → CodeIntelClient.retrieve({ project_id, query, mode })
  → Service runs mode-aware hybrid retrieval over the local index (§8.6)
  → Returns ranked + related chunks with code read from disk
  → buildTailoredPrompt() assembles context-rich prompt → optimizer
Ask → project:context-stream → POST /api/context/stream (SSE locations + answer tokens)
```

### 10.4. User Memory System

Runs automatically in the background:

1. After each optimization, `MemoryAnalyzer.onNewOptimization()` is called.
2. Every 3rd call (and only while the Memory toggle is on), it sends the raw prompt, the optimized output and the skill to `POST /extract-memory-facts` (MEMORY_MODEL).
3. The returned facts (`user` / `behavioral` / `context`, each with key, value, confidence) are upserted into `user_memory` as `inferred` entries; entries the user set explicitly are not overwritten.
4. The updated memory is pushed to the App Window (`memory:updated`).
5. On the next optimization, `MemoryService.buildMemoryContext()` is appended to the custom instructions sent to the optimizer.

### 10.5. Overlay Cursor Glow

1. When the overlay opens, `startCursorPolling()` starts a `setInterval` at ~16 ms (~60 fps).
2. Each tick: `screen.getCursorScreenPoint()` → translated to overlay-relative coordinates.
3. `overlay:cursor-pos` IPC event sent to renderer.
4. Renderer updates `.panel-glow-wrapper` with `radial-gradient(circle at Xpx Ypx, <emerald>, transparent)`.
5. After 1.5 s of cursor inactivity, glow opacity fades to 0 via CSS transition.
6. Polling stops when the overlay is hidden.

### 10.6. Connectivity

All data is local, so nothing is queued or cached for offline use; an internet connection is only needed to reach OpenRouter (and Deepgram for voice).

1. `networkMonitor` checks `net.isOnline()` every 5 s.
2. On a change it broadcasts `network:status: { isOnline }` to both windows → the UI shows the amber offline banner.
3. While offline, `app:send-message` / `overlay:optimize` return "You're offline. Prmpt needs an internet connection to reach OpenRouter." instead of calling the services. Chats, the library and settings keep working from the local database.
4. On reconnect, `network:reconnected` is sent to the App Window.

### 10.7. Silent Auto-Launch at Login

```
[Tray menu or Settings → Customize → Startup] User toggles "Start at Login"
        ▼
setAutoLaunchPreference(checked)          → {userData}/auto-launch.json
applyAutoLaunchToOS(checked)              (skipped in unpackaged dev builds)
        ▼
app.setLoginItemSettings({
  openAtLogin: checked,
  openAsHidden: true,                                  // macOS
  ...(process.platform === 'win32' && {                // Windows
    path: process.execPath,
    args: ['--hidden'],
  }),
})

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

[`electron/preload.ts`](electron/preload.ts) uses Electron's `contextBridge` to expose a typed `window.electronAPI` object. All renderer ↔ main communication flows through this bridge — direct `ipcRenderer` calls are never exposed. The preload also captures microphone audio for voice input and streams it to main (`transcription:audio-chunk`).

### Namespace Map

| Namespace / members | Methods |
|---|---|
| `window.electronAPI.platform` | `'darwin'`, `'win32'` or `'linux'` |
| `window.electronAPI.overlay.*` | `optimize`, `submitClarification`, `save`, `copy`, `close`, `openApp`, `insert`, `insertSection`, `getSourceInfo`, `checkAuth`, `getCollections`, `createCollection`, `getChats`, `saveToChat`, `getSettings`, `newSession`, `stopGeneration`, `truncateHistory`, `notifyReady`; events `onOpened`, `onAuthState`, `onClarificationRequired`, `onOptimizationChunk`, `onOptimizationComplete`, `onOptimizationError`, `onUploadPartialFailure`, `onCursorPos`, `onSettingsUpdate` |
| Chat (top-level) | `sendMessage`, `regenerateResponse`, `submitClarification`, `optimizePrompt`, `stopGeneration`, `getGenerationStatus`, `loadChats`, `createChat`, `loadMessages`, `renameChat`, `deleteChat`, `saveToChat`, `copyToClipboard`, `saveFeedback`; events `onChatsLoaded`, `onChatCreated`, `onMessagesLoaded`, `onMessageSent`, `onMessageReceived`, `onMessageSendError`, `onClarificationRequired`, `onOptimizationChunk`, `onOptimizationComplete`, `onOptimizationError`, `onUploadPartialFailure`, `onChatRenamed`, `onChatRenameError`, `onChatDeleted`, `onChatDeleteError`, `onChatSaved`, `onOverlayMessagesAppended` |
| Session & profile (top-level) | `checkAuth` (asks main for the local session), `onAuthStateChange`, `requestUserData`, `onUserDataLoaded`, `updateProfile`, `uploadAvatar`, `updatePreferences`, `setPersonalizationPrompt`, `onProfileUpdated`, `onPreferencesUpdated` |
| `window.electronAPI.aiSettings.*` | `get`, `save`, `validateKey`, `listModels`, `onChanged` — returns `AISettingsView` only (no raw keys) |
| Settings (top-level) | `loadSettings`, `saveSettings` |
| `window.electronAPI.promptLibrary.*` | `getAll`, `getCollections`, `createCollection`, `renameCollection`, `deleteCollection`, `savePrompt`, `createCollectionAndSave`, `updatePrompt`, `deletePrompt`, `toggleFavorite`; plus top-level `onPromptLibraryLoaded` |
| `window.electronAPI.memory.*` | `get`, `upsert`, `delete`, `getEnabled`, `setEnabled`, `onUpdated` |
| `window.electronAPI.storage.*` | `getSignedUrl` (stored attachment → data URL), `openPdf` |
| `window.electronAPI.transcription.*` | `start`, `stop`, `onTranscription`, `onStatus`, `onError` |
| `window.electronAPI.skills.*` | `list` |
| `window.electronAPI.zoom.*` | `get`, `set`, `onChanged` |
| `window.electronAPI.autoLaunch.*` | `get`, `set` |
| `window.electronAPI.project.*` | `add`, `remove`, `list`, `status`, `setActive`, `getActive`, `reindex`, `toggleWatching`, `isWatching`, `isScanning`, `retrieve`, `context`, `contextStream`, `ensureFresh`, `onStatusUpdate`, `onOverlayStatus` |
| `window.electronAPI.spaces.*` | `publishSnapshot`, `list`, `appendMessages`, `onApplyAppend`, `getActiveStream` |
| `window.electronAPI.windowControls.*` | `minimize`, `maximize`, `close` |
| Misc (top-level) | `openExternal` (http/https only), `send` (allow-list: `overlay:settings-update`, `overlay:close`, `overlay:ready`), `onNetworkStatus` (`{ isOnline }`), `onNetworkReconnected`, `onPythonUnavailable`, `onPythonRecovered` |

---

## 12. Configuration & Environment Variables

Everything is optional. The OpenRouter key and models are entered in the app (§5.4), not in env files. The root `.env` (template: `.env.example`) is read by the Electron app (project root in dev, `resourcesPath/.env` if present in packaged builds) and by the Python optimizer service; the code-intelligence service reads `code-intelligence-service/.env`.

| Variable | Used by | Description |
|---|---|---|
| `PYTHON_SERVICE_URL` | Electron main | Python service base URL (default: `http://127.0.0.1:8001`) |
| `CODE_INTELLIGENCE_SERVICE_URL` | Electron main + Python service | Code Intelligence Service URL (default: `http://127.0.0.1:8002`) |
| `PRMPT_USER_DATA_DIR` | Electron main | Overrides Electron's `userData` folder (portable installs, testing) |
| `OPENROUTER_API_KEY` | Both Python services | Fallback only — used when a request carries no key (scripts, curl) |
| `DEEPGRAM_API_KEY` | Python service | Fallback only — used when the transcription start message has no `deepgram_api_key` |
| `OPTIMIZER_MODEL` | Python service | Default optimizer model when the app sends none (default `openrouter/openai/gpt-4o-mini`); the model chosen in the app overrides it |
| `SUMMARIZER_MODEL` | Python service | Helper model for clarification, task planning and context compaction (default `openrouter/openai/gpt-4o-mini`) |
| `TITLE_MODEL` / `MEMORY_MODEL` | Python service | Chat title generation / memory extraction (default: `SUMMARIZER_MODEL`) |
| `MAX_CONCURRENT_OPTIMIZATIONS` | Python service | Concurrency semaphore size (default 50) |
| `APP_ENV` | Both Python services | `production` disables `/docs`, `/redoc` and `/openapi.json` in the optimizer service |
| `ALLOWED_ORIGINS` | Both Python services | Extra browser origins allowed by `BrowserOriginGuard` (comma-separated, `*` is ignored); empty by default |
| `PORT` | Both Python services | Port when started with `python -m app.main` (8001 / 8002); the npm scripts pass `--port` to uvicorn |
| `CODE_INTEL_DB_ROOT` | Code Intelligence service | Overrides the index root (otherwise the app's `X-Prmpt-Code-Intel-Root`, then a per-OS default) |
| `EMBEDDING_BACKEND` / `EMBEDDING_LOCAL_MODEL` / `EMBEDDING_DIMENSIONS` | Code Intelligence service | Must be `local` / default `Xenova/bge-small-en-v1.5` / default 384 |
| `RERANKER_BACKEND` / `RERANKER_LOCAL_MODEL` / `RERANKER_MODEL` | Code Intelligence service | `local` (default) uses `Xenova/bge-reranker-base` via ONNX; otherwise the LLM reranker `RERANKER_MODEL` |
| `ANSWER_MODEL` / `AGENT_MODEL` | Code Intelligence service | Default answer / agent-loop models (`openrouter/deepseek/deepseek-chat`); overridden by the RAG model chosen in the app |
| `SUMMARIZER_MODEL` | Code Intelligence service | Chunk summaries at ingest (default `openrouter/deepseek/deepseek-chat`) |
| `QUERY_DECOMPOSE_MODEL` / `QUERY_REFINER_MODEL` / `COMMUNITY_MODEL` | Code Intelligence service | Helper models for query decomposition (default `openrouter/openai/gpt-4o-mini`), query refinement and community reports |
| `AGENTIC_RETRIEVAL_ENABLED` | Code Intelligence service | Agentic multi-hop retrieval for Ask/Bug/Optimize (default `true`; Find never uses it). Limits: `AGENT_MAX_HOPS` (6), `AGENT_TIME_BUDGET_S` (25), `AGENT_MAX_CHUNKS` (15) |
| `GRAPH_BUILDER_ENABLED` | Code Intelligence service | Knowledge-graph pipeline after each index (default `true`; set `false` for flat retrieval) |
| `SPLADE_ENABLED` | Code Intelligence service | Optional SPLADE sparse recall (default `false`; FTS5 otherwise) |

---

## 13. Local-First Boundaries (Keys, Origins, Network)

### 13.1. API Keys

- The OpenRouter key and the optional Deepgram key are stored only in `prmpt.db` (`app_kv` → `ai_settings`), encrypted with `safeStorage` on Windows/Linux (§5.4).
- They stay in the Electron main process; the renderer sees `AISettingsView` (configured flags, masked previews, model ids).
- The Python services never persist them: each request carries the settings it needs, and they live only for that request (plus any background indexing the request started).

### 13.2. How Provider Settings Travel

| Hop | Carrier | Fields |
|---|---|---|
| Electron → python-service HTTP (`/clarify`, `/generate-title`, `/extract-memory-facts`, `/optimize`) | Axios request interceptor (`aiSettings.pythonHeaders()`) | `X-Prmpt-OpenRouter-Key`, `X-Prmpt-Optimizer-Model`, `X-Prmpt-Rag-Model` |
| Electron → python-service `WS /ws/optimize-stream` | `llm` field in every request message (`aiSettings.llmPayload()`) | `{ api_key, optimizer_model, rag_model }`, plus `code_intel_root` when a project is attached |
| Electron → python-service `WS /ws/transcribe-stream` | Start message | `deepgram_api_key` |
| Electron → code-intel HTTP + SSE | Axios interceptor / `fetch` headers (`aiSettings.codeIntelHeaders()`) | `X-Prmpt-OpenRouter-Key`, `X-Prmpt-Rag-Model`, `X-Prmpt-Code-Intel-Root` |
| python-service → code-intel (`project_context.py`) | `LLMSettings.code_intel_headers()` | The same headers, built from the WebSocket `llm` object, plus `X-Prmpt-Code-Intel-Root` |

Inside the services: python-service builds `LLMSettings` (`pipeline_v2/config.py`) and passes the key to `litellm` via `provider_kwargs()`; code-intel keeps the settings in a contextvar (`app/llm.py`) read by `completion_kwargs()` / `with_key()`. A missing key produces "No OpenRouter API key configured. Add one in Prmpt Settings > AI provider."; a rejected key, unknown model or rate/credit limit is mapped to a clear message.

### 13.3. `BrowserOriginGuard`

Both services listen on `127.0.0.1` without a login, so a web page open in the user's browser must not be able to call them. `BrowserOriginGuard` (`app/origin_guard.py`, identical in both services) is a pure ASGI middleware:

- Requests without an `Origin` header pass — Node/Electron (`axios`, `fetch`, `ws`) sends none.
- An `Origin` equal to the service's own host (`http(s)://<Host>`) passes.
- Origins listed in `ALLOWED_ORIGINS` pass (`*` is ignored).
- Anything else gets HTTP 403 `{"detail": "Requests from web pages are not allowed"}`, or a WebSocket close with code 1008.

There is no CORS middleware. In the renderer, the main process installs a Content-Security-Policy whose `connect-src` allows only `'self'` and the python-service HTTP/WebSocket origins; the renderer never calls the code-intelligence service or OpenRouter directly.

### 13.4. Network Calls That Leave the Machine

| Destination | From | When |
|---|---|---|
| `openrouter.ai/api/v1/key`, `/api/v1/models` | Electron main (`ai-settings-service.ts`) | Validating a key on save; loading the model list (cached 1 h) |
| OpenRouter (via `litellm`) | Python service, Code Intelligence service | Optimization, clarification, task planning, titles, memory extraction; chunk summaries, query decomposition/refinement, agentic loop, answers, graph community reports (and reranking only if `RERANKER_BACKEND` is not `local`) |
| `api.deepgram.com` (WebSocket) | Python service | Voice input, only when a Deepgram key is set |
| Hugging Face Hub | Code Intelligence service | First use of the ONNX embedding / reranker (and SPLADE, if enabled) models; cached afterwards. `HF_HUB_DISABLE_TELEMETRY=1` is set |

Both Python services set `LITELLM_LOCAL_MODEL_COST_MAP=True` so `litellm` uses its bundled model price list instead of fetching it on import. A non-OpenRouter `litellm` model id set via env uses that provider's own key from the environment.

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
| Installer | NSIS (`npm run package:win`) — x64 | DMG (`npm run package:mac`) — x64 + arm64; uses `build/entitlements.mac.plist` (microphone, JIT); `hardenedRuntime: false` |
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
- `appId: "com.prmpt.desktop"`
- `mac.target: dmg` (x64 + arm64), `mac.icon: build/icon.icns`, `mac.hardenedRuntime: false`, `mac.entitlements: build/entitlements.mac.plist`
- `win.target: nsis`, `win.icon: build/icon.ico`
- `extraResources` lists the native `.node` binaries, the `files/` skills folder, `tree-sitter-wasms/`, and the tray and app icons so they're discoverable at `process.resourcesPath` in packaged builds

There is no `build.publish` target and no auto-updater; installers are built locally with `npm run package:win` / `npm run package:mac`. The two Python services are not bundled into the installer — they run from their own virtual environments (`npm run python:dev`, `npm run code-intel:dev`).

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

The app uses `Geist` (UI and display) and `Geist Mono`, bundled with the `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` packages (no font CDN at runtime). The `font_size` and `font_family` user preferences are applied as Tailwind classes on the root element (`text-sm` / `text-base` / `text-lg`, `font-sans` / `font-mono` / `font-serif`).
