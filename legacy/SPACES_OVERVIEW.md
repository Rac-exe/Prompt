# Spaces Overview

## What Spaces Is

Spaces is Prmpt's code-intelligence layer. It attaches local repositories to a workspace so optimization can use real code context instead of only user text.

## Core Responsibilities

- Manage project-scoped workspaces.
- Parse local source code into searchable structural chunks.
- Keep indexes fresh as files change.
- Retrieve high-relevance code context for find/ask/bug/optimize flows.
- Feed ranked context into the Prompt layer.

## Indexing Pipeline (High Level)

1. Project folder is added to a Space.
2. File watcher detects supported files and changes.
3. Tree-sitter parses files into chunks (file/class/function/method + metadata).
4. Hash checks skip unchanged files.
5. Summaries/embeddings/relationships are generated through service paths.
6. Local SQLite project index is updated.
7. Retrieval pipeline serves context to UI modes.

## Local Storage Model (Phase 1 Direction)

- Per-project SQLite index (`code-intel/projects/<project_id>/index.db`)
- Stores:
  - Chunk metadata (paths, symbol names, line ranges, signatures)
  - Summaries
  - Embeddings
  - Relationships and graph fields
  - FTS index
  - Retrieval logs/feedback
  - File hash cache
- Does **not** store full source body as canonical DB payload.
- Hydration reads current code slices from filesystem using line ranges.

## Retrieval Modes

- **Find:** exact code lookup with files/symbols/line ranges.
- **Ask:** codebase Q&A with probable source locations.
- **Bug:** bug-location-oriented retrieval and related context.
- **Optimize:** context packaging for implementation prompt generation.

## How Spaces Connects to Prompt and Overlay

- **To Prompt:** Spaces retrieval output is injected as code context into optimization.
- **To Overlay:** overlay can show active project/indexing state and run context-aware requests.
- **To app UI:** Spaces management, mode switching, and result rendering happen in the project workspace views.

## Remote vs Local Split

- **Supabase remains for:** auth, product data, chats/history, settings, library, analytics, lightweight registry.
- **Local remains for:** heavy code-intel index and retrieval runtime data.
- **Provider keys remain server-side:** model/provider calls route through controlled service boundaries.

## Why It Matters

Spaces turns Prmpt from a generic optimizer into a code-aware system. It gives the optimizer grounded project context, improves retrieval precision, and enables practical debugging/implementation workflows across real repositories.
