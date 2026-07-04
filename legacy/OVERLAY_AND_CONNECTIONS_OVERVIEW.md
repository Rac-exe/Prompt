# Overlay and Connections Overview

## What Overlay Is

Overlay is the operating-system-facing interaction layer of Prmpt. It lets users trigger prompt optimization from any app without switching windows.

## Core Overlay Responsibilities

- Detect global `@prompt` trigger via native keyboard hooks.
- Open a lightweight, always-on-top floating UI near cursor.
- Collect user input, show clarification UI, and stream responses.
- Insert optimized text back into the source application.
- Reflect app/runtime state (auth, service availability, active project/indexing status).

## OS-Level Trigger and Insertion

- Windows hook path: `WH_KEYBOARD_LL`
- macOS hook path: `CGEventTap`
- Windows insertion: `SendInput`
- macOS insertion: `CGEventPost` + clipboard restore flow

## End-to-End Connection Flow

1. User types `@prompt` in any app.
2. Native hook detects trigger and notifies Electron main process.
3. Electron main opens overlay and removes trigger token from source app.
4. Overlay sends request to Python optimization service.
5. Service returns streamed optimized content (and clarification steps if needed).
6. User clicks Insert.
7. Electron writes final text back into original application context.

## How Overlay Connects to Other Systems

- **Prompt layer:** overlay is the fastest entry point into prompt optimization.
- **Spaces layer:** overlay can consume active code context status and pass context-aware queries.
- **App window:** both share auth/session and project status via IPC broadcasts.
- **Health monitoring:** overlay reflects runtime transitions (ready, indexing, offline, service unavailable).

## Failure Handling Behavior

- Missing permissions (especially macOS accessibility): guide user to enable required access.
- Python service unavailable: show non-ready state and prevent broken requests.
- Network loss: fallback UX path should avoid pretending generation succeeded.

## Why It Matters

Overlay is what makes Prmpt feel native. It removes context switching, shortens the path from thought to optimized prompt, and makes optimization usable inside normal developer workflow instead of as a separate app ritual.
