# DEEP_DOCUMENTATION.md — Prmpt Codebase Deep Dive

> Exhaustive technical documentation of the Prmpt desktop application.
> Every architectural decision, data flow, and implementation detail explained from first principles.

---

## Table of Contents

1. [Chapter 1: What Is This App?](#chapter-1-what-is-this-app)
2. [Chapter 2: The Technology Stack -- From the Ground Up](#chapter-2-the-technology-stack----from-the-ground-up)
3. [Chapter 3: Architecture -- The Five Subsystems](#chapter-3-architecture----the-five-subsystems)
4. [Chapter 4: Electron Main Process -- The Brain](#chapter-4-electron-main-process----the-brain)
5. [Chapter 5: The Preload Bridge -- How UI Talks to the OS](#chapter-5-the-preload-bridge----how-ui-talks-to-the-os)
6. [Chapter 6: React App Window UI](#chapter-6-react-app-window-ui)
7. [Chapter 7: The Overlay System -- Engineering a Flicker-Free Popup](#chapter-7-the-overlay-system----engineering-a-flicker-free-popup)
8. [Chapter 8: The Native Rust Module -- Cross-Platform Deep Dive](#chapter-8-the-native-rust-module----cross-platform-deep-dive)
9. [Chapter 9: Python AI Service -- The Optimization Engine](#chapter-9-python-ai-service----the-optimization-engine)
10. [Chapter 10: Supabase Database -- Schema and Security](#chapter-10-supabase-database----schema-and-security)
11. [Chapter 11: Voice Input -- From Sound Waves to Text](#chapter-11-voice-input----from-sound-waves-to-text)
12. [Chapter 12: Networking, Offline Mode, and Error Handling](#chapter-12-networking-offline-mode-and-error-handling)
13. [Chapter 13: Sharing and Deep Links](#chapter-13-sharing-and-deep-links)
14. [Chapter 14: Build System and Development Workflow](#chapter-14-build-system-and-development-workflow)
15. [Chapter 15: Security Model](#chapter-15-security-model)
16. [Chapter 16: Code Intelligence Service — The Codebase Indexing Brain](#chapter-16-code-intelligence-service--the-codebase-indexing-brain)
17. [Chapter 17: The Spaces Feature — Project-Aware Prompt Workspaces](#chapter-17-the-spaces-feature--project-aware-prompt-workspaces)
18. [Chapter 18: Code Parser — Tree-Sitter WASM Code Parsing](#chapter-18-code-parser--tree-sitter-wasm-code-parsing)
19. [Chapter 19: File Watcher — Incremental Re-indexing on File Changes](#chapter-19-file-watcher--incremental-re-indexing-on-file-changes)
20. [Chapter 20: Git Service — Local Repository Introspection](#chapter-20-git-service--local-repository-introspection)
21. [Chapter 21: Local Project Cache — SQLite File Hash Store](#chapter-21-local-project-cache--sqlite-file-hash-store)
22. [Chapter 22: Code Intelligence Client — Electron-Side HTTP Client](#chapter-22-code-intelligence-client--electron-side-http-client)
23. [Chapter 23: Project IPC Handlers](#chapter-23-project-ipc-handlers)
24. [Chapter 24: Analytics Service — Session Tracking and Usage Events](#chapter-24-analytics-service--session-tracking-and-usage-events)
25. [Chapter 25: Clarification System — Pre-Optimization Questionnaire](#chapter-25-clarification-system--pre-optimization-questionnaire)
26. [Chapter 26: Feedback System](#chapter-26-feedback-system)
27. [Chapter 27: Skill System — Optimization Domain Skills](#chapter-27-skill-system--optimization-domain-skills)
28. [Chapter 28: AI Guardrails — Request Deduplication and Rate Control](#chapter-28-ai-guardrails--request-deduplication-and-rate-control)
29. [Chapter 29: New Overlay Components](#chapter-29-new-overlay-components)
30. [Chapter 30: History View](#chapter-30-history-view)
31. [Chapter 31: Updated File Map — All New Files Since Last Documentation](#chapter-31-updated-file-map--all-new-files-since-last-documentation)
32. [Chapter 32: Task Planner — Structured Builds for Complex Prompts](#chapter-32-task-planner--structured-builds-for-complex-prompts)
33. [Chapter 33: OTP-Based Email Authentication](#chapter-33-otp-based-email-authentication)
34. [Chapter 34: GDPR Account Deletion — 30-Day Graceful Wipe](#chapter-34-gdpr-account-deletion--30-day-graceful-wipe)
35. [Chapter 35: Rate Limiting and Daily Usage Caps](#chapter-35-rate-limiting-and-daily-usage-caps)
36. [Chapter 36: Active Window Detector and Zoom Indicator](#chapter-36-active-window-detector-and-zoom-indicator)
37. [Chapter 37: Request ID Middleware and Production API Hardening](#chapter-37-request-id-middleware-and-production-api-hardening)
38. [Chapter 38: Cross-Platform Support — Windows and macOS](#chapter-38-cross-platform-support--windows-and-macos)
39. [Chapter 39: Silent Auto-Launch at Login](#chapter-39-silent-auto-launch-at-login)
40. [Chapter 40: Sentry Observability — Four-Surface Coverage](#chapter-40-sentry-observability--four-surface-coverage)
41. [Chapter 41: Prmpt Branding and Cross-Platform Packaging](#chapter-41-prmpt-branding-and-cross-platform-packaging)
- [Appendix A: Environment Variables Reference](#appendix-a-environment-variables-reference)
- [Appendix B: File Map](#appendix-b-file-map)

---

## Chapter 1: What Is This App?

### Product Overview

Prmpt (pronounced "prompt") is a desktop AI prompt optimizer. Its core premise is simple: users type rough, vague prompts and Prmpt transforms them into detailed, effective AI prompts using Large Language Models (LLMs). Think of it as a translator between what a human casually types and what an LLM needs to produce excellent output. The user writes "write an email to boss for vacation" and Prmpt produces a detailed, structured prompt specifying tone, format, content sections, audience considerations, and desired length — all optimized to elicit the best possible response from any AI model.

The application is a native cross-platform desktop application built with Electron, shipping for **both Windows and macOS** (Apple Silicon). It runs persistently in the system tray (Windows) / menu bar (macOS), always available. It is not a web app — it installs and runs locally, with two Python services running on the user's machine (an AI optimization service and a Code Intelligence service) and a Supabase cloud backend for user data persistence. Both platforms share the same TypeScript / React / Rust codebase; platform differences are handled through `process.platform` branches in the Electron main process and `#[cfg(target_os = …)]` blocks inside the Rust crate.

### Three Ways to Use Prmpt

There are three distinct interaction modes, each designed for a different user context:

#### 1. The App Window — Full Interface

The App Window is a full-featured ChatGPT-like interface. It opens as a standard desktop window (1400×900 pixels). On Windows it is **frameless with a custom title bar**; on macOS it uses **`titleBarStyle: 'hiddenInset'`** so Electron's native traffic-light buttons remain in the upper-left corner with `trafficLightPosition: { x: 12, y: 12 }`. On macOS, the Dock icon appears only while the App Window is visible — closing the window via the red traffic light hides both the window and the Dock icon, but keeps the keyboard hook and tray running silently in the background. It contains:

- **Sidebar**: Lists all chat sessions, searchable, with create/delete/rename functionality.
- **Chat Area**: A scrollable message history showing user prompts and AI-optimized responses. Each message supports branching versions — the user can regenerate a response and navigate between versions (v1, v2, v3...) with arrow buttons.
- **Input Section**: A multi-line text input with support for file attachments (PDFs, images), voice input via microphone button, mode selection (Fast mode vs Thinking mode), and a send button.
- **Prompt Library**: A collection management system where users save, organize, share, and reuse their best prompts. Collections can be shared with other users via deep links.
- **Settings Page**: Configure theme (light/dark), font size, custom instructions (personalization prompt that's injected into every optimization), memory system toggle, and account management.
- **Profile & Account**: Avatar upload, profile editing, GDPR-compliant account deletion.

The App Window is the power-user interface. It's where you go when you want to have a sustained conversation with the optimizer, build up a prompt library, or configure the app.

#### 2. The Overlay — Compact Popup

The Overlay is a small, transparent, always-on-top popup window. It appears near the user's cursor when triggered. It's designed for quick, in-context optimizations without switching away from whatever application the user is working in.

The Overlay contains:
- A text input field for typing the rough prompt.
- A streaming output area that shows the optimized text as it's generated token by token.
- An "Insert" button (replaces the @prompt trigger text in the original application).
- A "Copy" button (copies optimized text to clipboard).
- A microphone button for voice input.
- Mode selection (Fast/Thinking).
- File attachment support.
- A "Save" button to save the result to the Prompt Library.

The Overlay can be triggered in two ways:
- **`CommandOrControl+5` hotkey**: Press `Ctrl+5` (Windows) or `Cmd+5` (macOS) from anywhere on the system. The overlay appears centered on screen. Registered via `globalShortcut.register('CommandOrControl+5', …)` in `electron/main/index-new.ts`.
- **`@prompt` trigger**: Type the literal text `@prompt` in any application. The overlay appears near the cursor. When the user clicks "Insert", the `@prompt` text is automatically replaced with the optimized result. This is the signature feature of Prmpt.

On macOS, the overlay window sets `visibleOnAllWorkspaces: true` and `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`, so it appears on every Mission Control space (including spaces that are running another app full-screen). It uses `showInactive()` + `moveTop()` so it surfaces over the foreground app *without* stealing keyboard focus from the user's source application.

#### 3. The @prompt Trigger — System-Wide Text Replacement

This is the most distinctive feature. A low-level OS keyboard hook (implemented in Rust, with platform-dispatched backends) monitors every keystroke across the entire operating system. When the user types the seven characters `@prompt` (case-sensitive) in any application — VS Code, Notepad, a browser text field, Slack, Microsoft Word, literally any window that accepts text input — the following happens:

1. The Rust hook detects the completed `@prompt` sequence.
   - **Windows**: `WH_KEYBOARD_LL` low-level hook installed via `SetWindowsHookExW` on a dedicated message-pump thread.
   - **macOS**: `CGEventTap` (`kCGSessionEventTap`, listen-only) attached to `CFRunLoopGetMain`, requires the user to grant Accessibility permission once.
2. It captures the **focused-window anchor** of the currently focused window and the trigger length (7 characters).
   - **Windows**: anchor = HWND (`GetForegroundWindow`).
   - **macOS**: anchor = PID (`NSWorkspace.frontmostApplication`). The JS layer treats this as an opaque integer.
3. It calls a JavaScript callback via a ThreadsafeFunction bridge back into the Node.js event loop.
4. The Electron main process opens the Overlay window near the cursor.
5. The user types their rough prompt into the Overlay.
6. The optimization streams from the Python service.
7. The user clicks "Insert".
8. The Rust native module focuses the original window (using the stored anchor), removes the `@prompt` text, and inserts the optimized text:
   - **Windows**: `SetForegroundWindow(hwnd)` + `Shift+Left × N` selection + `KEYEVENTF_UNICODE` injection of optimized text.
   - **macOS**: `osascript activate` of the target PID + `CGEventPost` Backspace × N + clipboard-swap (save current pasteboard → set pasteboard to optimized text → post `Cmd+V` → sleep ~30 ms → restore previous pasteboard).
9. The original application now contains the fully optimized prompt where `@prompt` used to be.

### User Journey Walkthrough

A new user's journey through Prmpt looks like this:

1. **Installation & Sign Up**: The user downloads and installs the Electron app. On first launch, the app window opens showing a sign-up/sign-in screen. The user creates an account with email and password, or signs in with Google/GitHub OAuth.

2. **Initial Configuration**: After signing in, the user lands on the main chat interface. They can optionally visit Settings to:
   - Set custom instructions (e.g., "I'm a senior backend engineer who works primarily with Python and TypeScript").
   - Enable/disable the memory system (which learns about the user over time).
   - Choose their preferred theme and font size.

3. **First Use — App Window**: The user types a rough prompt like "help me write tests for my api" in the chat input and clicks Send (or presses Enter). The app sends this to the Python AI service, which streams back an optimized version. The user sees tokens appearing in real-time in the chat area, producing something like: "Write comprehensive unit and integration tests for a REST API. Include: test setup with fixtures, happy path tests for each endpoint, error case tests (400, 401, 404, 500), edge cases for input validation, mock external dependencies, use pytest with async support, aim for >90% coverage, and include both positive and negative test assertions."

4. **Using @prompt in VS Code**: The user is writing code in VS Code. They need a prompt to help them refactor a function. Instead of switching to the Prmpt app, they simply type `@prompt` right in their code editor. The Overlay pops up near their cursor. They type "refactor this function to use dependency injection". The AI streams the optimized prompt. They click "Insert" and the `@prompt` text in VS Code is replaced with the detailed, optimized prompt. They can then copy this prompt and send it to their AI coding assistant.

5. **Using `Cmd/Ctrl+5`**: The user is browsing the web and wants to quickly optimize a prompt. They press `Ctrl+5` (Windows) or `Cmd+5` (macOS). The Overlay appears. They type their rough prompt, get the optimized version, and click "Copy" to put it on the clipboard.

6. **Voice Input**: In either the App Window or the Overlay, the user clicks the microphone button. They speak their prompt out loud. The audio is captured by the browser's microphone API, converted to raw PCM in the preload script, sent via IPC to the main process, forwarded to the Python service via WebSocket, which proxies it to Deepgram's streaming speech-to-text API. The transcribed text appears in real-time in the input field. The user can then edit and send it for optimization.

7. **Building a Prompt Library**: Over time, the user saves their best optimized prompts to collections. They create collections like "Code Reviews", "Email Templates", "Documentation". They can share collections with colleagues via deep links (prmpt://share/c/<token>).

8. **Memory System**: As the user uses Prmpt, the memory system silently extracts facts about them from their prompts. It learns things like "works with React and TypeScript", "prefers concise technical writing", "is a senior backend engineer". These facts are injected into future optimizations for better personalization — without the user having to repeat context every time.

### Feature Summary

- **Chat with History & Branching Versions**: Full conversation history persisted in Supabase. Each assistant response can be regenerated, creating version branches (v1, v2, v3...) navigable with arrow buttons. Chat titles are auto-generated by the AI.
- **Prompt Library with Collections & Sharing**: Organize saved prompts into collections. Star favorites. Share collections and individual prompts via cryptographically secure deep links (prmpt:// protocol).
- **Voice Input via Microphone**: Real-time streaming speech-to-text powered by Deepgram Nova-2 (cloud) with local Whisper (CPU) as fallback. Audio captured in the browser, converted to Int16 PCM, streamed via WebSocket.
- **File Attachments**: Attach PDFs and images to prompts. PDFs are viewable inline (Chromium PDF viewer). Images are sent as base64 to vision-capable LLMs. Maximum 5 files per message.
- **Memory System**: Three categories of learned facts — user (identity, role, domain), behavioral (writing style, preferences), and context (recurring topics, tools). Facts are extracted by an LLM after each optimization. Users can view, edit, and delete memories. The system can be toggled on/off.
- **Fast Mode vs Thinking Mode**: Fast mode uses the standard optimizer model for quick results. Thinking mode uses a more capable model (or different parameters) for deeper, more thoughtful optimizations. Temperature is 0.7 for normal optimization, 0.95 for regeneration (to produce distinctly different results).
- **Offline Support**: The app detects network status changes. When offline, mutations are queued locally. When connectivity returns, the queue is drained and synced. Auth sessions survive brief offline periods (spurious SIGNED_OUT events from Supabase's token refresher are suppressed when offline).
- **GDPR Account Deletion**: Users can request account deletion. The request is scheduled (not immediate) and can be cancelled. All user data is permanently removed upon execution.

---

## Chapter 2: The Technology Stack — From the Ground Up

This chapter explains every technology used in Prmpt from first principles — not just what it is, but how it works under the hood.

### Electron (v28)

#### What Electron Is

Electron is a framework for building cross-platform desktop applications using web technologies (HTML, CSS, JavaScript). It achieves this by bundling two major open-source projects into a single binary:

1. **Chromium**: The open-source browser engine that powers Google Chrome. Chromium provides the rendering engine (Blink) that parses HTML and CSS into pixels on screen, the JavaScript engine (V8) that executes JavaScript, and the browser infrastructure (networking stack, GPU compositing, security sandbox, DevTools).

2. **Node.js**: A JavaScript runtime built on V8 that provides access to operating system APIs — file system, networking, child processes, native addons, and more. Node.js is what makes JavaScript capable of running outside a browser.

By combining these two, Electron lets you build desktop apps with a web-based UI (Chromium) that also has full access to the operating system (Node.js).

#### Multi-Process Architecture

Electron inherits Chromium's multi-process architecture. Understanding this is critical to understanding Prmpt:

**Main Process (Node.js)**:
- There is exactly one main process per Electron application.
- It runs Node.js — meaning it can `require()` any Node.js module, access the file system, spawn child processes, and use native addons.
- It has full access to the Electron API: creating windows, registering global shortcuts, managing the system tray, handling IPC, and controlling the application lifecycle.
- It is the privileged process — it can do anything the operating system allows.
- In Prmpt, the main process (electron/main/index-new.ts) is the orchestrator of the entire application. It manages windows, communicates with the Python service, handles database operations, and coordinates between the UI and the native Rust module.

**Renderer Process (Chromium)**:
- Each BrowserWindow runs in its own renderer process. It's essentially a separate Chrome tab.
- It runs a full Chromium instance with V8, the DOM, Web APIs (fetch, WebSocket, MediaStream, Canvas, etc.).
- It is sandboxed — by design, it cannot access the file system, spawn processes, or use Node.js modules. This is a security boundary. If a renderer process is compromised (e.g., by loading malicious web content), it cannot escalate to OS-level access.
- In Prmpt, there are two renderer processes: one for the App Window (running the full React application) and one for the Overlay (running a separate, simpler React application).

**Preload Script (Bridge)**:
- The preload script runs before the renderer page loads. It executes in a special context that has access to both Node.js APIs (require, process, Buffer, ipcRenderer) and browser APIs (document, window, navigator).
- However — and this is the critical security design — the renderer page's JavaScript cannot access the preload's context directly. They live in separate JavaScript realms.
- The preload uses `contextBridge.exposeInMainWorld('electronAPI', {...})` to create a safe, read-only, non-tamperable copy of a controlled API object on the renderer's `window` object. The renderer can call `window.electronAPI.someMethod()`, but cannot modify the API object, access `ipcRenderer` directly, or reach any Node.js APIs.

#### contextIsolation

When `contextIsolation: true` is set in the BrowserWindow's webPreferences (which it is in Prmpt), the preload script runs in its own isolated JavaScript context. This means:

- The preload's `window` object is different from the renderer page's `window` object.
- The preload can define variables and functions that are invisible to the page.
- `contextBridge.exposeInMainWorld` creates a structured clone of the API on the page's window — meaning it's a deep copy with read-only property descriptors. The page cannot Object.defineProperty() or otherwise tamper with the exposed API.
- This prevents a class of attacks where malicious code injected into the page (via XSS, a compromised npm package in the renderer bundle, or a loaded iframe) could intercept or modify IPC calls to gain privileged access.

#### IPC (Inter-Process Communication)

IPC is how the renderer communicates with the main process. There are three patterns, each used for different purposes:

**Pattern 1: Fire-and-Forget (Renderer → Main)**

```typescript
// In preload:
ipcRenderer.send('overlay:optimize', data);

// In main process:
ipcMain.on('overlay:optimize', (event, data) => {
  // Handle the optimization request
});
```

`ipcRenderer.send()` sends a message to the main process and immediately returns. There is no response. This is used when the renderer doesn't need to wait for a result — for example, sending a message to optimize (the result comes back via event push), closing a window, or starting transcription.

**Pattern 2: Request/Response (Renderer → Main → Renderer)**

```typescript
// In preload:
return ipcRenderer.invoke('settings:load');  // Returns a Promise

// In main process:
ipcMain.handle('settings:load', async (event) => {
  const settings = await settingsService.load(authState.currentUserId);
  return settings;  // This becomes the resolved value of the Promise
});
```

`ipcRenderer.invoke()` sends a message and returns a Promise that resolves with the handler's return value. This is used when the renderer needs to wait for data — loading settings, checking auth status, getting rate limit info. The handler's return value is serialized via Electron's structured clone algorithm, sent back to the renderer process, and used to resolve the Promise.

**Pattern 3: Event Push (Main → Renderer)**

```typescript
// In main process:
appWindowManager.send('optimization-chunk', { chunk, accumulated });
// Which internally does:
// window.webContents.send('optimization-chunk', { chunk, accumulated });

// In preload:
ipcRenderer.on('optimization-chunk', (event, data) => callback(data));
```

`webContents.send()` pushes a message from the main process to a specific renderer. This is used for events that originate in the main process — streaming optimization chunks, auth state changes, network status updates, Python service availability changes. The preload wraps each listener and returns a cleanup function: `() => ipcRenderer.removeListener(channel, handler)` — so the renderer can unsubscribe when a React component unmounts.

#### BrowserWindow

Each window in Electron is a `BrowserWindow` — a separate Chromium renderer process with its own DOM, JavaScript context, and web page. Key configuration in Prmpt:

```typescript
new BrowserWindow({
  width: 1400,
  height: 900,
  frame: false,                    // Removes native OS title bar
  backgroundColor: '#0d1117',     // Dark background shown during load
  webPreferences: {
    nodeIntegration: false,        // Renderer cannot use require()
    contextIsolation: true,        // Separate JS contexts
    plugins: true,                 // Enables Chromium PDF viewer
    preload: path.join(..., 'preload.js'),  // Bridge script
  },
});
```

- `nodeIntegration: false` ensures the renderer cannot access Node.js APIs like `require`, `process`, `fs`, etc. This is a critical security setting.
- `contextIsolation: true` ensures the preload runs in a separate context from the page, as described above.
- `plugins: true` enables the Chromium PDF viewer plugin so that PDF attachments can be displayed inline.

#### Frameless Windows

`frame: false` removes the native operating system title bar (the bar with minimize/maximize/close buttons and the window title). The application renders its own title bar in HTML and CSS instead. This allows for a custom design that matches the app's aesthetic.

For the custom title bar to be draggable (so the user can click and drag to move the window), the HTML element uses the CSS property `-webkit-app-region: drag`. Interactive elements within the title bar (buttons) use `-webkit-app-region: no-drag` so clicks on them are not interpreted as drag gestures.

The minimize, maximize, and close buttons in the custom title bar send IPC messages to the main process:
- `window:minimize` → `win.minimize()`
- `window:maximize` → `win.isMaximized() ? win.unmaximize() : win.maximize()`
- `window:close` → `win.hide()` (note: hide, not close — the app keeps running in the background)

### React 18

#### What React Is

React is a JavaScript library for building user interfaces using a component-based architecture. A React component is a JavaScript function that accepts inputs (called "props") and returns a description of what the UI should look like (written in JSX).

```tsx
function MessageBubble({ content, role }: { content: string; role: string }) {
  return (
    <div className={cn("rounded-lg p-4", role === "assistant" ? "bg-muted" : "bg-primary")}>
      {content}
    </div>
  );
}
```

#### JSX

JSX is syntactic sugar that lets you write HTML-like markup directly in JavaScript. At build time, a compiler (in Prmpt's case, SWC via the Vite plugin) transforms JSX into `React.createElement()` calls:

```tsx
// What you write:
<div className="chat-message">{content}</div>

// What the compiler produces:
React.createElement("div", { className: "chat-message" }, content)
```

`React.createElement()` doesn't create a real DOM element. It creates a lightweight JavaScript object (a "React element") that describes what the DOM should look like: `{ type: "div", props: { className: "chat-message", children: content } }`.

#### Virtual DOM and Reconciliation

React maintains a lightweight JavaScript representation of the entire DOM tree — the Virtual DOM. When state changes in a component:

1. React calls the component function again with the new state, producing a new tree of React elements (a new Virtual DOM).
2. React diffs the new tree against the previous tree using a diffing algorithm called "reconciliation".
3. The diffing algorithm identifies the minimal set of real DOM mutations needed (insert node, update attribute, remove node).
4. React applies only those mutations to the actual browser DOM.

This is faster than directly manipulating the DOM for complex UIs because: (a) DOM operations are expensive (they trigger layout recalculation, style recomputation, and potentially repainting), and (b) React batches multiple state changes into a single DOM update pass.

#### Fiber Architecture (React 18)

React 18 uses the Fiber reconciliation engine. Each React element becomes a "fiber" node — a JavaScript object in a linked-list tree structure. Each fiber has a reference to its first child, its next sibling, and its parent. This linked-list structure (as opposed to a recursive tree walk) allows React to:

- **Pause** reconciliation work after processing a certain number of fibers.
- **Resume** where it left off later.
- **Prioritize** work — user interactions (clicks, typing) get higher priority than background data fetching or non-visible updates.

This is called "concurrent rendering." In Prmpt, this means the UI stays responsive even during heavy streaming updates (where dozens of optimization chunks arrive per second and each one triggers a state update and re-render). Without concurrent rendering, processing all those updates synchronously could block the main thread and make the UI feel laggy.

#### Hooks

React hooks are functions that let you use state and side effects in function components. Prmpt uses hooks exclusively (no class components):

- **`useState(initialValue)`**: Declares a piece of local state. Returns `[currentValue, setterFunction]`. When the setter is called with a new value, React schedules a re-render of the component.
- **`useEffect(callback, dependencies)`**: Runs the callback function after the component renders, but only when the values in the dependencies array have changed since the last render. Used for side effects like subscribing to IPC events, fetching data, or setting up timers. The callback can return a cleanup function that runs before the next effect or when the component unmounts.
- **`useCallback(fn, dependencies)`**: Returns a memoized version of the callback function that only changes if the dependencies change. Prevents unnecessary re-renders of child components that receive the callback as a prop.
- **`useRef(initialValue)`**: Returns a mutable ref object `{ current: initialValue }` that persists across renders. Unlike state, changing a ref's `.current` value does not trigger a re-render. Used for storing DOM references, timers, or any mutable value that shouldn't cause re-renders.
- **`useContext(Context)`**: Reads the current value from a React Context. Context provides a way to pass data through the component tree without manually passing props down every level.

#### HashRouter vs BrowserRouter

React Router is the routing library used in Prmpt. It provides URL-based navigation within the single-page application.

**BrowserRouter** uses the HTML5 History API (`pushState`, `replaceState`, `popState`) for clean URLs like `/settings` or `/chat/123`. The browser never reloads the page; React Router intercepts navigation and renders the appropriate component. However, if the user refreshes the page at `/settings`, the browser sends a request to the server for `/settings`. A web server would need to be configured to return `index.html` for all routes (since all routes are handled client-side). In Electron, pages are loaded via the `file://` protocol, which does not have a server — there's nothing to handle the `/settings` path.

**HashRouter** uses the URL hash fragment (the part after `#`). URLs look like `file:///path/to/index.html#/settings`. The browser never sends the hash to a server — it's entirely client-side. When the user navigates to `#/settings`, the browser doesn't reload the page; it just fires a `hashchange` event that React Router handles.

Prmpt uses HashRouter because it's running in Electron with `file://` protocol, where BrowserRouter would fail on page refresh or deep links.

### Vite (v5)

#### What Vite Is

Vite (French for "fast") is a build tool for web projects, created by Evan You (also the creator of Vue.js). It replaces tools like Webpack and serves two functions: a lightning-fast development server, and a production bundler.

#### Development Mode

Traditional bundlers like Webpack bundle your entire application into a single file before serving it. For large applications, this can take 30+ seconds on cold start.

Vite takes a radically different approach in development:

1. Vite starts a development server almost instantly (regardless of application size).
2. When the browser loads the page, it encounters `<script type="module" src="/src/main.tsx">`.
3. The browser's native ES module system sends an HTTP request to Vite for `/src/main.tsx`.
4. Vite transforms the file on-the-fly (TypeScript → JavaScript, JSX → React.createElement) using esbuild (which is written in Go and is 10-100x faster than Babel).
5. The transformed module contains `import` statements for its dependencies. The browser requests each dependency separately.
6. Vite serves each module individually. Only modules actually imported by the running code are loaded.

This means startup time is proportional to the modules needed for the current page, not the entire application.

#### Hot Module Replacement (HMR)

When you save a file during development:

1. Vite detects the file change via the file system watcher.
2. It determines which module(s) are affected (the changed file and its importers).
3. It sends a message over a WebSocket to the browser telling it which modules changed.
4. The browser re-imports just the changed modules.
5. React Fast Refresh (the HMR integration for React) updates the affected components in place without losing their state. If you were typing in an input field and saved a file that affects the component, the input field retains its value after the hot update.

No full page reload is needed. The feedback loop from saving a file to seeing the change is typically under 100ms.

#### Production Build

For production, Vite uses Rollup (a mature JavaScript bundler) under the hood:

- **Tree-shaking**: Rollup analyzes the import/export graph and removes code that is never imported. If you import `{ Button }` from a UI library that exports 50 components, only Button's code ends up in the bundle.
- **Code splitting**: Rollup can split the bundle into chunks loaded on demand (though in Prmpt this is disabled — `manualChunks: undefined` — because Electron loads everything locally and there's no network cost).
- **Minification**: esbuild minifies the output (shorter variable names, removed whitespace, dead code elimination).

#### Vite Configuration in Prmpt

The `vite.config.ts` configures several Prmpt-specific settings:

```typescript
base: "./"  // Relative paths — required for Electron's file:// protocol
envDir: ".."  // Read .env from project root (parent of app-ui/)
```

The build configuration uses multi-entry points:

```typescript
rollupOptions: {
  input: {
    main: path.resolve(__dirname, "index.html"),      // App window
    overlay: path.resolve(__dirname, "overlay.html"),  // Overlay window
  },
}
```

This builds two separate HTML entry points from a single Vite project. Both entry points share the same `src/` directory and can import common components, but they have different root components and entry scripts.

Output goes directly to `../electron/renderer/app-ui/` — the directory that Electron loads when creating BrowserWindows.

The `@vitejs/plugin-react-swc` plugin uses SWC (Speedy Web Compiler, written in Rust) instead of Babel for transforming JSX and enabling React Fast Refresh. SWC is approximately 20x faster than Babel, making HMR updates nearly instantaneous.

### TypeScript

#### What TypeScript Is

TypeScript is a strict syntactic superset of JavaScript that adds static type annotations. Every valid JavaScript program is also a valid TypeScript program, but TypeScript adds the ability to declare the types of variables, function parameters, return values, and object shapes.

```typescript
function optimizeStream(
  prompt: string,                    // Must be a string
  onChunk: (chunk: string) => void,  // Must be a function taking string, returning void
  mode: string = "fast"              // String with default value
): Promise<OptimizeResult> {         // Must return a Promise of OptimizeResult
  // ...
}
```

The TypeScript compiler (`tsc`) reads these type annotations and performs static analysis of the entire codebase at compile time. It catches errors like:
- Calling a function with the wrong number or type of arguments.
- Accessing a property that doesn't exist on an object.
- Assigning a value of the wrong type to a variable.
- Using a nullable value without checking for null first (with `strictNullChecks`).

Types are erased at compile time — they don't exist at runtime. TypeScript compiles to plain JavaScript. The type system is purely a development-time aid.

#### Two TypeScript Configurations in Prmpt

The project has two separate TypeScript compilation targets because the code runs in two different JavaScript environments:

**1. Root tsconfig.json — Electron Main Process**

```json
{
  "compilerOptions": {
    "target": "ES2020",           // Output ES2020 JavaScript
    "module": "commonjs",         // Use require()/module.exports (Node.js format)
    "rootDir": "./electron",      // Source files are in electron/
    "outDir": "./dist"            // Compiled JS goes to dist/
  }
}
```

- `target: "ES2020"`: The compiled JavaScript can use ES2020 features (optional chaining, nullish coalescing, BigInt, `Promise.allSettled`). Node.js 18+ (bundled with Electron 28) supports all of these natively.
- `module: "commonjs"`: Node.js traditionally uses CommonJS modules (`require()` to import, `module.exports` to export). The compiled output uses `require()` instead of `import`.
- This configuration compiles `electron/**/*.ts` into `dist/**/*.js`. The main process loads `dist/main/index-new.js` at startup.

**2. app-ui/tsconfig.json — React Application**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",           // Use native ES modules (import/export)
    "jsx": "react-jsx"            // Automatic React import for JSX
  }
}
```

- `module: "ESNext"`: Uses native ES module syntax (`import`/`export`). Vite handles bundling, so modules don't need to be converted to CommonJS.
- `jsx: "react-jsx"`: The "automatic" JSX transform — JSX is compiled to `_jsx()` calls from `react/jsx-runtime` instead of `React.createElement()`. This means you don't need to `import React from 'react'` in every file that uses JSX.
- In practice, Vite/SWC handle the actual compilation of TSX to JS. The TypeScript compiler (`tsc`) is only used for type checking (via `tsc --noEmit`), not for producing output files.

#### Key Compiler Options Explained

- **`strict: true`**: Enables all strict type checking options simultaneously. This includes `noImplicitAny` (error when a type can't be inferred), `strictNullChecks` (null and undefined are not assignable to other types without explicit checking), `strictFunctionTypes` (function parameter types are checked contravariantly), and more. This is the most rigorous type checking mode.
- **`esModuleInterop: true`**: CommonJS modules don't have a `default` export. Without this flag, `import express from 'express'` would fail for CommonJS packages. This flag adds helper functions to make `import x from 'y'` work for CommonJS modules by wrapping their `module.exports` in a synthetic default export.
- **`moduleResolution: "node"`**: Resolves imports by looking in `node_modules` directories and following the same algorithm that Node.js uses (check package.json `main` field, look for index.js, etc.).
- **`skipLibCheck: true`**: Skip type checking of `.d.ts` declaration files (type definition files for third-party libraries). These files are assumed to be correct. This speeds up compilation significantly in projects with many dependencies.
- **`resolveJsonModule: true`**: Allows importing `.json` files as modules. The JSON content is typed — TypeScript infers the shape of the JSON object and provides autocomplete and type checking.

### FastAPI / Python

#### What FastAPI Is

FastAPI is a modern Python web framework for building APIs. It's built on top of two foundational libraries:

- **Starlette**: An ASGI (Asynchronous Server Gateway Interface) framework that provides the web layer — HTTP request/response handling, WebSocket support, middleware, routing.
- **Pydantic**: A data validation library that uses Python type annotations to define data schemas and automatically validates/serializes data.

FastAPI combines these to provide automatic request validation, automatic API documentation, and first-class async/await support.

#### ASGI vs WSGI

**WSGI** (Web Server Gateway Interface) is the traditional Python web standard, used by Flask and Django. WSGI is synchronous — each HTTP request is handled by a single thread, and that thread blocks while waiting for I/O (database queries, API calls, file reads). To handle concurrent requests, you need multiple threads or processes, each consuming memory.

**ASGI** (Asynchronous Server Gateway Interface) is the async successor to WSGI. It supports Python's `async`/`await` syntax. When an async handler awaits an I/O operation, the event loop suspends that handler and processes other requests. A single thread can handle hundreds of concurrent requests by switching between them while waiting for I/O. ASGI also natively supports WebSockets and long-lived connections — features that WSGI cannot handle.

FastAPI uses ASGI, which is critical for Prmpt because:
1. The optimization endpoint streams LLM responses (long-lived WebSocket connections).
2. The transcription endpoint proxies between the client and Deepgram (two simultaneous WebSocket connections per session).
3. Multiple optimization requests can be in-flight simultaneously.

#### Uvicorn

Uvicorn is the ASGI server that runs the FastAPI application. Think of it as the "web server" — it handles TCP connections, parses HTTP, and passes requests to FastAPI. Under the hood:

- **uvloop**: A drop-in replacement for Python's default asyncio event loop, written in Cython (compiled Python). It uses libuv (the same C library that powers Node.js's event loop) and is 2-4x faster than the standard asyncio loop.
- **httptools**: A C-based HTTP parser (based on the same parser used in Node.js). It parses HTTP request headers and bodies significantly faster than a pure Python implementation.

Uvicorn handles the TCP socket, TLS termination (if configured), HTTP parsing, and passes the parsed request to the ASGI application (FastAPI).

#### Middleware Stack

Middleware in FastAPI/Starlette wraps the application like layers of an onion. Each incoming request passes through every middleware layer before reaching the route handler, and each outgoing response passes back through them in reverse order:

```
Request → RequestIDMiddleware → SlowAPIMiddleware → CORSMiddleware → Route Handler
                                                                        ↓
Response ← RequestIDMiddleware ← SlowAPIMiddleware ← CORSMiddleware ← Route Handler
```

In Prmpt's Python service, the middleware stack is:

1. **RequestIDMiddleware**: Reads the `X-Request-ID` header from the request (or generates a UUID if absent). Attaches it to the response headers. Used for tracing a request across the entire system (Electron → Python → LLM API).
2. **SlowAPIMiddleware**: Rate limiting. Uses `slowapi` (a FastAPI-compatible wrapper around `limits`). Default limit: 60 requests per minute per IP, 200 requests per minute application-wide.
3. **CORSMiddleware**: Handles Cross-Origin Resource Sharing headers (explained in the HTTP section below).

#### Pydantic Models

Pydantic models define the shape and constraints of request/response data using Python type annotations:

```python
class OptimizeRequest(BaseModel):
    prompt: str = Field(..., min_length=3, max_length=50_000)
    skip_cache: Optional[bool] = False
    messages: Optional[list[Message]] = Field(None, max_length=100)
    mode: Optional[str] = "fast"
    custom_instructions: Optional[str] = Field("", max_length=10_000)
    user_id: Optional[str] = None
```

When a request arrives at a route that uses this model, FastAPI automatically:
1. Parses the JSON request body.
2. Validates each field against its type and constraints (`prompt` must be 3-50000 chars, `messages` must have at most 100 items).
3. If validation fails, returns a 422 Unprocessable Entity response with detailed error messages explaining exactly which fields failed and why.
4. If validation passes, creates an `OptimizeRequest` instance that the route handler receives as a typed Python object.

#### Dependency Injection

FastAPI's `Depends()` function lets you inject dependencies into route handlers:

```python
@app.post("/optimize", response_model=OptimizeResponse)
async def optimize_prompt(request: OptimizeRequest, auth: dict = Depends(require_auth)):
    user_id = auth.get("sub")
    # ...
```

`Depends(require_auth)` tells FastAPI: "Before running this handler, call `require_auth` first. If it raises an exception (e.g., HTTPException with status 401), don't run the handler — return the error response. If it succeeds, pass its return value as the `auth` parameter." This lets you declare auth requirements declaratively instead of adding auth-checking code to every route.

#### WebSocket Support

FastAPI/Starlette support WebSocket endpoints natively:

```python
@app.websocket("/ws/optimize-stream")
async def optimize_stream(websocket: WebSocket):
    await websocket.accept()  # Complete the WebSocket handshake
    while True:
        data = await websocket.receive_json()  # Wait for a JSON message from client
        # ... process and respond ...
        await websocket.send_json({"type": "chunk", "content": chunk})
```

The `WebSocket` object provides methods for bidirectional communication: `receive_json()`, `receive_text()`, `receive_bytes()` for reading from the client; `send_json()`, `send_text()`, `send_bytes()` for writing to the client; `accept()` to complete the handshake; `close()` to terminate the connection.

### Rust + napi-rs

#### What Rust Is

Rust is a systems programming language focused on three goals: safety, speed, and concurrency. Unlike languages with garbage collectors (JavaScript, Python, Go, Java), Rust manages memory through a system of ownership rules enforced at compile time:

- Every value has exactly one owner.
- When the owner goes out of scope, the value is dropped (its memory is freed).
- You can have either one mutable reference or any number of immutable references to a value, but not both simultaneously.

These rules, checked by the Rust compiler (a.k.a. the "borrow checker"), eliminate entire classes of bugs at compile time: null pointer dereferences, dangling pointers, data races, use-after-free, double-free. If a Rust program compiles, it is memory-safe (in safe Rust code).

Rust compiles to native machine code via LLVM — the same compiler backend used by Clang (C/C++) and Swift. The resulting binaries are as fast as C/C++ with no garbage collection pauses.

#### What N-API Is

N-API (Node-API) is Node.js's stable ABI (Application Binary Interface) for building native addons. A native addon is a compiled binary (a `.node` file, which is really a dynamic library — `.dll` on Windows, `.so` on Linux, `.dylib` on macOS) that Node.js can load using `require()` just like a JavaScript module.

Before N-API, native addons were compiled against specific Node.js headers and broke when the Node.js version changed. N-API provides a stable, version-independent C API — addons compiled against N-API work across Node.js versions without recompilation.

#### What napi-rs Is

napi-rs is a Rust framework that generates N-API bindings. You write Rust functions and annotate them with `#[napi]`:

```rust
#[napi]
pub fn get_active_window_title() -> String {
    // Win32 API calls to get foreground window title
}

#[napi]
pub fn start_hook(callback: ThreadsafeFunction<TriggerAnchor>) {
    // Install WH_KEYBOARD_LL hook, call callback when @prompt detected
}
```

napi-rs generates the N-API glue code that makes these functions callable from JavaScript. The result is a `.node` binary file that exports these functions.

#### How Compilation Works

1. `cargo build --release` compiles the Rust code. Cargo is Rust's package manager and build system (analogous to npm for Node.js). The `--release` flag enables LLVM optimizations (inlining, loop unrolling, dead code elimination) that make the binary significantly faster.
2. `napi build --platform` invokes Cargo and post-processes the output into a platform-specific `.node` file. The file is named with platform identifiers: e.g., `platform-core.win32-x64-msvc.node`.
3. An `index.js` file in the native module's directory detects the current platform and `require()`s the appropriate `.node` binary.

#### ThreadsafeFunction

This is the critical bridge between Rust and Node.js:

- Rust code runs on its own OS threads. The keyboard hook, for example, runs on a dedicated thread that processes Windows messages.
- Node.js is single-threaded — all JavaScript execution happens on the main event loop thread. V8 (the JavaScript engine) is not thread-safe — calling JavaScript functions from a non-V8 thread causes undefined behavior (usually a crash).
- `ThreadsafeFunction` is an N-API mechanism that lets any thread safely schedule a callback to be executed on Node.js's event loop thread.

When the Rust keyboard hook thread detects that the user has typed "@prompt":
1. The hook thread calls `ThreadsafeFunction.call(anchor_data, ThreadsafeFunctionCallMode::NonBlocking)`.
2. N-API queues the call on Node.js's event loop (using `uv_async_send` under the hood — libuv's mechanism for cross-thread signaling).
3. On the next iteration of the event loop, Node.js executes the JavaScript callback with the anchor data.
4. The callback in `index-new.ts` receives the trigger and opens the overlay.

Without ThreadsafeFunction, there would be no safe way for the Rust hook thread to notify the JavaScript code.

#### In This App

The Rust crate lives in `native/platform-core/`. It compiles to a `.node` binary. The `native-bridge.ts` module in Electron's main process loads it via `require()` and exposes typed wrapper functions:

- `startHook(callback)`: Install the global keyboard hook.
- `stopHook()`: Remove the keyboard hook.
- `replaceAtLastAnchor(text)`: Focus the original window and replace the @prompt text with the optimized text.
- `forceFocusWindow(hwnd)`: Force-focus a native window by HWND.
- `getActiveWindowTitle()`: Get the title of the currently focused window.

If the `.node` binary is missing (e.g., on a dev machine without the Rust toolchain installed), the module falls back to stub implementations that log warnings. The app still works — you just can't use the @prompt trigger or text replacement.

### Supabase

#### What Supabase Is

Supabase is an open-source Firebase alternative that provides a suite of backend services:

1. **PostgreSQL Database**: A fully managed PostgreSQL instance. Supabase doesn't abstract away the database — you get direct access to PostgreSQL with all its features (schemas, views, functions, triggers, extensions, full-text search). The database is the source of truth for all user data.

2. **GoTrue Authentication**: A Go-based authentication service that handles email/password sign-up/sign-in, OAuth providers (Google, GitHub), magic links, phone auth, and session management. It issues JWTs (JSON Web Tokens) that are used to authenticate all subsequent requests.

3. **PostgREST API**: An auto-generated REST API that mirrors your database schema. Every table, view, and function gets a REST endpoint automatically. You can query, insert, update, and delete data via HTTP requests. PostgREST respects Row Level Security policies, so the API is safe to call directly from client code.

4. **Realtime**: Built on PostgreSQL's LISTEN/NOTIFY mechanism. When data changes in the database, Supabase can push those changes to connected clients in real-time via WebSocket.

5. **Storage**: S3-compatible object storage for files (images, PDFs, etc.). Integrated with auth and security policies.

6. **Edge Functions**: Deno-based serverless functions that run at the edge (close to users). Used for custom server-side logic.

#### How the JavaScript Client Works

The `@supabase/supabase-js` client is initialized with two values:

```typescript
SupabaseClientManager.initialize(SUPABASE_URL, SUPABASE_ANON_KEY);
```

- **SUPABASE_URL**: The URL of the Supabase project (e.g., `https://xyz.supabase.co`).
- **SUPABASE_ANON_KEY**: The "anonymous" API key. Despite its name, this is safe to expose in client-side code. It is not a secret. It simply identifies which Supabase project to connect to. Security comes from Row Level Security policies, not from keeping this key secret.

The client provides methods like:
- `supabase.auth.signUp()`, `supabase.auth.signInWithPassword()`
- `supabase.from('chats').select('*').eq('user_id', userId)`
- `supabase.from('messages').insert({ chat_id, content, role })`

#### Row Level Security (RLS)

RLS is a PostgreSQL feature where you define security policies on tables. These policies are SQL expressions that are automatically appended to every query as WHERE clauses. They are enforced at the database level — even if someone bypasses the API and connects directly to the database, the policies still apply.

Example policy: "Users can only see their own chats":

```sql
CREATE POLICY "Users can only read their own chats"
ON chats FOR SELECT
USING (user_id = auth.uid());
```

`auth.uid()` is a PostgreSQL function that extracts the user ID from the JWT attached to the current request. Supabase's PostgREST layer automatically passes the JWT to PostgreSQL, which makes `auth.uid()` available in policy expressions.

With this policy, even if a malicious user crafts a direct API call to `supabase.from('chats').select('*')`, PostgreSQL automatically filters the results to only return rows where `user_id` matches the authenticated user's ID. There is no way to bypass this from the client side.

#### JWT Flow

1. User signs in (email/password, OAuth, etc.).
2. GoTrue verifies credentials and issues a JWT: `{ sub: "user-uuid", role: "authenticated", aud: "authenticated", exp: 1700000000, ... }`.
3. The JWT is signed with a secret (HMAC-SHA256). Only the server can produce a valid signature.
4. The client stores the JWT and includes it in the `Authorization: Bearer <jwt>` header on every subsequent request.
5. PostgREST (or the Python service) verifies the JWT's signature and extracts claims like `sub` (the user ID).
6. In PostgreSQL, `auth.uid()` returns the `sub` claim. RLS policies use this to filter data.
7. JWTs expire. Supabase's client library automatically refreshes them using a refresh token before expiry. When a token is refreshed, the Electron main process reconnects the Python WebSocket with the new token.

### Tailwind CSS

#### What Tailwind Is

Tailwind CSS is a utility-first CSS framework. Instead of writing custom CSS classes with semantic names (`.chat-message { padding: 1rem; border-radius: 0.5rem; }`), you compose styles from pre-defined utility classes directly in your HTML/JSX:

```tsx
<div className="p-4 rounded-lg bg-muted text-foreground">
```

Each class maps to a single CSS property: `p-4` → `padding: 1rem`, `rounded-lg` → `border-radius: 0.5rem`, `bg-muted` → `background-color: var(--muted)`.

#### How It Works Under the Hood

Tailwind's JIT (Just-In-Time) compiler scans your source files for class name strings using regex patterns. For every class name it finds (e.g., `p-4`, `bg-primary`, `hover:bg-primary/80`), it generates the corresponding CSS rule and includes it in the output stylesheet. Class names that don't appear in any source file are not generated.

This means:
- Zero unused CSS in production (no dead code).
- Arbitrary values work (`w-[327px]` generates `width: 327px`).
- The compiler only generates CSS for what's actually used, keeping the stylesheet small.
- In development, the compiler watches for file changes and regenerates CSS instantly.

#### Design Tokens and Theming

Prmpt uses CSS custom properties (CSS variables) for theming. The `tailwind.config.ts` maps semantic color names to CSS variable references:

```typescript
colors: {
  background: "hsl(var(--background))",
  foreground: "hsl(var(--foreground))",
  primary: "hsl(var(--primary))",
  muted: "hsl(var(--muted))",
  // ...
}
```

The actual HSL values for these variables are defined in `index.css` for both light and dark themes:

```css
:root {
  --background: 222 47% 6%;  /* Dark theme */
  --foreground: 210 40% 98%;
  --primary: 217 91% 60%;
}
```

Switching between light and dark themes just swaps which set of CSS variable values is active. All components automatically update because they reference the variables, not hardcoded colors.

#### The `cn()` Utility

From `lib/utils.ts`, the `cn()` function combines two utilities:

1. **clsx**: Conditional class merging. `clsx("base", isActive && "active", isPrimary && "primary")` produces `"base active"` when `isActive` is true and `isPrimary` is false. It filters out falsy values.

2. **tailwind-merge**: Deduplicates conflicting Tailwind classes. If you have `cn("px-4 py-2", className)` and `className` is `"px-6"`, tailwind-merge recognizes that `px-6` conflicts with `px-4` (both set `padding-left` and `padding-right`) and removes `px-4`, producing `"py-2 px-6"`. Without tailwind-merge, both `px-4` and `px-6` would be in the class list and CSS specificity would determine which wins (usually the last one defined in the stylesheet, which is unpredictable).

#### shadcn/ui Pattern

shadcn/ui is not a component library that you `npm install`. It is a collection of copy-paste component templates. You use the CLI to add components to your project, and they are copied into your codebase (in Prmpt, they live in `app-ui/src/components/ui/`). You own the code and can customize it.

Each component is built with two layers:

1. **Radix UI Primitives**: Headless (unstyled), accessible, behavioral components. Radix provides the logic — keyboard navigation, focus management, ARIA attributes, screen reader support, portal rendering, collision-aware positioning. For example, Radix's Dialog component handles focus trapping, Escape to close, clicking outside to close, and proper ARIA roles — without any CSS.

2. **Tailwind classes**: The visual styling. Radix provides the behavior, Tailwind provides the look.

This separation means you get production-grade accessibility for free (Radix handles all the complex ARIA/keyboard/focus logic) while maintaining full control over the visual design (just edit the Tailwind classes).

### WebSockets

#### What WebSockets Are

WebSockets provide full-duplex, persistent communication between a client and server over a single TCP connection. Unlike HTTP (which is request/response — the client sends a request, the server sends a response, and the conversation is over), a WebSocket connection stays open indefinitely. Either side can send messages at any time, in any order, without the overhead of establishing new connections.

#### How the Handshake Works

A WebSocket connection starts as a regular HTTP request that gets "upgraded":

1. **Client sends an HTTP GET request** with special headers:
   ```
   GET /ws/optimize-stream HTTP/1.1
   Host: 127.0.0.1:8001
   Upgrade: websocket
   Connection: Upgrade
   Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
   Sec-WebSocket-Version: 13
   ```

2. **Server responds with 101 Switching Protocols**:
   ```
   HTTP/1.1 101 Switching Protocols
   Upgrade: websocket
   Connection: Upgrade
   Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
   ```

   The `Sec-WebSocket-Accept` value is computed by concatenating the client's `Sec-WebSocket-Key` with a magic GUID (`258EAFA5-E914-47DA-95CA-C5AB0DC85B11`), computing the SHA-1 hash, and base64-encoding it. This proves the server understands the WebSocket protocol.

3. **After the handshake**, the TCP connection is upgraded from HTTP to WebSocket. Both sides can now send frames (binary or text) at any time.

#### Frame Format

WebSocket data is transmitted in frames. Each frame has:
- An **opcode** indicating the frame type: text (0x1), binary (0x2), close (0x8), ping (0x9), pong (0xA).
- A **payload length** (7 bits, 16 bits, or 64 bits depending on size).
- An optional **mask** (4-byte XOR key — client-to-server frames must be masked per the spec, server-to-client frames must not be).
- The **payload data**.

#### Why Prmpt Uses WebSockets

The optimization endpoint streams LLM tokens as they're generated. Without streaming, the user would send a prompt and wait 5-30 seconds for the entire optimized text to appear at once. With streaming, each token appears in real-time (typically 20-50ms between tokens), giving immediate feedback.

HTTP request/response couldn't handle this (the response body would need to be fully generated before sending). Server-Sent Events (SSE) could work for the streaming direction (server to client) but are unidirectional — the client couldn't send abort signals or new requests on the same connection. WebSockets provide bidirectional communication — the client can send multiple optimization requests, receive streaming responses, and send abort signals, all on the same persistent connection.

#### WebSocket Connections in Prmpt

Two distinct WebSocket endpoints are used:

1. **`/ws/optimize-stream`**: A persistent connection for streaming prompt optimizations. The PythonClient in the main process maintains a single WebSocket to this endpoint. It sends JSON optimization requests (with a unique `request_id`) and receives streaming chunks and completion signals. Multiple requests can be multiplexed on the same connection via request IDs.

2. **`/ws/transcribe-stream`**: A per-session connection for streaming audio transcription. Each recording session (when the user presses the mic button) opens a new WebSocket. The client sends binary audio frames (raw Int16 PCM), and the server returns JSON transcription results. The Python server proxies these audio frames to Deepgram's streaming STT API and relays results back to the client.

### HTTP (Hypertext Transfer Protocol)

#### TCP Layer

Before any HTTP communication, a TCP (Transmission Control Protocol) connection is established between the client and server. TCP provides reliable, ordered delivery of bytes:

1. **Three-way handshake**: The client sends a SYN (synchronize) packet. The server responds with SYN-ACK (synchronize-acknowledge). The client sends ACK (acknowledge). This three-step process establishes a reliable connection and synchronizes sequence numbers.

2. **Byte stream**: After the handshake, TCP provides a bidirectional byte stream. Data is split into segments, each with a sequence number. The receiver acknowledges received segments. Lost segments are automatically retransmitted. Segments are reassembled in order. The application sees a smooth, reliable byte stream.

3. **Flow control**: TCP uses a sliding window mechanism to prevent the sender from overwhelming the receiver. The receiver advertises how many bytes it can accept (the receive window). The sender limits its transmission to this window size.

#### TLS (HTTPS)

For encrypted communication (HTTPS, WSS), a TLS (Transport Layer Security) handshake occurs after the TCP connection is established:

1. **Client Hello**: The client sends a list of supported cipher suites and its TLS version.
2. **Server Hello**: The server chooses a cipher suite and sends its digital certificate (which contains its public key, identity, and is signed by a Certificate Authority).
3. **Certificate Verification**: The client verifies the certificate by checking the signature chain up to a trusted root Certificate Authority (CA). If the chain is valid, the client trusts the server's identity.
4. **Key Exchange**: Using Diffie-Hellman or Elliptic Curve Diffie-Hellman, the client and server agree on a shared secret without ever transmitting it. This shared secret is used to derive symmetric encryption keys.
5. **Encrypted Communication**: All subsequent data is encrypted with a symmetric cipher (e.g., AES-256-GCM) using the derived keys. Symmetric encryption is fast — the overhead is minimal.

In Prmpt, the Python service runs on localhost (127.0.0.1:8001) without TLS — encrypted communication isn't needed for local loopback. The Supabase API uses HTTPS.

#### HTTP Request and Response

An HTTP request consists of:
- **Method**: GET (read), POST (create/action), PUT (update), DELETE (remove).
- **Path**: `/optimize`, `/health`, `/generate-title`.
- **Headers**: Key-value pairs. `Content-Type: application/json`, `Authorization: Bearer <jwt>`, `X-Request-ID: <uuid>`.
- **Body**: The data payload. For POST requests, typically JSON. The body is optional for GET and DELETE.

An HTTP response consists of:
- **Status Code**: A three-digit code indicating the result.
  - 200 OK: Request succeeded.
  - 400 Bad Request: The client's request is malformed.
  - 401 Unauthorized: Authentication is required or has failed.
  - 404 Not Found: The requested resource doesn't exist.
  - 422 Unprocessable Entity: The request body failed validation.
  - 429 Too Many Requests: Rate limit exceeded.
  - 500 Internal Server Error: Something broke on the server.
- **Headers**: Response metadata. `Content-Type`, `X-Request-ID`, CORS headers.
- **Body**: The response data. Typically JSON for API responses.

#### CORS (Cross-Origin Resource Sharing)

Browsers enforce the Same-Origin Policy: JavaScript running on one origin (protocol + domain + port) cannot make HTTP requests to a different origin. This prevents a malicious website from making requests to your bank's API using your cookies.

CORS is the mechanism to relax this restriction. When the browser detects a cross-origin request:

1. For "simple" requests (GET with no custom headers), the browser sends the request and checks the `Access-Control-Allow-Origin` header in the response.
2. For "preflighted" requests (POST with JSON body, custom headers), the browser first sends an OPTIONS request (a "preflight") asking the server: "Would you accept a POST from this origin with these headers?" The server responds with `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`. If the response allows the origin, the browser proceeds with the actual request.

In Prmpt's Python service, CORS is configured to allow localhost origins:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1", "http://localhost"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)
```

This allows the Electron renderer (which loads pages from `file://` but makes API calls to `http://127.0.0.1:8001`) to communicate with the Python service.

#### REST Conventions

Prmpt's Python API follows REST conventions for most endpoints:
- `GET /health` — check service health (read).
- `POST /optimize` — create an optimization (action).
- `POST /generate-title` — generate a title (action).
- `POST /extract-memory-facts` — extract memory facts (action).
- `POST /transcribe-audio` — transcribe audio (action).
- WebSocket endpoints (`/ws/optimize-stream`, `/ws/transcribe-stream`) are used for streaming — these go beyond REST's request/response model.

### How Microphones Work

#### Physics of Sound

Sound is a longitudinal pressure wave traveling through air. When you speak, your vocal cords vibrate, alternately compressing and rarefying the air molecules around them. These pressure variations propagate outward at approximately 343 meters per second (at room temperature). The frequency of vibration determines the pitch (human speech ranges from about 85 Hz to 8000 Hz), and the amplitude determines the volume.

#### Transduction

A microphone converts these mechanical pressure variations into electrical voltage variations — a process called transduction.

Most laptop and headset microphones are **condenser** (capacitor) microphones. They consist of a thin diaphragm placed very close to a fixed backplate, forming a capacitor. When sound pressure hits the diaphragm, it vibrates, changing the distance between the diaphragm and backplate. This changes the capacitance, which modulates the electrical signal proportionally to the sound pressure. The result is a continuously varying electrical voltage that mirrors the original sound wave.

#### ADC (Analog-to-Digital Conversion)

The continuous electrical signal from the microphone is analog — it varies smoothly and continuously. Computers work with discrete digital numbers. An Analog-to-Digital Converter (ADC) converts the analog signal to digital by:

1. **Sampling**: Measuring the voltage at regular intervals. The number of measurements per second is the **sample rate**. Common sample rates are 44,100 Hz (CD quality) and 48,000 Hz (professional audio). The Nyquist theorem states that to accurately capture a frequency, you need to sample at least twice that frequency. Human hearing goes up to about 20,000 Hz, so 44,100 Hz captures the full audible range.

2. **Quantization**: Converting each voltage measurement to a discrete number. The number of possible values is determined by the **bit depth**. 16-bit audio has 65,536 possible values (2^16), ranging from -32,768 to 32,767. Each sample is stored as a signed integer in this range. This is called **PCM** (Pulse Code Modulation) encoding.

The result is a stream of numbers — 44,100 (or 48,000) integers per second, each between -32,768 and 32,767 — that digitally represent the sound wave.

#### Browser Capture (getUserMedia)

The Web API `navigator.mediaDevices.getUserMedia({ audio: true })` requests microphone access from the user (the browser shows a permission dialog). If granted, it returns a `MediaStream` — a stream of audio data from the microphone.

Options like `echoCancellation`, `noiseSuppression`, and `autoGainControl` are DSP (Digital Signal Processing) filters applied by the browser/OS audio pipeline before the audio reaches your JavaScript code:
- **echoCancellation**: Removes the echo of the computer's speakers from the microphone input (prevents feedback loops in video calls).
- **noiseSuppression**: Reduces background noise (keyboard clicks, fan noise, ambient sounds).
- **autoGainControl**: Normalizes the volume — boosts quiet signals, attenuates loud signals.

#### AudioContext and ScriptProcessorNode

The Web Audio API's `AudioContext` manages an audio processing graph. In Prmpt's preload script:

1. `audioContext.createMediaStreamSource(stream)` — creates a source node from the microphone MediaStream.
2. `audioContext.createScriptProcessor(4096, 1, 1)` — creates a ScriptProcessorNode with a buffer size of 4096 samples, 1 input channel, 1 output channel. Every time the buffer fills (approximately every 4096/sampleRate seconds, about 85ms at 48kHz), the `onaudioprocess` callback fires with the audio data.
3. `audioContext.createGain()` with `gain.value = 0` — a GainNode that multiplies the audio by 0, effectively muting it. This prevents the captured microphone audio from playing through the speakers (which would cause feedback).

The nodes are connected in a chain: `source → processor → muteGain → audioContext.destination`. Audio flows through the processor (where we capture it), through the mute gain (silencing it), and to the audio output (where it's inaudible).

#### Float32 to Int16 Conversion

The Web Audio API provides audio samples as `Float32Array` values normalized between -1.0 and 1.0. The Python service (and Deepgram's API) expects **Int16 PCM** — integer values from -32,768 to 32,767.

The conversion in the preload:

```typescript
const s = Math.max(-1, Math.min(1, channelData[i]));  // Clamp to [-1, 1]
int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;          // Scale to Int16 range
```

- `0x8000` = 32,768 (for negative values, which range from -32,768 to 0).
- `0x7FFF` = 32,767 (for positive values, which range from 0 to 32,767).
- The asymmetry (32,768 vs 32,767) is because two's complement signed integers have one more negative value than positive.

The converted `Int16Array` is wrapped in a `Buffer` and sent via IPC to the main process.

#### The Full Audio Pipeline in Prmpt

1. Preload captures mic audio via `getUserMedia`.
2. ScriptProcessorNode provides Float32 samples every ~85ms.
3. Preload converts Float32 to Int16 PCM.
4. Preload sends `Buffer.from(int16.buffer)` via IPC `transcription:audio-chunk` to the main process.
5. Main process receives the buffer and forwards it to `TranscriptionClient.sendAudioChunk()`.
6. TranscriptionClient sends the raw bytes as binary WebSocket frames to the Python service.
7. Python service's `/ws/transcribe-stream` endpoint proxies the bytes to Deepgram's streaming API.
8. Deepgram processes the audio and returns JSON transcription results.
9. Python relays the results back to the client WebSocket.
10. Main process receives the transcription JSON and forwards it via IPC to both the overlay and app window renderers.
11. Preload dispatches the transcription data to registered listener callbacks.
12. React components update the input field with the transcribed text.

### LLM APIs

#### What Tokens Are

Large Language Models (LLMs) don't process text character by character or word by word. They split text into **tokens** — subword units determined by the model's tokenizer. Tokenization uses algorithms like Byte-Pair Encoding (BPE) that create a vocabulary of common character sequences.

For example, the word "tokenization" might be split into `["token", "ization"]` — two tokens. Common words like "the" are a single token. Unusual words or technical terms may be split into many tokens. A rough estimate is that 1 token ≈ 4 characters or ≈ 0.75 English words.

Models have **context windows** measured in tokens — the maximum number of tokens they can process in a single request (input + output combined). GPT-4o-mini has a 128K token context window, meaning it can process approximately 96,000 words in a single conversation.

#### How Streaming Works

Without streaming, you send a prompt to the LLM API and wait for the entire response to be generated. Depending on the response length, this could take 5-30 seconds of silence before the full text appears.

With streaming enabled, the API returns tokens as they're generated, one at a time (or in small groups). Each response event contains a `delta` — typically 1-3 tokens of new text. The client receives these delta chunks in real-time and assembles the full response progressively.

In Prmpt:
1. The Python service calls `pipeline_optimize()` with `stream=True`, which returns a generator.
2. Each chunk from the generator is put into an asyncio Queue.
3. An async loop reads from the queue and sends each chunk via WebSocket: `{"type": "chunk", "content": "Write", "accumulated": "Write"}`, then `{"type": "chunk", "content": " comprehensive", "accumulated": "Write comprehensive"}`, etc.
4. The Electron main process receives each chunk and forwards it to the renderer via IPC.
5. React updates the UI with each new chunk, showing the text appearing word by word.

#### Temperature

Temperature is a parameter (typically 0.0-2.0) that controls the randomness of the model's output. Technically, it scales the logits (raw output scores) before the softmax function:

- **Temperature 0**: The model always picks the token with the highest probability. Output is deterministic — the same input always produces the same output.
- **Temperature 0.7**: Moderate randomness. The model usually picks high-probability tokens but occasionally selects less likely ones, producing varied but coherent output.
- **Temperature 1.0**: The model samples according to its learned probability distribution. More creative and varied.
- **Temperature > 1.0**: Output becomes increasingly random and may lose coherence.

In Prmpt:
- Normal optimization uses temperature 0.7 — producing good, varied prompts.
- Regeneration (when the user wants a different version) uses temperature 0.95 — producing distinctly different output from the same input.

#### LiteLLM

LiteLLM is a Python library that provides a unified `litellm.completion()` API for 100+ LLM providers. Instead of writing separate code for OpenAI's API format, Anthropic's format, Google's format, etc., you call:

```python
litellm.completion(
    model="openrouter/anthropic/claude-haiku-4.5",
    messages=[{"role": "user", "content": "Hello"}],
    max_tokens=100,
)
```

LiteLLM examines the model name, determines the provider (in this case, OpenRouter for an Anthropic model), formats the request in the provider's expected format, and returns a standardized response object. This lets Prmpt switch models by just changing an environment variable — no code changes needed.

#### OpenRouter

OpenRouter is a unified LLM gateway. Instead of managing separate API keys and rate limits for OpenAI, Anthropic, Google, Meta, and other providers, you get a single OpenRouter API key that accesses all of them. Benefits:

- Single billing account for all providers.
- Automatic fallback to alternative providers if one is down.
- Model names are prefixed with the provider: `openrouter/openai/gpt-4o-mini`, `openrouter/anthropic/claude-haiku-4.5`.

LiteLLM handles the OpenRouter integration — it recognizes the `openrouter/` prefix and routes requests through OpenRouter's API.

#### Vision Models

Some LLMs can process images alongside text (multimodal input). When a user attaches an image to a prompt, the app needs to:

1. Check if the configured model supports vision (via a hardcoded list of vision-capable model names).
2. Convert the image to a base64-encoded data URL: `data:image/png;base64,iVBORw0KGgo...`.
3. Send the image as part of the message content (using the content array format that multimodal models expect).

If the model doesn't support vision, the image attachment is mentioned in text but the actual image data is not sent.

---

## Chapter 3: Architecture — The Six Subsystems

Prmpt is composed of six distinct subsystems that communicate via well-defined interfaces. Understanding these subsystems and their boundaries is essential to navigating the codebase.

### Subsystem 1: Rust Native Module (`native/platform-core/`)

There is **one** Rust native crate in the project — `native/platform-core/`. It compiles to **two** `.node` binaries, both checked into the repo:

- `platform-core.win32-x64-msvc.node` — Windows x64
- `platform-core.darwin-arm64.node` — macOS Apple Silicon

A loader at `native/platform-core/index.js` selects the right binary at runtime based on `process.platform + process.arch`. `electron/main/utils/native-bridge.ts` lazy-`require()`s through this loader and provides stub fallbacks when neither binary is available.

**Responsibilities (identical JS surface on both platforms, platform-dispatched internally via `#[cfg(target_os = …)]`):**
- **Global Keyboard Hook**: Intercepts all keystrokes across the entire operating system. Windows: `SetWindowsHookExW(WH_KEYBOARD_LL, …)` on a dedicated message-pump thread. macOS: `CGEventTapCreate(kCGSessionEventTap, listenOnly)` attached to `CFRunLoopGetMain` (requires Accessibility permission).
- **`@prompt` Detection**: Maintains a 64-character ring buffer in shared Rust code. Both platform backends call the same `on_char_keydown(char)` after translating the native key event.
- **Anchor Storage**: When `@prompt` is detected, captures the focused-window anchor — HWND on Windows (`GetForegroundWindow`), PID on macOS (`NSWorkspace.frontmostApplication`). The JS layer treats it as an opaque integer.
- **JavaScript Callback**: `napi-rs` `ThreadsafeFunction` delivers anchor data to the Node.js event loop.
- **Text Replacement**: `replaceAtLastAnchor(text)`. Windows: `SetForegroundWindow` → `Shift+Left × N` selection → `KEYEVENTF_UNICODE` injection. macOS: save pasteboard → `CGEventPost` Backspace × N → set pasteboard to `text` → post `Cmd+V` → ~30 ms sleep → restore pasteboard (the "clipboard swap").
- **Direct Paste**: `pasteTextToWindow(target, text)` — targets HWND on Windows, PID on macOS; used as fallback when the anchor has been consumed.
- **Chat Enter**: `sendEnterToWindow(target)` — auto-submit in chat apps (Slack, Discord, Teams, ChatGPT web). `VK_RETURN` on Windows, `kVK_Return` via `CGEventPost` on macOS.
- **Window Focus**: `forceFocusWindow(target)` — bypasses platform foreground-stealing protection. Windows: `AttachThreadInput` + `AllowSetForegroundWindow`. macOS: `osascript tell application process "X" to activate`.
- **Active Window Title**: `getActiveWindowTitle()` — `GetWindowTextW` on Windows, `osascript`-against-System-Events fallback on macOS.
- **Accessibility Check**: `checkAccessibilityPermission()` — returns `true` on Windows (no-op), wraps `AXIsProcessTrustedWithOptions` on macOS.

**Communication**: The module communicates with JavaScript exclusively through the N-API interface. It exports functions that JavaScript can call, and uses `ThreadsafeFunction` to call JavaScript callbacks from Rust threads.

> The crate was renamed from `windows-core` to `platform-core` once the macOS backend landed and the directory was no longer Windows-only. Active-window *polling* is a separate concern implemented in `electron/main/services/active-window-detector.ts` using the **`active-win` npm package** (not a custom Rust crate), wrapped with Sentry `captureException` on load failure.

### Subsystem 2: Electron Main Process (`electron/main/`)

The main process is the orchestrator — the brain of the application. It's a long-running Node.js process that coordinates all other subsystems.

**Responsibilities:**
- **Window Management**: Creates, shows, hides, and destroys BrowserWindows (App Window and Overlay). Manages the system tray.
- **IPC Hub**: Routes messages between renderer processes (App Window, Overlay) and backend services (Python, Supabase). Every user action in the UI ultimately becomes an IPC message handled here.
- **API Clients**: Maintains connections to the Python AI service (PythonClient for WebSocket optimization streaming, Axios for HTTP endpoints) and to Supabase (via the JS client library).
- **Database Services**: Service classes that encapsulate Supabase operations for each domain (auth, chats, messages, settings, prompt library, memory, etc.).
- **Auth State**: Maintains the global authentication state (user ID, email, JWT) and syncs it across all windows and API clients.
- **Native Bridge**: Loads and communicates with the Rust native module for keyboard hook and text replacement.
- **Network Monitoring**: Polls connectivity, detects online/offline transitions, triggers reconnection and offline queue draining.
- **Global Hotkey**: Registers `CommandOrControl+5` (`Ctrl+5` on Windows, `Cmd+5` on macOS) as a system-wide shortcut for toggling the overlay.
- **Deep Link Handling**: Handles `prmpt://` protocol URLs for shared collection/prompt links.
- **Error Tracking**: Initializes Sentry for error reporting with PII scrubbing.

**Key file**: `electron/main/index-new.ts` — the entry point that wires everything together.

### Subsystem 3: App Window Renderer (`app-ui/src/`)

The App Window is a full React single-page application loaded in a BrowserWindow. It's the primary user interface.

**Responsibilities:**
- Rendering the full ChatGPT-like interface: sidebar with chat list, main chat area with message history, input section, settings page, prompt library, profile management.
- Managing UI state: current chat, messages, streaming state, file attachments, selected mode.
- Displaying streaming optimization chunks in real-time.
- Providing navigation between pages (chat, settings, prompt library, shared content).

**Communication**: The App Window communicates with the main process exclusively through `window.electronAPI` — the IPC bridge exposed by the preload script. It has no direct access to Node.js, the file system, or the network. All data persistence, API calls, and system operations are delegated to the main process via IPC.

**Entry point**: `app-ui/src/main.tsx` → renders `<App />` into the `#root` DOM element in `index.html`.

### Subsystem 4: Overlay Renderer (`app-ui/src/overlay/`)

The Overlay is a separate React application loaded in a transparent, frameless, always-on-top BrowserWindow. It shares the same Vite project and component library as the App Window but has its own entry point.

**Responsibilities:**
- Rendering a compact optimization UI (input field, output area, action buttons).
- Handling streaming optimization display.
- Supporting voice input (microphone capture).
- Providing quick-save to prompt library and copy-to-clipboard.
- Supporting the "Insert" action that replaces @prompt text in the original application.

**Communication**: Uses the same `window.electronAPI` preload bridge as the App Window. The overlay-specific API methods are under `window.electronAPI.overlay.*`.

**Entry point**: `app-ui/src/overlay/main.tsx` → renders the Overlay component into `overlay.html`.

### Subsystem 5: Python AI Service (`python-service/`)

A standalone FastAPI server running on `localhost:8001`. It handles all AI/ML workloads.

**Responsibilities:**
- **Prompt Optimization**: The core feature. Takes a rough prompt, applies a specialized optimization pipeline (detect prompt type → select strategy → call LLM → clean output), and returns the optimized text. Available as both HTTP POST (`/optimize`) and streaming WebSocket (`/ws/optimize-stream`).
- **Streaming Transcription**: Proxies audio from the Electron client to Deepgram's streaming speech-to-text API and relays results back. Endpoint: `/ws/transcribe-stream`.
- **Local Transcription**: Processes uploaded audio files using faster-whisper (a local Whisper implementation with int8 quantization). Includes resampling, VAD (Voice Activity Detection), and quality checks. Endpoint: `POST /transcribe-audio`.
- **Title Generation**: Generates short chat titles (3-5 words) from the first user message. Endpoint: `POST /generate-title`.
- **Memory Extraction**: Extracts factual observations about the user from their prompts using an LLM. Endpoint: `POST /extract-memory-facts`.
- **Rate Limiting**: Server-side daily request limit per user (configurable, default 50/day).

**Communication**: The Python service communicates with the Electron main process via HTTP (Axios) and WebSocket (`ws` library). Authentication is via JWT — the Electron client includes the Supabase JWT in requests, and the Python service verifies it.

### Subsystem 6: Code Intelligence Service (`code-intelligence-service/`)

A second, independent FastAPI server running on `localhost:8002`. Added for the Spaces feature — it indexes user projects, embeds code chunks, and answers hybrid-retrieval queries. Chapter 16 describes this subsystem in full detail; the summary here is just to place it on the subsystem map.

**Responsibilities:**
- **Project registry**: `projects` / `project_branches` rows in Supabase keyed by `user_id`.
- **Ingest**: accepts Tree-sitter-produced skeletons (which are parsed inside Electron — source code never leaves the device raw), summarizes each chunk with a cheap LLM, embeds the summary with `text-embedding-3-small` (`dimensions=512`), and upserts into the `code_chunks` table with a pgvector `vector(512)` HNSW index.
- **Retrieve**: four-strategy hybrid pipeline (vector ANN, full-text, concept, file-path) fused via Reciprocal Rank Fusion, then expanded with the call graph from `code_relationships`.
- **Background workers**: ARQ + Redis for durable indexing jobs (falls back to FastAPI `BackgroundTasks` when no Redis is configured).
- **GitHub sync**: webhook-driven and polling-driven diverged-chunk flagging.
- **Own Sentry project**: initialized with `FastApiIntegration` + `LoggingIntegration`.

**Communication**: The Code Intelligence service communicates with the Electron main process via HTTP (axios through `CodeIntelClient`). Authentication is via the same Supabase JWT. Electron-side calls are wrapped in Sentry spans (`code-intel.ingest`, `code-intel.retrieve`, `code-intel.health`).

**Why a separate process from Python optimization?** Different workloads (stateful indexer vs stateless optimizer), different failure domains (a crash in the indexer must not take down optimization), different deployment targets (Code Intelligence is always local because it touches the user's filesystem and holds a Supabase pool for their projects), different model usage (direct OpenAI embeddings here vs LiteLLM/OpenRouter routing in the optimizer).

### Data Flow: @prompt Trigger

The most complex data flow in the application. Here's every step, from the user typing "@prompt" to the optimized text appearing in the original application:

1. **User types "@prompt"** in any application (VS Code, Notepad, browser, etc.).
2. **Rust keyboard hook** intercepts each keystroke — `WH_KEYBOARD_LL` on Windows, `CGEventTap` on macOS. It maintains a 64-character ring buffer; `ends_with("@prompt")` becomes true as the user types the last `t`.
3. **Rust captures anchor data**: `{ hwnd: <focused window anchor>, triggerLen: 7 }`. `hwnd` is a real HWND on Windows and a PID on macOS — the JS layer treats it as opaque.
4. **Rust calls ThreadsafeFunction**: The anchor data is marshaled and queued on Node.js's event loop via `uv_async_send`.
5. **Node.js callback fires** in `index-new.ts`: `startHook((anchor) => { overlayManager.open(...) })`.
6. **Main process opens overlay**: The OverlayWindowManager shows the pre-loaded hidden overlay window, positions it, and sends `overlay:opened` with auth state.
7. **User types prompt** in the overlay's input field (React component in the overlay renderer).
8. **User clicks "Send"** (or presses Enter).
9. **Overlay sends IPC**: `ipcRenderer.send('overlay:optimize', { text: "write tests for my api", mode: "fast" })`.
10. **Main process handler** (`overlay-ipc-handlers.ts`) receives the message, validates input, and calls `pythonClient.optimizeStream()`.
11. **PythonClient** ensures WebSocket connection to Python service (`/ws/optimize-stream`), generates a unique `requestId`, and sends a JSON message with the prompt, mode, custom instructions, and auth token.
12. **Python service** receives the WebSocket message, validates the prompt, builds a `ChatContext`, and calls `pipeline_optimize()` with `stream=True`.
13. **LLM generates tokens**: The pipeline sends the prompt to the LLM (via LiteLLM → OpenRouter → Anthropic/OpenAI). The LLM generates tokens one at a time.
14. **Python streams chunks**: Each token is put in an asyncio Queue, read by the WebSocket handler, and sent to the client as `{"type": "chunk", "content": "Write", "accumulated": "Write"}`.
15. **PythonClient receives chunks**: The WebSocket message handler finds the matching `requestId` in `activeRequests`, calls the `onChunk` callback.
16. **Main process forwards to overlay**: The `onChunk` callback in `overlay-ipc-handlers.ts` sends `overlay:optimization-chunk` via IPC to the overlay renderer.
17. **Overlay updates UI**: React state updates, the output area shows the accumulated text growing in real-time.
18. **Python sends completion**: `{"type": "complete", "optimized": "<cleaned text>", "models_used": {...}}`.
19. **PythonClient resolves**: The Promise resolves. The main process sends `overlay:optimization-complete` to the overlay.
20. **User clicks "Insert"**.
21. **Overlay sends IPC**: `ipcRenderer.invoke('overlay:insert', { text: "<optimized prompt>" })`.
22. **Main process calls Rust**: `replaceAtLastAnchor(text)` — the native bridge delegates to the Rust module.
23. **Rust performs text replacement**: Uses the stored anchor to focus the original window, selects the 7 "@prompt" characters, and pastes the optimized text via clipboard injection.
24. **Main process closes overlay**: The overlay hides.
25. **User sees the optimized text** in their original application where "@prompt" used to be.

### Data Flow: App Window Optimization

The App Window flow is similar but involves chat persistence:

1. **User types prompt** in the chat input field and clicks Send.
2. **Renderer sends IPC**: `ipcRenderer.send('app:send-message', { chatId, content, mode, attachedFiles })`.
3. **Main process** (`chat-handlers.ts`) receives the message:
   a. If `chatId` is null, creates a new chat in Supabase.
   b. Saves the user message to Supabase (messages table).
   c. Sends `message-sent` IPC to renderer with the new chat and message data.
   d. Calls `pythonClient.optimizeStream()` with the prompt and conversation history.
4. **Streaming proceeds** as above (chunks forwarded via `optimization-chunk` IPC channel — different from `overlay:optimization-chunk`).
5. **On completion**:
   a. Saves the assistant message to Supabase.
   b. Sends `message-received` to renderer.
   c. Calls `pythonClient.generateTitle()` to auto-generate a chat title.
   d. Calls `pythonClient.extractMemoryFacts()` to learn about the user.
   e. Saves extracted facts to Supabase's memory table.

### Key Files

| File | Purpose |
|------|---------|
| `electron/main/index-new.ts` | Main entry point — initializes everything, wires subsystems |
| `electron/preload.ts` | IPC bridge — defines the `window.electronAPI` surface |
| `app-ui/src/pages/Index.tsx` | App Window page orchestrator |
| `app-ui/src/overlay/main.tsx` | Overlay entry point |
| `python-service/app/main.py` | FastAPI server — all AI endpoints |
| `native/platform-core/src/lib.rs` | Rust N-API exports — keyboard hook and text replacement |

### Initialization Sequence

When the Electron app starts, `index-new.ts` executes the following sequence:

1. **Load environment variables**: `dotenv.config()` reads `.env` from the project root. This populates `process.env` with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `PYTHON_SERVICE_URL`, `SENTRY_DSN`, etc.

2. **Initialize Sentry error tracking**: `Sentry.init()` configures error reporting with the app version, environment (dev/prod), and a `beforeSend` hook that scrubs PII (any field containing "prompt", "content", "message", or "text" is replaced with "[REDACTED]").

3. **Import all modules**: Window managers, overlay manager, API clients, database services, IPC handler modules, native bridge, network monitor.

4. **`app.whenReady()` fires** — the Electron app is initialized and ready to create windows:

   a. **Install CSP headers**: `installCSP()` registers a `webRequest.onHeadersReceived` handler that injects `Content-Security-Policy` headers on all responses. This restricts what the renderers can load — only scripts from `'self'`, styles from `'self'` and inline, images from self/data/https/blob, connections to Supabase and the Python service.

   b. **Initialize Supabase client**: `SupabaseClientManager.initialize(SUPABASE_URL, SUPABASE_KEY)`. Validates that credentials are present (fatal error if missing).

   c. **Preload App Window (hidden)**: `appWindowManager.preload()` creates the BrowserWindow and loads `index.html` but doesn't show it. This means when the user first opens the app, the window appears instantly (no creation/loading delay).

   d. **Preload Overlay (hidden)**: `overlayManager.preload()` creates the overlay BrowserWindow and loads `overlay.html` but doesn't show it. This ensures the overlay appears instantly when triggered.

   e. **Initialize PythonClient**: Creates the HTTP client (Axios) with auth interceptor. Runs a health check (`GET /health`) to verify the Python service is running. If healthy, initiates background WebSocket connection to `/ws/optimize-stream`.

   f. **Start health check polling loop**: Every 30 seconds, pings the Python service. If it becomes unavailable, sends `python:unavailable` to both windows. If it recovers, sends `python:recovered`. This lets the UI show a degraded state indicator.

   g. **Start NetworkMonitor**: Polls connectivity status. On reconnection, broadcasts `network:reconnected` to all windows and drains the offline queues (prompt library operations and chat messages that were queued while offline).

   h. **Initialize TranscriptionClient**: Creates the TranscriptionClient with the WebSocket base URL of the Python service.

   i. **Register transcription IPC handlers**: `transcription:start`, `transcription:audio-chunk`, `transcription:stop` — these bridge between the preload's audio capture and the TranscriptionClient.

   j. **Register all IPC handler modules**: `registerAuthHandlers(appWindowManager)`, `registerUserHandlers(appWindowManager)`, `registerSettingsHandlers(overlayManager)`, `registerChatHandlers(appWindowManager, pythonClient)`, `registerOverlayHandlers(overlayManager, pythonClient, appWindowManager)`, `registerSkillHandlers()`, `registerAvatarHandlers()`, `registerFileUploadHandlers()`, `registerFeedbackHandlers()`, `registerDeletionHandlers()`. Each function sets up `ipcMain.on()` and `ipcMain.handle()` listeners for its domain.

   k. **Register window control handlers**: `window:minimize`, `window:maximize`, `window:close`, `shell:openExternal` (with URL validation — only http/https allowed).

   l. **Restore auth session**: `checkAndRestoreSession(appWindowManager)` checks if the user was previously logged in (persisted auth tokens). If so, restores the session and updates `authState`.

   m. **Set up auth state change listener**: Listens for Supabase auth events (`SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`). On sign-in, updates `authState`, sets Sentry user, syncs to overlay. On sign-out (only if online — ignores offline spurious sign-outs), clears `authState`, clears Sentry user, notifies all windows. On token refresh, updates the access token and reconnects the Python WebSocket.

   n. **Start native keyboard hook**: `startKeystrokeDetection()` loads the Rust native bridge and calls `startHook()` with a callback that opens the overlay when @prompt is detected. If the native bridge isn't available (binary not compiled), logs a warning and continues — the @prompt feature is disabled but the app still works.

   o. **Register global hotkey**: `globalShortcut.register('CommandOrControl+5', toggleOverlay)` registers Ctrl+5 as a system-wide shortcut.

   p. **Create system tray**: `SystemTray` creates a tray icon with three menu items: "Open Prmpt", "Toggle Overlay (Ctrl+5)", and "Quit".

5. **Single instance lock**: `app.requestSingleInstanceLock()` ensures only one instance of the app runs. If a second instance tries to start, the first instance receives the `second-instance` event (with the command-line arguments, which may contain a deep link URL) and the second instance quits.

6. **Deep link protocol registration**: `app.setAsDefaultProtocolClient('prmpt')` registers the `prmpt://` URL protocol with the operating system. When a `prmpt://share/c/<token>` URL is opened (e.g., from a browser), the OS routes it to this app. The `handleDeepLink()` function validates the URL (whitelist of path types, regex validation of token format), and sends `navigate-to-share` to the renderer to navigate to the shared content.

7. **Global error guards**: `process.on('unhandledRejection')` and `process.on('uncaughtException')` catch unhandled errors, report them to Sentry, and log them — but do NOT crash the process. The app continues running.

---

## Chapter 4: Electron Main Process — The Brain

This chapter details every module in the Electron main process.

### Window Managers

#### AppWindowManager (`electron/main/windows/app-window-manager.ts`)

Manages the main application window — the full ChatGPT-like interface.

**Window Configuration:**
- **Size**: 1400×900 pixels (default), minimum 1200×700.
- **Background**: `#0d1117` (GitHub's dark background color) — shown during page load to prevent white flash.
- **Frame**: `false` — removes the native Windows title bar entirely. The app renders its own custom title bar in HTML/CSS.
- **Menu**: `autoHideMenuBar: true` — belt-and-suspenders approach (with `frame: false`, there's no menu bar anyway, but this ensures it in case of frame restoration).
- **Security**: `nodeIntegration: false`, `contextIsolation: true` — the renderer is fully sandboxed.
- **Plugins**: `plugins: true` — enables the Chromium PDF viewer so users can preview attached PDFs inline.
- **Preload**: Points to the compiled `dist/preload.js`.

**Lifecycle:**
- `preload()`: Called during app initialization. Creates the window hidden (never shown to the user) and loads the HTML. This means the first `show()` call is instant — no window creation or page loading delay.
- `show()`: If the window exists and is loaded, shows and focuses it immediately. If the window exists but is still loading, waits for `ready-to-show` then shows. If the window was destroyed, creates a new one.
- On close: The window is hidden, not destroyed. `window.on('close')` calls `window.hide()`. The `window-all-closed` event does NOT quit the app (critical for background operation). The app continues running with just the overlay and tray.
- Ctrl+R is disabled via `before-input-event` handler. This prevents users from accidentally pressing the browser refresh shortcut, which would reload the page and wipe all in-memory state (current chat, streaming state, etc.).

**Methods:**
- `send(channel, ...args)`: Forwards IPC messages to the renderer via `window.webContents.send()`. Used by all handler modules to push events to the UI.
- `getWindow()`: Returns the BrowserWindow instance (or null).
- `isVisible()`: Returns whether the window is currently visible.
- `destroy()`: Permanently destroys the window.

#### OverlayWindowManager (`electron/main/overlay/overlay-window-manager.ts`)

Manages the compact overlay popup window. Detailed in Chapter 7.

Key differences from AppWindowManager:
- Transparent background, always-on-top, frameless.
- Positioned near the cursor (or centered on screen for Ctrl+5).
- Smaller dimensions.
- Loads `overlay.html` instead of `index.html`.

#### SystemTray (`electron/main/windows/system-tray.ts`)

Creates and manages the system tray icon and context menu.

**Constructor** accepts three callbacks:
- `onOpenApp`: Called when "Open Prmpt" is clicked → shows the App Window.
- `onToggleOverlay`: Called when "Toggle Overlay (Ctrl+5)" is clicked → toggles the overlay.
- `onQuit`: Called when "Quit" is clicked → calls `app.quit()` (which triggers shutdown).

**Tray icon**: Loaded from `electron/resources/icon.png`, resized to 16×16 pixels. Set as the tray icon with tooltip "Prmpt".

**Click behavior**: Clicking the tray icon directly (not right-click context menu) opens the App Window.

**Context menu items**:
1. "Open Prmpt" — shows the app window.
2. "Toggle Overlay (Ctrl+5)" — toggles overlay visibility.
3. Separator line.
4. "Quit" — exits the application.

### API Clients

#### PythonClient (`electron/main/api/python-client.ts`)

The PythonClient handles all communication with the Python AI service. It's the most complex API client in the application.

**HTTP Client (Axios):**
- Base URL: `http://127.0.0.1:8001` (configurable via `PYTHON_SERVICE_URL` env var).
- Timeout: 60 seconds.
- Content-Type: `application/json`.
- Request interceptor: Automatically attaches `Authorization: Bearer <token>` header from `authState.currentAccessToken` to every outgoing request.

**WebSocket Connection:**
- Connects to `/ws/optimize-stream` with the auth token as a query parameter (`?token=<encoded_token>`).
- Managed via `ensureConnection()`: If the WebSocket is already open, reuses it. If connecting, waits for the existing connection promise. If closed, creates a new connection.
- The connection is persistent — it stays open and is reused for multiple optimization requests.

**Request Tracking:**
- `activeRequests: Map<string, StreamRequest>`: Maps request IDs to their pending state (resolve/reject callbacks, onChunk callback, accumulated text, aborted flag).
- Each `optimizeStream()` call generates a unique request ID (`Date.now() + random string`), stores the request in the map, and sends it via WebSocket.
- When a response message arrives, the handler looks up the request by `request_id` in the message. If the request ID is missing (legacy server behavior), it falls back to the single active request.

**Silence Detection:**
- A 3.5-second inactivity timer starts after the first chunk is received.
- Each subsequent chunk resets the timer.
- If 3.5 seconds pass without a chunk (after at least one chunk was received), the request is auto-resolved with whatever text has accumulated. This handles edge cases where the Python service sends all chunks but the "complete" message is lost or delayed.

**Hard Timeout:**
- 30 seconds per request. If neither completion nor silence detection resolves the request in 30 seconds, it times out. If any text was accumulated, it resolves with that text. Otherwise, it rejects with a timeout error.

**Abort Support:**
- `abortLatestStream()`: Marks the most recently started request as aborted. Resolves the pending Promise with whatever text has accumulated so far (partial result, not an error). Sends an abort signal to the Python service (best-effort). Remembers the aborted request ID for 30 seconds to suppress noisy warnings from late-arriving chunks.

**Token Refresh:**
- `reconnect()`: Closes the current WebSocket and opens a new one. Called when the Supabase JWT is refreshed, so the new token is used for WebSocket authentication.

**Sentry Trace Propagation:**
- Before sending a WebSocket message, the client extracts the active Sentry span's trace header and baggage. These are included in the message as `sentry_trace` and `baggage` fields. The Python service uses these to continue the distributed trace, linking Python spans to the Electron span that originated the request.

**HTTP Endpoints:**
- `healthCheck()`: `GET /health` with 5-second timeout. Returns true if response is `{"status": "ok"}`.
- `optimize()`: `POST /optimize` — legacy non-streaming endpoint, kept for backward compatibility.
- `generateTitle(prompt)`: `POST /generate-title` — generates a 3-5 word chat title from the first user message. Falls back to "New Chat" on failure.
- `extractMemoryFacts(rawPrompt, optimizedText, skill?)`: `POST /extract-memory-facts` — extracts user facts for the memory system. Non-critical — returns empty array on failure.
- `transcribeAudio(audioBase64)`: `POST /transcribe-audio` — transcribes uploaded audio using local Whisper.

#### TranscriptionClient (`electron/main/api/transcription-client.ts`)

Manages per-session WebSocket connections to the Python streaming transcription service.

**Key design difference from PythonClient**: No persistent connection. Each recording session (mic button press) opens a fresh WebSocket. When the session ends, the socket is closed. No reconnection logic.

**`startSession(sessionId, sampleRate, callbacks)`:**
1. Stores the callback functions (onTranscription, onError, onStatus).
2. Builds the WebSocket URL with auth token: `ws://127.0.0.1:8001/ws/transcribe-stream?token=<encoded_token>`.
3. Creates a new WebSocket connection.
4. On open: sends `{"action": "start", "session_id": sessionId, "sample_rate": sampleRate}`.
5. On message: parses JSON and routes to the appropriate callback via `routeMessage()`.
6. Returns a Promise that resolves when the connection is established.

**`sendAudioChunk(chunk: Buffer)`:**
- Sends the raw binary buffer directly on the WebSocket (binary frame, not JSON).
- No-op if the WebSocket isn't open (guard: `this.ws.readyState !== WebSocket.OPEN`).

**`stopSession()`:**
- Sends `{"action": "stop"}` to the server.
- Waits 500ms (to allow final transcription results to arrive).
- Calls `cleanup()` to close the WebSocket and clear callbacks.

**Message routing** (`routeMessage()`):
- `type: "transcription"` or `type: "final"` → `callbacks.onTranscription({ text, accumulated, type, is_final, speech_final })`.
- `type: "status"` → `callbacks.onStatus(status)`.
- `type: "error"` → `callbacks.onError(message)`.

### Database Layer

#### SupabaseClientManager (`electron/main/database/supabase-client.ts`)

A singleton that initializes the Supabase JavaScript client with the project URL and anon key. The client instance is used by all service classes.

#### Service Classes (`electron/main/database/services/`)

Each service class encapsulates Supabase operations for a specific domain:

- **AuthService** (`auth-service.ts`): Sign up (create user + profile in one transaction), sign in (email/password), sign out, OAuth (Google/GitHub via `supabase.auth.signInWithOAuth`), session management, `onAuthStateChange` listener for token refresh and sign-out events.

- **ChatService** (`chat-service.ts`): CRUD for chats (create, read, update title, delete) and messages (insert, query by chat_id with ordering). Loads chat history with pagination. Saves messages with metadata (role, content, attached files, version info).

- **OptimizationService** (`optimization-service.ts`): Saves prompt optimization records and their version history.

- **UserService** (`user-service.ts`): Profile CRUD (name, avatar URL, date of birth), preferences (theme, font size), personalization prompt.

- **SettingsService** (`settings-service.ts`): Loads and saves user settings from/to the `user_settings` table. Settings include theme, font size, custom instructions, memory_enabled flag.

- **PromptLibraryService** (`prompt-library-service.ts`): Full CRUD for collections and prompts. Favorites (toggle star). Sharing — generates cryptographically secure share tokens (`randomBytes(24).toString('base64url')`), stores them in the database, and supports fetching shared collections/prompts by token. Also supports saving (cloning) shared collections to the user's own library.

- **MemoryService** (`memory-service.ts`): CRUD for `user_memory` table entries. Organized by type (user, behavioral, context) and key. Supports upsert (update if exists, insert if not) and delete. Also manages the memory_enabled setting.

- **MemoryAnalyzer** (`memory-analyzer.ts`): Higher-level memory analysis — determines what facts to extract and how to merge them with existing memories.

- **RateLimitService** (`rate-limit-service.ts`): Checks daily usage against per-role limits. Dev accounts get higher limits.

- **DeletionService** (`deletion-service.ts`): GDPR-compliant account deletion. Supports request (schedules deletion for a future date), cancel (revokes pending deletion), and status check (is there a pending deletion request?).

### IPC Handler Modules

Each handler module is a function that receives references to shared resources (window managers, Python client) and registers `ipcMain.on()` / `ipcMain.handle()` listeners for its domain.

#### auth-handlers.ts

Handles: `auth:sign-up`, `auth:sign-in`, `auth:oauth-sign-in`, `auth:check`.

- **Sign up**: Creates user via `authService.signUp()`, creates profile via `userService.createProfile()`, updates `authState`, sends `auth:state-changed` to renderer with user data.
- **Sign in**: Authenticates via `authService.signIn()`, updates `authState`, sends `auth:state-changed`.
- **OAuth**: Opens the system browser with the OAuth URL via `shell.openExternal()`. Supabase handles the redirect flow. The auth state change listener picks up the `SIGNED_IN` event.
- **Check auth**: Calls `checkAndRestoreSession()` to see if a previous session is still valid.
- **`checkAndRestoreSession()`**: Calls `supabase.auth.getSession()`. If a session exists, updates `authState` and sends `auth:state-changed` to the renderer.

#### chat-handlers.ts

Handles: `app:send-message`, `app:regenerate-response`, `app:load-chats`, `app:load-messages`, `app:create-chat`, `app:delete-chat`, `app:rename-chat`, `app:stop-generation`, `app:save-feedback`.

The `app:send-message` handler orchestrates the full send flow:
1. Validate input (non-empty content, valid mode).
2. If `chatId` is null, create a new chat via `chatService.create()`.
3. Save user message to Supabase via `chatService.insertMessage()`.
4. Send `message-sent` to renderer (includes the new chat and user message).
5. Call `pythonClient.optimizeStream()` with:
   - The prompt content.
   - Conversation history (previous messages in the chat).
   - Mode (fast/thinking).
   - Custom instructions from user settings.
   - Attached files.
   - `onChunk` callback that sends `optimization-chunk` to the renderer.
6. On completion:
   - Save assistant message to Supabase.
   - Send `message-received` to renderer.
   - Generate title (fire-and-forget): `pythonClient.generateTitle(content)` → `chatService.updateTitle()` → `chat-renamed` to renderer.
   - Extract memory facts (fire-and-forget): `pythonClient.extractMemoryFacts()` → save to memory service.

`app:regenerate-response` is similar but reuses the existing chat and sends a different signal to the renderer.

`app:stop-generation` calls `pythonClient.abortLatestStream()`.

#### overlay-ipc-handlers.ts

The most complex IPC module in the application. Handles the complete overlay optimization lifecycle, clarification state machine, dual-chat persistence, real-time app window sync, and all overlay utility operations.

**Full channel list**: `overlay:optimize`, `overlay:submit-clarification`, `overlay:copy`, `overlay:close`, `overlay:open-app`, `overlay:insert`, `overlay:insert-section`, `overlay:save`, `overlay:check-auth`, `overlay:get-collections`, `overlay:create-collection`, `overlay:get-chats`, `overlay:save-to-chat`, `overlay:get-source-info`, `overlay:new-session`, `overlay:stop-generation`, `overlay:truncate-history`, `overlay:get-settings`.

**Key module-level state**:
- `inMemoryOverlayHistory` — rolling 20-message conversation buffer (trimmed to last 20 when exceeded); used as LLM context when no `chatId` is provided
- `currentOverlayChatId` — tracks the overlay session's DB chat so all messages within a session go to the same chat
- `pendingOverlayClarification` — stores the full `PendingOverlayOptimization` state (prompt, custom instructions, history context) while the user is answering clarification questions; set to `null` before resuming
- `sourceHwnd` / `sourceWindowTitle` / `firstSectionDone` — source window state captured at `@prompt` trigger time; `firstSectionDone` tracks whether the first section has been inserted (used by `overlay:insert-section`)

**`overlay:optimize` flow**:
1. Auth check → offline check (blocks file attachments, warns; allows text through)
2. Client-side rate limit check via `RateLimitService.checkRateLimit(userId)` — sends error frame immediately if exceeded, no LLM call
3. Fetch custom instructions from `SettingsService` + memory context from `MemoryService` (both silent-fail)
4. Build history context: if `chatId` is attached → load last 8 messages from DB; otherwise use in-memory overlay session history
5. Clarification pre-pass: if NOT a regeneration AND `!isWeakMessage(text)` → call `pythonClient.clarify(text)`. If questions returned, store `pendingOverlayClarification` and send `overlay:clarification-required` — **optimization is completely paused here**
6. If no clarification needed → call `pythonClient.optimizeStream()` with all parameters including `projectId`, `projectBranch`, `wantsSections`, `clarificationAnswers`
7. On complete: send `overlay:optimization-complete`, log analytics event, invalidate rate-limit cache
8. Fire-and-forget DB save: save optimization record, trigger background memory analysis, persist user+assistant messages

**Dual-chat persistence paths** (in both `overlay:optimize` and `overlay:submit-clarification`):
- **Context chat path** (when `chatId` is attached): Append messages to that existing chat. Pre-generate user message ID for file upload paths. Call `svc.touchChat()` to bump `updated_at` so the chat rises to the top of the sidebar. Push `overlay:messages-appended` to the app window for instant real-time sync without a full reload.
- **Session chat path** (no `chatId`): Create or reuse `currentOverlayChatId`. On first message, create a placeholder chat title (first 4 words), then fire-and-forget a smart AI title from `pythonClient.generateTitle()` and push `chat-renamed` to the app window sidebar.

**`overlay:submit-clarification`**:
- Reads `pendingOverlayClarification`, clears it atomically, formats answers via `formatOverlayClarificationAnswers()`, then calls `pythonClient.optimizeStream()` with the original prompt data plus the formatted answers as `clarificationAnswers`
- Full DB save with `clarificationChoices` metadata stored on the assistant message so the UI can display "answered X questions" badges
- Same dual-chat persistence logic as `overlay:optimize`

**`overlay:insert`**:
Closes the overlay immediately, waits 150ms for focus to return to the source window, calls `replaceAtLastAnchor(text)`. If that fails (anchor consumed), falls back to `pasteTextToWindow(sourceHwnd, text)`. Sets `firstSectionDone = true` on success.

**`overlay:insert-section`** (multi-task output):
Does NOT close the overlay. Temporarily sets overlay opacity to 0 (visually hides it) so the native focus manipulation doesn't flash. First section uses `replaceAtLastAnchor`, subsequent sections use `pasteTextToWindow(sourceHwnd)`. For chat windows (`detectWindowMode(sourceWindowTitle).mode === 'chat'`): calls `sendEnterToWindow(sourceHwnd)` to auto-submit the message into the chat. After paste, restores overlay opacity to 1 and calls `forceFocusWindow(overlayHwnd)` to return focus to the overlay.

**`overlay:copy`**: Copies text to the system clipboard via `clipboard.writeText()`.

**`overlay:close`**: Hides the overlay window.

**`overlay:open-app`**: Shows the main app window (used for unauthenticated users prompted to log in).

**`overlay:save`** (prompt library save): Fully offline-aware — when offline, creates temp IDs with `offline-pmt-*` prefix, stores in `localCache`, and queues to `offlineQueue` for sync on reconnect. Auto-creates "Quick Saves" collection if none specified, then notifies the app window to refresh the library in real-time.

**`overlay:get-settings`**: Fetches and caches user settings to `localCache`; offline falls back to cached settings or defaults `{ theme: 'dark', font_size: 'medium', font_family: 'inter', prompt_instructions: '' }`.

**`overlay:get-chats`**: Returns `{ id, title }[]` lightweight list for the context picker; offline falls back to `localCache.getChats()`.

**`overlay:get-source-info`**: Returns source window metadata `{ hwnd, title, detectedMode, confidence, appName }` using `detectWindowMode(sourceWindowTitle)`.

**`overlay:stop-generation`**: Calls `pythonClient.abortLatestStream()` to abort the current in-flight WebSocket stream.

**`overlay:truncate-history`**: Truncates `inMemoryOverlayHistory` to `keepCount` messages — called by the overlay frontend when the user edits a message or retries, to keep backend history in sync with the rendered conversation.

**Cursor polling** (`startCursorPolling`): Sets up a `setInterval` at ~60fps that reads `screen.getCursorScreenPoint()`, offsets it relative to the overlay window position, and sends `overlay:cursor-pos` to drive the emerald glow animation in the renderer. Started when `registerOverlayHandlers` is called; stopped via `stopCursorPolling()` on shutdown.

#### settings-handlers.ts

Handles: `settings:load`, `settings:save`.

- **`settings:load`**: Loads user settings from Supabase via `settingsService.load(authState.currentUserId)`. Returns the settings object.
- **`settings:save`**: Saves settings via `settingsService.save()`. After saving, forwards the updated settings to the overlay via `overlayManager.send('overlay:settings-update', settings)` so the overlay stays in sync.

#### user-handlers.ts

Handles: `app:request-user-data`, `user:update-profile`, `user:update-preferences`, `user:set-personalization-prompt`.

- **`app:request-user-data`**: Loads user profile and preferences from Supabase. Sends `user-data-loaded` to the renderer with the combined data.
- **`user:update-profile`**: Updates profile fields (name, avatar_url, etc.).
- **`user:update-preferences`**: Updates preference fields (theme, font_size, etc.).
- **`user:set-personalization-prompt`**: Saves the custom instructions string (injected into every optimization request).

#### prompt-library-handlers.ts

Handles the full prompt library CRUD + sharing:
- `prompt-library:get-all`, `prompt-library:get-collections`, `prompt-library:create-collection`, `prompt-library:rename-collection`, `prompt-library:delete-collection`.
- `prompt-library:save-prompt`, `prompt-library:create-collection-and-save`, `prompt-library:update-prompt`, `prompt-library:delete-prompt`, `prompt-library:toggle-favorite`.
- `prompt-library:get-share-link`, `prompt-library:get-shared-collection`, `prompt-library:save-shared-collection`.
- `prompt-library:get-prompt-share-link`, `prompt-library:get-shared-prompt`.

This module also exports `syncOfflineQueue()` — called when the network reconnects — to drain queued operations that were performed while offline.

#### Other Handler Modules

- **skill-handlers.ts**: `skills:list` — lists available skill files from the `files/` directory.
- **avatar-handlers.ts**: `avatar:upload` — uploads avatar images to Cloudinary (a cloud image hosting service) and returns the URL.
- **file-upload-service.ts**: Handles file attachment uploads to Supabase Storage (`message-attachments` bucket). Returns the storage path for later retrieval.
- **feedback-handlers.ts**: `feedback:submit` — saves user feedback (positive/negative rating with optional comment).
- **deletion-handlers.ts**: `deletion:request`, `deletion:cancel`, `deletion:status` — GDPR account deletion workflow.

### Utility Modules

#### auth-state.ts (`electron/main/utils/auth-state.ts`)

A simple exported object that acts as a global singleton for authentication state:

```typescript
export const authState = {
    isAuthenticated: false,
    currentUserId: null as string | null,
    currentUserEmail: null as string | null,
    currentAccessToken: null as string | null,
};
```

This is updated by auth handlers when the user signs in/out and when tokens are refreshed. It's read by PythonClient (to attach auth tokens to requests), overlay handlers (to check auth before operations), and network handlers.

The reason this is a plain object (not a class or EventEmitter) is to avoid circular dependencies. Multiple modules need to read auth state, and making it a simple imported object avoids the complexity of dependency injection or event systems.

#### native-bridge.ts (`electron/main/utils/native-bridge.ts`)

The centralized loader for the Rust `.node` native module. It implements a lazy-loading pattern:

1. On first call to any exported function, `loadBridge()` attempts to `require()` the native module from `native/platform-core/index.js`.
2. If the module loads successfully, `_bridge` is set to the native module's exports.
3. If loading fails (file not found, wrong architecture, etc.), `_bridge` remains as `STUB` — a set of no-op functions that log warnings.
4. `isNativeBridgeAvailable()` returns `true` if the real module was loaded, `false` if using stubs.

The stub pattern ensures the application works without the Rust module compiled. Features that depend on native code (keyboard hook, text replacement) are gracefully degraded — they log warnings instead of crashing.

Exported functions:
- `startHook(callback)`: Adapts the napi-rs error-first callback convention `(err, anchor)` to the simpler `(anchor)` signature used by callers.
- `stopHook()`: Uses `_bridge` directly (not `loadBridge()`) to avoid re-loading during shutdown.
- `replaceAtLastAnchor(text)`: Delegates to the native module's text replacement function.
- `forceFocusWindow(hwnd)`: Force-focuses a window using Win32's foreground steal sequence.
- `getActiveWindowTitle()`: Returns the title of the currently focused window.

#### network-monitor.ts

Polls network connectivity by making periodic requests to a known endpoint. Emits online/offline status changes to all windows. On reconnection, triggers callback functions that drain offline queues (prompt library and chat message queues).

The network monitor is critical for offline support. It also suppresses spurious Supabase `SIGNED_OUT` events that occur when the token refresh fails due to no network connectivity.

### Input System

- **KeyboardHook** (`input/keyboard-hook.ts`): DEPRECATED. This was the original JavaScript-based keyboard hook implementation, which has been replaced by the Rust native module. It now exists as a stub that logs a deprecation message.

- **TextStatePoller** (`input/text-state-poller.ts`): Polls the text state in focused windows. Used for scenarios where the Rust module isn't available.

- **TextReplacer** (`input/text-replacer.ts`): High-level text replacement logic. Delegates to the native `replaceAtLastAnchor()` function.

### Optimization Modules

- **AIGuardrails** (`optimization/ai-guardrails.ts`): Validates LLM responses against guardrail rules. Ensures the optimizer's output is actually an improved prompt and not an answer to the prompt, a refusal, or off-topic content.

- **ResponseValidator** (`optimization/response-validator.ts`): Validates the quality of optimization output. Checks for minimum length, absence of meta-text ("Here is the optimized version:"), and other quality signals.

- **SessionState** (`optimization/session-state.ts`): Tracks per-session optimization state. Used to maintain context across multiple optimization requests in the same session.

- **StabilityTracker** (`optimization/stability-tracker.ts`): Tracks optimization stability metrics over time. Used for monitoring and debugging optimization quality.

---

## Chapter 5: The Preload Bridge — How UI Talks to the OS

### What the Preload Script Is

The preload script (`electron/preload.ts`) is the security boundary between the web page (the React application running in the renderer process) and the operating system (Node.js running in the main process). It occupies a unique position in Electron's architecture:

- **It has access to Node.js APIs**: `require`, `process`, `Buffer`, and Electron's `ipcRenderer`. These are unavailable to the renderer page's JavaScript.
- **It has access to browser APIs**: `document`, `window`, `navigator`, including `navigator.mediaDevices.getUserMedia` for microphone access.
- **BUT**: The renderer page's JavaScript cannot access any of the preload's capabilities directly. The two run in separate JavaScript contexts (because `contextIsolation: true`).

The preload script's single most important line is:

```typescript
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
```

This creates a safe, read-only, non-tamperable copy of the `electronAPI` object on the renderer page's `window` object. The renderer page can call `window.electronAPI.overlay.optimize(data)`, but it cannot:
- Modify the `electronAPI` object (it's frozen via structured clone).
- Access `ipcRenderer` directly.
- Call `require()`.
- Access `process`, `Buffer`, or any Node.js API.

### Why This Architecture Exists

Without `contextIsolation`, a malicious script injected into the renderer page could access `ipcRenderer` directly. Consider an attack scenario:

1. A compromised npm package in the renderer bundle injects malicious code.
2. Without isolation, the malicious code accesses `window.require('electron').ipcRenderer`.
3. It sends arbitrary IPC messages: `ipcRenderer.send('app:delete-chat', <every chat ID>)`, or accesses auth tokens, or triggers native operations.

With `contextBridge` and `contextIsolation`:
- The renderer only has access to the specific methods exposed in the `electronAPI` object.
- Each method has defined inputs and outputs — a whitelist-only API surface.
- There's no way to escape this sandbox from the renderer side.

### The Three IPC Patterns in Detail

#### Pattern 1: Fire-and-Forget (Renderer → Main)

```typescript
// Preload exposes:
optimize: (data) => {
  ipcRenderer.send('overlay:optimize', data);
}

// Main process listens:
ipcMain.on('overlay:optimize', (event, data) => {
  // Process the optimization request
  // Results come back via event push (pattern 3)
});
```

The renderer calls `window.electronAPI.overlay.optimize(data)`. The preload invokes `ipcRenderer.send()`, which serializes the data (structured clone algorithm), sends it to the main process, and returns immediately. No return value, no Promise, no waiting.

**Used for**: Sending messages for optimization, starting/stopping transcription, window control actions (minimize, maximize, close), copying to clipboard, saving feedback. These are operations where the result (if any) comes back asynchronously via event push.

#### Pattern 2: Request/Response (Renderer → Main → Renderer)

```typescript
// Preload exposes:
loadSettings: () => {
  return ipcRenderer.invoke('settings:load');  // Returns Promise<any>
}

// Main process handles:
ipcMain.handle('settings:load', async (event) => {
  const settings = await settingsService.load(authState.currentUserId);
  return settings;  // Serialized and sent back to renderer
});
```

The renderer calls `await window.electronAPI.loadSettings()`. The preload invokes `ipcRenderer.invoke()`, which:
1. Serializes the arguments.
2. Sends them to the main process.
3. Returns a Promise.
4. The main process runs the `handle()` callback.
5. The callback's return value is serialized and sent back to the renderer.
6. The Promise resolves with the return value.

If the handler throws an error, the Promise rejects with the error.

**Used for**: Loading settings, saving prompts, checking auth status, getting rate limit status, getting collections, creating collections, uploading avatars — any operation where the renderer needs to wait for a result before proceeding.

#### Pattern 3: Event Push (Main → Renderer)

```typescript
// Main process sends:
appWindowManager.send('optimization-chunk', { chunk, accumulated });
// Internally: window.webContents.send('optimization-chunk', { chunk, accumulated });

// Preload exposes:
onOptimizationChunk: (callback) => {
  const handler = (_event, data) => callback(data);
  ipcRenderer.on('optimization-chunk', handler);
  return () => ipcRenderer.removeListener('optimization-chunk', handler);
}
```

The main process pushes a message to a specific renderer window via `webContents.send()`. The preload has registered a listener with `ipcRenderer.on()`. When the message arrives, the preload's handler calls the user's callback, stripping the Electron event object (the renderer doesn't need it).

The preload returns a cleanup function `() => ipcRenderer.removeListener(...)`. This is critical for React — when a component unmounts, it calls the cleanup function to stop listening. Without cleanup, listeners accumulate and cause memory leaks and duplicate event handling.

**Used for**: Streaming optimization chunks (arrive rapidly during generation), auth state changes, network status updates, Python service availability changes, chat updates, memory updates, navigation events.

### Complete API Surface

The preload exposes the following API surface organized into logical groups:

#### Overlay API (`window.electronAPI.overlay.*`)

| Method | IPC Channel | Pattern | Purpose |
|--------|-------------|---------|---------|
| `optimize(data)` | `overlay:optimize` | send | Start optimization |
| `save(data)` | `overlay:save` | invoke | Save to prompt library |
| `copy(text)` | `overlay:copy` | send | Copy to clipboard |
| `close()` | `overlay:close` | send | Close overlay |
| `openApp()` | `overlay:open-app` | send | Open app window |
| `insert(text)` | `overlay:insert` | invoke | Replace @prompt text |
| `checkAuth()` | `overlay:check-auth` | invoke | Check auth status |
| `getCollections()` | `overlay:get-collections` | invoke | List collections |
| `createCollection(name, icon?)` | `overlay:create-collection` | invoke | Create collection |
| `getChats()` | `overlay:get-chats` | invoke | List recent chats |
| `saveToChat(chatId, content)` | `overlay:save-to-chat` | invoke | Save to existing chat |
| `onOpened(callback)` | `overlay:opened` | on | Overlay opened event |
| `onAuthState(callback)` | `overlay:auth-state` | on | Auth state sync |
| `onOptimizationChunk(callback)` | `overlay:optimization-chunk` | on | Streaming chunk |
| `onOptimizationComplete(callback)` | `overlay:optimization-complete` | on | Stream complete |
| `onOptimizationError(callback)` | `overlay:optimization-error` | on | Stream error |
| `onCursorPos(callback)` | `overlay:cursor-pos` | on | Cursor position |
| `getSettings()` | `overlay:get-settings` | invoke | Get user settings |
| `onSettingsUpdate(callback)` | `overlay:settings-update` | on | Settings changed |
| `newSession()` | `overlay:new-session` | send | Reset overlay session |
| `stopGeneration()` | `overlay:stop-generation` | send | Abort generation |
| `truncateHistory(keepCount)` | `overlay:truncate-history` | send | Limit history |
| `notifyReady()` | `overlay:ready` | send | Signal readiness |

#### Transcription API (`window.electronAPI.transcription.*`)

| Method | Mechanism | Purpose |
|--------|-----------|---------|
| `start(sessionId)` | Starts local mic capture + sends `transcription:start` IPC | Begin recording |
| `stop()` | Stops mic + sends `transcription:stop` IPC | End recording |
| `onTranscription(callback)` | Local listener set (not direct IPC) | Receive transcription text |
| `onStatus(callback)` | Local listener set | Receive status changes |
| `onError(callback)` | Local listener set | Receive errors |

**Important**: Transcription listeners are NOT direct IPC listeners. The preload sets up `ipcRenderer.on('transcription:update')`, `ipcRenderer.on('transcription:status')`, and `ipcRenderer.on('transcription:error')` globally at module load time. These global listeners dispatch to a local `Set<callback>` for each event type. `transcription.onTranscription(callback)` adds to this set. This design allows both the overlay and app window to receive transcription events from the same preload instance, since the preload dispatches to all registered listeners.

#### App Window API (`window.electronAPI.*`)

| Method | IPC Channel | Pattern |
|--------|-------------|---------|
| `sendMessage(data)` | `app:send-message` | send |
| `regenerateResponse(data)` | `app:regenerate-response` | send |
| `loadChats()` | `app:load-chats` | send |
| `loadMessages(chatId)` | `app:load-messages` | send |
| `createChat(title?)` | `app:create-chat` | send |
| `deleteChat(chatId)` | `app:delete-chat` | send |
| `renameChat(chatId, title)` | `app:rename-chat` | send |
| `stopGeneration()` | `app:stop-generation` | send |
| `copyToClipboard(text)` | `app:copy-to-clipboard` | send |
| `saveFeedback(messageId, rating)` | `app:save-feedback` | send |
| `signOut()` | `app:sign-out` | send |
| `getGenerationStatus(chatId)` | `app:get-generation-status` | invoke |
| `onChatsLoaded(callback)` | `chats-loaded` | on |
| `onMessagesLoaded(callback)` | `messages-loaded` | on |
| `onMessageSent(callback)` | `message-sent` | on |
| `onMessageReceived(callback)` | `message-received` | on |
| `onOptimizationChunk(callback)` | `optimization-chunk` | on |
| `onOptimizationComplete(callback)` | `optimization-complete` | on |
| `onOptimizationError(callback)` | `optimization-error` | on |
| `onMessageSendError(callback)` | `message-send-error` | on |
| `onSendMessageQueued(callback)` | `send-message-queued` | on |
| `onOfflineMessageSynced(callback)` | `offline-message-synced` | on |
| `onChatCreated(callback)` | `chat-created` | on |
| `onChatDeleted(callback)` | `chat-deleted` | on |
| `onChatDeleteError(callback)` | `chat-delete-error` | on |
| `onChatRenamed(callback)` | `chat-renamed` | on |
| `onChatRenameError(callback)` | `chat-rename-error` | on |
| `onOverlayMessagesAppended(callback)` | `overlay:messages-appended` | on |

#### Auth API

| Method | IPC Channel | Pattern |
|--------|-------------|---------|
| `signUp(data)` | `auth:sign-up` | send |
| `signIn(data)` | `auth:sign-in` | send |
| `signInWithOAuth(provider)` | `auth:oauth-sign-in` | invoke |
| `checkAuth()` | `auth:check` | send |
| `onAuthStateChange(callback)` | `auth:state-changed` | on |
| `updateProfile(updates)` | `user:update-profile` | send |
| `uploadAvatar(imageData, filename)` | `avatar:upload` | invoke |
| `updatePreferences(updates)` | `user:update-preferences` | send |
| `setPersonalizationPrompt(prompt)` | `user:set-personalization-prompt` | send |
| `onProfileUpdated(callback)` | `user:profile-updated` | on |
| `onPreferencesUpdated(callback)` | `user:preferences-updated` | on |

#### Settings API

| Method | IPC Channel | Pattern |
|--------|-------------|---------|
| `loadSettings()` | `settings:load` | invoke |
| `saveSettings(settings)` | `settings:save` | invoke |

#### Prompt Library API (`window.electronAPI.promptLibrary.*`)

| Method | IPC Channel | Pattern |
|--------|-------------|---------|
| `getAll()` | `prompt-library:get-all` | invoke |
| `getCollections()` | `prompt-library:get-collections` | invoke |
| `createCollection(name, icon?)` | `prompt-library:create-collection` | invoke |
| `renameCollection(id, name)` | `prompt-library:rename-collection` | invoke |
| `deleteCollection(id)` | `prompt-library:delete-collection` | invoke |
| `savePrompt(collectionId, title, content, metadata?)` | `prompt-library:save-prompt` | invoke |
| `createCollectionAndSave(...)` | `prompt-library:create-collection-and-save` | invoke |
| `updatePrompt(promptId, updates)` | `prompt-library:update-prompt` | invoke |
| `deletePrompt(promptId)` | `prompt-library:delete-prompt` | invoke |
| `toggleFavorite(promptId)` | `prompt-library:toggle-favorite` | invoke |
| `getShareLink(collectionId)` | `prompt-library:get-share-link` | invoke |
| `getSharedCollection(token)` | `prompt-library:get-shared-collection` | invoke |
| `saveSharedCollection(id)` | `prompt-library:save-shared-collection` | invoke |
| `getPromptShareLink(promptId)` | `prompt-library:get-prompt-share-link` | invoke |
| `getSharedPrompt(token)` | `prompt-library:get-shared-prompt` | invoke |

#### Memory API (`window.electronAPI.memory.*`)

| Method | IPC Channel | Pattern |
|--------|-------------|---------|
| `get()` | `memory:get` | invoke |
| `upsert(data)` | `memory:upsert` | invoke |
| `delete(data)` | `memory:delete` | invoke |
| `getEnabled()` | `memory:get-enabled` | invoke |
| `setEnabled(enabled)` | `memory:set-enabled` | invoke |
| `onUpdated(callback)` | `memory:updated` | on |

#### Window Controls (`window.electronAPI.windowControls.*`)

| Method | IPC Channel | Pattern |
|--------|-------------|---------|
| `minimize()` | `window:minimize` | send |
| `maximize()` | `window:maximize` | send |
| `close()` | `window:close` | send |

#### Other APIs

| Method | IPC Channel | Pattern |
|--------|-------------|---------|
| `openExternal(url)` | `shell:openExternal` | send |
| `onNetworkStatus(callback)` | `network:status` | on |
| `onNetworkReconnected(callback)` | `network:reconnected` | on |
| `onSentryUser(callback)` | `sentry:set-user` | on |
| `getRateLimitStatus()` | `app:get-rate-limit-status` | invoke |
| `onNavigateToShare(callback)` | `navigate-to-share` | on |
| `onPythonUnavailable(callback)` | `python:unavailable` | on |
| `onPythonRecovered(callback)` | `python:recovered` | on |
| `feedback.submit(data)` | `feedback:submit` | invoke |
| `deletion.request(reason?)` | `deletion:request` | invoke |
| `deletion.cancel()` | `deletion:cancel` | invoke |
| `deletion.status()` | `deletion:status` | invoke |
| `skills.list()` | `skills:list` | invoke |
| `storage.getSignedUrl(path)` | `storage:get-signed-url` | invoke |
| `storage.openPdf(path)` | `storage:open-pdf` | invoke |

#### Generic `send()` with Whitelist

The preload exposes a generic `send(channel, data)` method, but it enforces a strict whitelist:

```typescript
send: (channel: string, data: any) => {
  const ALLOWED_SEND_CHANNELS = new Set([
    'overlay:settings-update',
    'overlay:close',
    'overlay:ready',
  ]);
  if (!ALLOWED_SEND_CHANNELS.has(channel)) {
    console.warn(`[Preload] Blocked IPC send to unknown channel: ${channel}`);
    return;
  }
  ipcRenderer.send(channel, data);
}
```

Only three channels are allowed through the generic `send()`:
- `overlay:settings-update` — settings page syncs changes to the overlay.
- `overlay:close` — close the overlay.
- `overlay:ready` — overlay renderer signals that it has loaded.

Any other channel is blocked with a console warning. This prevents the renderer from discovering and exploiting arbitrary IPC channels through the generic method.

### The Mic Capture Pipeline in Preload

The preload contains the complete microphone capture implementation. This is significant — the audio capture logic lives in the preload (which has access to browser APIs like `navigator.mediaDevices`) rather than in the main process (which doesn't have a DOM or Web Audio API).

#### Starting a Recording

`transcription.start(sessionId)` calls `startLocalTranscription()`:

1. **Guard check**: If `activeRecorder` is not null, recording is already in progress. Emit an error and return.

2. **Get microphone access**:
   ```typescript
   const stream = await mediaDevices.getUserMedia({
     audio: {
       echoCancellation: true,
       noiseSuppression: true,
       autoGainControl: true,
     },
   });
   ```
   The browser prompts the user for microphone permission (first time only). The DSP filters (echo cancellation, noise suppression, auto gain control) are applied by the browser/OS audio pipeline before the audio reaches JavaScript.

3. **Create audio processing pipeline**:
   ```typescript
   const audioContext = new AudioContextCtor();
   const sampleRate = audioContext.sampleRate;  // Native rate (usually 44100 or 48000)
   const source = audioContext.createMediaStreamSource(stream);
   const processor = audioContext.createScriptProcessor(4096, 1, 1);
   const muteGain = audioContext.createGain();
   muteGain.gain.value = 0;  // Mute playback
   ```

4. **Notify main process**:
   ```typescript
   ipcRenderer.send('transcription:start', { sessionId: Date.now().toString(), sampleRate });
   ```
   The main process uses this to open a WebSocket to the Python service and start the transcription session.

5. **Process audio in real-time**:
   ```typescript
   processor.onaudioprocess = (event) => {
     const channelData = event.inputBuffer.getChannelData(0);  // Float32Array
     const int16 = new Int16Array(channelData.length);
     for (let i = 0; i < channelData.length; i++) {
       const s = Math.max(-1, Math.min(1, channelData[i]));
       int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
     }
     ipcRenderer.send('transcription:audio-chunk', Buffer.from(int16.buffer));
   };
   ```
   Every ~85ms (4096 samples at 48kHz), the processor fires with a buffer of Float32 audio samples. Each sample is clamped to [-1, 1], converted to Int16 PCM, wrapped in a Node.js Buffer, and sent via IPC to the main process.

6. **Connect the audio graph**:
   ```typescript
   source.connect(processor);
   processor.connect(muteGain);
   muteGain.connect(audioContext.destination);
   ```
   Audio flows: Microphone → ScriptProcessor (capture) → GainNode (mute) → Output (silence). The mute gain ensures the user doesn't hear their own microphone through their speakers.

7. **Store the recorder handle**:
   ```typescript
   activeRecorder = { stream, audioContext, source, processor, muteGain };
   ```

#### Stopping a Recording

`transcription.stop()` calls `stopLocalTranscription()`:

1. **Guard check**: If `activeRecorder` is null, nothing to stop.
2. **Capture and clear the handle**: `const recorder = activeRecorder; activeRecorder = null;` — prevents double-stop.
3. **Disconnect all audio nodes**:
   ```typescript
   recorder.processor.disconnect();
   recorder.source.disconnect();
   recorder.muteGain.disconnect();
   recorder.processor.onaudioprocess = null;
   ```
4. **Stop all media tracks**: `recorder.stream.getTracks().forEach(track => track.stop())` — releases the microphone.
5. **Close the AudioContext**: `await recorder.audioContext.close()` — frees audio system resources.
6. **Notify main process**: `ipcRenderer.send('transcription:stop')` — the main process sends a stop signal to the Python service and closes the WebSocket.

#### Transcription Event Dispatching

The preload sets up three global IPC listeners at module load time (outside of any function):

```typescript
ipcRenderer.on('transcription:update', (_event, data) => {
  emitTranscription(data);
});
ipcRenderer.on('transcription:status', (_event, status) => {
  emitTranscriptionStatus(status);
});
ipcRenderer.on('transcription:error', (_event, error) => {
  emitTranscriptionError(error);
});
```

The `emit*` functions iterate over their respective `Set<callback>` and call each callback:

```typescript
function emitTranscription(data) {
  transcriptionListeners.transcription.forEach((listener) => listener(data));
}
```

When a React component calls `window.electronAPI.transcription.onTranscription(callback)`, the callback is added to the set. This allows multiple components (in both the overlay and app window, since they share the same preload) to independently listen for transcription events.

Note that unlike the `on*` methods in other API groups (which return cleanup functions), the transcription `on*` methods do NOT return cleanup functions. Callbacks are added to the set and remain there until the page is reloaded. This is a design choice — transcription events are relatively rare and the number of listeners is small, so the cost of not cleaning up is negligible.

---

## Chapter 6: React App Window UI

### Bootstrap Sequence

The app window's entry point is `app-ui/src/main.tsx`:

1. **Sentry Initialization**: `Sentry.init()` with:
   - DSN from `import.meta.env.VITE_SENTRY_DSN` (Vite injects env vars prefixed with VITE_)
   - Release version from `__APP_VERSION__` (defined in vite.config.ts via `define`)
   - PII scrubbing in `beforeSend` (same pattern as main process)
   - `integrations`: BrowserTracing for performance, Replay for session recording

2. **React Mount**: `createRoot(document.getElementById("root")).render(<App />)` — mounts the root component into the `<div id="root">` in index.html.

3. **CSS**: Imports `index.css` which contains Tailwind's base/components/utilities layers and all CSS custom properties for the design system.

### App.tsx -- The Root Component

`App.tsx` wraps the entire application in a provider stack:

```
Sentry.ErrorBoundary (catches React errors, reports to Sentry)
  └── QueryClientProvider (TanStack React Query — manages server state caching)
       └── TooltipProvider (Radix tooltip context)
            └── Toaster (shadcn toast notifications)
            └── Sonner (alternative toast library — provides richer notifications)
            └── HashRouter (React Router with hash-based URLs)
                 └── DeepLinkListener (listens for 'navigate-to-share' IPC, calls navigate())
                 └── Routes
                      ├── /share/c/:token → SharePage (public, no auth required)
                      ├── /share/p/:token → SharePromptPage (public, no auth required)
                      └── /* → AuthWrapper → nested routes
                                              └── / → Index (main app)
                                              └── * → NotFound
```

**Key architectural decision**: Share routes are OUTSIDE the AuthWrapper. This allows unauthenticated users to view shared prompts/collections. The AuthWrapper wraps only the main app routes.

**Deep Link Listener**: A component that subscribes to `window.electronAPI.onNavigateToShare(routePath)`. When the main process receives a `prmpt://` deep link, it sends the validated route path to the renderer, and this component calls `navigate(routePath)` to switch to the share view.

### AuthWrapper -- The Authentication Gate

`AuthWrapper` is the authentication state machine. It manages the app's authentication flow:

**State machine**: `authView` can be: `'loading'` | `'login'` | `'signup'` | `'onboarding'` | `'app'`

**Flow**:
1. On mount: Registers `onAuthStateChange` listener and calls `checkAuth()`
2. `checkAuth()` sends IPC to main process, which checks for existing Supabase session
3. Main process responds via `auth:state-changed` event:
   - If authenticated: Sets user state. If user is new (created_at within 2 minutes AND no `onboarding-completed-{userId}` in localStorage), shows onboarding. Otherwise shows app.
   - If not authenticated: Shows login view.

**AuthContext**: Created inside AuthWrapper. Provides `{ user, isLoading, signOut }` to all child components via React context. Components access it via `useAuth()` hook.

**Login Page**: Email/password form. Calls `electronAPI.signIn({email, password})`. Also has OAuth buttons (Google, GitHub) that call `electronAPI.signInWithOAuth(provider)` — this opens the system browser for OAuth flow.

**Signup Page**: Name, DOB, email, password form. Calls `electronAPI.signUp({name, dob, email, password})`.

**Onboarding Page**: Welcome screen shown after first signup. Explains the app, lets user configure initial settings. Sets `localStorage['onboarding-completed-{userId}'] = 'true'` when done.

### Index.tsx -- The Central Orchestrator

This is the largest component (~2000+ lines). It manages:

**State**:
- `currentView`: `'chat' | 'library' | 'settings' | 'history' | 'shared-library'` — which view is shown in the main content area
- `selectedChatId`: The currently selected chat
- `messages`: Array of messages for the current chat
- `recentChats`: List of chats for the sidebar
- `collections` / `savedPrompts`: Prompt library data
- `isGenerating` / `isStreaming`: Streaming state flags
- Per-chat composer state via `useChatUIState(selectedChatId)`: input text, mode (fast/thinking), selected skill, attached files

**Custom Hooks**:
- `useMessageTree()`: Manages branching message versions. Each user message can have multiple versions (edits), and each user version can have multiple assistant responses (regenerations). The tree tracks groupId + versionIndex for both user and assistant messages. This enables the "Version Navigator" UI that lets users browse between different edits and regenerations.
- `useSmoothStreaming()`: Buffers incoming streaming chunks and releases them character-by-character with a small delay, creating a smooth typing animation instead of chunky updates.
- `useChatUIState(chatId)`: Per-chat form state (input, mode, skill, files) that persists when switching between chats.
- `useScrollController()`: Auto-scrolls the chat to the bottom when new messages arrive, but stops auto-scrolling if the user manually scrolls up.

**Message Flow**:
1. User types in input, clicks send
2. `sendMessage` is called with `{chatId, content, mode, attachedFiles, forcedSkill, groupId, versionIndex}`
3. Main process creates the chat (if new), saves user message to Supabase
4. Main process sends `message-sent` IPC with `{chatId, chat, userMessage}`
5. React adds user message to state, initializes streaming
6. Main process streams optimization from Python, sends `optimization-chunk` events
7. `useSmoothStreaming` buffers and smoothly renders chunks
8. Main process sends `message-received` with final assistant message
9. React finalizes the message in state, stops streaming

**View Switching**:
- `Sidebar` component shows navigation: "New Chat" and "Prompt Library"
- `ProfileMenu` dropdown has "Settings" option
- The sidebar also shows recent chats with rename/delete context menus
- Clicking a chat loads its messages via `loadMessages(chatId)`

### ChatView -- The Chat Interface

`ChatView` renders the message list and input area:

- **Message Bubbles**: Each message is rendered as a `MessageBubble` component. User messages are right-aligned, assistant messages are left-aligned. Assistant messages support markdown rendering.
- **Version Navigator**: When a message has multiple versions (user edits or assistant regenerations), a `VersionNavigator` component shows "Version 1 of 3" with arrow buttons to navigate between versions.
- **PlusMenu**: A button that opens a menu for attaching files (PDFs, images) and selecting skills (coding, creative, business, etc.).
- **Mode Toggle**: A dropdown to switch between Fast mode and Thinking mode. Fast mode uses keyword-based strategy selection for quick responses. Thinking mode loads full skill files and system prompts for deeper optimization.
- **File Preview**: `FilePreviewModal` opens attached PDFs in an embedded viewer (using Chromium's built-in PDF plugin).
- **Regenerate**: Users can click a regenerate button on assistant messages. This calls `regenerateResponse` which sends the previous output to Python so it generates a distinctly different optimization.
- **Copy**: Each assistant message has a copy button that calls `electronAPI.copyToClipboard(text)`.
- **Feedback**: Thumbs up/down buttons on assistant messages that save feedback via `saveFeedback(messageId, rating)`.

### PromptLibrary -- Collections and Saved Prompts

The prompt library lets users save and organize optimized prompts:

- **Collections**: Folders for organizing prompts. CRUD operations via `promptLibrary.createCollection()`, `renameCollection()`, `deleteCollection()`.
- **Saved Prompts**: Each prompt has a title, content, and optional metadata. CRUD via `promptLibrary.savePrompt()`, `updatePrompt()`, `deletePrompt()`.
- **Favorites**: Toggle favorites via `promptLibrary.toggleFavorite(promptId)`.
- **Search**: Client-side filtering of prompts by title and content.
- **Sharing**: Generate share links for collections (`getShareLink()`) and individual prompts (`getPromptShareLink()`). Generates HMAC-based share tokens stored in Supabase.
- **Import Shared**: Paste a `prmpt://share/...` URL to import a shared collection or view a shared prompt.

### SettingsView -- Configuration

Three tabs:

1. **Profile**: Avatar upload (via Cloudinary), display name, email (read-only), date of birth. Account deletion (GDPR) at the bottom.
2. **Customize**: Theme toggle (light/dark), font size selector, font family selector, custom prompt instructions (free text that gets appended to every optimization as `custom_instructions`).
3. **Memory**: The `MemoryView` component. Shows user memories organized by type (user facts, behavioral patterns, context facts). Each memory entry can be edited or deleted. Memory can be toggled on/off globally.

**Settings persistence**: `lib/settings.ts` loads settings from Supabase (via `electronAPI.loadSettings()`), caches in localStorage, and applies them to the DOM (dark mode class, font classes). On save, writes to Supabase and broadcasts to overlay via `electronAPI.send('overlay:settings-update', newSettings)`.

### Component Library -- shadcn/ui

The app uses the shadcn/ui pattern:

- Components live in `app-ui/src/components/ui/` — they are NOT installed from npm. They are source code templates that you own and customize.
- Each component is built from Radix UI primitives (headless, accessible, unstyled) + Tailwind CSS classes.
- The `cn()` utility from `lib/utils.ts` combines `clsx` (conditional class joining) + `tailwind-merge` (resolves conflicting Tailwind classes).
- Example components: Button, Dialog, DropdownMenu, Tabs, Toast, Tooltip, ScrollArea, Select, Input, Textarea, Avatar, Badge, Card, Command (command palette), etc.
- All components use `class-variance-authority` (CVA) for variant definitions (e.g., Button variants: default, destructive, outline, ghost).

### Design System (index.css)

The design system uses CSS custom properties (variables) for all colors:

```css
:root {
  --background: 220 14% 96%;
  --foreground: 224 71% 4%;
  --primary: 217 91% 60%;
  /* ... etc */
}

.dark {
  --background: 224 71% 4%;
  --foreground: 210 20% 98%;
  --primary: 217 91% 60%;
  /* ... etc */
}
```

Colors are stored as HSL values (without the `hsl()` wrapper). Tailwind references them as `hsl(var(--background))`. This allows runtime theme switching by toggling the `dark` class on `<html>`.

The app defaults to dark mode: `@apply dark` on the `html` element in CSS.

Font stack: Inter (loaded locally), system-ui, sans-serif.

---

## Chapter 7: The Overlay System -- Engineering a Flicker-Free Popup

### The Problem

On Windows, transparent frameless `BrowserWindow`s (transparent: true, frame: false) exhibit a visual artifact on first display: a brief flash or "ghost frame" where the window appears partially faded before fully rendering. This happens because the Windows Desktop Window Manager (DWM) needs to initialize an alpha compositor surface for the transparent window.

The DWM (Desktop Window Manager) is the Windows compositing engine. Since Windows Vista, all windows are rendered to off-screen buffers, then composited by DWM onto the screen. For transparent windows, DWM creates an alpha-aware compositor surface. The first time a transparent window is shown, DWM must allocate this surface, which takes 1-2 frames. During this time, the window appears partially transparent or shows a stale frame.

### The Solution: Compositor Pre-Heat

Instead of showing and hiding the overlay window, the app uses a "positional" open/close strategy:

1. **At startup**: Create the window, show it off-screen at coordinates (-9999, -9999) via `showInactive()`. This triggers DWM to create and stabilize the alpha compositor surface. The user cannot see this because it's way off-screen.

2. **To "open"**: Move the window to the correct on-screen position near the cursor. No `window.show()` call needed — the window is already "shown" (just positioned off-screen).

3. **To "close"**: Move the window back to (-9999, -9999) and call `blur()`. No `window.hide()` call — hiding would destroy the compositor surface, causing the flicker again on next show.

This eliminates all DWM transition animations and flicker because the window's compositor state is never torn down.

### Implementation Details

**OverlayWindowManager** manages three boolean flags:
- `isLoaded`: true after renderer is ready AND compositor pre-heat is complete
- `shouldShowOnReady`: true if open() was called before isLoaded (deferred open)
- `isOpen`: true when the window is logically visible to the user (on-screen)

**Window Creation** (`createWindow()`):
```
BrowserWindow({
  width: 520, height: 600,
  frame: false,           // No native title bar
  transparent: true,      // Fully transparent background
  alwaysOnTop: true,      // Above all other windows
  skipTaskbar: true,      // Don't show in taskbar
  resizable: false,
  movable: true,
  show: false,            // Initially hidden (will be pre-heated)
  focusable: true,
  hasShadow: false,       // No drop shadow
  backgroundColor: '#00000000',  // Fully transparent
  webPreferences: {
    backgroundThrottling: false,  // Keep renderer active when off-screen
  }
})
```

`backgroundThrottling: false` is critical — without it, Chromium would throttle the renderer process when the window is not visible (off-screen), causing a stale framebuffer on the next move to on-screen.

`setAlwaysOnTop(true, 'screen-saver')` sets the highest z-order level, placing the overlay above even screenshot tools and screen capture UIs.

**Compositor Pre-Heat** (`preheatCompositor()`):
1. `window.webContents.invalidate()` — forces a fresh render
2. `window.setPosition(OFFSCREEN_X, OFFSCREEN_Y)` — park off-screen
3. `window.showInactive()` — trigger DWM compositor creation without stealing focus
4. `await executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')` — wait two full animation frames for the alpha surface to stabilize
5. `isLoaded = true`

Two triggers for pre-heat:
- **Primary**: Renderer sends `overlay:ready` IPC (via `notifyReady()` in preload) after React has mounted and painted its first frame
- **Fallback**: If `overlay:ready` never arrives (preload error), `did-finish-load` + 200ms timeout triggers pre-heat

**Open** (`open()`):
1. Send `overlay:opened` IPC with `{isAuthenticated, prefill, triggeredByHook, sentryUser}`
2. Call `positionNearCursor()` — calculates position near mouse cursor, clamped to screen bounds
3. If `isLoaded`: call `showAndFocus()` (just sets `isOpen = true` and focuses — no `show()` call)
4. If not loaded: set `shouldShowOnReady = true` (deferred until pre-heat completes)

**Position Near Cursor** (`positionNearCursor()`):
- Gets cursor position via `screen.getCursorScreenPoint()`
- Gets display nearest to cursor via `screen.getDisplayNearestPoint(cursor)`
- Places overlay 10px right and 24px below cursor
- If overlay would go past right edge: flip to left of cursor
- If overlay would go below bottom edge: position above cursor
- Clamp to work area bounds

**Focus Stealing** (`focusWindow()`):
On Windows, `BrowserWindow.focus()` often fails when another application holds the foreground lock. The app uses the Rust native module for reliable focus:
1. Get overlay's HWND via `window.getNativeWindowHandle().readBigInt64LE(0)`
2. Call `forceFocusWindow(Number(overlayHwnd))` which:
   - Calls `AllowSetForegroundWindow(ASFW_ANY)` — allows any process to set foreground
   - Gets current foreground thread via `GetWindowThreadProcessId`
   - Calls `AttachThreadInput` — attaches the overlay's thread to the foreground thread's input queue
   - Calls `SetForegroundWindow` — sets the overlay as foreground
   - Calls `BringWindowToTop` + `ShowWindow`
   - Calls `AttachThreadInput` again to detach
3. If Rust focus fails, falls back to `window.focus()`

**Close** (`close()`):
1. Set `isOpen = false`
2. `window.setPosition(OFFSCREEN_X, OFFSCREEN_Y)` — park off-screen
3. `window.blur()` — release focus so the previous app regains foreground

**Toggle** (`toggle()`): If `isOpen`, close. Otherwise, open.

### The Overlay React App

The overlay has its own entry point (`overlay/main.tsx`), separate from the main app. It initializes Sentry with `window: 'overlay'` tag, calls `notifyReady()` after first paint via `requestAnimationFrame`, then renders `OverlayApp`.

**OverlayApp** structure:
```
Header (minimize buttons, settings icon, mode toggle)
├── If not authenticated: AuthGate ("Please open the app to sign in")
└── If authenticated:
    ├── OfflineBanner (shown when network is offline)
    ├── ChatArea (scrollable list of user/assistant turns)
    └── InputSection (text input, attach files, skills, send button, voice input)
    └── Modals: ChatPicker (save to existing chat), CollectionPicker (save to library)
```

**useTurns() hook**: The overlay uses a turn-based conversation model. Each "turn" consists of a user message and an assistant response. The hook tracks:
- Array of turns, each with `userVersions[]` and `assistantVersionGroups[]`
- Current version indices for user and assistant messages
- `registerUserMessage()` and `registerAssistantMessage()` for adding new entries
- Version navigation (next/previous user version, next/previous assistant version)

**Settings sync**: When settings change in the main app, `overlay:settings-update` IPC delivers the new settings. The overlay applies them (theme, font) via `applySettings()`.

---

## Chapter 8: The Native Rust Module -- Cross-Platform Deep Dive

### Overview

The native module lives in **a single Rust crate** at `native/platform-core/` (renamed from `windows-core` once the macOS backend landed — the directory name was platform-specific by accident and is now neutral). The crate is compiled via `napi-rs` to **two `.node` binaries**, both checked into the repo:

- `native/platform-core/platform-core.win32-x64-msvc.node` — Windows x64 (built with `npm run native:build`)
- `native/platform-core/platform-core.darwin-arm64.node` — macOS Apple Silicon (built with `npm run native:build:mac`)

A loader at `native/platform-core/index.js` selects the right binary at runtime based on `process.platform` + `process.arch`. `electron/main/utils/native-bridge.ts` lazy-`require()`s through this loader and exposes a uniform JS API across platforms (with stub fallbacks if neither binary loads).

The exported N-API surface — same on both platforms, but each function dispatches internally via `#[cfg(target_os = …)]`:

1. `getActiveWindowTitle()` — title of the currently focused window
2. `startHook(callback)` — installs a global keyboard hook that calls `callback` when `@prompt` is typed
3. `stopHook()` — removes the keyboard hook
4. `replaceAtLastAnchor(text)` — replaces the `@prompt` trigger text with `text` in the originating window
5. `pasteTextToWindow(target, text)` — pastes at the current cursor position in a specific window/process
6. `sendEnterToWindow(target)` — sends an Enter keystroke to a specific window/process (used by `overlay:insert-section` to auto-submit in chat apps)
7. `forceFocusWindow(target)` — forces a window/process to the foreground, bypassing platform foreground-stealing protections
8. `checkAccessibilityPermission()` — Windows: returns `true` (no-op). macOS: wraps `AXIsProcessTrustedWithOptions`.

> **`TriggerData.hwnd` is platform-overloaded.** On Windows it's a real `HWND`. On macOS it's the **PID** of the frontmost application, resolved via `NSWorkspace.frontmostApplication`. The JS layer never interprets it — it just round-trips the integer back into the next native call.

### Backend Dispatch Table

| Function | Windows backend | macOS backend |
|---|---|---|
| `startHook(cb)` | `SetWindowsHookExW(WH_KEYBOARD_LL, …)` on a dedicated message-pump thread | `CGEventTapCreate(kCGSessionEventTap, listenOnly)` attached to `CFRunLoopGetMain` |
| `stopHook()` | `PostThreadMessageW(WM_QUIT)` to the hook thread, then join | `CGEventTapEnable(false)` + remove from run loop |
| `replaceAtLastAnchor(text)` | `SetForegroundWindow` → `Shift+Left × N` → `KEYEVENTF_UNICODE` injection | save pasteboard → `CGEventPost` Backspace × N → set pasteboard to text → `CGEventPost` `Cmd+V` → 30 ms sleep → restore pasteboard |
| `pasteTextToWindow(target, text)` | `SetForegroundWindow(hwnd)` → SendInput | `osascript tell process X to activate` (PID) → `CGEventPost` `Cmd+V` (with clipboard swap) |
| `sendEnterToWindow(target)` | `SendInput VK_RETURN` to focused control of `hwnd` | `CGEventPost` `kVK_Return` to PID |
| `forceFocusWindow(target)` | `AttachThreadInput` + `AllowSetForegroundWindow` + `SetForegroundWindow` | `osascript tell application process "X" to activate` |
| `getActiveWindowTitle()` | `GetForegroundWindow` + `GetWindowTextW` | `osascript` against System Events (frontmost-app fallback) |
| `checkAccessibilityPermission()` | `true` (no-op) | `AXIsProcessTrustedWithOptions` |

Inside `src/`, the shared module `hook.rs` exposes `on_char_keydown(char)` which both backends call after translating their native key event into a character. The ring buffer in `buffer.rs` lives entirely in this shared layer and never touches platform-specific types.

The Windows-specific deep dive in the rest of this chapter — message pump threads, `WH_KEYBOARD_LL`, `LLKHF_INJECTED`, UI Automation, the three-path replacement engine, clipboard-restore atomic — all describes the **Windows backend only**. The macOS backend is covered in **Chapter 38: Cross-Platform Support — Windows and macOS**, which walks through `CGEventTap`, `CGEventPost`, the clipboard-swap window, the Accessibility permission flow, and the macOS replacement edge cases.

### How Global Keyboard Hooks Work (WH_KEYBOARD_LL)

Windows provides the `SetWindowsHookExW` API to install "hooks" — functions that intercept system events before they reach their target. `WH_KEYBOARD_LL` is a "low-level keyboard hook" that intercepts ALL keystrokes system-wide, before any application processes them.

**How it works at the OS level**:
1. Your application calls `SetWindowsHookExW(WH_KEYBOARD_LL, hookProc, hModule, 0)`:
   - `WH_KEYBOARD_LL`: hook type (low-level keyboard)
   - `hookProc`: your callback function
   - `hModule`: handle to the DLL/module containing the callback (for global hooks)
   - `0`: thread ID (0 = all threads = global hook)
2. Windows registers your callback in the system hook chain
3. When ANY keystroke occurs ANYWHERE in the system:
   - The input travels from the keyboard driver through the Windows message system
   - Before the keystroke reaches the target application, Windows calls your `hookProc`
   - Your callback receives a `KBDLLHOOKSTRUCT` containing: virtual key code (vkCode), scan code, flags (including `LLKHF_INJECTED` for synthetic input), timestamp
   - Your callback MUST call `CallNextHookEx` to pass the event to the next hook in the chain
   - If your callback blocks or takes too long (>300ms per Microsoft docs), Windows removes the hook

**Critical requirement**: The hook callback runs on a thread with a message pump. The `GetMessage` / `TranslateMessage` / `DispatchMessage` loop is required for the Windows message system to deliver keyboard events to your callback. Without this loop, Windows cannot call your hook proc.

### The Hook Thread (hook.rs)

The Rust module creates a dedicated thread for the keyboard hook:

```rust
// Simplified flow
std::thread::spawn(|| {
    // Install the hook on THIS thread
    let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(ll_keyboard_proc), hmod, 0);
    
    // Message pump — required for the hook to receive events
    loop {
        let msg = GetMessage(...);
        if msg == 0 || msg == -1 { break; } // WM_QUIT or error
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
    
    // Cleanup
    UnhookWindowsHookEx(hook);
});
```

**Why a dedicated thread?** The hook callback must run on a thread with a message pump. Node.js's main thread has its own event loop (libuv), not a Windows message pump. Running the hook on a dedicated thread with its own message pump ensures:
1. Keyboard events are delivered reliably
2. The hook callback doesn't block the Node.js event loop
3. The hook callback can call Win32 APIs freely

**Stopping the hook**: The main thread calls `PostThreadMessageW(thread_id, WM_QUIT, 0, 0)` to send a WM_QUIT message to the hook thread. The `GetMessage` loop returns 0 for WM_QUIT, breaking the loop. The thread then calls `UnhookWindowsHookEx` and exits. The main thread joins the hook thread to ensure clean shutdown.

### The Keyboard Callback (ll_keyboard_proc)

```rust
unsafe extern "system" fn ll_keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let kb = *(lparam.0 as *const KBDLLHOOKSTRUCT);
        
        // CRITICAL: Skip injected keys (from SendInput, clipboard paste, etc.)
        // Without this, our own text replacement would feed back into the hook
        if kb.flags & LLKHF_INJECTED != 0 {
            return CallNextHookEx(None, code, wparam, lparam);
        }
        
        if wparam.0 == WM_KEYDOWN as usize || wparam.0 == WM_SYSKEYDOWN as usize {
            handle_keydown(kb.vkCode, kb.flags);
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}
```

**LLKHF_INJECTED flag**: When `SendInput` or other APIs inject keystrokes, Windows sets this flag. The hook MUST skip these events — otherwise, when the replacement engine types the optimized text (via `SendInput` or clipboard paste), those keystrokes would feed back into the rolling buffer and potentially trigger another `@prompt` detection, causing an infinite loop.

**`CallNextHookEx`**: ALWAYS called at the end. The hook is an OBSERVER — it never consumes or blocks keystrokes. Every key event passes through to the target application unchanged. The hook only monitors the input stream.

### The Rolling Buffer and @prompt Detection (buffer.rs)

```rust
const TRIGGER: &str = "@prompt";
const MAX_LEN: usize = 64;

struct RollingBuffer {
    chars: Vec<char>,
}

impl RollingBuffer {
    fn push(&mut self, ch: char) {
        self.chars.push(ch);
        if self.chars.len() > MAX_LEN {
            self.chars.remove(0);
        }
    }
    
    fn ends_with_trigger(&self) -> bool {
        let s: String = self.chars.iter().collect();
        s.ends_with(TRIGGER)
    }
    
    fn clear(&mut self) {
        self.chars.clear();
    }
}
```

The buffer maintains the last 64 characters typed. On each keydown:

1. Track modifier state (Shift up/down)
2. If Backspace: remove last character from buffer
3. If Enter, Escape, or Tab: clear the entire buffer (these keys typically indicate the user is done typing or switching context)
4. Otherwise: map the virtual key code to a printable character via `vk_to_char()` (keymap.rs), push into buffer
5. Check `ends_with_trigger()` — if the last 7 characters are "@prompt":
   - Clear the buffer
   - Store anchor: `{hwnd: GetForegroundWindow(), trigger_len: 7, timestamp_ms}`
   - Call the JavaScript callback via `ThreadsafeFunction.call(Ok(TriggerData), NonBlocking)`

### Key Mapping (keymap.rs)

`vk_to_char(vk_code, shift_pressed) -> Option<char>` maps Windows virtual key codes to printable ASCII characters using a US QWERTY keyboard layout:

- Letters (0x41-0x5A): lowercase by default, uppercase with Shift
- Digits (0x30-0x39): digit by default, symbols with Shift (!, @, #, $, %, ^, &, *, (, ))
- OEM keys: period, comma, semicolon, slash, brackets, etc. with Shift variants
- Space (0x20): space character

### The Replacement Engine (replacement.rs)

After the AI produces optimized text and the user clicks "Insert", the main process calls `replaceAtLastAnchor(text)`. This function must:
1. Focus the original window (where @prompt was typed)
2. Select the "@prompt" text (7 characters)
3. Replace it with the optimized text

This is remarkably complex because different Windows applications handle text input differently.

**Step 1: Retrieve and validate the anchor**

```rust
// LAST_ANCHOR is a Mutex<Option<Anchor>> set by the keyboard hook
let anchor = LAST_ANCHOR.lock().unwrap().take(); // Take once (consume)
if anchor.is_none() { return false; }
let anchor = anchor.unwrap();

// Verify the window still exists
if !IsWindow(HWND(anchor.hwnd as isize)) { return false; }
```

**Step 2: Focus the original window**

```rust
SetForegroundWindow(hwnd);
std::thread::sleep(Duration::from_millis(60)); // Wait for focus transition
```

**Step 3: Try replacement paths (A -> B -> C)**

**Path A: Win32 Edit Controls**

Some applications use standard Win32 Edit or RichEdit controls. These have well-defined message APIs:

```rust
// Get the GUI thread info to find the focused control
let mut gui_info = GUITHREADINFO { ... };
GetGUIThreadInfo(thread_id, &mut gui_info);
let focused_hwnd = gui_info.hwndFocus;

// Check if it's an Edit or RichEdit control
let class_name = GetClassNameW(focused_hwnd);
if class_name starts with "Edit" or "RichEdit" {
    // Get current selection
    SendMessage(focused_hwnd, EM_GETSEL, &start, &end);
    
    // Select the trigger text (7 chars back from cursor)
    SendMessage(focused_hwnd, EM_SETSEL, end - trigger_len, end);
    
    // Replace selection with optimized text
    SendMessage(focused_hwnd, EM_REPLACESEL, TRUE, text_ptr);
    return true;
}
```

This is the cleanest path — it directly manipulates the text buffer without clipboard or keyboard simulation.

**Path B: UI Automation (COM)**

For modern applications (WPF, UWP, Electron-based apps, browsers), the Edit control API doesn't work. UI Automation is Microsoft's accessibility framework that provides a uniform interface to UI elements across different frameworks.

```rust
// Initialize COM
CoInitializeEx(None, COINIT_APARTMENTTHREADED);

// Create UI Automation instance
let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER);

// Get the element at the focused window
let element = automation.ElementFromHandle(hwnd);

// Get the TextPattern interface (if the element supports text editing)
let text_pattern: IUIAutomationTextPattern = element.GetCurrentPattern(UIA_TextPatternId);

// Get current selection range
let selection = text_pattern.GetSelection();
let range = selection.GetElement(0);

// Move the start of the selection back by trigger_len characters
range.MoveEndpointByUnit(TextPatternRangeEndpoint_Start, TextUnit_Character, -trigger_len);

// Select the range
range.Select();

// Brief pause for the application to process the selection
std::thread::sleep(Duration::from_millis(50));

// Paste the replacement text via clipboard
inject_via_clipboard_paste(text);
```

**Path C: Fallback (Backspace + Clipboard Paste)**

If both Path A and Path B fail, use the most universal (but least elegant) approach:

```rust
// Delete @prompt by simulating Backspace key presses
for _ in 0..trigger_len {
    send_input_key(VK_BACK, true);  // key down
    send_input_key(VK_BACK, false); // key up
    std::thread::sleep(Duration::from_millis(10));
}

// Paste replacement text via clipboard
inject_via_clipboard_paste(text);
```

### Clipboard Management

The `inject_via_clipboard_paste(text)` function:

1. **Save current clipboard**: Open clipboard, get current CF_UNICODETEXT data, save it
2. **Set new text**: GlobalAlloc, copy text bytes, SetClipboardData(CF_UNICODETEXT, handle)
3. **Verify**: Check `GetClipboardSequenceNumber()` changed (retry once if not)
4. **Close clipboard**: CloseClipboard()
5. **Wait for listeners**: Sleep 150ms (other apps may be monitoring clipboard changes)
6. **Simulate Ctrl+V**: 
   ```rust
   send_input_key(VK_CONTROL, true);
   send_input_key(VK_V, true);
   send_input_key(VK_V, false);
   send_input_key(VK_CONTROL, false);
   ```
7. **Schedule clipboard restore**: After 500ms, restore the original clipboard content. Uses an `RESTORE_CANCELLED` atomic boolean — if a new replacement starts within 500ms, the restore is cancelled to avoid overwriting the new content.

**Why clipboard paste instead of SendInput for each character?** Two reasons:
1. **Performance**: Sending individual character keystrokes via `SendInput` for a long text (hundreds of characters) is slow and unreliable. Clipboard paste is a single atomic operation.
2. **Unicode support**: `SendInput` with `KEYEVENTF_UNICODE` can send individual Unicode characters, but some applications don't process them correctly. Clipboard paste is universally supported.

**The race condition**: Between saving the clipboard and restoring it 500ms later, the user might copy something. The 500ms delay is a trade-off — short enough to minimize this risk, long enough for the paste operation to complete. The `RESTORE_CANCELLED` atomic prevents restoration if a new replacement starts.

### Win32 APIs Reference

| API | Purpose in this codebase |
|-----|--------------------------|
| `SetWindowsHookExW(WH_KEYBOARD_LL, ...)` | Install global keyboard hook |
| `UnhookWindowsHookEx(hook)` | Remove keyboard hook |
| `CallNextHookEx(None, ...)` | Pass key event to next hook |
| `GetMessage / TranslateMessage / DispatchMessage` | Message pump for hook thread |
| `PostThreadMessageW(id, WM_QUIT, ...)` | Signal hook thread to stop |
| `GetForegroundWindow()` | Get HWND of currently focused window |
| `GetWindowTextW(hwnd, ...)` | Get window title text |
| `IsWindow(hwnd)` | Check if HWND is still valid |
| `SetForegroundWindow(hwnd)` | Bring window to foreground |
| `BringWindowToTop(hwnd)` | Bring window to top of z-order |
| `ShowWindow(hwnd, SW_SHOW)` | Ensure window is visible |
| `AllowSetForegroundWindow(ASFW_ANY)` | Allow any process to set foreground |
| `GetWindowThreadProcessId(hwnd)` | Get thread ID of a window |
| `AttachThreadInput(from, to, true)` | Attach input queues of two threads |
| `GetGUIThreadInfo(thread, info)` | Get focused control HWND |
| `GetClassNameW(hwnd)` | Get window class name (Edit, RichEdit, etc.) |
| `SendMessageW(hwnd, EM_GETSEL/SETSEL/REPLACESEL, ...)` | Edit control manipulation |
| `CoInitializeEx / CoCreateInstance` | COM initialization + create UI Automation |
| `OpenClipboard / SetClipboardData / CloseClipboard` | Clipboard manipulation |
| `GetClipboardSequenceNumber()` | Clipboard change verification |
| `GlobalAlloc / GlobalLock / GlobalUnlock` | Allocate memory for clipboard data |
| `SendInput(...)` | Simulate keyboard input (Ctrl+V, Backspace) |

### Non-Windows Builds

All functions are conditionally compiled with `#[cfg(target_os = "windows")]`. On non-Windows platforms (macOS, Linux), the functions are stubs:
- `getActiveWindowTitle()` returns `""`
- `startHook()` / `stopHook()` do nothing
- `replaceAtLastAnchor()` returns `false`
- `forceFocusWindow()` returns `false`

This allows the Rust crate to compile on all platforms — the binary just doesn't provide any functionality on non-Windows. The `native-bridge.ts` module also has its own stub fallback for when the `.node` binary is missing entirely.


---

## Chapter 9: Python AI Service -- The Optimization Engine

### Service Overview

The Python service (`python-service/`) is a standalone FastAPI application that handles all AI/ML workloads. It runs as a separate process on `localhost:8001`, communicating with Electron via HTTP and WebSocket.

**Why a separate Python service?** Python has the richest ML/AI ecosystem. Libraries like LiteLLM, faster-whisper, PyTorch, PyMuPDF, and the Silero VAD model are only available in Python. Rather than trying to run Python from within Electron (complex, fragile), the app runs Python as a separate local service and communicates over localhost HTTP/WebSocket.

### FastAPI Application Setup (main.py)

**Environment Loading**:
The very first thing `main.py` does is load `.env` from the project root (two directories up from `app/main.py`). This happens BEFORE any pipeline imports, ensuring `os.environ` is populated when `config.py` reads `OPENROUTER_API_KEY` etc. Uses `python-dotenv` with `override=False` (system env vars take precedence).

**UTF-8 Encoding Fix**: On Windows, the default console encoding is cp1252. The service reconfigures stdout/stderr to UTF-8 to prevent crashes from emoji and non-ASCII characters in LLM responses.

**Sentry Initialization**: Initializes `sentry_sdk` with:
- DSN from `SENTRY_PYTHON_DSN`
- PII scrubbing via `_scrub_prompts` (same pattern as Electron: redacts keys containing "prompt", "content", "message", "text")
- `LoggingIntegration`: INFO-level logs become Sentry breadcrumbs, ERROR-level logs become Sentry events
- `send_default_pii=False`: Never send user data to Sentry

**Middleware Stack** (applied in order):
1. `RequestIDMiddleware`: Adds `X-Request-ID` header to every response. Uses client's `X-Request-ID` if provided, otherwise generates a UUID.
2. `SlowAPIMiddleware` + `Limiter`: Rate limiting. Default: 60 requests/minute per IP, 200 requests/minute application-wide.
3. `CORSMiddleware`: Configures Cross-Origin Resource Sharing. Defaults to localhost origins. `ALLOWED_ORIGINS` env var overrides (comma-separated list, or `*` for all).

**Startup Event**: On server start, runs three warmup tasks in parallel:
1. `_warmup_openrouter()`: Makes a tiny 1-token LLM call to establish the HTTP connection pool to OpenRouter (avoids cold-start latency on first real request)
2. `_load_whisper()`: Preloads the faster-whisper "small" model (244 MB download on first run, then cached)
3. `_load_vad()`: Preloads the Silero VAD model from torch.hub

### Configuration (pipeline_v2/config.py)

Centralized model and API key configuration. Every module imports from here:

```python
OPTIMIZER_MODEL  = os.environ.get("OPTIMIZER_MODEL",  "openrouter/openai/gpt-4o-mini")
SUMMARIZER_MODEL = os.environ.get("SUMMARIZER_MODEL", "openrouter/openai/gpt-4o-mini")
TITLE_MODEL      = os.environ.get("TITLE_MODEL",      SUMMARIZER_MODEL)
MEMORY_MODEL     = os.environ.get("MEMORY_MODEL",     SUMMARIZER_MODEL)
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")
```

To change models, update `.env` — no code changes needed. `TITLE_MODEL` and `MEMORY_MODEL` default to `SUMMARIZER_MODEL` (cheap/fast model for non-critical tasks).

### Authentication (app/auth.py)

**JWT Verification**:
- When `SUPABASE_JWT_SECRET` is set: Verifies the JWT using `PyJWT` with HS256 algorithm, audience="authenticated". Returns the decoded payload (containing `sub` = user ID, `role`, etc.).
- When unset in production (`APP_ENV=production`): The service EXITS immediately — fail-closed security.
- When unset in development: Logs a warning, returns `{"sub": "dev-user", "role": "authenticated"}` — auth is bypassed for local development.

**HTTP auth** (`require_auth`): Uses FastAPI's `HTTPBearer(auto_error=False)`. Extracts the Bearer token from the `Authorization` header. Missing token returns 401.

**WebSocket auth** (`require_ws_auth`): Extracts token from `?token=` query parameter. On failure, closes the WebSocket with code 4001. This is necessary because WebSocket connections don't support standard HTTP Authorization headers.

### The /optimize Endpoint (POST)

Non-streaming prompt optimization:

1. **Auth**: JWT verified via `require_auth`
2. **Validation**: Pydantic validates `OptimizeRequest` (prompt: 3-50000 chars, messages: max 100, mode: string, custom_instructions: max 10000)
3. **Regeneration handling**: If `skip_cache=true`, appends `[REGENERATE_<microsecond_timestamp>]` to the prompt so it misses the cache
4. **Cache check**: `TTLCache(maxsize=200, ttl=300)` — 200 entries, 5-minute TTL, keyed by original prompt text
5. **Clean regeneration tag**: Strips `[REGENERATE_...]` before sending to LLM
6. **Build ChatContext**: Creates ephemeral `ChatContext` with a new UUID session ID, adds messages from request
7. **Call pipeline**: `pipeline_optimize(user_input, cc, model, provider, stream=False, mode, custom_instructions)`
8. **Clean output**: `clean_optimized_text()` strips markdown code fences, meta-prefixes ("Here's the optimized prompt:"), and surrounding quotes
9. **Cache result**: Store in TTLCache
10. **Return**: `{optimized, original, model, latency_ms}`

### The /ws/optimize-stream WebSocket

Streaming optimization — the primary path used by the app:

**Connection setup**:
1. Auth via `require_ws_auth` (token in query param)
2. `websocket.accept()`
3. Enter receive loop — each JSON message is a new optimization request

**Per-request flow**:
1. Parse JSON: `request_id`, `prompt`, `previous_output`, `messages`, `mode`, `custom_instructions`, `attached_files`, `forced_skill`, `sentry_trace`, `baggage`, `user_id`
2. **Rate limit**: If `user_id` available, check `_check_rate_limit(user_id)`. Daily limit (default 50, env `DAILY_REQUEST_LIMIT`) keyed by `user_id:YYYY-MM-DD`. Resets at midnight UTC. Counters are in-memory (not persisted).
3. **Sentry tracing**: If `sentry_trace` header provided, continue the distributed trace from Electron. Otherwise start a new transaction.
4. **Validation**: Max 5 attached files, prompt >= 3 chars
5. **Build ChatContext**: From `messages` array
6. **Acquire semaphore**: `_optimize_semaphore` limits concurrent optimizations (default 50)
7. **Thread + Queue pattern**: The LLM streaming generator is blocking (runs synchronously). To avoid blocking the asyncio event loop:
   - Create an `asyncio.Queue`
   - Run the blocking generator in a thread via `loop.run_in_executor(None, run_stream)`
   - The thread pushes chunks to the queue via `loop.call_soon_threadsafe(chunk_queue.put_nowait, chunk)`
   - The async loop reads from the queue: `chunk = await chunk_queue.get()`
   - Thread signals completion with a `None` sentinel
8. **Stream chunks**: For each chunk from the queue, send `{type: "chunk", request_id, content, accumulated}`
9. **Complete**: After all chunks, send `{type: "complete", request_id, optimized: cleaned_text, original, models_used}`
10. **Error**: On exception, send `{type: "error", request_id, message}`

**Why the Thread + Queue pattern?** LiteLLM's streaming generator is synchronous — it blocks while waiting for the next token from the LLM API. If we ran this directly in an async handler, it would block the entire asyncio event loop, preventing other WebSocket connections from being served. By running the generator in a thread pool executor, the event loop stays free to handle other requests.

### Pipeline V2 Architecture

The optimization pipeline has two modes:

#### Fast Mode (pipeline_v2/fast_mode.py)

Optimized for speed. No skill files loaded, no context summarization.

1. **Detect prompt type**: `detect_prompt_type(prompt)` scans the lowercase prompt for keywords:
   - First checks a regex pattern for "app building" requests (build|create|make + app|website|platform...)
   - Then checks keyword lists for: coding, email, analysis, creative, image, documentation, business
   - Falls back to "general" if no match
   
2. **Get optimization strategy**: `get_optimization_strategy(prompt_type)` returns a specialized system prompt for the detected type. Each strategy:
   - Sets a role context ("You are an expert software engineer...")
   - Lists specific elements to include in the optimized prompt
   - Ends with "Return ONLY the optimized prompt"
   
3. **Build messages**: 
   - System message = `FAST_SYSTEM_PROMPT` (base rules) + detected strategy + optional custom_instructions
   - Include last 6 messages from ChatContext for conversational continuity
   - User message = optional `[ATTACHED CONTEXT]...` + user input + optional regeneration instruction
   - If vision parts exist: multimodal user message with text + image_url parts

4. **Call LLM**: `litellm.completion(model, messages, max_tokens=8192, temperature=0.7 or 0.95 for regen)`

The `FAST_SYSTEM_PROMPT` is critical — it establishes the core behavior:
- "Your output MUST be ONLY the exact improved prompt text"
- "If the user's input is a REFINEMENT, apply the new instruction to the PREVIOUS optimized prompt"
- Examples showing input/output pairs

#### Thinking Mode (pipeline_v2/optimizer.py)

Deeper optimization with skill files and context management.

1. **Load system prompt**: Reads `files/system_prompt_optimizer.md` from the project root
2. **Select skills** (`pipeline_v2/skills.py`):
   - If `forced_skill` provided: load that specific skill file
   - Otherwise: `select_skills(user_input)` scores 8 skill categories (technical, creative, business, communication, educational, visual, automation, research) by counting keyword matches. Returns top 2 scoring skills, or ["general"] if none match.
   - `load_skill_file(name)`: reads `files/skill_{name}.md` (LRU cached, max 16 entries)
   - Returns `(skill_names, concatenated_skill_content)`
   
3. **Context management**: If `cc.token_estimate() > 3000` tokens:
   - Call `summarize_context(cc, provider)`: Sends full chat history to `SUMMARIZER_MODEL` with `system_prompt_summarizer.md`, gets back a compressed JSON summary
   - `cc.compact_with_summary(summary, keep_recent=4)`: Replaces old messages with a `[CONVERSATION SUMMARY]` system message, keeps 4 most recent messages
   
4. **Build prompt**: Constructs a structured user prompt with sections:
   ```
   CHAT CONTEXT:
   {cc.to_text(max_messages=6)}
   
   LOADED SKILLS: technical, creative
   {skill file contents}
   
   USER REQUEST:
   {user input with optional attached context}
   ```

5. **Regeneration**: If `previous_output` is provided, appends a block telling the LLM not to reproduce the previous output and to generate a "DISTINCTLY DIFFERENT optimization." Temperature is raised from 0.7 to 0.95 for more variance.

6. **Call LLM**: Same as fast mode but with the richer prompt

#### LiteLLM Integration

LiteLLM is the abstraction layer for calling LLMs:

`_get_litellm_kwargs(provider, model)`: 
- If model starts with "openrouter/": uses `OPENROUTER_API_KEY` as `api_key` parameter
- Otherwise: passes through to LiteLLM's default provider routing

**Streaming**: `litellm.completion(..., stream=True, stream_options={"include_usage": True})` returns a generator. Each chunk has `chunk.choices[0].delta.content` (the text delta). The final chunk may include `usage` with token counts.

**Usage logging**: After streaming completes, `log_usage()` writes to `pipeline_v2/storage/usage/YYYY-MM-DD.jsonl` with model, tokens, latency, skills, and estimated cost.

#### Vision Model Support

`supports_vision(model)`: Checks if the model name (case-insensitive substring match) is in the `VISION_MODELS` set. This set includes:
- OpenAI: gpt-4o-mini, gpt-4o
- Anthropic: claude-3-5-sonnet, claude-3-5-haiku, claude-3-haiku, claude-haiku-4, claude-haiku-4.5
- Google: gemini-1.5-flash, gemini-1.5-pro

When vision is supported, image attachments are sent as OpenAI-format vision message parts: `{type: "image_url", image_url: {url: "data:image/png;base64,...", detail: "high"}}`.

### Document Parser (pipeline_v2/document_parser.py)

Handles file attachments (PDFs and images) sent with optimization requests.

**Security features**:
- **Magic byte validation**: Validates file content against known magic bytes (not file extension). PDF must start with `%PDF`, PNG with `\x89PNG\r\n\x1a\n`, JPEG with `\xff\xd8\xff`, etc.
- **10 MB size limit**: Per-file hard cap
- **8000 token text cap**: Prevents massive PDFs from consuming the entire context window
- **Injection sanitization**: Regex-based removal of common prompt injection patterns ("ignore all previous instructions", "you are now admin", etc.)
- **Graceful failure**: Failed files are logged but NOT injected into the LLM context — the optimization still proceeds with remaining files

**PDF parsing** (`parse_pdf`): Uses PyMuPDF (fitz) to extract text from each page. In-memory processing — no temp files. Concatenates page texts with `\n\n` separators. Wraps in `[ATTACHED PDF: name]...[END OF PDF]` markers.

**Image handling**: Two paths based on model capability:
- Vision model: Creates data URL (`data:image/png;base64,...`) as OpenAI vision message part. GIF images are converted to PNG via Pillow (some vision APIs don't support GIF directly).
- Non-vision model: Fallback to Pillow metadata extraction — dimensions, format, mode, EXIF description if available. Returns plain text description.

### Context Management (pipeline_v2/context.py)

**ChatContext**: Dataclass with `session_id` and `messages: List[Message]`. Each `Message` has `role`, `content`, `timestamp`.

**Token estimation**: Uses `tiktoken` with `cl100k_base` encoding (compatible with GPT-4 and Claude). Falls back to `len(text) // 4` if tiktoken is unavailable.

**Context compaction** (`compact_with_summary`): When token count exceeds the threshold (3000):
- Keeps the N most recent messages (default 4)
- Replaces everything else with a summary system message
- Before: `[msg1, msg2, ..., msg13, msg14, msg15]`
- After: `[SUMMARY_BLOCK, msg14, msg15]`

**Persistence**: `save_chat_context()` / `load_chat_context()` use JSON files in `pipeline_v2/storage/sessions/`. The FastAPI app creates ephemeral contexts per request (doesn't persist), but the CLI tool persists sessions.

### Other Endpoints

**POST /generate-title**: Generates a 3-5 word chat title from the first user message. Uses `TITLE_MODEL` (defaults to `SUMMARIZER_MODEL`). System prompt instructs the LLM to generate a short title without assistant-style phrases ("I can help", "Let me"). Falls back to "New Chat" on failure.

**POST /extract-memory-facts**: Extracts factual observations about the user from a raw prompt + optimized output. Returns JSON array of `{category, key, value, confidence}` facts. Categories: "user" (identity/role), "behavioral" (writing style), "context" (recurring topics). Confidence is capped at 0.95 (below 1.0 which is reserved for explicit user-stated facts). Called fire-and-forget from Electron after each optimization.

**POST /transcribe-audio**: Upload-based transcription. Accepts base64-encoded WAV audio. Processing pipeline:
1. Decode base64, parse WAV headers
2. Validate: 16-bit PCM, non-empty
3. Downmix multichannel to mono
4. Resample to 16kHz via scipy polyphase filter
5. Quality gates: min 0.3s duration, min RMS threshold, Silero VAD speech detection
6. Transcribe via faster-whisper "small" model (beam_size=5, temperature=0.0)
7. Return concatenated segment texts

**WS /ws/transcribe-stream**: Deepgram streaming proxy. Detailed in Chapter 11.

**GET /health**: Lightweight liveness probe. Returns `{status: "ok"}`.

**GET /health/ready**: Readiness probe. Checks: OpenRouter API key present, optimizer model configured, Whisper model loadable. Returns `{status: "ready"|"degraded", checks: {...}}`.

### Prompt Caching

`TTLCache(maxsize=200, ttl=300)`: In-memory cache using the `cachetools` library.
- Key: The original (stripped) prompt text
- Value: The optimized text
- Max 200 entries, 5-minute TTL (time-to-live)
- Regeneration requests append `[REGENERATE_...]` to the prompt, which changes the cache key, ensuring a cache miss
- The cache is NOT shared across server restarts (in-memory only)

### Rate Limiting

Three layers:

1. **IP-based** (SlowAPI): 60 requests/minute per IP, 200/minute application-wide. Applied to ALL HTTP endpoints. `/health` and `/health/ready` are exempt via `@limiter.exempt`.
2. **User-based daily cap** (custom `_check_rate_limit()`): In-memory counters keyed by `"{user_id}:{YYYY-MM-DD}"`. Default limit: `DAILY_REQUEST_LIMIT=50` (env-configurable). Applied to BOTH `POST /optimize` and the `WS /ws/optimize-stream` endpoint (per-request inside the WebSocket receive loop). On limit exceeded, the WebSocket path sends an error JSON frame and `continue`s — the connection stays alive. Counters reset at UTC midnight via `_rate_last_date` comparison.
3. **Concurrency semaphore**: `_optimize_semaphore = Semaphore(MAX_CONCURRENT_OPTIMIZATIONS=50)` — caps simultaneous in-flight LLM inference calls. The `async with _optimize_semaphore:` block inside the WebSocket handler ensures no more than 50 optimization requests run concurrently regardless of the number of connected clients.

**Client-side mirror**: `RateLimitService` in Electron applies the same daily cap check BEFORE sending to Python, allowing immediate UI feedback without a round-trip. The service is invalidated via `getRateLimitService().invalidateCache(userId)` after each successful optimization so the next check reflects the fresh count.

### CORS Configuration

CORS is restricted to `localhost`/`127.0.0.1` by default — the service is never intended to be publicly reachable. Override via `ALLOWED_ORIGINS` env var (comma-separated list of allowed origins). The `X-Request-ID` header is explicitly allowed so distributed Sentry traces can propagate between Electron and Python.

---

## Chapter 10: Supabase Database -- Schema and Security

### What Supabase Provides

Supabase is the app's cloud backend. It provides:

1. **PostgreSQL database**: All persistent data (users, chats, messages, prompts, settings, memories)
2. **Authentication (GoTrue)**: Email/password signup, OAuth (Google, GitHub), JWT token management, session refresh
3. **Storage**: S3-compatible object storage for file attachments (PDFs)
4. **Edge Functions**: Deno-based serverless functions for the share-view endpoint
5. **Row Level Security (RLS)**: Database-level access control — every query is automatically filtered by security policies

### How RLS Works

Row Level Security is a PostgreSQL feature that adds automatic WHERE clauses to every query.

When you create a policy like:
```sql
CREATE POLICY "Users can only see their own chats"
ON chats FOR SELECT
USING (user_id = auth.uid());
```

PostgreSQL automatically appends `WHERE user_id = auth.uid()` to every SELECT on the `chats` table. Even if a client crafts a query without a WHERE clause, they can only see their own chats.

`auth.uid()` is a Supabase-specific PostgreSQL function that extracts the user ID from the JWT that accompanies every request. Supabase's PostgREST layer verifies the JWT, sets it as a PostgreSQL session variable, and `auth.uid()` reads it.

This means security is enforced at the DATABASE level, not the application level. Even if there's a bug in the application code, the database won't leak data to unauthorized users.

### Complete Database Schema

#### Enums

```sql
CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system');
CREATE TYPE optimization_source AS ENUM ('overlay', 'app_window', 'api');
```

#### profiles

Created by migration `002_add_profiles_and_preferences.sql`. Linked to Supabase's `auth.users` table.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK, references auth.users(id) ON DELETE CASCADE |
| name | TEXT | |
| dob | TEXT | Date of birth |
| email | TEXT | |
| avatar_url | TEXT | Cloudinary URL |
| role | TEXT | 'user', 'dev', or 'admin'. Default 'user'. Added by migration 20260323 |
| created_at | TIMESTAMPTZ | Default now() |
| updated_at | TIMESTAMPTZ | Default now() |

**Trigger**: `handle_new_user()` fires on `INSERT` to `auth.users`. Automatically creates a `profiles` row and a `user_preferences` row.

**RLS**: Users can SELECT/UPDATE their own profile. INSERT is triggered automatically.

#### user_preferences

| Column | Type | Notes |
|--------|------|-------|
| user_id | UUID | PK, references auth.users(id) ON DELETE CASCADE |
| personalization_prompt | TEXT | Custom instructions for optimization |
| ui_settings | JSONB | UI configuration |
| updated_at | TIMESTAMPTZ | |

**View**: `user_full_profile` joins `profiles` and `user_preferences`.

#### user_settings

Created by migration `003_add_user_settings.sql`.

| Column | Type | Notes |
|--------|------|-------|
| user_id | UUID | PK, references auth.users(id) ON DELETE CASCADE |
| theme | TEXT | 'light' or 'dark' |
| font_size | TEXT | 'small', 'medium', 'large' |
| font_family | TEXT | Font name |
| prompt_instructions | TEXT | Custom instructions (separate from preferences) |
| memory_enabled | BOOLEAN | Default true. Added by migration 20260323 |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

#### chats

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK, default gen_random_uuid() |
| user_id | UUID | References auth.users(id) ON DELETE CASCADE |
| title | TEXT | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |
| is_pinned | BOOLEAN | Default false |
| metadata | JSONB | Extensible metadata |

**Indexes**: `(user_id, updated_at DESC)`, GIN on `metadata->'tags'`

**Trigger**: `update_chat_timestamp` — updates `updated_at` on any change.

**RLS**: Users can SELECT/INSERT/UPDATE/DELETE their own chats.

#### messages

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| chat_id | UUID | References chats(id) ON DELETE CASCADE |
| user_id | UUID | References auth.users(id) |
| content | TEXT | Message content |
| role | message_role | 'user', 'assistant', or 'system' |
| created_at | TIMESTAMPTZ | |
| optimization_id | UUID | References prompt_optimizations(id), nullable |
| metadata | JSONB | Stores source_app, file attachments, feedback, groupId, versionIndex |

**Indexes**: `(chat_id, created_at)`, GIN on `metadata->'source_app'`

**Trigger**: `update_chat_statistics` — fires on INSERT, updates the parent chat's `updated_at`.

**RLS**: Users can SELECT/INSERT/UPDATE their own messages.

#### prompt_optimizations

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | References auth.users(id) |
| original_text | TEXT | |
| optimized_text | TEXT | |
| created_at | TIMESTAMPTZ | |
| source | optimization_source | 'overlay', 'app_window', or 'api' |
| applied | BOOLEAN | Whether the user applied the result |
| rating | INT | User rating |
| metadata | JSONB | |

#### prompt_versions

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| optimization_id | UUID | References prompt_optimizations(id) |
| version_number | INT | |
| optimized_text | TEXT | |
| created_at | TIMESTAMPTZ | |
| is_selected | BOOLEAN | |
| metadata | JSONB | |

#### prompt_collections

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | References auth.users(id) ON DELETE CASCADE |
| name | TEXT | |
| icon | TEXT | Emoji icon |
| share_token | TEXT | UNIQUE, nullable. For sharing |
| original_collection_id | UUID | For imported shared collections |
| original_creator_id | UUID | Creator of the original collection |
| original_creator_name | TEXT | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**Unique constraint**: `(user_id, name)` — collection names unique per user.

#### saved_prompts

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | References auth.users(id) ON DELETE CASCADE |
| collection_id | UUID | References prompt_collections(id) ON DELETE CASCADE |
| title | TEXT | |
| content | TEXT | Prompt content |
| share_token | TEXT | UNIQUE, nullable. For individual sharing |
| metadata | JSONB | Stores is_favorite, skill, mode |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**RLS for sharing**: 
- Public (no auth) can SELECT saved_prompts where `share_token IS NOT NULL` (individual prompt sharing via Edge Function)
- Authenticated users can SELECT shared collections and their prompts (after HMAC migration, collection sharing requires auth)

#### user_memory

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | References auth.users(id) ON DELETE CASCADE |
| memory_type | TEXT | 'user', 'behavioral', or 'context' |
| key | TEXT | Snake_case identifier (e.g., "role", "preferred_tone") |
| value | TEXT | The fact |
| confidence | FLOAT | 0.0 to 1.0 |
| source | TEXT | 'inferred' or 'explicit' |
| observation_count | INT | Default 1. Incremented when same fact re-observed |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**Unique constraint**: `(user_id, memory_type, key)` — one value per user per type per key.

#### deletion_requests (GDPR)

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | References auth.users(id) |
| requested_at | TIMESTAMPTZ | |
| scheduled_deletion_at | TIMESTAMPTZ | |
| status | TEXT | 'pending', 'completed', 'cancelled' |
| reason | TEXT | Optional reason from user |
| processed_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |

**Constraints**: Unique partial index — only one `pending` request per user. Users can only UPDATE their own requests to `cancelled` status.

### Storage Bucket

**message-attachments**: 
- Private bucket (not publicly accessible)
- 10 MB file size limit
- Allowed MIME types: `application/pdf` only
- RLS: Users can SELECT/INSERT/DELETE files where `bucket_id = 'message-attachments'` AND the first path segment equals `auth.uid()` (files are stored as `{userId}/{filename}`)

### Edge Function: share-view

Located at `supabase/functions/share-view/index.ts`. Runs on Deno.

**Purpose**: Serves individual shared prompts as HTML pages or JSON API responses.

**Flow**:
1. Receives GET request with `?token=<share_token>`
2. Validates token format: `/^[A-Za-z0-9_-]{20,50}$/` (same regex as Electron's deep link validation)
3. Creates a Supabase client with `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS — this function needs to read any shared prompt regardless of who's requesting)
4. Queries `saved_prompts` where `share_token = token`
5. Queries `profiles` to get the owner's display name
6. If `Accept: application/json` header: Returns JSON `{id, title, content, owner_name, created_at}`
7. Otherwise: Returns HTML page:
   - Dark theme card UI
   - Title, content, owner name, creation date
   - Copy button (uses Clipboard API with textarea fallback)
   - All dynamic content escaped via `escapeHtml()` (prevents XSS)
   - Security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`
   - CSP: `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'`
   - Meta tag: `<meta name="robots" content="noindex">` (don't index shared prompts)

### HMAC Share Tokens

Migration `20260330_hmac_share_tokens.sql` changed the sharing model:

**Before**: Share tokens were random strings. Anyone with the token could view the shared collection/prompt (public access).

**After**: 
- All existing share tokens on collections and prompts were cleared
- Collection sharing now requires authentication (public RLS policies dropped, replaced with authenticated-only policies)
- Individual prompt sharing still works publicly via the Edge Function (which uses the service role key)
- New tokens are generated as HMAC-SHA256 hashes (using `crypto.randomBytes(24).toString('base64url')`)

### Authentication Flow

1. **Sign Up**: User submits name, dob, email, password
   - Electron calls Supabase's `auth.signUp()` 
   - GoTrue creates a user in `auth.users`
   - Database trigger `handle_new_user()` creates `profiles` and `user_preferences` rows
   - GoTrue returns a JWT

2. **Sign In**: User submits email, password
   - Electron calls `auth.signInWithPassword()`
   - GoTrue verifies credentials, returns JWT
   - Main process sets `authState` (userId, email, accessToken)
   - Sends `auth:state-changed` to renderer
   - Reconnects Python WebSocket with new token

3. **OAuth**: User clicks Google/GitHub button
   - Electron calls `auth.signInWithOAuth()` 
   - Opens system browser to OAuth provider
   - After consent, provider redirects back to Supabase
   - Supabase completes auth and fires auth state change event
   - Electron picks up the event and updates state

4. **Token Refresh**: JWTs expire after 1 hour (Supabase default)
   - Supabase JS client automatically refreshes tokens in the background
   - On `TOKEN_REFRESHED` event: main process updates `authState.currentAccessToken`
   - Calls `pythonClient.reconnect()` to open a new WebSocket with the fresh token
   
5. **Offline edge case**: If the device goes offline, Supabase's token refresh poller fails and fires a `SIGNED_OUT` event. The main process checks `networkMonitor.isOnline` — if offline, it IGNORES the `SIGNED_OUT` event (it's not a real sign-out, just a refresh failure).


---

## Chapter 11: Voice Input -- From Sound Waves to Text

### The Physics of Sound

Sound is a mechanical wave — a longitudinal pressure disturbance that propagates through a medium (usually air). When you speak:

1. Your vocal cords vibrate, creating alternating regions of high pressure (compression) and low pressure (rarefaction)
2. These pressure variations propagate outward at ~343 m/s (speed of sound in air at 20C)
3. The frequency of vibration determines the pitch (human speech: 85-255 Hz fundamental, with harmonics up to ~8 kHz)
4. The amplitude of the pressure variation determines the loudness

### How Microphones Convert Sound to Electricity

Most laptop/headset microphones are **electret condenser** microphones:

1. A thin, electrically charged diaphragm (typically Mylar coated with metal) is positioned near a fixed backplate
2. Sound pressure waves cause the diaphragm to vibrate
3. As the diaphragm moves closer to and farther from the backplate, the capacitance between them changes
4. A JFET (Junction Field-Effect Transistor) inside the microphone converts this capacitance change into a voltage signal
5. The output is a continuous analog voltage that mirrors the original sound waveform

### Analog-to-Digital Conversion (ADC)

The continuous analog voltage must be converted to discrete digital samples:

1. **Sampling**: The voltage is measured at regular intervals. The sampling rate determines how many measurements per second:
   - CD quality: 44,100 Hz (44.1 kHz)
   - Professional audio: 48,000 Hz (48 kHz)
   - Telephone: 8,000 Hz (8 kHz)
   - The Nyquist theorem states you need at least 2x the highest frequency to accurately represent a signal. Human hearing goes up to ~20 kHz, so 44.1 kHz captures everything audible.

2. **Quantization**: Each sample is rounded to the nearest value in a fixed set of levels:
   - 16-bit: 65,536 levels (-32,768 to 32,767). This is PCM (Pulse Code Modulation) Int16 format.
   - 24-bit: 16,777,216 levels (professional recording)
   - Float32: 32-bit floating point (-1.0 to 1.0). Used by Web Audio API.

3. **PCM (Pulse Code Modulation)**: The standard digital audio encoding. Each sample is stored as an integer (Int16) or float (Float32). No compression — raw samples.

### Browser Audio Capture Pipeline

In this app, the preload script captures microphone audio using Web APIs:

**Step 1: Request microphone access**
```javascript
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,   // DSP filter removes speaker output from mic input
    noiseSuppression: true,   // DSP filter reduces background noise
    autoGainControl: true,    // Automatically adjusts mic gain for consistent volume
  }
});
```

`getUserMedia` is a browser API. Electron inherits it from Chromium. The first time it's called, the OS may show a permission prompt. The `echoCancellation`, `noiseSuppression`, and `autoGainControl` options are DSP (Digital Signal Processing) filters applied by the browser/OS audio stack before your code sees the samples.

**Step 2: Create audio processing graph**
```javascript
const audioContext = new AudioContext();
// audioContext.sampleRate is typically 44100 or 48000 (depends on OS/hardware)

const source = audioContext.createMediaStreamSource(stream);
// source = node that reads from the mic MediaStream

const processor = audioContext.createScriptProcessor(4096, 1, 1);
// bufferSize=4096: process 4096 samples at a time
// inputChannels=1: mono input
// outputChannels=1: mono output (required even though we don't use it)

const muteGain = audioContext.createGain();
muteGain.gain.value = 0;
// Mutes output so mic audio doesn't play through speakers

// Connect the graph: mic -> processor -> mute -> speakers
source.connect(processor);
processor.connect(muteGain);
muteGain.connect(audioContext.destination);
```

The `ScriptProcessorNode` fires an `onaudioprocess` event every time its buffer fills up (every 4096 samples ≈ 93ms at 44.1kHz). Note: `ScriptProcessorNode` is deprecated in favor of `AudioWorklet`, but still works and is simpler for this use case.

**Step 3: Convert Float32 to Int16**
```javascript
processor.onaudioprocess = (event) => {
  const channelData = event.inputBuffer.getChannelData(0);  // Float32Array, values in [-1.0, 1.0]
  const int16 = new Int16Array(channelData.length);
  
  for (let i = 0; i < channelData.length; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]));   // Clamp to [-1, 1]
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;           // Scale to Int16 range
  }
  
  ipcRenderer.send('transcription:audio-chunk', Buffer.from(int16.buffer));
};
```

**Why this conversion?** The Web Audio API provides Float32 samples (range -1.0 to 1.0), but Deepgram expects `linear16` format (Int16, range -32768 to 32767). The conversion:
- Clamp: ensures no sample exceeds [-1, 1] (prevents overflow)
- Scale: negative values multiply by 32768 (0x8000), positive by 32767 (0x7FFF). This slight asymmetry matches the two's complement Int16 range.
- Buffer.from: wraps the Int16Array's underlying ArrayBuffer as a Node.js Buffer for IPC transmission.

### Data Flow Through the System

```
Microphone -> OS Audio Driver -> Chromium Audio Stack (with DSP filters)
  -> ScriptProcessorNode (Float32, native sample rate)
  -> Float32-to-Int16 conversion (preload.ts)
  -> IPC 'transcription:audio-chunk' (Buffer)
  -> Electron Main Process (index-new.ts)
  -> TranscriptionClient.sendAudioChunk(Buffer)
  -> WebSocket binary frame to Python (/ws/transcribe-stream)
  -> Python relays binary to Deepgram (wss://api.deepgram.com/v1/listen)
  -> Deepgram processes audio, returns JSON transcription results
  -> Python relays results back to Electron via WebSocket
  -> Main process sends 'transcription:update' to renderer(s)
  -> React UI updates the input field with transcribed text
```

### Deepgram Streaming Transcription

Deepgram is a cloud Speech-to-Text service. The app proxies audio through the Python service (rather than connecting directly from the browser) for security (API key stays server-side).

**Deepgram connection URL**:
```
wss://api.deepgram.com/v1/listen?
  model=nova-2          # Deepgram's most accurate model
  &language=en          # English
  &smart_format=true    # Adds punctuation, capitalization
  &interim_results=true # Send partial results while speaking
  &utterance_end_ms=1000 # Detect end of utterance after 1s silence
  &vad_events=true      # Voice Activity Detection events
  &endpointing=300      # End of speech detection after 300ms silence
  &encoding=linear16    # Int16 PCM
  &sample_rate={rate}   # From client's AudioContext.sampleRate
  &channels=1           # Mono
```

**Protocol**:
- Client sends binary frames (raw PCM audio) as fast as they're captured
- Deepgram sends back JSON messages with `type: "Results"`:
  - `channel.alternatives[0].transcript`: The transcribed text
  - `is_final`: true when this segment won't change (final result)
  - `speech_final`: true when the speaker has finished an utterance
- The Python service accumulates all `is_final` transcripts in `finalized_parts`
- Sends to client: `{type: "transcription", text, accumulated, is_final, speech_final}`
- On stop: sends `{type: "final", text: accumulated}` and `{type: "status", status: "stopped"}`

**Why proxy through Python?** The Deepgram API key must not be exposed to the client. By proxying through the Python service, the key stays server-side. The Python service adds the `Authorization: Token {key}` header when connecting to Deepgram.

### Local Whisper Transcription (Upload Path)

For the upload-based transcription endpoint (`/transcribe-audio`), the app uses **faster-whisper**, a local STT model:

**What Whisper is**: OpenAI's open-source speech recognition model. It's an encoder-decoder transformer:
1. Audio is converted to a mel spectrogram (frequency-over-time representation)
2. The encoder processes the spectrogram into a sequence of embeddings
3. The decoder autoregressively generates text tokens, attending to the encoder output

**What faster-whisper is**: A reimplementation of Whisper using CTranslate2, an optimized inference engine for transformer models. CTranslate2 uses:
- Weight quantization (int8): Reduces model size and increases inference speed with minimal accuracy loss
- Batch processing: Processes multiple segments simultaneously
- CPU-optimized kernels: AVX2/AVX-512 vectorization

The app uses the "small" model (244 MB) with int8 quantization on CPU. This balances accuracy and speed for a desktop app.

**What Silero VAD is**: Voice Activity Detection — determines whether audio contains speech or just silence/noise. Uses a small LSTM (Long Short-Term Memory) neural network. The model processes 64ms windows of audio and outputs a probability (0-1) that the window contains speech. The app requires at least one speech segment >= 250ms to proceed with transcription.

### Audio Resampling

Whisper and Deepgram require 16 kHz audio. The browser captures at the native sample rate (typically 44.1 or 48 kHz). The Python service resamples:

```python
from scipy.signal import resample_poly
from math import gcd

g = gcd(src_rate, 16000)
up = 16000 // g
dn = src_rate // g
resampled = resample_poly(audio_f32, up, dn)
```

`resample_poly` uses a polyphase FIR filter, which:
1. Upsamples by factor `up` (inserts zeros between samples)
2. Applies a low-pass anti-aliasing filter
3. Downsamples by factor `dn` (picks every dn-th sample)

For 48000 -> 16000: g=16000, up=1, dn=3 (just downsample by 3x with anti-aliasing filter).
For 44100 -> 16000: g=100, up=160, dn=441 (complex rational resampling).

---

## Chapter 12: Networking, Offline Mode, and Error Handling

### Network Monitor

The `NetworkMonitor` class (`electron/main/ipc-handlers/network-monitor-singleton.ts`) tracks online/offline status:

1. Polls connectivity periodically
2. When online -> offline: Broadcasts `{channel: 'network:status', data: {isOnline: false}}` to both app window and overlay
3. When offline -> online: Broadcasts `{isOnline: true}` and triggers reconnection callbacks
4. Reconnection callbacks:
   - `syncOfflineQueue()`: Replays queued prompt library mutations
   - `syncChatMessageQueue()`: Replays queued chat messages

The renderer subscribes via `window.electronAPI.onNetworkStatus(callback)`.

### Offline Queue

When the network goes down, certain operations are queued instead of failing:

**Prompt Library Queue**: 
- Create/rename/delete collections
- Save/update/delete prompts
- Toggle favorites
Queued mutations are stored in memory. When network recovers, they're replayed in order.

**Chat Message Queue**:
- When a user sends a message while offline, the main process:
  1. Saves the message to a local queue
  2. Sends `send-message-queued` IPC to renderer (shows "queued" indicator)
  3. When back online: replays the message (sends to Python for optimization, saves to Supabase)
  4. Sends `offline-message-synced` IPC with the user and assistant messages

### Sentry Error Tracking

Three Sentry instances run independently:

1. **Electron Main Process** (`@sentry/electron/main`):
   - DSN from `SENTRY_DSN`
   - Release: `prmpt@{version}`
   - PII scrubbing: `beforeSend` redacts any data key matching `/prompt|content|message|text/i`
   - Traces: 100% in dev, 20% in prod
   - Breadcrumbs added for lifecycle events (startup, overlay toggle, transcription, etc.)

2. **React Renderer** (`@sentry/react`):
   - DSN from `VITE_SENTRY_DSN`
   - User linked via `onSentryUser` IPC and `onAuthStateChange`
   - ErrorBoundary at the root catches React rendering errors
   - BrowserTracing for page load and navigation performance

3. **Python Service** (`sentry_sdk`):
   - DSN from `SENTRY_PYTHON_DSN`
   - PII scrubbing: `before_send` function with same pattern
   - `LoggingIntegration`: INFO logs -> breadcrumbs, ERROR logs -> events
   - `send_default_pii=False`

**Distributed Tracing**: When the Electron main process sends a WebSocket optimization request, it attaches `sentry-trace` and `baggage` headers. The Python service uses `sentry_sdk.continue_trace()` to link its transaction to the Electron trace. This creates a unified trace spanning both processes in Sentry's trace view.

### Error Handling Patterns

**Global error guards** (index-new.ts):
```javascript
process.on('unhandledRejection', (reason) => {
  Sentry.captureException(err);
  // Do NOT exit — log and continue
});

process.on('uncaughtException', (err) => {
  Sentry.captureException(err);
  // Do NOT call process.exit — let Electron handle it
});
```

**WebSocket resilience** (PythonClient):
- Hard timeout (30s): If no response in 30 seconds, resolves with accumulated partial text (if any) or rejects
- Silence timeout (3.5s): If no chunks after first chunk for 3.5s, auto-resolves with accumulated text
- On WebSocket close with pending requests: Resolves with accumulated text if available, otherwise rejects
- Abort: `abortLatestStream()` marks request as aborted, resolves with partial text

**Graceful degradation**: If Python service is unavailable:
- Health check loop detects it within 30 seconds
- Sends `python:unavailable` to renderers -> shows banner
- When it recovers, sends `python:recovered` -> hides banner
- Optimization requests fail with user-friendly error messages

---

## Chapter 13: Sharing and Deep Links

### Custom Protocol: prmpt://

The app registers a custom URL protocol (`prmpt://`) so other apps can deep-link into it.

**How custom protocols work on Windows**:
1. `app.setAsDefaultProtocolClient('prmpt')` writes a registry entry under `HKEY_CURRENT_USER\Software\Classes\prmpt` that tells Windows: "When a prmpt:// URL is opened, launch this executable"
2. When a user clicks a `prmpt://` link (in a browser, email, etc.), Windows launches the app with the URL as a command-line argument
3. If the app is already running (single instance lock), Windows activates the existing instance and fires the `second-instance` event with the URL in the command line arguments

**Protocol URL format**: `prmpt://share/<type>/<token>`
- `c` = collection: `prmpt://share/c/abc123...`
- `p` = prompt: `prmpt://share/p/xyz789...`

**Security validation**:
1. Parse the URL with `new URL(url)`
2. Verify protocol is `prmpt:`
3. Verify hostname is `share`
4. Split pathname into `[type, token]`
5. Verify `type` is in the hard-whitelist: `{c: '/share/c', p: '/share/p'}`
6. Verify `token` matches `/^[A-Za-z0-9_-]{20,50}$/` (base64url characters only, bounded length)
7. If all checks pass: Send the route path (`/share/c/token` or `/share/p/token`) to the renderer via `navigate-to-share` IPC
8. The renderer's `DeepLinkListener` component calls `navigate(routePath)` to show the share view

**macOS vs Windows**:
- macOS: Uses the `open-url` event (fired by the OS when a protocol URL is opened)
- Windows/Linux: Uses the `second-instance` event (URL comes as a command-line argument)
- On first launch (no existing instance): URL is in `process.argv`. Handled after window creation with a 1500ms delay.

### Share Flow

**Creating a share link**:
1. User clicks "Share" on a collection or prompt in the library
2. Renderer calls `promptLibrary.getShareLink(collectionId)` or `getPromptShareLink(promptId)`
3. Main process generates a random token: `crypto.randomBytes(24).toString('base64url')` (produces 32 chars)
4. Stores the token in Supabase (`share_token` column on `prompt_collections` or `saved_prompts`)
5. Returns `{shareToken, shareUrl: 'prmpt://share/c/{token}' or 'prmpt://share/p/{token}'}`
6. User copies the URL and shares it

**Opening a share link**:
1. Recipient pastes the URL in browser or clicks it
2. If the app is installed: OS opens the app via custom protocol handler
3. Deep link handler validates and routes to `/share/c/{token}` or `/share/p/{token}`
4. For collections: `SharedLibraryView` component loads the collection via `promptLibrary.getSharedCollection(token)` and shows it with a "Save to Library" button
5. For prompts: `SharePromptPage` fetches the prompt (via Edge Function or Supabase) and displays it with a copy button
6. If the app is NOT installed: The URL does nothing (there's no web fallback for collections). For individual prompts, the Edge Function serves an HTML page.

---

## Chapter 14: Build System and Development Workflow

### Project Structure

The project is NOT a monorepo (no npm workspaces). It's a single npm package at the root with separate subdirectories:

- `app-ui/`: React app (its own package.json, node_modules)
- `electron/`: TypeScript source for main process + preload
- `python-service/`: Python service (its own venv, requirements.txt)
- `native/platform-core/`: Rust native module (its own Cargo.toml, package.json)

### Build Pipeline

`npm run build` runs two steps in sequence:

**Step 1: Build UI** (`npm run build:ui`):
```bash
cd app-ui && npm run build
```
This runs Vite's production build:
1. SWC transpiles TypeScript/JSX to JavaScript
2. Rollup bundles everything, tree-shakes unused code
3. CSS is processed by PostCSS -> Tailwind JIT -> Autoprefixer
4. Output goes to `../electron/renderer/app-ui/` (directly into the Electron renderer directory)
5. Two HTML entry points: `index.html` (app window) and `overlay.html` (overlay)
6. Sourcemaps are generated (uploaded to Sentry in production, then deleted)

**Step 2: Build Electron** (`npm run build:electron`):
```bash
tsc
```
Compiles all TypeScript in `electron/` to JavaScript in `dist/`:
- `electron/main/index-new.ts` -> `dist/main/index-new.js`
- `electron/preload.ts` -> `dist/preload.js`
- All other `.ts` files in `electron/main/` -> corresponding `.js` in `dist/main/`
- Output format: CommonJS (Node.js `require()` compatible)

### Running the App

**Development**:
```bash
# Terminal 1: Python service
npm run python:dev
# -> cd python-service && venv/Scripts/python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8001

# Terminal 2: Electron (build + run)
npm run dev
# -> npm run build:electron && electron .
# or
npm run dev:full
# -> npm run build && electron .  (includes UI build)
```

There is no "hot reload" for Electron main process code — you must rebuild and restart. For the React UI during development, `npm run dev:ui` starts a Vite dev server on port 8080, but this is only useful for browser testing — Electron loads files directly.

**Native module**:
```bash
npm run native:build
# -> cd native/platform-core && npm install && npm run build
# -> napi build --platform --release
```
Requires Rust toolchain (rustup) + Visual Studio C++ build tools on Windows.

### Python Environment

```bash
npm run python:install
# -> cd python-service
# -> python -m venv venv
# -> venv/Scripts/python.exe -m pip install -r requirements.txt
```

Key packages from requirements.txt:
- `fastapi==0.128.0`: Web framework
- `uvicorn[standard]==0.40.0`: ASGI server
- `litellm==1.81.14`: LLM abstraction
- `faster-whisper==1.2.1`: Local STT
- `torch==2.9.1` + `torchaudio==2.9.1`: ML framework (for Silero VAD)
- `PyMuPDF==1.27.2`: PDF parsing
- `Pillow==12.1.1`: Image processing
- `sentry-sdk[fastapi]==2.56.0`: Error tracking
- `PyJWT==2.10.1`: JWT verification
- `slowapi==0.1.9`: Rate limiting
- `cachetools==5.5.2`: TTL cache
- `scipy==1.17.1`: Audio resampling

### Vite Configuration Details

From `app-ui/vite.config.ts`:

- `base: "./"`: All asset paths are relative (required for Electron's `file://` protocol)
- `envDir: ".."`: Reads `.env` from the project root (one level up from `app-ui/`)
- `@vitejs/plugin-react-swc`: Uses SWC for Fast Refresh (20x faster than Babel)
- `sentryVitePlugin` (production only): Uploads sourcemaps to Sentry, then deletes them from the build output
- `build.outDir: "../electron/renderer/app-ui"`: Output goes directly to the Electron app
- `build.rollupOptions.input`: Two entries — `index.html` and `overlay.html`
- `define.__APP_VERSION__`: Injects the version from root `package.json` as a compile-time constant

### TypeScript Configuration

**Root tsconfig.json** (Electron main process):
- `target: ES2020`: Output modern JavaScript (async/await, optional chaining, etc.)
- `module: commonjs`: Node.js uses CommonJS `require()` / `module.exports`
- `rootDir: ./electron`: Only compile files in `electron/`
- `outDir: ./dist`: Output to `dist/`
- `strict: true`: All strict type checks enabled
- `incremental: true`: Caches type-check results for faster rebuilds

**app-ui/tsconfig.json** (React app):
- Multiple config files: `tsconfig.json` (base), `tsconfig.app.json` (app source), `tsconfig.node.json` (vite config)
- `target: ES2020`, `module: ESNext` (Vite handles module bundling)
- `jsx: react-jsx`: Automatic React import (don't need `import React from 'react'`)
- Path alias: `"@/*": ["./src/*"]` -> `import { cn } from "@/lib/utils"`

### Entry Point

The Electron app's entry point is `dist/main/index-new.js` (specified in root `package.json` as `"main"`). When you run `electron .`, Electron:
1. Reads `package.json` to find the main script
2. Starts the main process running `dist/main/index-new.js`
3. This script creates windows, which start renderer processes loading the HTML files from `electron/renderer/app-ui/`

---

## Chapter 15: Security Model

### Content Security Policy (CSP)

The main process installs CSP headers on all responses via `session.defaultSession.webRequest.onHeadersReceived`. The policy:

```
default-src 'self'                          # Only load resources from same origin
script-src 'self'                           # Only execute scripts from same origin
style-src 'self' 'unsafe-inline'            # Allow inline styles (needed for shadcn/Tailwind)
img-src 'self' data: https: blob:           # Allow images from self, data URLs, HTTPS, blobs
font-src 'self' data:                       # Allow fonts from self and data URLs
connect-src 'self'                          # Allow connections to:
  https://{supabase_host}                   #   Supabase REST API
  wss://{supabase_host}                     #   Supabase Realtime WebSocket
  {python_http_base}                        #   Python service HTTP
  {python_ws_base}                          #   Python service WebSocket
  https://*.sentry.io                       #   Sentry error reporting
  https://res.cloudinary.com                #   Cloudinary CDN (avatars)
media-src 'self' blob:                      # Allow media from self and blobs (audio recording)
```

CSP prevents the page from loading scripts/styles/images from untrusted sources. Even if an attacker injects HTML, they can't load external scripts.

### Preload Security

1. **contextIsolation: true**: The preload script and the renderer page run in separate JavaScript contexts. The page cannot access `require`, `process`, `ipcRenderer`, or any Node.js API.

2. **nodeIntegration: false**: Node.js APIs are not available in the renderer. The page is sandboxed like a regular web page.

3. **Whitelist-only API surface**: `contextBridge.exposeInMainWorld` creates a read-only, non-tamperable API. The renderer can only call methods explicitly exposed. It cannot:
   - Access `ipcRenderer` directly
   - Send IPC messages to arbitrary channels
   - Read files from disk
   - Execute system commands

4. **`ALLOWED_SEND_CHANNELS` whitelist**: The generic `send()` method only allows three channels: `overlay:settings-update`, `overlay:close`, `overlay:ready`. All other channels are blocked.

### Input Validation

**URLs**: `shell:openExternal` validates the URL protocol — only `https:` and `http:` are allowed. Other protocols (e.g., `file:`, `javascript:`) are blocked.

**Deep links**: Token format validated with `/^[A-Za-z0-9_-]{20,50}$/`. Path prefix validated against hard-whitelist `{c: '/share/c', p: '/share/p'}`. Any mismatch is silently discarded.

**Prompt length**: Validated at Python service: 3-50,000 characters (Pydantic model validation).

**File attachments**: Max 5 files per message. Per-file: 10 MB limit, magic-byte validation, allowed MIME types only (PDF + images).

**Rate limiting**: IP-based (60/min per IP via SlowAPI) + user-based (50/day per user for WebSocket optimizer).

### Authentication Security

**JWT verification**: Python service verifies JWTs with `SUPABASE_JWT_SECRET` using HS256. In production, missing secret causes the service to EXIT (fail-closed, not fail-open).

**Token transmission**: WebSocket connections pass the JWT as a `?token=` query parameter (because WebSocket handshake doesn't support custom headers in browsers). This means the token appears in server logs — the security audit flagged this as medium severity (SEC-05). Mitigation: tokens are short-lived (1 hour) and automatically refreshed.

**Password validation**: The signup form enforces minimum requirements, though the security audit noted they could be stricter.

### Row Level Security (RLS)

All Supabase tables have RLS enabled. Key policies:
- Users can only see their own chats, messages, settings, memories
- Users can only modify their own data
- Shared prompts/collections have specific policies for read access
- Storage objects are scoped by user ID in the path
- Deletion requests: users can only cancel their own pending requests

### Clipboard Security

The Rust native module's clipboard management has a race condition window (500ms between paste and restore). Mitigations:
- Short window (500ms)
- `RESTORE_CANCELLED` atomic boolean prevents restore if a new replacement starts
- `GetClipboardSequenceNumber()` verification ensures clipboard was successfully set

### Error Handling Security

- PII scrubbing in Sentry: All three Sentry instances (Electron, React, Python) scrub keys matching `prompt|content|message|text`
- `send_default_pii=False` in Python Sentry
- Error messages to users are generic ("Optimization failed — please try again"), not stack traces
- `unhandledRejection` and `uncaughtException` handlers prevent silent crashes and capture errors in Sentry

### Dependency Security

The security audit noted:
- Electron v28 was outdated (should be updated regularly for security patches)
- Python dependencies were unpinned in some cases (now pinned in requirements.txt)
- Node dependencies should be audited regularly with `npm audit`

### File Security

- **Disable hard reload**: `Ctrl+R` is blocked in the app window to prevent accidental state loss
- **No temp files**: PDF parsing happens in-memory (PyMuPDF `fitz.open(stream=bytes)`)
- **Magic byte validation**: Files are validated by content, not extension or MIME type claim

---

## Appendix A: Environment Variables Reference

| Variable | Required | Default | Used By | Purpose |
|----------|----------|---------|---------|---------|
| `SUPABASE_URL` | Yes | — | Electron | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | — | Electron | Supabase anonymous API key |
| `PYTHON_SERVICE_URL` | No | `http://127.0.0.1:8001` | Electron | Python service base URL |
| `SUPABASE_JWT_SECRET` | Prod: Yes | — | Python | JWT verification secret |
| `OPENROUTER_API_KEY` | Yes | — | Python | OpenRouter LLM API key |
| `DEEPGRAM_API_KEY` | For voice | — | Python | Deepgram STT API key |
| `OPTIMIZER_MODEL` | No | `openrouter/openai/gpt-4o-mini` | Python | Main optimization model |
| `SUMMARIZER_MODEL` | No | `openrouter/openai/gpt-4o-mini` | Python | Cheap model for summaries |
| `TITLE_MODEL` | No | = SUMMARIZER_MODEL | Python | Chat title generation |
| `MEMORY_MODEL` | No | = SUMMARIZER_MODEL | Python | Memory fact extraction |
| `ALLOWED_ORIGINS` | No | localhost | Python | CORS origins |
| `DAILY_REQUEST_LIMIT` | No | 50 | Python | Per-user daily optimization limit |
| `MAX_CONCURRENT_OPTIMIZATIONS` | No | 50 | Python | Concurrent request limit |
| `VITE_CLOUDINARY_CLOUD_NAME` | For avatars | — | React | Cloudinary cloud name |
| `VITE_CLOUDINARY_UPLOAD_PRESET` | For avatars | — | React | Cloudinary upload preset |
| `NODE_ENV` | No | development | Electron | Environment mode |
| `APP_ENV` | No | development | Python | Environment mode |
| `SENTRY_DSN` | No | — | Electron | Sentry DSN (main process) |
| `VITE_SENTRY_DSN` | No | — | React | Sentry DSN (renderer) |
| `SENTRY_PYTHON_DSN` | No | — | Python | Sentry DSN (Python) |

---

## Appendix B: File Map

### Electron Main Process
| File | Purpose |
|------|---------|
| `electron/main/index-new.ts` | Entry point — wires all subsystems |
| `electron/preload.ts` | IPC bridge — defines window.electronAPI |
| `electron/main/api/python-client.ts` | WebSocket + HTTP client for Python service |
| `electron/main/api/transcription-client.ts` | Per-session transcription WebSocket |
| `electron/main/windows/app-window-manager.ts` | Main window lifecycle |
| `electron/main/windows/system-tray.ts` | System tray icon + menu |
| `electron/main/overlay/overlay-window-manager.ts` | Overlay lifecycle + DWM trick |
| `electron/main/database/supabase-client.ts` | Supabase client singleton |
| `electron/main/database/services/*.ts` | Domain-specific Supabase operations (10 files) |
| `electron/main/ipc-handlers/*.ts` | IPC handler registration (12 files) |
| `electron/main/utils/auth-state.ts` | Global auth state singleton |
| `electron/main/utils/native-bridge.ts` | Rust .node loader with stub fallback |
| `electron/main/utils/network-monitor.ts` | Online/offline detection |

### React App Window
| File | Purpose |
|------|---------|
| `app-ui/src/main.tsx` | React entry point |
| `app-ui/src/App.tsx` | Root component, routing, providers |
| `app-ui/src/pages/Index.tsx` | Main app orchestrator (~2000 lines) |
| `app-ui/src/components/auth/*.tsx` | Auth views (login, signup, onboarding, wrapper) |
| `app-ui/src/components/chat/*.tsx` | Chat components (view, bubbles, menus, skills) |
| `app-ui/src/components/layout/*.tsx` | App layout, sidebar, profile menu |
| `app-ui/src/components/library/*.tsx` | Prompt library + sharing |
| `app-ui/src/components/settings/*.tsx` | Settings + memory views |
| `app-ui/src/components/ui/*.tsx` | shadcn/ui components (~30 files) |
| `app-ui/src/context/AuthContext.tsx` | Auth React context |
| `app-ui/src/hooks/*.ts` | Custom React hooks |
| `app-ui/src/lib/*.ts` | Utilities (cn, settings, skill icons) |
| `app-ui/src/types/electron.d.ts` | window.electronAPI type declarations |

### React Overlay
| File | Purpose |
|------|---------|
| `app-ui/src/overlay/main.tsx` | Overlay entry point |
| `app-ui/src/overlay/components/*.tsx` | Overlay UI components (7 files) |
| `app-ui/src/overlay/hooks/useTurns.ts` | Turn-based conversation hook |
| `app-ui/src/overlay/lib/*.ts` | Overlay constants, types, utilities |

### Python Service
| File | Purpose |
|------|---------|
| `python-service/app/main.py` | FastAPI app, all endpoints |
| `python-service/app/auth.py` | JWT verification |
| `python-service/pipeline_v2/optimizer.py` | LLM orchestrator |
| `python-service/pipeline_v2/fast_mode.py` | Fast mode strategies |
| `python-service/pipeline_v2/skills.py` | Skill file loader |
| `python-service/pipeline_v2/context.py` | ChatContext management |
| `python-service/pipeline_v2/document_parser.py` | PDF/image parsing |
| `python-service/pipeline_v2/config.py` | Centralized configuration |
| `python-service/pipeline_v2/usage_logger.py` | Usage tracking |

### Rust Native Module
| File | Purpose |
|------|---------|
| `native/platform-core/src/lib.rs` | N-API exports |
| `native/platform-core/src/hook.rs` | Keyboard hook thread + callback |
| `native/platform-core/src/buffer.rs` | Rolling buffer for @prompt detection |
| `native/platform-core/src/keymap.rs` | Virtual key to character mapping |
| `native/platform-core/src/replacement.rs` | Text replacement engine |
| `native/platform-core/index.js` | Auto-generated N-API loader |
| `native/platform-core/index.d.ts` | TypeScript type declarations |

### Supabase
| File | Purpose |
|------|---------|
| `supabase/migrations/*.sql` | Database schema migrations (15 files) |
| `supabase/functions/share-view/index.ts` | Edge function for shared prompt viewing |

### Configuration
| File | Purpose |
|------|---------|
| `package.json` | Root npm package, scripts, dependencies |
| `tsconfig.json` | Root TypeScript config (Electron main) |
| `.env.example` | Environment variable template |
| `app-ui/package.json` | React app dependencies |
| `app-ui/vite.config.ts` | Vite build configuration |
| `app-ui/tailwind.config.ts` | Tailwind CSS configuration |
| `native/platform-core/Cargo.toml` | Rust crate configuration |
| `python-service/requirements.txt` | Python dependencies |

---

*This document covers every aspect of the Prmpt codebase — from the physics of sound waves to the Win32 API calls in the Rust module, from the TCP handshake to the React component hierarchy. If you've read this, you understand not just what the code does, but why it works the way it does at every level.*

---

## Chapter 16: Code Intelligence Service — The Codebase Indexing Brain

> **This entire service is new and not covered anywhere in the existing documentation.**

### What It Is

The Code Intelligence Service (`code-intelligence-service/`) is a standalone Python FastAPI microservice that provides **semantic code search and indexing** capabilities to the Prmpt desktop application. It runs on port **8002** (separate from the AI optimization service on port 8001) and is deployed to Render.com as its own service.

Its purpose: when a user opens a project folder in the "Spaces" workspace, Prmpt reads every source file, extracts function/class/method definitions (structural skeletons) using Tree-sitter WASM grammars **inside the Electron main process** (so source code never leaves the user's machine until parsing has reduced it to skeletons), generates LLM semantic summaries of each chunk, embeds those summaries as **512-dimensional vectors** (using `text-embedding-3-small` with the `dimensions=512` parameter, chosen for ~33% storage savings at near-1536-dim recall), and stores them in Supabase using pgvector with an **HNSW index** (`m=16, ef_construction=64`). When the user types a query, the service runs a **four-strategy hybrid retrieval pipeline** — vector ANN, full-text tsvector, concept (signature/name pattern matching), and file-path heuristics — fused via Reciprocal Rank Fusion, then expanded with the call graph for dependency-aware context. Results are injected into the prompt to make optimizations codebase-aware.

### Architecture

The service has four layers:

1. **Routes** (`app/routes/`): Six FastAPI routers — `projects`, `ingest`, `retrieve`, `context`, `sync`, `webhooks`. (`context` provides project-scoped metadata used by the Electron app to render the Spaces sidebar without round-tripping through `retrieve`.)
2. **Services** (`app/services/`): Domain services — `embedding`, `search`, `graph`, `github_sync`, `summarizer`, `query_preprocessor`, `query_analyzer`, `rrf` (Reciprocal Rank Fusion), `expander` (call-graph expansion).
3. **Workers** (`app/workers/`): `index_worker`, `sync_worker`, `arq_worker` (Redis-backed task queue, runs as a separate process so a crash in the queue runner doesn't take down the HTTP service).
4. **DB** (`app/db/`): Raw Supabase queries, models (Pydantic), and client initialization.

**Sentry integration**: `code-intelligence-service/app/main.py` initializes `sentry_sdk` with the `FastApiIntegration` (auto-spans every route) and the `LoggingIntegration` (logs at WARNING+ become breadcrumbs, logs at ERROR+ become Sentry events). `traces_sample_rate` is `1.0` in development and `0.2` in production. The ARQ worker initializes its own SDK in `arq_worker.py` because it runs in a separate process.

### Database Schema Tables (new tables in Supabase)

| Table | Purpose |
|-------|---------|
| `projects` | One row per user project: `id`, `user_id`, `name`, `repo_url`, `local_path`, `current_branch`, `default_branch`, `index_status` (`stale`/`indexing`/`ready`/`error`/`partial`), `last_indexed_at`, `github_repo_owner`, `github_repo_name` |
| `code_chunks` | One row per function/class/method: `id`, `project_id`, `user_id`, `file_path`, `start_line`, `end_line`, `chunk_type` (file/class/function/method), `name`, `signature`, `language`, `semantic_summary`, **`embedding` (vector(512))**, `content_hash`, `branch`, `branch_diverged`, `last_modified_commit`. The `embedding` column is indexed with **HNSW** (`m=16, ef_construction=64`) — see `supabase/migrations/20260414_fix_vector_index.sql` and `20260414_reduce_embedding_dims.sql`. There is also a `tsvector` GIN index on the chunk body for the full-text retrieval strategy. |
| `code_relationships` | Call graph edges: `project_id`, `from_chunk_id`, `to_chunk_id`, `relationship_type` (calls/imports/inherits/implements). Unique on `(from_chunk_id, to_chunk_id, relationship_type)` |
| `project_branches` | Branch metadata: `project_id`, `branch_name`, `last_commit_sha`, `last_commit_message`, `ahead_of_main_by`, `behind_main_by`, `diverged_files` (array of file paths) |

A Supabase RPC function `match_code_chunks` (created via migration) does the pgvector cosine similarity search using the `embedding <=> query_embedding` operator with `LIMIT` and filters on `project_id`, `user_id`, and optionally `branch`.

### Route Reference

**`POST /api/projects`** — Create a project. Takes `name`, `repo_url`, `local_path`, `default_branch`, `github_repo_owner`, `github_repo_name`. Returns `ProjectResponse`. The index_status starts as `"stale"`.

**`GET /api/projects`** — List all projects for the authenticated user, ordered by `created_at` descending.

**`GET /api/projects/{project_id}`** — Get a single project (with ownership validation).

**`DELETE /api/projects/{project_id}`** — Delete a project and all its `code_chunks`, `code_relationships`, and `project_branches` in sequence (no cascades — manually ordered to avoid FK constraint violations).

**`DELETE /api/projects/{project_id}/chunks`** — Delete all chunks for a specific file path within a project. Called when a file is deleted from disk.

**`POST /api/index/ingest`** (202 Accepted) — The main indexing endpoint. Receives an `IngestRequest` with `project_id`, `chunks` (list of up to 10,000 `ChunkInput`), `call_graph` (list of `CallGraphEdge`), `language_map` (dict of language to chunk count), and optional `branch`. Returns `202` immediately and runs indexing in the background (either via arq Redis queue if `REDIS_URL` is set and non-default, or via FastAPI `BackgroundTasks` otherwise). Updates `index_status` to `"indexing"` synchronously before returning.

**`GET /api/retrieve`** — The semantic search endpoint. Parameters: `project_id`, `query` (string, max 10k chars), `branch` (optional), `limit` (1-25, default 10). Returns `RetrieveResponse` with `ranked_chunks`, `related_chunks`, and `branch_context`. Raises `409` if the project is currently indexing.

**`POST /api/sync`** — Trigger GitHub polling sync for one or all projects. Body: `{ project_id?: string }`. If project_id is omitted, polls all GitHub-connected projects.

**`POST /api/webhooks/github`** — Receives GitHub `push` events. Signature-verified via HMAC-SHA256 using `GITHUB_WEBHOOK_SECRET`. Extracts changed files from the push payload, marks corresponding chunks as `branch_diverged = true`, and upserts branch metadata. Supports both arq queue and direct processing.

**`GET /health`** — Simple health check returning `{"status": "ok"}`.

**`GET /health/ready`** — Readiness check that verifies Supabase connectivity and that at least one embedding key (`OPENAI_API_KEY` or `OPENROUTER_API_KEY`) is configured.

### Ingest Pipeline: `index_worker.py`

For each `ChunkInput` received from Electron:

1. **Deduplication check**: Query `code_chunks` for a row matching `(project_id, file_path, name, content_hash)`. If found, skip — the chunk is unchanged.
2. **Summarization**: Call `summarize_chunk()` — a synchronous LiteLLM call to `SUMMARIZER_MODEL` (default: `openrouter/openai/gpt-4.1-nano`). The system prompt instructs the model to produce a 1-2 sentence description of what the function does and why, in 60 tokens or less. If summarization fails, falls back to a concatenation of `name + signature + docstring[:100]`.
3. **Embedding**: Call `embed_text(summary)` — async LiteLLM `embedding()` call using `text-embedding-3-small` with `dimensions=512` (truncated, re-normalized vectors). Retries up to 3 times with exponential backoff (1s, 2s, 4s). Embedded values are upserted directly into the `vector(512)` column.
4. **Upsert**: `INSERT INTO code_chunks ... ON CONFLICT(project_id, file_path, name, chunk_type) DO UPDATE`. Stores the embedding, summary, content hash, branch, and resets `branch_diverged = False`.

After all chunks are processed, `index_status` is set to `"ready"` (0 errors), `"partial"` (some errors), or `"error"` (all failed, 0 processed). `last_indexed_at` is set to the current UTC timestamp.

### Search Pipeline: `search.py` (Hybrid Retrieval)

The `retrieve_context()` function runs a **four-strategy hybrid pipeline**, designed because pure vector ANN throws away the structured signal in code (function names, file paths, identifier overlap) that small embedding models can underweight:

1. **Query preprocessing** (`query_preprocessor.py`): Normalize whitespace, lowercase, strip Markdown noise, and run a fast LLM call (model from `QUERY_DECOMPOSE_MODEL`) to produce a query plan: extracted entities, intent (definition vs usage vs design vs how-to), and zero or more alternate phrasings. The plan is cached per (project_id, query) for 5 minutes to avoid double-billing on UI re-renders.
2. **Parallel retrieval strategies** (run concurrently via `asyncio.gather`):
   - **Vector ANN**: Embed the query (`text-embedding-3-small`, 512-dim), call the Supabase `match_code_chunks` RPC. The HNSW index keeps recall ~99% even at small corpus sizes (a few thousand chunks per project).
   - **Full-text**: Postgres `tsvector @@ plainto_tsquery(...)` on the chunk body GIN index. Catches literal identifier hits the embedding model misses.
   - **Concept**: Pattern-match against signature/name (e.g., "charge users" → functions matching `*charge*`, `*pay*`, `*billing*`) using the entities the preprocessor extracted.
   - **File-path**: Boost chunks under directories whose path substring matches query terms (e.g., a query mentioning "auth" boosts `src/auth/`).
3. **Reciprocal Rank Fusion** (`rrf.py`): Merge the four ranked lists with `score(d) = Σ 1 / (k + rank_i(d))` (k=60). RRF requires no per-strategy score normalization, which makes it robust to the wildly different score scales of vector cosine, BM25, and pattern matching.
4. **Re-ranking layer**: Multiply each fused candidate by `log(1 + observation_count) * branch_weight`. Branch weight is 1.3x if the chunk's branch matches the requested branch, and 1.2x additional if `branch_diverged` is True (recently changed files rank higher). Truncate to `RETRIEVAL_DEFAULT_LIMIT = 15` (capped at `RETRIEVAL_MAX_LIMIT = 50`).
5. **Call-graph expansion** (`expander.py`): Take the top 5 ranked chunks, query `code_relationships` for their callers and callees (both incoming `from_chunk_id` and outgoing `to_chunk_id`), fetch those chunk records. These are returned as `related_chunks` — not vector-ranked but relationship-connected.
6. **Branch context**: Query `project_branches` for the requested branch metadata (ahead/behind counts, last commit, diverged files). Returned as `branch_context`.

Each step is wrapped in a Sentry span (`code-intel.search.preprocess`, `code-intel.search.vector`, `code-intel.search.fts`, `code-intel.search.rrf`, `code-intel.search.expand`) so we can profile slow queries in production.

### Call Graph Processing: `graph.py`

`process_call_graph()` iterates over `CallGraphEdge` objects. For each edge, it looks up the `from_chunk` and `to_chunk` in `code_chunks` by `(project_id, name, file_path)`. If both are found, it upserts a row in `code_relationships`. Edges that reference unknown chunks (e.g., external library calls) are silently skipped and counted as `skipped`.

Supported relationship types: `calls`, `imports`, `inherits`, `implements`.

### GitHub Sync: `github_sync.py`

**Phase 1 — Polling** (`poll_project()`): For a project with a non-main `current_branch`, calls the GitHub compare API (`/repos/{owner}/{repo}/compare/{default}...{branch}`) to get `ahead_by`, `behind_by`, and the list of changed files. Updates `project_branches` with this info and marks all changed file chunks as `branch_diverged = True`.

**Phase 2 — Webhooks** (`webhooks.py`): Receives GitHub `push` events. Extracts added/modified/removed files from all commits in the push payload. Calls `flag_diverged_chunks()` to mark those file paths as stale. Upserts branch metadata with the HEAD commit SHA and message.

**Webhook signature verification**: `verify_webhook_signature()` computes `HMAC-SHA256(GITHUB_WEBHOOK_SECRET, payload_bytes)` and compares with `X-Hub-Signature-256` header using `hmac.compare_digest()` — a timing-safe comparison that prevents timing attacks.

### arq Redis Task Queue: `arq_worker.py`

When `REDIS_URL` is set and points to a real Redis server (not the default `redis://localhost:6379`), the service uses `arq` for durable, retried background jobs:

- **`WorkerSettings`**: `max_jobs = 10`, `job_timeout = 600s`, `max_tries = 3`, `health_check_interval = 30s`.
- **`index_chunks_task`**: Deserializes `chunks_data` and `call_graph_data` (dicts for Redis serialization), runs `process_ingest_batch()` + `process_call_graph()`.
- **`sync_project_task`**: Runs `process_push_webhook()` for webhook-triggered syncs.
- **`enqueue_ingest()`** / **`enqueue_sync()`**: Use a shared arq connection pool (`create_pool()`) to push jobs to Redis.

Without Redis (development), FastAPI's `BackgroundTasks` is used instead — simpler but not retried if the server restarts mid-indexing.

### Middleware Stack

From outermost to innermost:
1. `SlowAPIMiddleware` — rate limiting (120 requests/minute per IP, using `slowapi`)
2. `CORSMiddleware` — allows origins from `ALLOWED_ORIGINS` env var (defaults to localhost)
3. `RequestIDMiddleware` — adds `X-Request-ID` response header (uses incoming header or generates UUID)

### Authentication

All routes use `require_auth` (from `app/auth.py`), a FastAPI `Depends` that:
1. Extracts `Authorization: Bearer <token>` from the request header
2. Decodes the Supabase JWT using `SUPABASE_JWT_SECRET` (HS256) via `PyJWT`
3. Returns the decoded payload (including `sub` = user ID) on success
4. Raises `HTTP 401` on missing/invalid/expired token

### Configuration (`config.py`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `SUPABASE_URL` | (required) | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | (required) | Service role for admin DB access |
| `SUPABASE_JWT_SECRET` | (required) | JWT verification secret |
| `OPENAI_API_KEY` | — | Direct OpenAI embeddings (primary) |
| `OPENROUTER_API_KEY` | — | OpenRouter for embeddings + summarization (fallback/alternative) |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model name |
| `EMBEDDING_DIMENSIONS` | `512` | Vector dimensions (truncated; matches `vector(512)` column) |
| `QUERY_DECOMPOSE_MODEL` | `openrouter/openai/gpt-4.1-mini` | Cheap LLM used by `query_preprocessor` to extract entities/intent |
| `GITHUB_WEBHOOK_SECRET` | — | Webhook HMAC secret |
| `REDIS_URL` | `redis://localhost:6379` | arq job queue (non-default = use arq) |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | CORS allowlist |
| `APP_ENV` | `development` | Sentry environment tag |
| `APP_VERSION` | `1.0.1` | Release tag in Sentry |
| `SENTRY_DSN` | — | Code-intel Sentry project DSN (distinct from the optimization service's DSN) |
| `MAX_CHUNKS_PER_INGEST` | `10,000` | Hard cap on chunks per ingest request |
| `SUMMARY_MAX_TOKENS` | `80` | LLM summary token cap |
| `SUMMARIZER_MODEL` | `openrouter/openai/gpt-4.1-nano` | LLM used to summarize each chunk |
| `RETRIEVAL_DEFAULT_LIMIT` | `15` | Default search result count |
| `RETRIEVAL_MAX_LIMIT` | `50` | Maximum search result count |
| `GITHUB_POLLING_INTERVAL_SECONDS` | `300` | Cron sync frequency (5 minutes) |

### Deployment

The service uses a `Dockerfile` (Python 3.12-slim base, uvicorn entrypoint on port 8002) and a `render.yaml` for one-click Render.com deployment. The Electron app connects to it via `CODE_INTELLIGENCE_SERVICE_URL` environment variable (defaults to `http://127.0.0.1:8002` for local development).

### Dependencies (`requirements.txt`)

| Package | Version | Purpose |
|---------|---------|---------|
| `fastapi` | 0.128.0 | HTTP + WebSocket framework |
| `uvicorn[standard]` | 0.40.0 | ASGI server |
| `pydantic` | 2.12.5 | Request/response validation |
| `httpx` | 0.28.1 | Async HTTP (GitHub API calls) |
| `PyJWT` | >=2.9.0 | JWT verification |
| `cryptography` | >=44.0.0 | Crypto primitives for JWT |
| `sentry-sdk[fastapi]` | 2.56.0 | Error tracking + LoggingIntegration |
| `slowapi` | 0.1.9 | Rate limiting middleware |
| `litellm` | 1.81.14 | LLM abstraction (embeddings + summarization) |
| `supabase` | 2.15.2 | DB client |
| `python-dotenv` | 1.1.0 | .env file loading |
| `arq` | 0.26.1 | Redis-backed async task queue |
| `redis` | 5.3.0 | Redis client (arq dependency) |

---

## Chapter 17: The Spaces Feature — Project-Aware Prompt Workspaces

> **This entire feature is new and not covered anywhere in the existing documentation.**

### What Spaces Are

"Spaces" is a new top-level navigation section in the App Window sidebar (rendered by `ProjectsView`). A Space is a named workspace that combines:

- One or more **local project folders** attached to it (each connected to a project record in the Code Intelligence Service).
- A **chat thread** (user/assistant message history, stored in localStorage).
- A **Project Mode toggle** — when on, every prompt sent is enriched with retrieved code context before being sent to the AI optimizer.
- **Index status tracking** — the UI shows whether each attached project is `ready`, `indexing`, or `stale`, along with the last indexed timestamp and current git branch.

The entry point is `ProjectsView` (`app-ui/src/components/projects/ProjectsView.tsx`), which shows an onboarding screen (when empty), a space card grid (`SpacesList`), or the active workspace detail (`SpaceWorkspace`).

### Data Model and Local Persistence

All Space data is stored in **localStorage** under the key `"prmpt_spaces"`. There is no Supabase persistence for Spaces — they are local to the machine.

```typescript
interface Space {
  id: string;                 // UUID, generated at creation
  name: string;               // User-defined name
  projects: SpaceProject[];   // Attached project folders
  messages: SpaceMessage[];   // Chat history (user + assistant turns)
  projectMode: boolean;       // Whether context injection is active
  createdAt: number;          // Unix timestamp (ms)
  lastUsedAt: number;         // Updated on every interaction
}

interface SpaceProject {
  projectId: string;          // ID from Code Intelligence Service
  name: string;               // Folder basename
  localPath: string;          // Absolute local path on disk
  branch?: string;            // Git branch at time of add
  indexStatus?: string;       // Last known status (for display)
}

interface SpaceMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;          // Unix timestamp (ms)
  feedback?: { rating: "positive" | "negative" };
}
```

`loadSpaces()` includes a **schema migration**: old Space objects that had a `history` field (array of `{ id, issue, optimizedPrompt, timestamp }`) are automatically converted to the new `messages` format (one user message + one assistant message per history entry).

### Adding a Project Folder

When a user clicks "Add Folder" in `SpaceWorkspace`:

1. `electronAPI.project.add()` is called (IPC channel `project:add`).
2. In the main process (`project-handlers.ts`), `dialog.showOpenDialog({ properties: ['openDirectory'] })` opens the native folder picker.
3. The folder path is checked with `isGitRepo()` (running `git rev-parse --is-inside-work-tree`).
4. If it's a git repo: `getBranchInfo()` fetches the current branch, and `getGitRemoteUrl()` + `parseGitHubUrl()` extract the GitHub owner/repo if the remote is on GitHub.
5. `CodeIntelClient.createProject()` sends `POST /api/projects` with name, local_path, repo_url, default_branch, github_repo_owner, github_repo_name.
6. `performFullScan()` is triggered immediately as a background task — it walks the directory tree, parses every source file, and sends the chunks to the Code Intelligence Service for indexing.
7. Status is broadcast to both the overlay and app window via IPC.

### File Watching

When a project is attached to a Space and Project Mode is on, `api.toggleWatching(projectId, localPath, true)` is called (IPC `project:toggle-watching`). This starts a chokidar watcher on the folder. When Project Mode is turned off or the Space is navigated away from, `toggleWatching(..., false)` stops the watcher.

The `watchStartedRef` in `SpaceWorkspace` tracks which project IDs already have watchers started (to avoid double-starting on re-renders).

### Context Injection Flow (Project Mode)

When the user types a query and presses Send in Project Mode:

1. `retrieve()` is called for each attached project: `electronAPI.project.retrieve({ project_id, query, branch, limit: 10 })` (IPC `project:retrieve` → `CodeIntelClient.retrieve()` → `GET /api/retrieve`).
2. All `ranked_chunks` from all projects are merged and sorted by `similarity_score` descending. The top 10 are kept.
3. All `related_chunks` (callers/callees of top results) are merged; the top 5 are kept.
4. `buildTailoredPrompt(query, rankedChunks, relatedChunks)` constructs the enriched prompt string injecting the code context as structured markdown.
5. This tailored prompt is sent to `electronAPI.optimizePrompt(tailoredPrompt, false, undefined, "thinking", "space")`.
6. The optimization streams back via `onOptimizationChunk` / `onOptimizationComplete` events, filtered by `source === 'space'` to avoid collision with main chat stream events.
7. The streaming response is rendered in the Space's chat thread using `useSmoothStreaming`.

### `buildTailoredPrompt()` Format

```
{original user query}

Here are the most relevant parts of my codebase for this task:

- **{name}** ({chunk_type}) in `{...shortened_path}` (lines {start}-{end})
  Signature: `{signature}`
  Summary: {semantic_summary}

Related/connected code:
- **{name}** in `{...shortened_path}`
  {semantic_summary}

Please provide a detailed, step-by-step plan considering these specific files and functions.
Include exact file paths and function names in your response.
```

`shortenPath()` trims paths to the last 3 segments with `...` prefix when longer (e.g., `".../src/auth/login.ts"`).

### Index Status UI

The right panel of `SpaceWorkspace` shows each attached project with:
- A colored dot (green = ready, amber = indexing + CSS pulse animation, red = stale).
- The index status label.
- The current git branch (with a `GitBranch` icon).
- Time since last indexed (e.g., "2h ago"), computed client-side.
- On hover: "Re-index" and "Remove" buttons.

`broadcastProjectStatus()` in `project-handlers.ts` sends `project:status-update` to the app window and `overlay:project-status` to the overlay, which updates `projectStatuses` state in real-time.

If a project has `index_status === "stale"` when the Space is loaded, `api.reindex()` is called automatically.

---

## Chapter 18: Code Parser — Tree-Sitter WASM Code Parsing

> **This module is new and not covered anywhere in the existing documentation.**

`electron/main/services/code-parser.ts` runs entirely in the **Electron main process** and uses **web-tree-sitter** (the WASM build of Tree-sitter) to parse source files into structural skeletons without executing the code.

### Initialization

`initializeParser()` dynamically requires `web-tree-sitter` and calls its `init()` method to load the WASM binary. This is called lazily before the first parse. Each language grammar is loaded on demand via `Language.load(wasmPath)` and cached in `languageParsers: Map<string, any>`.

### Supported Languages

| File Extensions | Language | Grammar WASM |
|----------------|---------|-------------|
| `.js`, `.jsx` | javascript | `tree-sitter-javascript.wasm` |
| `.ts`, `.tsx` | typescript | `tree-sitter-typescript.wasm` |
| `.py` | python | `tree-sitter-python.wasm` |
| `.go` | go | `tree-sitter-go.wasm` |
| `.rs` | rust | `tree-sitter-rust.wasm` |
| `.java` | java | `tree-sitter-java.wasm` |
| `.rb` | ruby | `tree-sitter-ruby.wasm` |
| `.c`, `.h` | c | `tree-sitter-c.wasm` |
| `.cpp`, `.hpp` | cpp | `tree-sitter-cpp.wasm` |
| `.cs` | c_sharp | `tree-sitter-c_sharp.wasm` |

WASM files are stored in `tree-sitter-wasms/` at the project root.

### `parseFile(filePath, content): Promise<ChunkData[]>`

1. Detect language from extension. Return `[]` if unsupported.
2. Load grammar parser for the detected language.
3. Call `parser.parse(content)` to get a CST.
4. **Import collection**: Walk the entire tree for import-type nodes and collect their text (up to 200 chars each).
5. **Chunk extraction** (`walkForChunks()` recursive traversal):
   - **Class nodes**: Create a `class` chunk. Recurse into children to find method nodes (which become `method` chunks named `{ClassName}.{methodName}`).
   - **Function nodes**: Create a `function` chunk. Extract `name` via `childForFieldName('name')`, `signature` via `parameters` + optional `return_type` (truncated to 500 chars), `docstring` from the first string literal in the body or a preceding comment node (truncated to 500 chars), and `callees` by walking child nodes for call expressions (max 50, method calls stripped to bare function name).
   - Skip anonymous functions (`name === '<anonymous>'`).
6. **File-level fallback**: If no chunks were extracted, create a single `file` chunk for the whole file using the basename.
7. **Content hash**: `sha256(node.text).hex().slice(0, 16)` — used for deduplication.

### `ChunkData` Structure

```typescript
{
  file_path: string,       // relative path
  start_line: number,      // 1-indexed
  end_line: number,
  chunk_type: 'file' | 'class' | 'function' | 'method',
  name: string,            // e.g., "AuthService.login"
  signature?: string,      // e.g., "(email: string): Promise<User>"
  language: string,
  docstring?: string,      // first docstring/comment, max 500 chars
  content_hash: string,    // 16-char hex sha256
  callees: string[],       // called function names, max 50
  imports: string[],       // file-level import texts
}
```

---

## Chapter 19: File Watcher — Incremental Re-indexing on File Changes

> **This module is new and not covered anywhere in the existing documentation.**

`electron/main/services/file-watcher.ts` uses **chokidar** to monitor project directories for file changes and triggers incremental re-indexing.

### `startWatching(projectId, projectPath, client, branch?)`

Creates a chokidar watcher with:
- `persistent: true` — keeps watching until explicitly stopped
- `ignoreInitial: true` — does not fire events for pre-existing files
- `awaitWriteFinish: { stabilityThreshold: 500ms, pollInterval: 200ms }` — waits for writes to stabilize before emitting
- `ignored` patterns: `node_modules`, `.git`, `dist`, `build`, `__pycache__`, `.venv`, `venv`, `.next`, `target`, `*.min.js`, `*.map`, `*.lock`, `package-lock.json`, `yarn.lock`

All `change` and `add` events are **debounced at 2000ms** per file — rapid saves only trigger one reindex.

### On File Change / Add (`handleFileChange`)

1. Check if file language is supported. Skip if not.
2. Skip files larger than 500KB.
3. Compute SHA-256 hash of file content.
4. Compare with cached hash from `local-project-cache.ts`. Skip if unchanged.
5. Parse file with `parseFile()`.
6. If chunks extracted: update local cache hash, call `client.ingestSkeleton()`.

### On File Delete (`unlink`)

1. Clear the file's entry from local SQLite cache.
2. Call `client.deleteChunksForFile(projectId, relativePath)`.

### `performFullScan(projectId, projectPath, client, branch?, onProgress?)`

Recursively collects all parseable files (skipping hidden dirs, node_modules, dist, build, target, venv). For each file:
1. Skip if >500KB.
2. Check hash against local cache. Skip unchanged files (incremental).
3. Parse with `parseFile()` and accumulate chunks.

The full batch is sent in **500-chunk sub-batches** to avoid HTTP payload size limits. Returns `{ totalFiles, totalChunks }`. The `onProgress` callback is called every 50 files for progress display in the UI.

### State Management

`activeWatchers: Map<string, WatcherState>` tracks all running watchers. Each `WatcherState` contains the chokidar watcher instance, projectId, projectPath, and a `debounceTimers` Map per file path.

`stopAllWatchers()` is called on app quit to close all chokidar instances and cancel pending debounce timers.

---

## Chapter 20: Git Service — Local Repository Introspection

> **This module is new and not covered in the existing documentation.**

`electron/main/services/git-service.ts` wraps the `git` CLI via `child_process.execFile`. All operations use a 10-second timeout and 1MB buffer.

### Functions

| Function | Git Command | Returns |
|----------|------------|---------|
| `isGitRepo(path)` | `git rev-parse --is-inside-work-tree` | `boolean` |
| `getCurrentBranch(path)` | `git rev-parse --abbrev-ref HEAD` | branch name string |
| `getDefaultBranch(path)` | `git symbolic-ref refs/remotes/origin/HEAD --short` | branch name (fallback: `main` or `master`) |
| `getAheadBehind(path, branch, default)` | `git rev-list --left-right --count origin/{default}...{branch}` | `{ ahead, behind }` |
| `getRecentCommits(path, count)` | `git log --max-count={n} --format=%H|%s|%an|%aI` | `GitCommitInfo[]` |
| `getChangedFiles(path, default)` | `git diff --name-only origin/{default}...HEAD` | `string[]` |
| `getGitRemoteUrl(path)` | `git config --get remote.origin.url` | URL string or `null` |
| `parseGitHubUrl(url)` | (regex) | `{ owner, repo }` or `null` |
| `getBranchInfo(path)` | (aggregates all above) | `GitBranchInfo` |

`parseGitHubUrl()` matches both HTTPS (`https://github.com/owner/repo`) and SSH (`git@github.com:owner/repo`) formats.

---

## Chapter 21: Local Project Cache — SQLite File Hash Store

> **This module is new and not covered in the existing documentation.**

`electron/main/database/local-project-cache.ts` maintains a **SQLite database** at `{userData}/project-cache.db` using the synchronous `better-sqlite3` library.

**Purpose**: Avoid re-parsing and re-sending unchanged files. Before parsing any file, the watcher checks the local cache; if the content hash matches the last successfully indexed version, the file is skipped.

**Schema**:
```sql
CREATE TABLE file_cache (
  project_id    TEXT NOT NULL,
  file_path     TEXT NOT NULL,      -- relative path
  content_hash  TEXT NOT NULL,      -- 16-char hex SHA-256
  chunk_count   INTEGER NOT NULL DEFAULT 0,
  last_parsed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, file_path)
)
```

WAL journal mode is enabled for better concurrent read performance.

**API**: `getCachedHash(projectId, filePath)`, `setCachedHash(projectId, filePath, contentHash, chunkCount)`, `clearProjectCache(projectId)`, `clearFileCache(projectId, filePath)`, `getProjectFileCount(projectId)`.

If `better-sqlite3` is not available, all functions gracefully degrade (return `null`/`0`) — the watcher still works but every file is treated as changed.

---

## Chapter 22: Code Intelligence Client — Electron-Side HTTP Client

> **This module is new and not covered in the existing documentation.**

`electron/main/api/code-intel-client.ts` is the axios-based HTTP client that the Electron main process uses to communicate with the Code Intelligence Service.

`CodeIntelClient` is initialized with `baseUrl` from `CODE_INTELLIGENCE_SERVICE_URL` env var (defaults to `http://127.0.0.1:8002`). It uses an **axios request interceptor** to automatically attach `Authorization: Bearer {currentAccessToken}` from `authState` to every outgoing request.

Timeouts: 120s for most requests, 300s for `ingestSkeleton()` (large batch operations may take longer).

---

## Chapter 23: Project IPC Handlers

> **This module is new and not covered in the existing documentation.**

`electron/main/ipc-handlers/project-handlers.ts` registers all project-related IPC channels. These are exposed via `electronAPI.project.*` in the preload.

| IPC Channel | Action |
|-------------|--------|
| `project:add` | Native folder dialog, git detection, `createProject()`, initial full scan |
| `project:remove` | Stop watcher, `deleteProject()`, clear local cache, broadcast null status |
| `project:list` | Return all user projects |
| `project:status` | Return single project info |
| `project:set-active` | Set active project, start watcher, broadcast status |
| `project:get-active` | Return `{ projectId, branch }` |
| `project:reindex` | Clear cache, broadcast `indexing`, `performFullScan()` with progress, broadcast result |
| `project:sync` | Call `client.syncProject()` |
| `project:toggle-watching` | `startWatching()` or `stopWatching()` |
| `project:is-watching` | Return `isWatching(projectId)` |
| `project:retrieve` | Call `client.retrieve(params)` |

`broadcastProjectStatus(data)` sends `overlay:project-status` to the overlay and `project:status-update` to the app window simultaneously.

---

## Chapter 24: Analytics Service — Session Tracking and Usage Events

> **This feature is new and not covered in the existing documentation.**

### `AnalyticsService` (`electron/main/analytics/analytics-service.ts`)

Singleton (`analyticsService`) that manages:
1. **App sessions**: `app_sessions` Supabase table row created on `startSession()`, updated with duration on `endSession()`.
2. **Usage events**: Discrete named events queued in `EventBuffer` and batch-flushed to `usage_events` table.

**Crash recovery**: On `startSession()`, any session rows where `ended_at IS NULL` are closed first with `duration_seconds = null` (indicating unclean termination).

All public methods are designed to never throw — exceptions are captured to Sentry but never surfaced.

### `EventBuffer` (`electron/main/analytics/event-buffer.ts`)

Batched write system for analytics events:
- **Auto-flush**: Every **10 seconds** via `setInterval`, or immediately when buffer reaches **50 events**.
- **Offline persistence**: If a Supabase flush fails, events are written to `{userData}/offline-cache/analytics-{userId}.json`. On next `initialize()`, `drainOfflineQueue()` retries the upload and deletes the file on success.
- **Shutdown flush**: `flushSync()` is awaited on app quit to ensure no events are lost.

### Database Tables

| Table | Columns |
|-------|---------|
| `app_sessions` | `id UUID`, `user_id`, `app_version`, `platform`, `started_at`, `ended_at`, `duration_seconds` |
| `usage_events` | `id UUID`, `user_id`, `event_type`, `metadata JSONB`, `created_at` |
| `user_feedback` | `id UUID`, `user_id`, `rating` (positive/negative), `comment TEXT`, `created_at` |

---

## Chapter 25: Clarification System — Pre-Optimization Questionnaire

> **This feature is new and not covered in the existing documentation.**

### Overview

Before the optimizer runs, the Python service can optionally return a set of clarification questions about the user's prompt. Answering these helps the optimizer produce more targeted output.

### `ClarificationCard` (`app-ui/src/components/chat/ClarificationCard.tsx`)

Rendered inline in the chat stream before the optimized response appears.

**Question types**:
- `multiple_choice` — multi-select by default (checkboxes). "Delivery format" questions (detected by keywords: "task sections", "broken into", "delivery", "one complete", "delivered") are single-select (radio buttons).
- `text` — free-text input.

**UX details**:
- Questions fade in one by one with a 120ms stagger (CSS `translate-y` + `opacity` transition).
- An "Other" option with a revealed text input is added to all multiple-choice questions.
- A progress bar shows which questions have been answered.
- An "Anything else?" free-text textarea is always shown at the bottom.
- The "Optimize" button brightens once at least one answer is given.
- `compact` prop renders a smaller variant for use in the Overlay.
- `initialAnswers` pre-fills all fields for re-edit mode.

**`wantsSections` detection**: If the user selected an option containing "section", "broken", or "task" in the delivery-format question, `wantsSections = true` is passed to `onSubmit`. The optimizer uses this to generate a multi-section structured output rather than a single block.

**Answer serialization**: Multiple-choice answers are joined with `", "`. Free-text "Other" input is appended to the same string. `parseAnswerToSelections()` reverses this on re-edit.

### `ClarificationSummaryCard` (`app-ui/src/components/chat/ClarificationSummaryCard.tsx`)

Shown after optimization completes, displaying which preferences were selected. Features:
- A "Tasks" or "Single" mode badge.
- Each answered question with pill badges for selected values.
- "Additional context" text if provided.
- An "Edit" button that replaces the summary with a pre-filled `ClarificationCard` for re-optimization.

---

## Chapter 26: Feedback System

> **This feature is new and not fully covered in the existing documentation.**

### Inline Message Feedback (`FeedbackWidget`)

`app-ui/src/components/chat/FeedbackWidget.tsx` renders thumbs-up/thumbs-down buttons below assistant messages. Selecting a rating calls `onFeedback(messageId, rating)`, then auto-dismisses after 900ms. Accepts `initialRating` prop for persisted ratings.

### App-Level Feedback Modal (`FeedbackModal`)

`app-ui/src/components/feedback/FeedbackModal.tsx` is a `Dialog` for rating the overall app experience. Renders rating buttons, optional comment textarea (shown after rating is selected with fade-in animation), and submit. Shows a success animation on submit, then closes after 1.5s.

### IPC Handler (`feedback-handlers.ts`)

`feedback:submit` IPC channel saves `{ rating, comment }` to the `user_feedback` Supabase table under the authenticated user's ID. Errors are captured to Sentry.

---

## Chapter 27: Skill System — Optimization Domain Skills

> **This feature is new and not covered in the existing documentation.**

Skills are markdown files in the `files/` directory, named `skill_{name}.md`. The Python service injects the selected skill's content into the optimizer system prompt to apply domain-specific guidance.

### `registerSkillHandlers()` (`electron/main/ipc-handlers/skill-handlers.ts`)

`skills:list` IPC channel:
1. Resolves the skills directory: `files/` (dev) or `process.resourcesPath/files` (packaged).
2. Finds all `skill_*.md` files.
3. Parses each with `parseSkillMetadata()`:
   - **Label**: First `# Heading` line, `SKILL FILE:` prefix stripped, title-cased.
   - **Description**: First two bullet points from the `## WHEN TO USE THIS SKILL` section, joined with `", "`, truncated to 80 chars.
4. Returns alphabetically sorted `SkillInfo[]`: `{ name, label, description }`.

`app-ui/src/components/chat/SkillPicker.tsx` renders the skill selection UI in the chat input. `app-ui/src/lib/skillIcons.tsx` maps skill names to Phosphor icon components.

---

## Chapter 28: AI Guardrails — Request Deduplication and Rate Control

> **This module is new and not covered in the existing documentation.**

`electron/main/optimization/ai-guardrails.ts` — `AIGuardrails` class — protects against spam and concurrent request conflicts.

### Rules

| Rule | Value | Effect |
|------|-------|--------|
| Minimum length | 10 chars | Rejects very short prompts |
| Similarity threshold | 0.9 (90%) | Skips near-duplicate requests (Levenshtein distance) |
| Cooldown | 3000ms | Enforces 3-second gap between requests |
| Max in-flight | 1 | Rejects if an optimization is already running |

### `optimize(promptText, requestId, skipCache)`

If an in-flight request with the same `requestId` exists and `skipCache` is false, returns the existing promise (deduplication). Otherwise creates a new optimization request, stores the promise in `inFlightRequests`, and removes it on completion.

### Levenshtein Similarity

```
similarity = 1 - (levenshteinDistance(a, b) / max(len(a), len(b)))
```

A score above 0.9 means the texts are considered too similar to re-optimize.

---

## Chapter 29: New Overlay Components

> **These components are new and not covered in the existing documentation.**

### `ChatPicker` (`app-ui/src/overlay/components/ChatPicker.tsx`)

A modal panel inside the overlay for selecting an existing app-window chat to attach as context. On open, loads the full chat list via `window.electronAPI.overlay.getChats()`. Renders a search input that filters by title, a scrollable list, and confirm/cancel buttons. Escape closes the picker. Confirming calls `onConfirm(chatId, chatName)`.

### `ProjectStatus` (`app-ui/src/overlay/components/ProjectStatus.tsx`)

A small status badge in the overlay header. Subscribes to `api.project.onOverlayStatus()` for real-time status updates. Shows:
- A colored dot (green/amber/red) with a pulsing animation when indexing.
- Project name + optional branch name.
- Indexing percentage when `status === 'indexing'` and `progress` is provided.
- Returns `null` if no active project.

### `CollectionPicker` (`app-ui/src/overlay/components/CollectionPicker.tsx`)

A modal panel in the overlay for selecting a prompt library collection to save the current optimization result to.

---

## Chapter 30: History View

`app-ui/src/components/history/HistoryView.tsx` — a read-only list of past chat sessions grouped by date.

**Date grouping**: "Today", "Yesterday", named weekday (within 7 days), or formatted date. Grouping is done client-side in a `reduce()`.

**`HistoryItem`**: `{ id, title, preview, date: Date, messageCount }`. Rendered as clickable bordered cards with truncated title, message count badge, and relative timestamp. Clicking calls `onSelectItem(id)` to navigate to the chat.

---

## Chapter 31: Updated File Map — All New Files Since Last Documentation

### `code-intelligence-service/` (entirely new service)

| File | Purpose |
|------|---------|
| `app/main.py` | FastAPI factory, middleware, router registration, health endpoints |
| `app/config.py` | All environment variables and runtime constants |
| `app/auth.py` | JWT Bearer auth FastAPI dependency |
| `app/routes/projects.py` | Project CRUD (create/list/get/delete/delete-chunks) |
| `app/routes/ingest.py` | Async chunk ingestion (202, arq or BackgroundTasks) |
| `app/routes/retrieve.py` | Semantic search with re-ranking |
| `app/routes/sync.py` | GitHub polling sync endpoint |
| `app/routes/webhooks.py` | GitHub push webhook receiver with HMAC verification |
| `app/services/embedding.py` | LiteLLM embedding with retry backoff |
| `app/services/search.py` | Vector search + re-ranking + related chunks |
| `app/services/graph.py` | Call graph edge resolution and relationship upsert |
| `app/services/github_sync.py` | GitHub API polling and webhook utilities |
| `app/services/summarizer.py` | LLM-based 60-token semantic chunk summaries |
| `app/db/models.py` | Pydantic request/response models for all routes |
| `app/db/queries.py` | All raw Supabase queries (CRUD, vector search RPC, branch ops) |
| `app/db/supabase_client.py` | Supabase client singleton (service role) |
| `app/workers/index_worker.py` | Per-chunk pipeline: hash check → summarize → embed → upsert |
| `app/workers/sync_worker.py` | Webhook-triggered delta re-indexing worker |
| `app/workers/arq_worker.py` | arq WorkerSettings, task functions, enqueue helpers |
| `Dockerfile` | Python 3.12-slim, uvicorn on port 8002 |
| `render.yaml` | Render.com deployment configuration |
| `requirements.txt` | Python dependency list |

### `electron/main/` (new files)

| File | Purpose |
|------|---------|
| `analytics/analytics-service.ts` | Session tracking + event logging singleton |
| `analytics/event-buffer.ts` | Batched analytics flusher with offline JSON persistence |
| `api/code-intel-client.ts` | axios HTTP client for Code Intelligence Service |
| `database/local-project-cache.ts` | better-sqlite3 file hash cache for incremental indexing |
| `ipc-handlers/feedback-handlers.ts` | `feedback:submit` IPC → `user_feedback` Supabase table |
| `ipc-handlers/project-handlers.ts` | All project/space IPC channels |
| `ipc-handlers/skill-handlers.ts` | `skills:list` IPC → parse skill markdown files |
| `optimization/ai-guardrails.ts` | Request deduplication, cooldown, similarity, in-flight limits |
| `optimization/response-validator.ts` | AI response structure validation |
| `optimization/session-state.ts` | Per-session optimization phase state machine |
| `optimization/stability-tracker.ts` | Optimization request success rate tracking |
| `services/code-parser.ts` | web-tree-sitter WASM code parser (13 languages, 4 chunk types) |
| `services/file-watcher.ts` | Chokidar watcher with 2s debounce and incremental ingest |
| `services/git-service.ts` | Git CLI wrapper (branch, commits, ahead/behind, remote URL) |

### `app-ui/src/` (new files)

| File | Purpose |
|------|---------|
| `components/chat/ClarificationCard.tsx` | Pre-optimization questionnaire with multi-select, stagger animation |
| `components/chat/ClarificationSummaryCard.tsx` | Post-optimization preference summary with re-edit |
| `components/chat/FeedbackWidget.tsx` | Inline thumbs up/down message rating |
| `components/chat/SkillPicker.tsx` | Skill selection UI in chat input |
| `components/feedback/FeedbackModal.tsx` | App-level rating dialog with optional comment |
| `components/history/HistoryView.tsx` | Date-grouped chat history list |
| `components/projects/ProjectsView.tsx` | Top-level Spaces navigation view |
| `components/projects/SpacesList.tsx` | Card grid of all user Spaces |
| `components/projects/SpaceWorkspace.tsx` | Space detail: chat thread, project panel, context toggle |
| `components/projects/types.ts` | Space data types, localStorage helpers, `buildTailoredPrompt()` |
| `lib/skillIcons.tsx` | Skill name to Phosphor icon component mapping |
| `overlay/components/ChatPicker.tsx` | Overlay modal for attaching existing chat context |
| `overlay/components/CollectionPicker.tsx` | Overlay modal for saving to prompt library collection |
| `overlay/components/ProjectStatus.tsx` | Overlay project indexing status badge |

### `tree-sitter-wasms/` (new directory)

WASM grammar files used by `code-parser.ts`:
`tree-sitter-javascript.wasm`, `tree-sitter-typescript.wasm`, `tree-sitter-python.wasm`, `tree-sitter-go.wasm`, `tree-sitter-rust.wasm`, `tree-sitter-java.wasm`, `tree-sitter-ruby.wasm`, `tree-sitter-c.wasm`, `tree-sitter-cpp.wasm`, `tree-sitter-c_sharp.wasm`.

---

*Documentation last extended: April 2026. Chapters 16–31 cover the Code Intelligence Service, Spaces workspaces, code parsing pipeline, file watching, git integration, analytics system, clarification questionnaire, feedback system, skill system, AI guardrails, and all new overlay components — none of which appeared in the original documentation.*

---

## Chapter 32: Task Planner — Structured Builds for Complex Prompts

> **New module in `pipeline_v2/task_planner.py` — not covered in any previous documentation.**

### The Problem It Solves

When a user submits a complex, multi-part build request (e.g., "Build a full SaaS dashboard with auth, billing, and analytics"), a single flat optimized prompt is insufficient. The optimizer needs to know what comes first, what each phase produces, and what state the codebase is in after each step. Without this, the AI coding assistant either tries to do everything at once or makes assumptions about what already exists.

The `task_planner.py` module runs a pre-pass before the optimizer in these cases, producing a structured task graph that the optimizer can use to write accurate, dependency-aware sectioned output.

### When It Runs

Task planning is triggered when the user's clarification answer indicates they want **sectioned task output** (the `wantsSections: true` flag from `ClarificationCard`). The flow is:

```
Clarification answers received
    └── wantsSections: true
            │
            ▼
plan_tasks(user_input, model=SUMMARIZER_MODEL)
            │
            ├── Returns None (failure) → optimizer falls back to generic sectioned format
            └── Returns List[TaskDict] → injected into optimizer system prompt
```

### `plan_tasks(user_input, model?, provider?)` Function

**Model**: `SUMMARIZER_MODEL` (cheap, fast — `gpt-4o-mini` or equivalent)
**Temperature**: 0.2 (deterministic — consistency is critical for dependency ordering)
**Response format**: `json_object`
**Max tokens**: 1024

The planner is given a strict system prompt with these rules:
1. Order tasks by dependency — earlier tasks must not depend on later ones
2. Each task must be independently executable by an AI coding assistant
3. Task 1 always handles project setup / scaffolding
4. 3–12 tasks. Merge trivial steps; split overly large ones
5. Be specific in "produces" — name actual files, components, or endpoints
6. "state_after" must describe what a developer would see after running this task
7. Do not include testing, deployment, or CI/CD unless explicitly requested

### Task Schema

Each task in the returned list has this shape:

```python
{
    "number": 1,
    "name": "Project Setup & Scaffolding",
    "goal": "Initialize the Next.js project with TypeScript, Tailwind, and Supabase",
    "depends_on": "",                          # Empty for task 1
    "produces": ["package.json", "tailwind.config.ts", "lib/supabase.ts"],
    "state_after": "A running Next.js dev server with Supabase client configured"
}
```

### Failure Handling

`plan_tasks` returns `None` on any error (LLM failure, JSON parse error, fewer than 2 valid tasks). The optimizer catches `None` and falls back to its own internal task-section format. This ensures the feature degrades gracefully without surfacing errors to the user.

### Token Logging

Every successful call logs to the daily usage `.jsonl` file with `call_type="task_planner"`, enabling cost tracking separate from optimization calls.

---

## Chapter 33: OTP-Based Email Authentication

> **New module in `app/email_otp.py` and `components/auth/OtpVerification.tsx` — not covered in any previous documentation.**

### Why OTP?

The app supports two email-based auth flows that don't map cleanly to Supabase's standard JWT flow:
1. **Signup OTP verification** — confirm email ownership before creating the Supabase account
2. **Password reset OTP** — reset password without Supabase's magic link flow (which requires a web redirect)

Both flows use a self-contained OTP system managed entirely by the Python service.

### OTP Service (`app/email_otp.py`)

**Storage**: In-memory Python dict — `_store: Dict[str, OTPRecord]` — no database required for OTP codes.

**OTPRecord shape**:
```python
{
    "otp": "847291",           # 6-digit random string
    "email": "user@example.com",
    "purpose": "signup",       # or "reset"
    "expires_at": datetime,    # now() + 10 minutes
    "data": {...}              # Optional extra data (for signup: display_name, custom_instructions)
}
```

**Key Functions**:

| Function | Description |
|---|---|
| `send_signup_otp(email, display_name?, custom_instructions?)` | Generate 6-digit OTP, store in `_store`, send via SMTP, return `{ message }` |
| `verify_signup_otp(email, otp)` | Verify OTP + expiry, create Supabase user via Admin API, return JWT session, delete OTP record |
| `send_reset_otp(email)` | Generate OTP, store with `purpose="reset"`, send via SMTP |
| `reset_password(email, otp, new_password)` | Verify OTP, call Supabase Admin API to update password, delete OTP record |
| `cleanup_expired()` | Removes all OTPRecords where `expires_at < now()` — called every 5 minutes by a background asyncio task started in `startup_event()` |

**OTP Expiry**: 10 minutes. After expiry, `verify_signup_otp` and `reset_password` return a 400 error.

**Brute-force protection**: No explicit lockout in the current implementation — rate limiting via SlowAPI (`60/minute` default) provides the primary protection.

### Frontend OTP UI (`OtpVerification.tsx`)

A 6-digit OTP entry form rendered after signup or password reset initiation. Features:
- 6 separate single-character `<input>` fields for controlled input
- Auto-advances focus to the next field on input
- Auto-submits when all 6 digits are entered
- Backspace on an empty field focuses the previous field
- Paste support — pasting a 6-digit string fills all fields and auto-submits
- Countdown timer showing remaining validity

### API Endpoints

```
POST /auth/send-signup-otp    { email, display_name?, custom_instructions? }
POST /auth/verify-signup-otp  { email, otp }  → { access_token, refresh_token, user }
POST /auth/send-reset-otp     { email }
POST /auth/reset-password     { email, otp, new_password }
```

None of these endpoints require a JWT (`require_auth` dependency is not applied).

---

## Chapter 34: GDPR Account Deletion — 30-Day Graceful Wipe

> **New modules in `database/services/deletion-service.ts`, `ipc-handlers/deletion-handlers.ts`, and the `deletion_requests` Supabase table.**

### The Lifecycle

```
User → Settings → "Delete Account" → Confirmation dialog
        │
        ▼
account:request-deletion IPC
  → DeletionService.scheduleDeletion(userId)
  → INSERT into deletion_requests { user_id, scheduled_for: now() + 30 days }
  → Return { scheduledFor: Date }
        │
        ▼
UI shows: "Your account is scheduled for deletion on [date]. You can cancel anytime."
        │
        ├── User clicks "Cancel Deletion"
        │       → account:cancel-deletion IPC
        │       → UPDATE deletion_requests SET cancelled_at = now()
        │       → Deletion prevented
        │
        └── 30 days pass without cancellation
                → Supabase edge function (cron job, runs daily)
                → SELECT from deletion_requests WHERE scheduled_for <= now() AND cancelled_at IS NULL
                → Permanently delete all user data (using service role key)
                → Auth.deleteUser(userId)
```

### `DeletionService`

| Method | Supabase Operation |
|---|---|
| `scheduleDeletion(userId)` | INSERT into `deletion_requests` |
| `cancelDeletion(userId)` | UPDATE `deletion_requests` SET `cancelled_at = now()` WHERE `cancelled_at IS NULL` |
| `getPendingDeletion(userId)` | SELECT most recent non-cancelled deletion request |

### Security

The Supabase edge function that executes deletions uses the **service role key** — it can bypass RLS and delete any user's data. The function validates that the caller is the cron scheduler (via a secret header) before executing. This ensures no user can trigger another user's deletion.

### Data Wiped on Deletion

All rows in every table where `user_id = userId`:
- `user_profiles`, `user_preferences`, `chats`, `messages`, `prompt_collections`, `saved_prompts`, `user_memory`, `app_sessions`, `usage_events`, `code_intel_projects`, `deletion_requests`

Cloudinary avatars and Supabase Storage attachments are deleted via their respective APIs. The Supabase Auth user (`auth.users`) is deleted last.

---

## Chapter 35: Rate Limiting and Daily Usage Caps

> **New module in `database/services/rate-limit-service.ts`.**

Prmpt enforces two layers of rate limiting:

### Layer 1: API-Level Rate Limiting (Python Service)

Implemented via **SlowAPI** middleware on every HTTP/WebSocket endpoint:
- Default: `60/minute` per IP address
- Application-wide: `10000/minute`
- Specific endpoints can override: e.g., OTP endpoints may have stricter limits

When a rate limit is exceeded, SlowAPI returns HTTP 429 with a `Retry-After` header. The Electron main process surfaces this as a toast notification: "You're going too fast. Wait a moment before sending again."

### Layer 2: Daily Usage Cap (Per-User, Electron-Side)

`RateLimitService` enforces a daily optimization count cap per user:

```typescript
interface DailyUsage {
  user_id: string;
  date: string;           // "YYYY-MM-DD"
  optimization_count: number;
  limit: number;          // Per-tier cap
}
```

**Flow**:
1. Before each optimization: `RateLimitService.checkLimit(userId)` → returns `{ allowed: boolean, remaining: number, resetAt: Date }`
2. If `allowed: false`: request is rejected with a specific error surfaced in the UI
3. If `allowed: true`: optimization proceeds, then `RateLimitService.increment(userId)` is called after completion
4. The `daily_usage_summaries` Supabase table is updated via a database trigger on every INSERT into `usage_events`

**Daily Summary Trigger**: The Supabase `upsert_daily_session_on_close` trigger (added in migration `20260415_fix_session_trigger_crash_recovery.sql`) ensures that crash-recovered sessions — where `duration_seconds IS NULL` — do **not** increment the `total_sessions` counter in `daily_usage_summaries`. This prevents inflated session counts from crashed app instances.

---

## Chapter 36: Active Window Detector and Zoom Indicator

### Active Window Detector (`services/active-window-detector.ts`)

Wraps the Rust native module's `getActiveWindowTitle()` function in a polling mechanism. Polls the currently focused window title at configurable intervals (default: 1 second) when the overlay is open.

Used by `ProjectStatus` in the overlay to determine if the user's current application matches any configured Space project path — enabling automatic context surfacing without manual selection.

**Polling stops** when the overlay closes to avoid unnecessary OS calls while the app is in the background.

### Zoom Indicator (`components/layout/ZoomIndicator.tsx`)

A floating indicator rendered in `AppLayout.tsx` that appears temporarily when the user adjusts font size in Settings.

**Behavior**:
- Watches the `--font-size` CSS variable on the document root
- When the value changes, a pill-shaped badge slides in from the bottom-right corner showing the current zoom level (e.g., "100%", "115%", "85%")
- Auto-dismisses after 1.5 seconds via a CSS transition
- Uses `animate-slide-up` from the design system for entry animation

**Implementation**: Uses a `MutationObserver` on `document.documentElement` watching the `style` attribute. When `--font-size` changes, it parses the value, sets the visible label, and starts a dismiss timer. The observer is cleaned up on component unmount.

---

## Chapter 37: Request ID Middleware and Production API Hardening

### Request ID Middleware

`RequestIDMiddleware` is applied to the FastAPI app as a Starlette `BaseHTTPMiddleware`. On every request:
1. Reads the `X-Request-ID` header from the incoming request (if present)
2. Falls back to generating a new UUID if not present
3. Attaches the `X-Request-ID` header to the outgoing response

This enables distributed tracing — Electron's `axios` can log the request ID, Python logs can reference the same ID, and Sentry breadcrumbs can include it.

### Production API Hardening

When `APP_ENV=production`:
- `/docs` (Swagger UI) is disabled
- `/redoc` is disabled
- `/openapi.json` is disabled

This prevents API schema disclosure in production environments. In development, all three are enabled for rapid iteration.

### Prompt Content Scrubbing

The `_scrub_prompts` Sentry `before_send` hook redacts any key containing "prompt", "content", "message", or "text" from:
- `event.extra` dict
- Breadcrumb `data` dicts
- `request.data` dict
- Exception `value` strings
- Stack frame `vars` dicts

This is applied before any data leaves the machine, ensuring no user prompt content appears in error reports.

### Lazy Pipeline Loading

`_ensure_pipeline()` is a once-guarded lazy loader that imports `pipeline_v2` (and its transitive dependencies: LiteLLM, tiktoken, torch, etc.) on first use, not at server startup. This allows the uvicorn server to bind its port immediately on startup — critical for Render.com's health check polling during cold starts — while the expensive model loading happens in a background `asyncio.create_task`.

The warmup sequence:
1. `_background_warmup()` runs as a fire-and-forget task on `startup_event`
2. Loads the pipeline (imports all heavy deps)
3. Makes a warm-up LLM call to OpenRouter to establish the connection
4. Pre-loads the Whisper and Silero VAD models

After warmup, the first user request is served with zero cold-start latency.

---

## Chapter 38: Cross-Platform Support — Windows and macOS

> **This chapter documents the macOS port. Prmpt was Windows-only through chapter 37; from this point onward the codebase ships for both Windows and macOS Apple Silicon from a single source tree.**

### 38.1 The Two Compiled Worlds

The same TypeScript / React / Rust source tree produces two different runtime artifacts:

| Layer | Windows | macOS |
|---|---|---|
| Electron app | `electron-builder --win nsis` → `Prmpt-Setup-x.y.z.exe` | `electron-builder --mac dmg` → `Prmpt-x.y.z-arm64.dmg` |
| Native module | `platform-core.win32-x64-msvc.node` | `platform-core.darwin-arm64.node` |
| Tray icon | `build/tray-icon.png` (full color) | `build/tray-iconTemplate.png` + `@2x` (template — auto-tinted by macOS) |
| App icon | `build/icon.ico` | `build/icon.icns` (+ `build/dock-icon.png` for dev) |
| Login item | `app.setLoginItemSettings({ path: process.execPath, args: ['--hidden'] })` | `app.setLoginItemSettings({ openAsHidden: true })` |
| Auto-update | `electron-updater` NSIS feed | `electron-updater` DMG feed (hardened runtime, entitlements) |
| Code signing | (currently unsigned in dev) | `mac.hardenedRuntime: true` + `entitlements.mac.plist` for Gatekeeper |

Platform-aware runtime branches use `process.platform === 'darwin'` (or `'win32'`) — there is **no** `if (isMac)` boolean utility because TypeScript narrowing on `process.platform` is sharper.

### 38.2 The macOS Native Module Backend

Chapter 8 already enumerated the dispatch table. Below is the macOS-specific reasoning for the harder choices:

#### Why CGEventTap and not Carbon `RegisterEventHotKey`?

Carbon hotkeys can only register *specific* key combinations (e.g., `Cmd+Shift+K`). They cannot observe arbitrary keystrokes. Detecting `@prompt` requires watching every key event in the system to maintain a 64-character rolling buffer — Carbon doesn't support that. `CGEventTap` is the only public macOS API that gives system-wide keystroke observation. It requires Accessibility permission, which is the cost of admission.

#### Why `kCGSessionEventTap` and not `kCGAnnotatedSessionEventTap` or `kCGHIDEventTap`?

- `kCGHIDEventTap` requires root privileges (we are not a root daemon).
- `kCGAnnotatedSessionEventTap` is for transformations that need knowledge of what the system has *already done* with the event (e.g., dead-key composition); we just need raw key events.
- `kCGSessionEventTap` runs in the user's login session, requires only Accessibility permission, and gives us pre-application keystroke observation — exactly the macOS analog of `WH_KEYBOARD_LL`.

The tap is created with `kCGEventTapOptionListenOnly` so we never block the user's keystrokes — the event always reaches the target app, identical to the `CallNextHookEx`-always semantics on Windows.

#### Why clipboard-swap for text replacement and not `CGEventCreateKeyboardEvent` per character?

We tested per-character `CGEventPost` of Unicode characters via `CGEventKeyboardSetUnicodeString`. Three problems:

1. **Slow** — 30–60 ms per character on average; pasting 800 characters would take 30+ seconds.
2. **Reliability** — some apps (Slack, Discord Electron apps, Notion's web view) drop characters when the rate is too high but stutter visibly when it is too low.
3. **IME interference** — Korean/Japanese/Chinese IMEs intercept Unicode keystrokes for re-composition, garbling the output.

Cmd+V on a clipboard we just set works in every text-accepting app on macOS, because `Cmd+V` is the universal contract. The cost is that we briefly clobber the user's pasteboard. We mitigate this:

```rust
let saved = NSPasteboard::generalPasteboard.string_for_type(NSStringPboardType);
set_pasteboard(text);
post_cmd_v();
sleep(Duration::from_millis(30));   // let the target app process the paste
NSPasteboard::generalPasteboard.set_string(saved, NSStringPboardType);
```

The 30 ms window is the gap between our paste and the restore. If a clipboard manager (Maccy, Paste, Alfred) was running and watched for changes, it might briefly capture our injected text. We surface this as a known caveat in the macOS docs for the Spaces beta.

#### Why osascript instead of `[NSRunningApplication activateWithOptions:]`?

`NSRunningApplication.activateWithOptions(.activateIgnoringOtherApps)` requires an `NSRunningApplication` instance, which requires linking AppKit and adopting the Cocoa main run loop. The Rust crate is a `cdylib` loaded into Electron's Node.js process, which does *not* run a Cocoa main loop. Spawning `osascript -e 'tell application process "PID" to activate'` is one fork-exec but works without any Cocoa setup. The latency is ~80 ms, which is acceptable because focus return only happens on Insert (a discrete user action, not a hot path).

### 38.3 Accessibility Permission Flow

On first launch on macOS, `electron/main/utils/native-bridge.ts` calls `checkAccessibilityPermission()` which wraps `AXIsProcessTrustedWithOptions` (passing `kAXTrustedCheckOptionPrompt = false`, so the OS does **not** show its own permission dialog). If false:

1. `index-new.ts` shows a custom dialog explaining that Prmpt needs Accessibility permission to detect the `@prompt` trigger and to insert optimized text.
2. The dialog's primary action calls `shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')` which deep-links straight to the right pane.
3. The main process polls `checkAccessibilityPermission()` every 2 seconds (with Sentry breadcrumbs on each transition).
4. The moment it returns `true`, we call `startHook(callback)` — no app restart required.

We deliberately do **not** start the keyboard hook before permission is granted. `CGEventTapCreate` will succeed without Accessibility, but it returns an inert tap that never delivers events. Starting it would silently break `@prompt` detection with no error to surface. Gating on the explicit check produces clear logs and a clear UX.

### 38.4 macOS-Specific Window Behavior

#### App Window — `titleBarStyle: 'hiddenInset'`

```ts
new BrowserWindow({
  width: 1400, height: 900,
  ...(process.platform === 'darwin' ? {
    titleBarStyle: 'hiddenInset' as const,
    trafficLightPosition: { x: 12, y: 12 },
  } : {
    frame: false,
  }),
});
```

Native traffic-light buttons are kept (users expect them), but the title bar is "hidden inset" — there is no visible chrome between the buttons and the React content. We position the buttons at `(12, 12)` to align with the sidebar's vertical rhythm.

#### Dock visibility tied to App Window lifecycle

```ts
this.window.on('close', (e) => {
  e.preventDefault();
  this.window?.hide();
  if (process.platform === 'darwin') app.dock?.hide();
});

show() {
  if (process.platform === 'darwin') app.dock?.show();
  this.window?.show();
}
```

When the user clicks the red traffic light, the window hides, the Dock icon disappears, and Prmpt vanishes from `Cmd+Tab`. The keyboard hook keeps running and the tray icon remains. Re-opening from the tray restores the Dock icon. This is the explicit product intent — Prmpt is a tray-resident background app that *also* has a full UI when wanted.

#### Dock icon set in `app.whenReady()` via PNG (dev) / icns (packaged)

In packaged builds, `app.dock.setIcon(path.join(process.resourcesPath, 'icon.icns'))` works. In dev mode, Electron's `.icns` loader is unreliable (resolves to an empty `nativeImage` because the path lookup goes through `node_modules/electron/`). We sidestep with a 512×512 `build/dock-icon.png`:

```ts
app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    const { nativeImage } = await import('electron');
    const dockIconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'icon.icns')
      : path.join(app.getAppPath(), 'build', 'dock-icon.png');
    const dockIcon = nativeImage.createFromPath(dockIconPath);
    if (!dockIcon.isEmpty()) app.dock?.setIcon(dockIcon);
  }
});
```

#### Overlay `visibleOnAllWorkspaces` + `showInactive`

The overlay window must surface on *every* Mission Control space (including spaces running a full-screen app) and must surface *without* stealing keyboard focus from the user's source application:

```ts
this.window = new BrowserWindow({
  /* ... */
  visibleOnAllWorkspaces: true,
});
this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

show(x: number, y: number) {
  this.window!.setPosition(x, y);
  this.window!.showInactive();   // surface without focus
  this.window!.moveTop();         // raise above other windows
}
```

`showInactive()` is the macOS-correct call (`show()` would steal focus on macOS); on Windows we use `show()` because Windows treats focus stealing on `show()` more conservatively to begin with.

#### Tray template image

`build/tray-iconTemplate.png` (and `@2x` for Retina) is a black-on-transparent silhouette with no color. macOS auto-inverts and tints it based on menu bar appearance (white on dark menu bar, dark on light, blue when the menu is open). The `-Template` filename suffix is the signal Electron uses to apply this behavior. Windows uses `build/tray-icon.png` (full color) because the system tray on Windows does not have template-image semantics.

### 38.5 Cross-Platform Build Matrix

| `npm` script | What it does |
|---|---|
| `npm run native:build` | Build the Rust crate for `x86_64-pc-windows-msvc` |
| `npm run native:build:mac` | Build the Rust crate for `aarch64-apple-darwin` |
| `npm run python:install` | Bootstrap the optimization service venv on Windows (PowerShell) |
| `npm run python:install:mac` | Bootstrap the optimization service venv on macOS (bash) |
| `npm run code-intel:dev` | Run the Code Intelligence service on Windows |
| `npm run code-intel:dev:mac` | Run the Code Intelligence service on macOS |
| `npm run package:win` | `electron-builder --win nsis` — produces NSIS installer |
| `npm run package:mac` | `electron-builder --mac dmg` — produces hardened-runtime DMG |

> **There is currently no `code-intel:install:mac` script.** macOS users follow a small manual venv setup, documented in the README. This is a tracked follow-up.

---

## Chapter 39: Silent Auto-Launch at Login

### 39.1 Why It Exists

Prmpt's value depends on it being *running* — without the keyboard hook, `@prompt` does nothing. Asking users to remember to open Prmpt after every reboot eroded the "always one keystroke away" promise. The "Start at Login" feature removes that friction by registering Prmpt as a login item that boots silently into the tray.

### 39.2 The Tray Toggle (Cross-Platform)

The tray menu (`electron/main/windows/system-tray.ts`) renders a checkbox bound to `app.getLoginItemSettings().openAtLogin`:

```ts
const isLoginEnabled = app.getLoginItemSettings().openAtLogin;
const startAtLoginItem: MenuItemConstructorOptions = {
  label: 'Start at Login',
  type: 'checkbox',
  checked: isLoginEnabled,
  click: (item) => {
    const enable = item.checked;
    app.setLoginItemSettings({
      openAtLogin: enable,
      openAsHidden: true,                               // macOS — boots without bringing window to front
      ...(process.platform === 'win32' ? {
        path: process.execPath,
        args: ['--hidden'],                             // Windows — registered with our --hidden CLI arg
      } : {}),
    });
    Sentry.addBreadcrumb({
      category: 'auto-launch',
      message: `Start at login ${enable ? 'enabled' : 'disabled'}`,
      level: 'info',
    });
  },
};
```

The breadcrumb lets us correlate "user enabled auto-launch" with subsequent silent-boot startup events in Sentry.

### 39.3 The Detection Function

`electron/main/index-new.ts` defines:

```ts
function isSilentLaunch(): boolean {
  if (process.platform === 'darwin') {
    return app.getLoginItemSettings().wasOpenedAsHidden;
  }
  return process.argv.includes('--hidden');
}
```

- On macOS, `app.getLoginItemSettings().wasOpenedAsHidden` returns `true` if we were launched as a login item registered with `openAsHidden: true`. macOS sets this flag at the OS level; we just read it.
- On Windows, there is no equivalent OS flag. We set `args: ['--hidden']` in the login item registration, so when the OS runs us, our own executable receives `--hidden` in `process.argv`. We detect it, gate the window-show on it.

### 39.4 The Gate at Startup

```ts
async function initialize() {
  await loadEnv();
  await initializeSentry();
  await registerIpcHandlers();
  await initializeServices();           // ProjectManager, AnalyticsService, AppWindowManager, OverlayWindowManager, SystemTray
  await startKeyboardHook();
  await checkAndPromptAccessibility();  // macOS only

  if (!isSilentLaunch()) {
    appWindowManager.show();
    Sentry.addBreadcrumb({ category: 'startup', message: 'Normal launch — window shown', level: 'info' });
  } else {
    Sentry.addBreadcrumb({ category: 'startup', message: 'Silent launch — window hidden', level: 'info' });
  }
}
```

Crucially, **everything except the App Window is initialized regardless** of whether this is a silent launch. The tray, the keyboard hook, the overlay, the Code Intelligence client, the offline cache — all of them come up. Only the App Window's `show()` call is gated. This is what makes the boot-into-tray UX work: the user reboots, sees only the tray icon, then types `@prompt` somewhere and gets an immediate overlay because the hook is already running.

### 39.5 Tradeoffs

- **First-time silent launch can feel invisible.** The tray icon is the only signal that Prmpt is running. We accept this — the alternative (briefly flashing the App Window on every boot) is a worse UX. We surface a Sentry breadcrumb on silent launch so support cases can correlate "user types `@prompt` for first time after boot" with "app started silently".
- **The `--hidden` CLI arg is best-effort on Windows.** If a user manually runs `Prmpt.exe` without the arg from a shortcut, it shows the window — which is the correct behavior. The arg is set only by the login-item registration we install.
- **Disabling the toggle does not uninstall the login item registration.** It rewrites it with `openAtLogin: false`. macOS's login items list will still show Prmpt with a disabled checkbox. Removing it entirely requires the user to delete it from System Settings → General → Login Items.

---

## Chapter 40: Sentry Observability — Four-Surface Coverage

### 40.1 The Four Runtime Surfaces

Prmpt's runtime is genuinely four processes (five, if you count the ARQ worker as separate from the FastAPI server). Each surface initializes Sentry with its own DSN and integration set.

| Surface | SDK | Init site | DSN env var | Notes |
|---|---|---|---|---|
| Electron main | `@sentry/electron/main` | `electron/main/index-new.ts` | `SENTRY_DSN` | Captures process errors, IPC errors, child-process errors. Tags: `analytics_session`, `active_project`, `code_intel.healthy`, `parser.initialized`. Spans: `code-intel.ingest`, `code-intel.retrieve`, `code-intel.health`, `parser.parseFile`, `git.getCurrentBranch`. Breadcrumbs: `code-intel`, `file-watcher`, `active-window`, `git`, `auto-launch`, `startup`. |
| React App Window | `@sentry/react` | `app-ui/src/main.tsx` | `VITE_SENTRY_DSN` | `browserTracingIntegration` + `replayIntegration`; whole tree wrapped in `Sentry.ErrorBoundary`. |
| React Overlay | `@sentry/react` | `app-ui/src/overlay/main.tsx` | `VITE_SENTRY_DSN` | Separate Sentry client (each renderer is its own browser context). Tagged `window: overlay` to disambiguate from app-window events. |
| Python optimization | `sentry-sdk[fastapi]` | `python-service/app/main.py` | `SENTRY_PYTHON_DSN` | `LoggingIntegration` (WARN+ → breadcrumbs, ERROR+ → events). Trace continuation from `sentry-trace` headers on inbound WebSocket and HTTP. |
| Python Code Intelligence | `sentry-sdk[fastapi]` | `code-intelligence-service/app/main.py` | `SENTRY_DSN` (service-local `.env`) | `LoggingIntegration` + **`FastApiIntegration`** — every route is auto-spanned. `traces_sample_rate=1.0` in dev, `0.2` in prod. |
| ARQ worker | `sentry-sdk` | `code-intelligence-service/app/workers/arq_worker.py` | `SENTRY_DSN` | Initializes its own SDK because it runs in a separate process. |

The DSN allocation is intentional: each surface goes to its own Sentry project so we can tune sample rates, alert routing, and PII scrubbing independently. Releases are tagged with `APP_VERSION` from `package.json` (Electron) or env (`APP_VERSION` for Python services), keeping per-release error rates correlatable across surfaces.

### 40.2 PII Scrubbing — The `beforeSend` Hook

User prompt bodies are explicitly *not* shipped to Sentry. Each Sentry init declares a `beforeSend` hook (Python: `before_send`) that recursively walks the event payload and replaces any field whose key contains `prompt`, `content`, `message`, or `text` with `[REDACTED]`. The same logic runs over breadcrumb `data`, exception `value` strings, and stack frame local-variable maps.

```ts
function scrubEvent(event: any): any {
  const SENSITIVE_KEYS = /(prompt|content|message|text)/i;
  const walk = (obj: any) => {
    if (typeof obj !== 'object' || obj === null) return obj;
    for (const key of Object.keys(obj)) {
      if (SENSITIVE_KEYS.test(key) && typeof obj[key] === 'string') obj[key] = '[REDACTED]';
      else walk(obj[key]);
    }
    return obj;
  };
  walk(event.extra ?? {});
  walk(event.contexts ?? {});
  if (event.breadcrumbs) for (const bc of event.breadcrumbs) walk(bc.data ?? {});
  if (event.exception?.values) for (const v of event.exception.values) {
    if (typeof v.value === 'string' && SENSITIVE_KEYS.test(v.value)) v.value = '[REDACTED]';
  }
  return event;
}
```

The scrubber runs **before** the SDK's network transport, so redacted fields never leave the device.

### 40.3 Distributed Trace Chain — Current State

- **Electron main → Python optimization service**: ✅ trace headers (`sentry-trace`, `baggage`) propagated by axios/WebSocket interceptors.
- **Electron main → Code Intelligence service**: ⚠️ partial. Spans are created on the Electron side (`codeIntel.ingestSkeleton`, `codeIntel.retrieve`); the service's `FastApiIntegration` creates its own root span. Header propagation is in place but the service-side trace continuation is verified in fewer paths than the optimization service. Tracked follow-up.
- **Renderer ↔ main IPC**: ❌ not yet part of the trace chain. Adding it would require a custom span propagator across the contextBridge — feasible but not implemented. This is a known gap (see questions Q26 and Q50 in `system-deconstruction.md`).
- **HTTP correlation IDs**: Both Python services emit/echo `X-Request-ID` via `RequestIDMiddleware`. The Electron `CodeIntelClient` does not yet attach an outbound request ID — it relies on the service auto-generating one and surfacing it in error responses for support correlation.

### 40.4 What Each Surface Captures

- **Electron main** — anything thrown in an IPC handler reaches Sentry (the IPC dispatcher wraps every handler in `try/catch` + `Sentry.captureException`); Code Intelligence client failures (HTTP errors, deserialization errors); native module load failures (with breadcrumbs about which `.node` the loader tried); file watcher errors; git introspection errors; auto-launch state changes; silent-launch detection; Accessibility permission flips.
- **App Window React** — uncaught component errors via `Sentry.ErrorBoundary`; Replay sessions on errors (`replaysOnErrorSampleRate: 1.0`); promise rejections in IPC calls (each `electronAPI.*` call is `try/catch`-wrapped at call sites that matter).
- **Overlay React** — same coverage as App Window, but tagged `window: overlay`. Overlay errors are particularly important because the overlay is the most-exercised UI surface.
- **Python optimization** — every uncaught exception in a route or background task; LiteLLM provider failures (timeouts, 429 throttles, malformed responses); WebSocket connection failures; pipeline lazy-load failures.
- **Python Code Intelligence** — every uncaught exception in a route (auto via `FastApiIntegration`); embedding failures (with the model name in tags); summarization failures; ARQ task crashes; webhook signature verification failures.

### 40.5 Sample Rates

- Errors: 100% (we want every exception)
- Tracing (Electron main, Python optimization): 100% in dev, 10–20% in prod
- Tracing (Code Intelligence): 100% in dev, 20% in prod (it's a chatty service — every UI keystroke can fan out to retrieve calls)
- Replay (App Window, Overlay): 10% session sample, 100% on-error sample (`replaysSessionSampleRate: 0.1, replaysOnErrorSampleRate: 1.0`)

---

## Chapter 41: Prmpt Branding and Cross-Platform Packaging

### 41.1 Brand Identity

The app's product name is **Prmpt** (no vowel between *r* and *m* — pronounced "prompt"). The mark is a stylized lowercase wordmark: a thick "P" with the descender kerned tight against an "rmpt" set in a geometric sans-serif. Source files live in `logos/`:

- `logos/dark-logo-svg.svg` — primary mark, dark-on-light
- `logos/light-logo-svg.svg` — inverse, light-on-dark
- `logos/icon-glyph.svg` — square glyph used for app icons (the "P" alone)

All raster assets in `build/` are generated from these SVGs via a `sharp` script (Node) and `iconutil`/`sips` (macOS) — see `scripts/generate-icons.ts`.

### 41.2 The `build/` Directory — Packaged Assets

| File | Used by | Notes |
|---|---|---|
| `build/icon.icns` | macOS app bundle, Dock (packaged) | Generated from `logos/icon-glyph.svg`: rasterize once at 1024×1024 (`density: 300` to avoid `sharp`'s pixel-limit error on SVGs), then resize down to 512, 256, 128, 64, 32, 16; bundle into `.iconset/`; `iconutil --convert icns` to produce `icon.icns`. The `iconutil` step must run unsandboxed. |
| `build/icon.ico` | Windows NSIS installer + executable | Generated by `sharp` from a 256×256 PNG export of the same glyph. |
| `build/dock-icon.png` | macOS Dock in dev mode | 512×512 PNG; used because `app.dock.setIcon('.icns path')` is unreliable under `electron .` (resolves the path inside `node_modules/electron/`). |
| `build/tray-iconTemplate.png` (+ `@2x`) | macOS menu bar tray | Black-on-transparent silhouette of the glyph at 18×18 (× 36×36 for @2x). The `-Template` filename activates Electron's auto-tinting for light/dark/active menu bar states. |
| `build/tray-icon.png` | Windows system tray | Full-color 32×32 of the glyph. Windows tray has no template-image semantics. |
| `build/entitlements.mac.plist` | `electron-builder` `mac.entitlements` | Declares `com.apple.security.device.audio-input` (for voice transcription), `com.apple.security.cs.allow-jit` (for V8), `com.apple.security.cs.allow-unsigned-executable-memory` (for native modules). |

### 41.3 `electron-builder` Configuration

In `package.json`:

```json
"build": {
  "productName": "Prmpt",
  "appId": "com.prmpt.app",
  "files": ["electron/dist/**/*", "app-ui/dist/**/*", "preload.js"],
  "extraResources": [
    { "from": "build/", "to": "." },
    { "from": "native/platform-core/", "to": "native/platform-core/", "filter": ["*.node", "index.js"] },
    { "from": "python-service/dist/", "to": "python-service/" },
    { "from": "code-intelligence-service/dist/", "to": "code-intelligence-service/" }
  ],
  "win": {
    "target": "nsis",
    "icon": "build/icon.ico"
  },
  "mac": {
    "target": "dmg",
    "icon": "build/icon.icns",
    "category": "public.app-category.productivity",
    "hardenedRuntime": true,
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.plist"
  }
}
```

### 41.4 Why `productName: "Prmpt"` Matters

`productName` is what the OS sees in:

- The macOS `.app` bundle name (`Prmpt.app`)
- The macOS Dock tooltip
- The macOS `Cmd+Tab` switcher
- The Windows installer title bar
- The Windows Start Menu entry
- The Windows uninstaller registry name

Setting it via `electron-builder` (and the `name` field in `app-ui/package.json` for the rendered HTML title) replaces the Electron defaults end-to-end. The user never sees the word "Electron" anywhere.

### 41.5 macOS Hardened Runtime and Entitlements

`hardenedRuntime: true` is required for distributable macOS apps that need to bypass Gatekeeper without ad-hoc signing warnings. It enables a stricter runtime: by default, no JIT, no unsigned executable memory, no DYLD environment variable injection. Electron's V8 needs JIT, and the napi-rs `.node` binary is unsigned executable memory — both must be re-allowed via entitlements:

```xml
<key>com.apple.security.cs.allow-jit</key><true/>
<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
<key>com.apple.security.device.audio-input</key><true/>
```

Without these, the app would crash on first launch with `EXC_BAD_ACCESS` inside V8 or refuse to load `platform-core.darwin-arm64.node`.

---

## Updated Table of Contents (Chapters 32–41)

| Chapter | Topic |
|---|---|
| 32 | Task Planner — Structured Builds for Complex Prompts |
| 33 | OTP-Based Email Authentication |
| 34 | GDPR Account Deletion — 30-Day Graceful Wipe |
| 35 | Rate Limiting and Daily Usage Caps |
| 36 | Active Window Detector and Zoom Indicator |
| 37 | Request ID Middleware and Production API Hardening |
| 38 | Cross-Platform Support — Windows and macOS |
| 39 | Silent Auto-Launch at Login |
| 40 | Sentry Observability — Four-Surface Coverage |
| 41 | Prmpt Branding and Cross-Platform Packaging |

---

*Documentation extended: April 2026. Chapters 32–37 document the Task Planner pipeline pre-pass, OTP email authentication system, GDPR deletion lifecycle, dual-layer rate limiting, active window detection, zoom indicator, and production API hardening. Chapters 38–41 document the macOS port (cross-platform Rust crate, accessibility flow, dock visibility, template tray icon, hardened runtime), the silent auto-launch system, the four-surface Sentry coverage map (with PII scrubbing and trace propagation status), and the Prmpt branding + cross-platform packaging pipeline — completing the full picture of all systems in the Prmpt codebase as of the cross-platform release.*
