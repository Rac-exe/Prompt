# PRMPT Deep Dive — Complete Technical Reference

> This document covers PRMPT end-to-end: the problem space, the architecture, every component, all three user journeys, competitive context, benchmark results, current limitations, roadmap, and the full decision log. External knowledge (protocols, algorithms, competitor internals, industry pricing) is woven in throughout — not assumed. This is the document you read before a demo, before pitching, or before contributing to the codebase.

---

## PART 0 — Background: The World PRMPT Was Built Into

This part contains no PRMPT-specific content. It explains the industry context that makes PRMPT necessary.

### What LLM Coding Agents Are

In 2024–2026, a new category of developer tool emerged: the **agentic coding CLI**. Unlike previous AI coding assistants (which autocompleted lines or answered questions), agentic tools take a high-level instruction and execute it autonomously — reading files, running tests, writing code, making multiple decisions — until the task is done or they give up.

The major players as of June 2026:

**Claude Code** (Anthropic) — An open-source CLI agent running against the full Anthropic API. Claude Code reads your project, identifies relevant files autonomously, writes patches, runs tests, and iterates. It uses Claude Sonnet 4.5 by default. It supports the **MCP** (Model Context Protocol) — a standard for external tool plugins. It is widely regarded as the best-performing CLI agent at code navigation and complex multi-file reasoning. Pricing: $3/million input tokens, $15/million output tokens, $0.30/million cache-read tokens (June 2026, Anthropic API direct).

**Codex CLI** (OpenAI) — OpenAI's CLI agent, running GPT-5 Codex. Similar to Claude Code but with different context management strategies. Codex tends to use more input tokens per session because its caching strategy is less aggressive. Supports MCP via `.codex/config.toml`. Pricing varies by model tier; GPT-5 Codex sits in a similar range to Claude Sonnet.

**Cursor** — Not a CLI but an IDE (VS Code fork) with deeply integrated AI. Cursor has its own closed-source context pipeline (codebase indexing, semantic search, tab autocomplete, Composer for multi-file edits). Cursor's context retrieval is excellent but non-exportable — it's tied to the IDE. Power developers who prefer Neovim, Emacs, or vanilla VS Code can't use Cursor's retrieval layer with their preferred tool.

**OpenCode** — An open-source CLI agent. Its CEO/founder is a prominent figure in the AI tooling space, which has driven rapid adoption. Fully open-source, which means it can be forked and modified. This is relevant to PRMPT's roadmap (see Part 9).

**Aider** — A well-established open-source CLI agent with its own "repo map" (a lightweight code index). Works well for small-to-medium codebases. No MCP support. Doesn't have a prompt optimization layer.

### What a Context Window Is and Why It's the Cost Unit

Every LLM (Large Language Model — the AI under the hood of all these tools) has a **context window**: the maximum amount of text it can process in a single turn. Claude Sonnet's context window is 200,000 tokens (roughly 150,000 words). GPT-5's is similar.

This context window is not free. Every token sent to the model costs money. The context window is filled with:

1. The system prompt (instructions the developer gives to the agent)
2. The conversation history (all previous messages in the session)
3. File contents read during the session
4. Tool call results (outputs from bash commands, grep results, etc.)

The **context window is the cost unit** because every token in it is billed on every turn.

### The Context Replay Problem

This is the dominant cost driver that most people don't fully understand.

LLMs are **stateless between turns**. They don't "remember" previous turns the way a human colleague does. Every time you send a new message to Claude Code, Claude Code resends the entire conversation history to the model — including all the files it read earlier, all the tool outputs, all the previous analysis.

The compounding math:

- Turn 1: 2,000 tokens (system prompt + initial user message)
- Turn 5: 2,000 new tokens + 8,000 tokens of history = 10,000 tokens for one message
- Turn 10: 2,000 new tokens + 20,000 tokens of history = 22,000 tokens for one message
- Turn 15: 2,000 new tokens + 35,000 tokens of history = 37,000 tokens for one message

A 15-turn session might bill 200,000+ input tokens total — most of which is not new information, just replayed history. Anthropic's prompt cache helps (cached tokens cost $0.30/million vs $3/million — 90% cheaper) but it doesn't eliminate this cost, and not all providers cache with the same efficiency.

The insight PRMPT was built on: **if you can reduce a 15-turn session to a 6-turn session, you eliminate 9 turns of compounding context replay**. That's where the real savings are — not in reducing what the AI reads per turn, but in reducing the number of turns the session needs.

### Why Agents Explore Broadly Without Guidance

An agent working on a 100,000-line codebase with no guidance has to find the relevant 3 files by itself. It typically does this by:

1. Reading the project's directory structure
2. Looking at file names and guessing which are relevant
3. Using `grep` or `glob` to search for related terms
4. Reading files it finds and following references

Each of these steps costs tokens. Worse, each step adds more content to the context window, which makes subsequent turns more expensive. A well-guided agent that starts from the right 3 files and finishes in 6 turns might cost $0.18. An unguided agent that explores for 4 turns before finding the right files and then takes 11 more turns might cost $0.55 for the same outcome.

### What "Vibe Coding" Is

The term "vibe coding" (coined by Andrej Karpathy) refers to the development practice of giving AI agents high-level, intentional instructions rather than detailed specifications — trusting the model to fill in the gaps. "Fix the import reconciliation bug" instead of "in `src/features/imports/reconcileWorkspaceImport.js`, line 47, the `workspaceId` lookup is missing a null check when `activeWorkspaces` has an empty result set."

Vague prompts are the norm because:

1. Developers don't always know exactly where a bug is (that's why they're asking the AI)
2. Writing a perfectly precise prompt can take longer than just writing the fix yourself
3. The experience of modern AI tools has trained users to expect the model to figure it out

The problem: vague prompts force the agent into exploration mode. Exploration is expensive. The insight: PRMPT can do the precise prompt construction automatically using the codebase map — it's the middle step that developers were previously skipping.

### The MCP Protocol — How It Works

**MCP (Model Context Protocol)** was designed by Anthropic and released as an open standard in late 2024. It's a protocol that lets external tools (called "MCP servers") plug into AI agents (called "MCP clients"). Claude Code, Codex, OpenCode, and others are MCP clients.

**How MCP works technically:**

An MCP server is a program that speaks JSON-RPC 2.0 over standard input/output (stdio) — the simplest possible communication channel. The agent launches the MCP server as a subprocess and talks to it through text lines.

The communication sequence:

1. Agent sends `{"method": "initialize", "params": {"protocolVersion": "2024-11-05", ...}}` — a handshake to establish the protocol version
2. Server responds with its capabilities
3. Agent sends `{"method": "notifications/initialized"}` — confirms the handshake
4. Agent sends `{"method": "tools/list"}` — asks "what tools do you have?"
5. Server responds with a list of tools: name, description, input schema
6. Agent decides which tools are relevant to its task based on the descriptions
7. Agent calls a tool: `{"method": "tools/call", "params": {"name": "prmpt_optimize_task", "arguments": {...}}}`
8. Server processes the call and returns a result
9. Agent uses the result in its next reasoning step

**Why tool descriptions matter enormously:** The agent reads tool descriptions to decide whether and when to call a tool. A description that says "returns some file suggestions" is less compelling than "FINAL AUTHORITATIVE ROUTE. Run tests, read the JSON primary files, patch those files, rerun tests." Claude in particular tends to follow compelling descriptions — this is why PRMPT's tool descriptions are written the way they are.

**Stdio vs HTTP transport:** MCP supports two transports. Stdio (used by PRMPT's benchmark server) runs the server as a subprocess. HTTP transport runs the server as a web service. Stdio is simpler to test and more portable; HTTP is better for shared services. PRMPT's production MCP will likely use HTTP so multiple agents can share one running server.

### OpenRouter — What It Is and Why It Matters

**OpenRouter** is an API aggregator — it provides a single API endpoint that routes requests to dozens of AI model providers (Anthropic, OpenAI, Google, Mistral, and others). For a small team:

- One API key works for all models
- Switch from Claude Sonnet to GPT-5 by changing one parameter
- OpenRouter's usage tracking API provides a cumulative spend counter per key

PRMPT uses OpenRouter for all its own LLM calls (prompt optimization, code analysis). This matters for the benchmark: PRMPT snapshots the key's cumulative spend before a session, snapshots it after, and takes the delta as the exact cost of PRMPT's work. No estimation, no hardcoded token counts — real billed dollars.

OpenRouter's tiered pricing means the more you spend, the lower your per-token rate. For teams spending $1,000+/month through a single key, per-token costs drop meaningfully. This is a secondary benefit of routing all AI spend through PRMPT: volume discounts.

---

## PART 1 — What Is PRMPT?

### The Single-Sentence Pitch

PRMPT intercepts your raw vague prompt, makes it precise and code-aware, then feeds it to whatever AI agent you use — so the agent spends fewer tokens exploring and more tokens fixing.

### The Three Architectural Bets

**Bet 1: Prompt quality determines exploration cost.** A precise prompt reduces the search space for the agent. If the prompt already names the relevant files, the agent doesn't need to find them — eliminating the most expensive early turns of any session.

**Bet 2: Code context at optimize-time is better than code context at agent-time.** The agent reads files during its session. PRMPT reads the entire codebase structure before the session starts. PRMPT's offline analysis (graph, PageRank, embeddings) is more thorough than what an agent can do in a few real-time `grep` calls. Using PRMPT's pre-analysis to guide the agent means the agent benefits from the full codebase understanding without paying the token cost of doing that analysis itself.

**Bet 3: Routing before the agent starts is the highest-leverage intervention.** Turn 1 sets the trajectory. An agent told "look at `auth/jwt.ts`" on turn 1 will likely fix the bug in turns 1–6. An agent told "there's a login bug" on turn 1 will spend turns 1–5 searching before it finds `auth/jwt.ts`. The earlier the routing happens, the bigger the compounding effect on total session cost.

### Where PRMPT Sits in the Stack

```
User
  ↓ (types vague prompt)
PRMPT overlay (intercepts prompt)
  ↓ (queries code intelligence for file routing)
PRMPT optimizer (rewrites prompt with file context)
  ↓ (sends precise prompt)
AI Agent (Claude Code / Codex / OpenCode)
  ↓ (uses PRMPT MCP server for real-time guidance during session)
Your codebase
```

PRMPT is a layer between the human and the agent. It is not an agent itself. It doesn't execute code, run tests, or write patches. It makes other agents more efficient.

### What PRMPT Is NOT

- **Not an IDE**: PRMPT works with your existing editor and workflow. No installation in VS Code required.
- **Not a coding agent**: It doesn't write code or fix bugs itself. It improves the prompts and routing for the agents that do.
- **Not a code reviewer**: It doesn't audit code quality, security, or style.
- **Not a replacement for Claude/Codex**: It makes them more efficient. You still need the agent.
- **Not a cloud code analysis tool**: Your source code never leaves your machine. The codebase index is stored locally in SQLite on your disk.

---

## PART 2 — Product Timeline

This is the story of PRMPT from the first commit (January 12, 2026) to the first real benchmark run (June 12, 2026). Approximately 500 commits over 6 months.

### Era 1: Zero to One (Jan 12 – Jan 26, 2026)

The first commit on January 12 established the basic structure: an Electron app with a Python service for prompt optimization. The goal was simple — can we take a vague prompt and make it better using an LLM?

The first meaningful milestone: "Optimization works, Basic App Built." This was a working pipeline: type a prompt in the Electron UI, send it to the Python service, get back an optimized version. No overlay, no codebase integration, no MCP. Just the core LLM chain.

**Why this was the right start:** Proving the pipeline before building the delivery mechanism. Many startups build the interface first and the backend second. PRMPT's team validated that the optimization was actually useful before investing in the OS-level hooks and overlay machinery.

### Era 2: Streaming and IPC Refinement (Feb 5–9, 2026)

**Problem identified:** The optimization pipeline had perceptible latency (2–3 seconds before the first token appeared). Even though total optimization time was 4–6 seconds, feeling like nothing was happening for 3 seconds made it feel slow and unresponsive.

**Solution:** Streaming. Instead of waiting for the full optimized prompt and delivering it at once, the pipeline streams tokens back as they're generated — the same way ChatGPT shows text appearing word by word. The first token appears in under 500ms even if the full response takes 5 seconds.

**Technical consequence:** IPC (Inter-Process Communication — how the Electron main process talks to the renderer UI) had to be refactored to support streamed chunked events rather than a single result event. Phase 4 IPC refactor refers to the fourth major restructuring of this communication layer.

**Why this mattered for the product:** In user testing, the streaming version felt "instant" even though total time was the same. Perceived latency is a product variable, not just a technical one.

### Era 3: Pipeline v2 (Mar 6, 2026)

**Problem with v1:** The original pipeline was a single monolithic function: take prompt → send to Claude → get back result. This worked but was fragile. If the user was asking a clarifying question vs a refinement vs a completely new request, the pipeline treated them all the same. Context was handled poorly. Adding new pipeline stages meant touching the single large function.

**Pipeline v2 design:** Seven distinct stages, each with a clear input/output contract:

1. **Decision Taker (DT)** — Classifies the intent: NEW (first optimization), REFINEMENT (improving a previous output), or ADDITION (adding more context to an existing prompt)
2. **Skill Selector (SF)** — Picks the right domain skill file: technical, creative, business, communication, educational, visual, automation, or research
3. **Context Summarizer (CC)** — Compresses conversation history before the optimization call (prevents context bloat from previous turns)
4. **Prompt Optimizer (PO)** — The main LLM call: rewrites the prompt using the skill file and any code context
5. **Clarifier** — When the prompt is too vague even to optimize, generates targeted questions for the user
6. **Task Planner** — For complex multi-step tasks, produces an ordered implementation plan instead of a monolithic blob
7. **Memory Extraction** — Stores stable preferences (user's role, preferred tone, tech stack) for reuse in future optimizations

**Why the separation matters:** Each stage can be developed, tested, and improved independently. Adding a new skill domain doesn't require touching the optimizer code. Improving context summarization doesn't risk breaking clarification. The pipeline is now a directed graph of stages, not a single function.

### Era 4: Security and Auth (Mar 28, 2026)

**Why this was needed:** PRMPT was approaching its first real users. The Python services (:8001, :8002) were accessible over localhost HTTP — no authentication. For development this is fine; for a real installation on a user's machine, any other process on that machine (or any website with localhost access) could call the optimization API without permission.

**Solution:** JWT (JSON Web Token) authentication on all Python service endpoints. The Electron app issues signed tokens; the Python services verify them before processing requests. The tokens expire and are refreshed automatically.

**External context — what JWT is:** JSON Web Token is a standard for stateless authentication. A JWT is a base64-encoded JSON object with three parts: a header (algorithm), a payload (claims — who you are, when the token expires), and a signature (cryptographic proof that the token wasn't tampered with). The server can verify the token without storing any session state. PRMPT uses JWTs for service-to-service auth between Electron and Python.

**Also added:** Dev auth fallback in both Python services — environment variables that allow CLI/benchmark access without a full Electron session, which later became critical for the benchmark harness to call the services without launching the full app.

### Era 5: macOS Port (Apr 10–17, 2026)

Twenty-plus commits over eight days. This was the single most intensive engineering period in PRMPT's history.

**Why it happened:** The team had been building Windows-only since January. But developer surveys consistently show ~50% of professional developers use macOS as their primary machine. Windows-only means half the addressable market is excluded before the first pitch. The port was a strategic requirement, not a nice-to-have.

**Why macOS was hard:**

*Keyboard hooks:* Windows uses `WH_KEYBOARD_LL` (`SetWindowsHookEx`) — a well-documented, stable, system-wide keyboard hook. macOS uses `CGEventTap` — conceptually similar but requiring **Accessibility permission** from macOS System Preferences. The user must grant this permission on first launch, and macOS can silently revoke it when the system updates. The PRMPT code had to handle permission checks, permission requests, and graceful degradation when permission is revoked.

*System Integrity Protection (SIP):* Apple's SIP prevents even privileged processes from modifying certain system behaviors. Some keyboard hook approaches are blocked by SIP. CGEventTap requires the binary to be code-signed or running with the right entitlements.

*Text injection:* Windows uses `UIA SetValue` (UI Automation — Microsoft's accessibility API for programmatic text injection) or `SendInput`. macOS has no equivalent direct API. The solution: `CGEventPost` to simulate keyboard events. PRMPT's macOS text injection works by: (1) saving the clipboard, (2) placing the optimized text on the clipboard, (3) simulating `Cmd+V` via `CGEventPost`, (4) restoring the original clipboard. The `NSPasteboard` API replaced `pbcopy`/`pbpaste` shell commands due to a clipboard race condition discovered during testing.

*Overlay window:* Electron's `always-on-top` and `transparent` window behaviors differ between Windows and macOS. Windows uses DWM (Desktop Window Manager) compositing; macOS uses a different model. The `panel` window type was added for macOS (a special Electron window type that floats over all spaces including full-screen apps and the menu bar).

*Accessibility permission UX:* macOS requires a guided flow for users to grant Accessibility permission. PRMPT added a startup check for this permission and a UI prompt guiding users to System Settings → Privacy & Security → Accessibility.

**What shipped:** Full parity with Windows — CGEventTap hook, NSPasteboard text injection, macOS panel overlay, app icons, dock integration, auto-launch at login, system tray in the macOS menu bar.

### Era 6: v1.0 Release (Apr 13, 2026)

**Version bump to 1.0.0** — the first production-grade release. Key additions at v1.0:

- **Supabase** integration for user authentication, chat history persistence, and prompt library storage. Supabase (open-source Firebase alternative, Postgres + Auth + Storage) handles everything that needs to be cross-device and persistent. Code intelligence data stayed local.
- **Download tracking** via a Supabase Edge Function — records unique downloads to track initial adoption.
- **Sentry** error tracking — captures exceptions in both Electron (main + renderer) and Python services. Without production error tracking, bugs reported by early users are invisible.
- **Auto-updater** switched to Supabase Storage — distributes new versions through the same infrastructure as the rest of the product.

**The strategic significance of v1.0:** Moving from "build in public" to "ship to users" requires infrastructure that doesn't exist in a prototype. Auth, error tracking, and updates are all table stakes. Shipping them as part of v1.0 rather than adding them post-launch was a deliberate choice to avoid the scramble of adding production infrastructure to a live product.

### Era 7: Spaces Birth (Apr 19–20, 2026)

**The realization:** PRMPT was optimizing prompts without any knowledge of what the user was building. For generic writing prompts, that's fine. For coding prompts, "fix the authentication bug" optimized in isolation becomes something plausible-sounding but not actually grounded in the user's codebase. The optimizer might suggest looking at `auth.ts` even though the user's project uses `authentication_manager.py`.

**The pivot:** Add a code context layer. Spaces are named workspaces tied to local repositories. A Space indexes the repository and makes that context available to the optimizer.

**What shipped in the initial Spaces integration:**

- Spaces UI in the main app (add folder, name it, manage it)
- `spaces-bridge-handlers.ts` — the Electron-side IPC bridge to the code intelligence service
- Indexing lifecycle — start index, progress updates, completion notification
- Overlay integration — the overlay shows whether a Space is active and uses it for optimization
- Context leaking fixes — early bugs caused the active Space context to bleed between overlay sessions

**Why this was an architectural pivot, not a feature:** Adding Spaces changed the optimization pipeline's input. The optimizer now received not just the user's prompt but also `[PROBABLE LOCATIONS]` — a structured block of the most likely relevant files from the codebase. This changed the optimizer's system prompt, the IPC message format, and the Python service's data flow.

### Era 8: v1.2 / v1.3 — Usability Pass (Apr 30 – May 13, 2026)

Multiple releases in rapid succession focused on making the product feel finished rather than functional:

- **Auto-launch at login** — PRMPT starts silently when the computer boots, so users don't have to remember to launch it
- **Skills picker UI** — allows users to select up to 2 domain skills simultaneously; skills are the domain-specific optimization hints (technical, creative, business, etc.)
- **Clarification card redesign** — the UI for PRMPT asking clarifying questions was redesigned from a multi-question list to a single-card stepper with arrow key navigation, better for keyboard-driven workflow
- **macOS polish** — NSPasteboard clipboard race fix, overlay focus restoration fix, dock icon, menu bar template images

**v1.3.0 → 1.3.1 → 1.3.2:** Three rapid patch versions fixing issues discovered after the v1.3 release — specifically macOS overlay and Accessibility permission edge cases that only appeared on certain macOS versions.

**The lesson:** Desktop applications on macOS are harder to test than on Windows because macOS version fragmentation (Ventura vs Sonoma vs Sequoia) introduces behavior differences. PRMPT's approach: get a macOS contributor (the commit history shows `MrRaccooon` contributing most macOS fixes) who can test on multiple macOS versions.

### Era 9: Graph RAG Architecture (May 15–19, 2026)

**The limitation discovered:** The first version of Spaces used flat vector search — embed the query, find similar code chunks, return the top results. This worked for obvious cases ("what does the auth module do?") but failed for structural questions ("which functions are most likely to be affected by a change to the database schema?").

**Why flat search fails for code:**

Vector embeddings capture semantic similarity — two pieces of code that do similar things will have similar vectors. But code has a different kind of relevance: structural relevance. A utility function used by 30 other modules is not semantically interesting (its docstring might just say "formats a date string") but it's architecturally critical. Changes to it affect 30 other modules. Pure vector search would bury this function because its description is mundane.

**Graph RAG:** The solution is to build a **call graph** (a graph where nodes are functions/files and edges represent "A calls B" or "A imports B") and use graph algorithms to identify structural importance.

Key additions in this era:

- `graph_builder.py` (559 lines) — extracts call edges from Tree-sitter ASTs, builds an igraph graph, runs the Leiden community detection algorithm to find clusters of tightly-related code, computes PageRank centrality for every node
- **Leiden algorithm:** Successor to the Louvain community detection algorithm. Louvain can produce disconnected communities (a known flaw); Leiden guarantees well-connected communities. For code graphs, this means a cluster identified by Leiden is a genuine cohesive module, not an artifact of the algorithm's limitations.
- **PageRank on code:** Originally designed for web pages (a page is important if many important pages link to it), PageRank on a code graph identifies files and functions that are depended upon by many other files/functions. These are the architectural keystones — highest impact, most likely to be relevant to any non-trivial bug.
- Major Spaces UI redesign — the redesigned architecture warranted a UI that exposed the new modes and capabilities

### Era 10: Local Code Intelligence (May 20 – Jun 2, 2026)

The most intensive development era by commit count: 30+ commits in 13 days.

**The move away from Supabase for code intelligence:**

The original code intelligence service used Supabase (PostgreSQL + pgvector) for storage. This worked in the prototype but had three serious problems:

1. **Latency:** A single embedding lookup against Supabase over the network takes 100–200ms. A retrieval query doing 20 lookups takes 2–4 seconds. Unacceptable for real-time use.
2. **Privacy:** Sending source code snippets to a remote database is a non-starter for enterprise users. Source code contains business logic, unreleased features, and security-sensitive implementations.
3. **Offline operation:** Laptop developers aren't always on a network. Code intelligence should work offline.

**The Phase 1 local architecture:**

All code intelligence data moves to local SQLite (`code-intel/projects/<project_id>/index.db`). Key design decisions:

- **SQLite with FTS5 (Full-Text Search):** SQLite's FTS5 extension provides fast full-text search without a separate search engine. This handles keyword-based retrieval (searching for function names, variable names, exact strings) in milliseconds.
- **ONNX embeddings:** Instead of calling OpenAI's embedding API (which sends code to the cloud and costs $0.00002/1k tokens), PRMPT downloads `bge-small-en-v1.5` — a 384-dimensional sentence embedding model from BAAI (Beijing Academy of AI) — and runs it locally via ONNX Runtime. Local embedding = zero per-call cost, zero latency, zero privacy concern.
- **No full code bodies in the DB:** The database stores chunk metadata (file path, start line, end line) but not the actual code text. Code is read from the filesystem at retrieval time. This dramatically reduces DB size and avoids storing redundant copies of the user's codebase.

**ONNX Runtime — what it is:**
ONNX (Open Neural Network Exchange) is a format for packaging neural network models so they can run on any platform without the full Python ML stack. Instead of requiring PyTorch or TensorFlow, ONNX Runtime is a lightweight inference engine (~5MB) that runs ONNX-format models directly. For `bge-small`, this means embedding a code chunk takes ~50ms on CPU with no GPU required.

**The agentic retrieval loop:** `agent_loop.py` was added in this era. The loop gives the code intelligence service its own multi-hop reasoning capability: when a query comes in, instead of doing a single-pass retrieve, the service can call its own tools (vector search, FTS search, get_chunk, find_definitions, get_callers, get_callees) multiple times — following the code graph — to build a more complete answer. Bounded by 6 hops and a 25-second time budget.

**Why the agentic loop matters for the determinism problem:** The core blocker identified before benchmarks was that PRMPT returned the same files on every retry. The agentic loop's retry escalation (passing `previous_attempt_chunk_ids` and `error_signal` on subsequent calls) forces it to escalate scope and explore different parts of the graph on each retry. As of the first benchmark run, this path exists in the code but is not yet driven by any caller — the future work section covers this.

**30+ commits in 13 days** included: local SQLite schema, ONNX embedding backend, FTS5 search, graph-primary FIND ranking, score-aware per-file caps, IDF weighting, local BGE reranker, bge-small ONNX model download, Python call-graph edge extraction, agentic loop implementation, streaming Ask answers, optimizer hard-fail when context unavailable, pruning probable locations to top 8, stable chunk IDs, graph pipeline fixes, and more.

### Era 11: Benchmarks (Jun 8–12, 2026)

**The motivation:** After six months of building, the team had anecdotes ("it felt faster") but no numbers. Investors ask for numbers. Users want to see proof. The team needed a controlled experiment with objective pass/fail.

**mcp-shi (June 8):** A collaborator (Nihal) contributed a benchmark package: three realistic JavaScript codebases (~100k lines each), each with seeded bugs, each with automated test suites that serve as an objective oracle. Plus a real working MCP server (`prompt_mcp_server.py`) that serves PRMPT's context and routing data. This became the testing foundation.

**The limitations of mcp-shi:**

- Cost measurement was based on hardcoded token constants, not real measured spend
- Only two variants (with/without PRMPT) — no soft/hard hardening distinction
- MCP call count was based on heuristics, not definitive server logs

**mcp-ahh (June 11):** The unified benchmark harness combining mcp-shi's real repos and server with the team's rigorous measurement engine. Three variants (raw, mcp_only, mcp_optimizer), two hardenings (soft, hard), OpenRouter usage-delta cost tracking, definitive MCP call counting from server logs, repeatable runs.

**First results (June 12):** 60 runs, 6 tasks, 2 agents, 3 variants, 2 hardenings. 100% pass rate. Results: Codex saves money in 20/24 cases (up to 52%). Claude saves money in only 4/24 cases.

---

## PART 3 — The Tech Stack (Every Tool Explained From Scratch)

### Electron 32

**What it is:** Electron is a framework for building desktop applications using web technologies (HTML, CSS, JavaScript). It bundles Chromium (the browser engine behind Chrome) and Node.js (a JavaScript runtime) into a single application. Your React UI runs in Chromium. Your system-level code (file operations, native modules, IPC) runs in Node.js.

**Why PRMPT chose it:** Electron allowed the team to ship a cross-platform (Windows + macOS) desktop app using a single codebase and skills the team already had. Alternatives — native Swift (macOS only), native C++ (complex, no web UI), Tauri (lighter but less mature) — either required platform-specific code or had ecosystem limitations.

**The Electron architecture as used in PRMPT:**

- **Main process** (`electron/main/`) — Node.js process. Manages windows, system tray, IPC handlers, native module calls, Python service lifecycle, Supabase client.
- **Renderer processes** — Chromium processes. One for the main app window, one for the overlay window. Each runs a separate React app.
- **Preload scripts** — run in the renderer's Chromium context with access to a limited Node.js API surface. PRMPT uses `contextBridge` to expose only specific IPC functions to the renderer, preventing the renderer from accessing arbitrary Node.js APIs (security boundary).
- **IPC (Inter-Process Communication)** — `ipcMain` in the main process, `ipcRenderer` in the renderer, bridge via preload. PRMPT has 14 distinct IPC channels for overlay management, optimization streaming, auth state, spaces management, etc.

**The tradeoffs:**

- **Memory:** Electron apps baseline at 150–200MB RAM. A native macOS app doing the same thing would use 20–30MB.
- **Binary size:** The full packaged PRMPT installer is ~150MB (mostly Chromium). A native app would be 5–10MB.
- **Performance:** For PRMPT's use case (UI + IPC + native module), Electron performance is entirely acceptable. The bottlenecks are the Python services, not Electron.

### React 18 + TypeScript + Vite + Tailwind

**React 18:** PRMPT uses React's concurrent features — `startTransition` for non-blocking state updates, streaming-friendly rendering that handles 30+ token events per second during optimization without blocking the UI thread.

**Two separate Vite entry points:** The main app and the overlay are separate React applications built by separate Vite instances. This is important: the overlay must load instantly (it appears on a keypress). Having it as a separate build means it can be loaded into a browser window at startup and kept ready in the background, rather than needing to build/load when triggered.

**Why overlay is a separate BrowserWindow not a React component:** Electron's renderer processes are isolated. A React component in the main app window can't "float over" other applications — it's confined to its window. The overlay needs to be a separate top-level window with `transparent: true`, `alwaysOnTop: 'screen-saver'`, `skipTaskbar: true`, `type: 'panel'` (macOS). This requires a second BrowserWindow instance.

### Rust N-API (`native/platform-core/`)

**What N-API is:** Node.js exposes a stable C API called N-API that allows native code (C, C++, Rust) to be called from JavaScript. `napi-rs` is a Rust crate that wraps this API with safe, ergonomic Rust bindings. PRMPT compiles a Rust crate into a native `.node` module that Electron loads like any other npm package — except instead of pure JavaScript, it runs compiled Rust code.

**Why Rust not C++ or Python:**

- **Memory safety:** Rust's ownership system prevents memory bugs (buffer overflows, use-after-free) at compile time. For a global keyboard hook running in the kernel's message loop, memory safety is non-negotiable.
- **No GC pauses:** Garbage-collected languages (Java, Python, .NET, even Node.js/V8) have unpredictable GC pauses. For text injection — which must complete in under 50ms to feel instant — any GC pause would create visible latency. Rust has no GC.
- **Thread safety:** Rust's type system enforces thread safety at compile time. The keyboard hook callback fires on a different thread than the Node.js main thread. Rust makes the safe cross-thread callback pattern explicit and enforced.

**What the native module does:**

- `buffer.rs`: maintains a rolling window of the last N keystrokes (default: 8 characters). When `@prompt` appears in the buffer, fires a callback into Node.js with a `TriggerAnchor` (window handle, cursor coordinates, timestamp).
- `hook.rs`: installs the global keyboard hook. Windows: `SetWindowsHookEx(WH_KEYBOARD_LL, ...)`. macOS: `CGEventTapCreate(...)`. Both run an event loop on a dedicated background thread.
- `keymap.rs`: translates virtual key codes to characters. `VK_65` is the keycode for the 'A' key on a US keyboard, but on a French keyboard layout `VK_65` might be 'Q'. The keymap handles this translation correctly.
- `replacement.rs`: text injection with three-tier fallback:
  1. UIA `SetValue` (Windows UI Automation API — direct text injection if the target control supports it)
  2. Clipboard paste (place text on clipboard, simulate `Ctrl+V` / `Cmd+V`)
  3. `CGEventPost` backspace simulation (macOS: simulate pressing Backspace n times to erase `@prompt`, then Cmd+V to paste)

### Python FastAPI Services

**Why Python for the AI layer:** Python is the language of the AI ecosystem. LiteLLM, Hugging Face transformers, ONNX Runtime, Tree-sitter Python bindings, faster-whisper, Silero VAD — all are Python-first. Building the AI pipeline in Node.js would mean reimplementing large parts of these libraries or using inferior alternatives.

**FastAPI:** An async Python web framework. PRMPT uses:

- **Async routes** for WebSocket streaming — can handle multiple concurrent optimization sessions without blocking
- **Pydantic models** for request/response validation — catches malformed inputs before they reach the LLM call
- **OpenAPI schema generation** — automatic API documentation useful for development

**Two separate services:**

*Optimizer service (:8001)* — handles prompt optimization, clarification, task planning, memory. CPU-light (the heavy work is done by the LLM via OpenRouter). Starts in ~1 second.

*Code Intelligence service (:8002)* — handles indexing, embedding, graph building, retrieval. I/O-heavy. On startup, warms the ONNX model (loads the 90MB `bge-small-en-v1.5` model into memory — takes 3–5 seconds). Keeps the model in memory for sub-50ms embedding thereafter.

**Why two separate services, not one:** Different startup costs, different resource profiles, different failure modes. If the code intelligence service crashes on an ONNX model load, it shouldn't take down prompt optimization. If the optimizer service needs to restart because a new system prompt was deployed, it shouldn't trigger a 5-second ONNX warmup.

### LiteLLM

**What it is:** An open-source Python library that provides a unified interface for all major LLM providers. `litellm.completion(model="openrouter/anthropic/claude-haiku-4-5", messages=[...])` routes to Claude. Change the model string to `"openrouter/openai/gpt-4o"` and it routes to GPT-4o. Same call structure, any model.

**What it abstracts:** Authentication headers, request format differences between providers, response parsing, streaming normalization, retry logic, fallback models.

**Why it matters for PRMPT:** The optimizer uses Claude Haiku (fast, cheap) for skill selection and decision taking, and a more capable model for the final optimization. Being able to swap models by changing one string means PRMPT can immediately take advantage of new, cheaper, or better models without code changes.

### Tree-sitter

**What it is:** An incremental, error-tolerant parser generator. Tree-sitter can parse source code in any supported language into an **AST (Abstract Syntax Tree)** — a structured representation of the code's meaning, not just its text.

**Why not regex:** Regular expressions can find patterns in text but can't understand code structure. Finding all function names with regex is fragile (comments, strings, edge cases). Tree-sitter understands the language grammar and returns syntactically correct results.

**Why not a Language Server:** An LSP (Language Server Protocol) language server (like TypeScript's `tsserver` or Python's `pylance`) gives compiler-accurate results but requires:

- A separate process per language
- Full compiler setup (npm packages installed, Python environment configured)
- Several seconds to start up and warm the language model

Tree-sitter WASM is different: it runs in-process (no subprocess needed), handles dozens of languages from a single library, starts instantly, and doesn't need the project's dependencies installed. PRMPT embeds Tree-sitter WASM in the Electron main process for the indexing phase.

**What PRMPT extracts:** For each file, Tree-sitter gives: function/method names, class names, their start/end line numbers, their parameters and return type (if typed), import statements, function call sites (what functions are called from inside each function), and docstrings/comments.

### ONNX + BGE Embeddings

**ONNX (Open Neural Network Exchange):** An open format for packaging trained neural network models. A model trained in PyTorch can be exported to ONNX format and then run by ONNX Runtime — a lightweight C++ inference engine that works without PyTorch installed. The `bge-small-en-v1.5` model PRMPT uses is 90MB in ONNX format and runs on CPU in ~50ms per 512-token chunk.

**BGE (BAAI General Embedding):** A family of sentence embedding models from BAAI (Beijing Academy of Artificial Intelligence). `bge-small-en-v1.5` specifically:

- 384-dimensional embeddings (vs OpenAI's 1536 or 3072 for their largest models)
- Trained on English text and code
- Ranks competitively with much larger models on code retrieval benchmarks
- Open-source, MIT-licensed, runs entirely locally

**Why local embeddings not API embeddings:**

- A 100,000-line codebase generates ~5,000–10,000 chunks at indexing time. At OpenAI `text-embedding-3-small` ($0.00002/1k tokens), that's $0.10–$0.20 per initial index. Small but real, and multiplied across re-indexing events.
- Source code privacy: enterprise users can't send their codebase to any third-party API.
- Latency: ONNX Runtime embedding is ~50ms/chunk local vs 150–400ms/chunk with API round-trip + network.
- Offline: laptop developers frequently work without internet.

**BGE Reranker:** PRMPT also uses `bge-reranker-base` (a cross-encoder model, also run locally via ONNX) for re-ranking retrieved chunks. The difference: the embedding model is a bi-encoder (each text encoded independently), which allows pre-computing all chunk embeddings at index time. The reranker is a cross-encoder (query and chunk encoded together), which is slower but more accurate. PRMPT does fast bi-encoder recall (retrieve top 40 candidates) then slow cross-encoder reranking (reorder top 40 to get final top 10).

### igraph + leidenalg

**igraph:** A C library with Python bindings for graph analysis. PRMPT builds a directed graph where nodes are code chunks (functions, files) and edges represent call relationships ("function A calls function B"). igraph runs PageRank and community detection on this graph.

**PageRank:** The original Google algorithm for ranking web pages by importance. On a code graph: a function that is called by many other important functions gets a high PageRank. This identifies architectural keystones — the utility functions, base classes, and core modules that everything else depends on. A bug in a high-PageRank function affects the whole codebase; a bug in a leaf function affects only direct callers.

**Leiden algorithm:** Community detection — finding clusters of densely connected nodes. In a code graph, communities correspond to cohesive modules (all the payment processing functions form one community, all the auth functions form another). PRMPT uses Leiden communities for two purposes:

1. "Community reports" — LLM-generated summaries of what each community does, stored in SQLite, used to give high-level context in ASK mode
2. Community membership as a retrieval signal — if the query is clearly about authentication, boost chunks from the auth community

**Why Leiden not Louvain:** Louvain (the predecessor algorithm) can produce "internally disconnected" communities — nodes that are classified in the same community but can only reach each other through nodes in other communities. This violates the basic intuition of what a "cluster" is. Leiden guarantees all communities are well-connected. For code, this means a Leiden community corresponds to a genuinely cohesive module, not an artifact of algorithmic quirks.

### SQLite

**Why local SQLite not Supabase for code intelligence:**

- 2ms local read vs 150ms+ Supabase query (75x faster)
- Zero egress cost
- Source code stays on disk
- Works offline
- No Supabase connection overhead or schema migration coordination

**Schema overview:**

- `chunks` — code chunk metadata (file_path, start_line, end_line, chunk_type, symbol_name, parent_symbol)
- `embeddings` — the ONNX embedding vector for each chunk (stored as binary blob)
- `chunk_content` — FTS5 virtual table for full-text search across chunk body text
- `graph_edges` — directed edges between chunks (chunk_a calls chunk_b)
- `communities` — Leiden community assignments per chunk
- `community_reports` — LLM-generated summaries of each community
- `pagerank_scores` — the PageRank value for each chunk
- `file_hashes` — SHA-256 hashes for incremental re-indexing (skip unchanged files)
- `retrieval_logs` — records each query and its results for debugging and improving retrieval

**What is NOT stored:** Full source code text. The DB stores file_path + start_line + end_line. At retrieval time, the file is read from disk to get the actual code. This keeps DB size manageable (typically 5–20MB for a 100k-line project).

### Supabase

**What it is:** An open-source Firebase alternative providing PostgreSQL + Auth + Storage + Edge Functions. PRMPT uses Supabase for:

- User authentication (email/password, OTP, Google OAuth)
- Chat history (persistent across devices)
- Prompt library (collections of saved prompts)
- User settings and preferences
- Download tracking (how many downloads per version)
- Anonymous analytics (session counts, feature usage)

**What Supabase is NOT used for:** Code intelligence. Source code, embeddings, graph data, retrieval results — all local only.

### OpenRouter (Full Detail)

**How OpenRouter pricing works:**

- Per-token pricing: each model has distinct input and output token prices
- Cumulative usage API: OpenRouter exposes a `/api/v1/credits` endpoint that returns a single `total_usage` (cumulative spend in dollars) for a given API key. Taking two snapshots (before and after a session) gives the exact billed cost of that session.
- Tiered volume discounts: once a key has spent over certain thresholds, per-token rates drop. This is relevant for teams routing all AI spend through a single PRMPT-managed key.

**Why PRMPT uses usage-delta instead of token counting:** Token counting requires knowing which model was called, what the tokenizer splits look like, and having access to the provider's pricing table — which changes. Usage-delta is model-agnostic, provider-agnostic, and reflects actual billed cost including any volume discounts, promotional rates, or billing adjustments. It's what the invoice says, not what the math estimates.

---

## PART 4 — Full System Architecture

The architecture has four major layers:

**Layer 1 — OS / Native**

- Rust `platform-core` module (keyboard hook, text injection)
- Operating system APIs (WH_KEYBOARD_LL / CGEventTap, UIA / CGEventPost)

**Layer 2 — Desktop Shell**

- Electron main process (window management, IPC, native module bridge, auth, tray)
- React renderer — Main app window (Vite entry: `app-ui/src/main.tsx`)
- React renderer — Overlay window (Vite entry: `app-ui/src/overlay.tsx`)

**Layer 3 — Intelligence Services**

- Python optimizer service :8001 (FastAPI, LiteLLM, pipeline_v2)
- Python code intelligence service :8002 (FastAPI, ONNX, igraph, SQLite)

**Layer 4 — Remote Services**

- Supabase (auth, chat, library, settings)
- OpenRouter (LLM routing for optimizer + code analysis)

**Process count at runtime:** 5 processes: Electron main, Electron renderer (main app), Electron renderer (overlay), Python optimizer, Python code intelligence. Plus: Node.js IPC channels between main and renderers, WebSocket connections from renderers to Python services.

**Port map:**

- `:8001` — Python optimizer service (HTTP + WebSocket)
- `:8002` — Python code intelligence service (HTTP + SSE for streaming Ask)
- Internal Electron IPC — not network ports, OS-level message queues

---

## PART 5 — How It Works End-to-End: Three Complete Journeys

### Journey 1: @prompt Trigger in Any App

**Scenario:** Developer is in VS Code, typing in the search bar to ask Claude Code about a bug. They type `@prompt` to get PRMPT's help first.

**Step 1 — Keystroke detection (Rust, `hook.rs` + `buffer.rs`)**

The Rust keyboard hook has been running since PRMPT started. On Windows: `SetWindowsHookEx(WH_KEYBOARD_LL, hook_proc, NULL, 0)` installs a system-wide hook. Every keypress on the system (in any application) fires `hook_proc`. PRMPT checks: is this keypress a printable character? If yes, append it to the rolling buffer in `buffer.rs`.

`buffer.rs` maintains a Vec of the last 8 characters. Each new character shifts the window. After each append, it checks if the buffer ends in `@prompt`. When it matches, it fires a Node.js callback via N-API.

Why `@prompt` not a hotkey: Hotkeys are global captures (Ctrl+Shift+P) that must be registered with the OS and can conflict with other apps. `@prompt` is passive — it only fires when the user types that specific sequence, anywhere, without registering any exclusive key combination.

**Step 2 — Anchor recording and window open (Electron, `index-new.ts`)**

The N-API callback fires in the main process with a `TriggerAnchor` object: `{hwnd: number, cursorX: number, cursorY: number, timestamp: number}`. `hwnd` is the window handle of the active application (the window where `@prompt` was typed).

`setSourceWindow(hwnd)` — records which window to inject the optimized prompt back into.

`overlayManager.open(cursorX, cursorY)` — positions and shows the overlay window. The overlay was pre-loaded at startup (a BrowserWindow created with `show: false` and loaded with the overlay React app). Opening it is just `win.setPosition(x, y)` + `win.show()` — ~10ms, which is why it appears instantly. The DWM pre-heat trick (Windows): send `WM_NCHITTEST` to the window before showing it to force DWM to compose its layer, so the first appearance isn't jarred by compositing initialization.

**Step 3 — User types their prompt in the overlay**

The overlay is a floating 520×600 transparent window with `alwaysOnTop: 'screen-saver'`. The user types their vague prompt. As they type, the overlay checks if an active Space is connected and shows the Space status.

When the user submits (hits Enter or clicks Optimize):

**Step 4 — IPC to optimization (Electron IPC)**

The overlay renderer sends `ipcRenderer.send('overlay:optimize', {prompt, spaceId, history, attachments})` through the preload contextBridge. The main process receives this on the `overlay:optimize` channel.

**Step 5 — Code context retrieval (if Space is active)**

If a Space (indexed repository) is active, `project_context.py` in the optimizer service calls `:8002/api/retrieve` with the prompt and space ID. The code intelligence service routes the query through its mode classifier, runs hybrid retrieval (vector + FTS + graph), and returns a `[PROBABLE LOCATIONS]` block: a structured list of the most relevant files and functions.

This retrieval takes ~200–500ms (varies by codebase size and query complexity). It happens concurrently with the optimizer's pre-processing.

**Step 6 — Pipeline v2 optimization**

`pipeline_v2/optimizer.py` runs the prompt through all 7 stages:

1. DT classifies as NEW / REFINEMENT / ADDITION
2. SF selects the domain skill (for "fix the login bug" → technical skill)
3. CC compresses any conversation history
4. PO constructs the final LLM call: system prompt + skill file + code context + user prompt → sends to Claude Haiku via LiteLLM via OpenRouter
5. PO streams tokens back over WebSocket to Electron
6. Clarifier may fire if the prompt is genuinely too vague to route (asks targeted questions)
7. Memory extraction stores any learned preferences for future sessions

**Step 7 — Streaming back to overlay**

The WebSocket stream from port 8001 arrives at Electron's main process. For each token event, `ipcMain` pushes it to the overlay renderer via `win.webContents.send('overlay:token', chunk)`. The overlay renderer appends each chunk to the displayed text in real-time. The user sees the optimized prompt building token by token.

**Step 8 — Text injection (Rust, `replacement.rs`)**

User clicks Insert (or hits the configured key). The overlay sends `ipcRenderer.send('overlay:insert', {text})`. The main process calls the Rust module's `replaceAtLastAnchor(hwnd, text)`.

On Windows:

1. Attempt `SetFocusToWindow(hwnd)` + `UIA SetValue(text)` — fastest, silent, works on standard Win32 controls
2. If UIA fails: `SetClipboard(text)` + `SendInput(CTRL+V)` — universal, works everywhere
3. Also simulates Backspace × len("@prompt") = 7 times before pasting, to erase the trigger text

On macOS:

1. `CGEventPost` × 7 Backspace events — erases `@prompt`
2. `NSPasteboard` write + save old clipboard
3. `CGEventPost` Cmd+V — pastes
4. `NSPasteboard` restore — restores the original clipboard content

The developer's VS Code search bar now contains the precise, code-aware prompt — as if they had typed it themselves.

---

### Journey 2: Spaces — Code-Aware Optimization

**Scenario:** Developer has added their project to PRMPT's Spaces. They ask PRMPT to help them optimize a prompt about a bug in the codebase.

**Sub-journey 2A: Indexing the project**

Developer opens PRMPT's main app → Spaces tab → "Add Project" → selects folder.

1. **Electron side (electron-side parsing):** `spaces-bridge-handlers.ts` calls the code intelligence service's ingest endpoint. But first, Electron does its own pre-processing: `chokidar` (a file system watcher library) watches the folder for changes. `Tree-sitter WASM` (running in the main process) parses every supported file, extracting functions, classes, and their line ranges. A SHA-256 hash of each file's content is stored; on re-index, unchanged files are skipped.
2. **Electron → code-intel:** The parsed structure (file path, list of chunks with symbol names and line ranges) is sent to `:8002/api/index/ingest` as a batch.
3. **Code intelligence service (`:8002`) processing:**
  - Receives the chunk list
  - For each chunk: fetches the actual code text from the file path, generates ONNX embedding, stores in SQLite (embeddings + FTS5 index)
  - After all chunks: calls `graph_builder.py` — builds call graph (Tree-sitter extracted `callee` edges), runs igraph, computes PageRank, runs Leiden community detection, generates community reports via LLM, stores everything in SQLite
  - Returns "index complete" to Electron
4. **Progress updates:** The code intelligence service streams progress events (file count, chunk count, percentage) back to Electron via SSE (Server-Sent Events). The Spaces UI shows a progress bar.

For a 100k-line project, full indexing takes 3–8 minutes (first time), subsequent re-indexes take seconds (hash-diff skips unchanged files).

**Sub-journey 2B: Retrieval at optimization time**

Developer triggers overlay with `@prompt`, types "fix the bug where imported workspaces corrupt lead assignment."

After Step 4 (IPC to optimization), `project_context.py` calls `:8002/api/retrieve` with the query and project ID.

The code intelligence service routes through `query_analyzer.py`:

- Intent: BUG (mentions "bug", "fix", specific symptom)
- Mode: BUG

BUG mode retrieval pipeline:

1. **Query preprocessing** (`query_preprocessor.py`): expand abbreviations ("workspace" → "workspace workspaceId workspace_id"), strip code-irrelevant words ("please", "kindly")
2. **Vector recall**: ONNX-embed the query, find top 40 similar chunks by cosine similarity in SQLite
3. **FTS recall**: full-text search for exact terms ("imported workspaces", "lead assignment", "corrupt")
4. **Git blame drift** (BUG-specific): query the git log for recently changed files, boost chunks from files with recent changes (bugs often live in recently changed code)
5. **Test file demotion** (BUG-specific): demote chunks from test files (tests name the bug, but the bug is in the implementation)
6. **RRF fusion**: Reciprocal Rank Fusion — merges the vector and FTS ranked lists into a single ranking
7. **Cross-encoder rerank**: pass the top 40 candidates through `bge-reranker-base` (local ONNX) to get a more accurate relevance ranking
8. **Graph expansion**: for the top 5 chunks, follow call-graph edges outward to depth 3 — add any callers and callees not already in the result set
9. **MMR diversity** (Maximal Marginal Relevance): filter final results to maximize both relevance AND diversity. MMR works by iteratively selecting the next chunk that is most relevant to the query while being least similar to already-selected chunks. Lambda parameter controls the relevance/diversity tradeoff.
10. Return top 8 chunks with file paths, line ranges, and relevance scores

**MMR detail:** A retrieval system without MMR might return 8 chunks that are all from the same function — because that function has the highest similarity to the query. MMR prevents this: after selecting the first (most relevant) chunk, the second must be both relevant AND different from the first. The result is a diverse set that covers multiple relevant areas of the codebase.

**Output:** The `[PROBABLE LOCATIONS]` block:

```
[PROBABLE LOCATIONS]
These files are the most relevant to your task based on codebase analysis.
Start here. Do not Glob/Grep unless a failing stack trace explicitly names another file.

PRIMARY:
- src/features/imports/reconcileWorkspaceImport.js (lines 45-120) — workspace reconciliation logic
- src/features/leads/leadScoring.js (lines 230-280) — lead assignment scoring
- src/security/authorizeWorkspace.js (lines 15-60) — workspace visibility authorization

SECONDARY:
- src/models/workspace.js
- src/models/lead.js
...
```

This block is injected into the optimizer's LLM call as additional context. The optimizer's system prompt instructs it to treat the `[PROBABLE LOCATIONS]` block as authoritative routing guidance for the downstream agent.

---

### Journey 3: MCP Benchmark Run

**Scenario:** Running `python mcp-ahh/run.py` to execute the full benchmark matrix.

**Step 1 — Prepare phase (`mcp-ahh/prepare.py`)**

Before any benchmark runs, the prepare script:

1. Calls `:8002/api/index/ingest` for each of the 3 test repos — indexes the codebase (takes a few minutes the first time)
2. For each of the 9 tasks (3 repos × 3 prompts), calls `:8001/api/optimize` with the raw bug description — gets the optimized prompt and file routing from the live optimizer
3. Records the OpenRouter usage delta for this entire prepare phase
4. Stores the 9 optimized prompts + routing data in `mcp-ahh/results/prepared/`

Total prepare cost for the first run: $0.4404. Amortized across 9 tasks: $0.0489/task.

**Step 2 — Benchmark matrix setup**

`mcp-ahh/run.py` loads `config.yaml` (defines agents: claude, codex; variants: raw, mcp_only, mcp_optimizer; hardenings: soft, hard; repeats: 1) and `tasks.yaml` (6 tasks: 3 repos × 2 prompts each, using the p2 and p3 bugs).

For each cell in the 2 × 3 × 2 = 12 variant×hardening×agent matrix, for each of 6 tasks: run the cell.

**Step 3 — Cell execution (`benchmarks/runner.py` → `run_cell`)**

For a single cell (e.g., `atlas-p3 / codex / mcp_optimizer / soft`):

1. **Create git worktree:** `git worktree add /tmp/atlas-p3-bench-xyz <branch>` — creates an isolated copy of the test repo with the seeded bug intact. Git worktrees let multiple test runs work on the same repo simultaneously without touching each other.
2. **Snapshot OpenRouter balance:** Call the OpenRouter usage API, record `start_credits`.
3. **Build the agent command:**
  - For `raw`: `codex --model gpt-5-codex -- "fix the atlas p3 bug"` (the raw, unoptimized prompt)
  - For `mcp_optimizer`: use the prepared optimized prompt; configure Codex to load PRMPT's MCP server via `.codex/config.toml`
4. **Apply hardening:**
  - For `soft`: no additional restrictions
  - For `hard`: write `claude-settings.hard.json` to the worktree that denies `Read`, `Glob`, `Grep` native tools — MCP is the only retrieval path
5. **Launch MCP server (for mcp_only / mcp_optimizer cells):**
  - `subprocess.Popen(["python", "prompt_mcp_server.py"], env={"PRMPT_CONTEXT_FILE": "results/prepared/atlas-p3.json"}, stdin=PIPE, stdout=PIPE)`
  - The MCP server runs as a subprocess, communicates via stdin/stdout
6. **Run the agent:**
  - `subprocess.run(agent_command, cwd=worktree_path, timeout=300)` — agent runs headlessly, reads files, calls MCP tools, writes fixes, runs tests
  - Agent exit code recorded
7. **Run `npm test` oracle:** In the worktree, run `npm test`. Exit code 0 = PASS. Anything else = FAIL.
8. **Snapshot OpenRouter balance:** Record `end_credits`. `prmpt_cost = end_credits - start_credits`.
9. **Read MCP server call log:** The MCP server writes a line to its log file for each tool call. Count the lines → definitive `mcp_tool_calls`.
10. **Record the RunRecord:**

```json
{
  "task": "atlas-p3",
  "agent": "codex",
  "variant": "mcp_optimizer",
  "hardening": "soft",
  "pass_rate": 1.0,
  "agent_cost_median": 0.241516,
  "prmpt_cost_median": 0.048934,
  "net_cost_median": 0.290450,
  "vs_baseline_saving_pct": 31.04,
  "mcp_calls_median": 1.0,
  "native_search_median": 0.0,
  "agent_tokens_median": 160845,
  "reconciled": true
}
```

1. **Append to `runs.jsonl`:** The record is appended to the output file. At the end of the full matrix, `runs.jsonl` contains 60 records (6 tasks × 5 variants including raw baseline × 2 agents).

**Step 4 — Report generation (`benchmarks/report.py`)**

Loads `runs.jsonl`, computes savings vs baseline for each non-raw cell, determines wins (net cost down AND pass rate held), formats `report.md` with the full table and verdicts.

---

## PART 6 — Deep Component Breakdown

### 6.1 Rust Native Module (`native/platform-core/`)

**File structure:**

- `src/lib.rs` — entry point, N-API `#[module]` export declaration, `PlatformCoreModule` struct with all exported functions
- `src/buffer.rs` — rolling keystroke buffer, trigger detection logic
- `src/hook.rs` — OS-level keyboard hook (Windows: `WH_KEYBOARD_LL`, macOS: `CGEventTap`)
- `src/keymap.rs` — virtual key code to character translation for US and international keyboard layouts
- `src/replacement.rs` — text injection logic (UIA SetValue / clipboard paste / CGEventPost)
- `src/macos/` — macOS-specific: `accessibility.rs` (check/request Accessibility permission), `pasteboard.rs` (NSPasteboard wrapper), `events.rs` (CGEventPost wrappers)
- `Cargo.toml` — dependencies: `napi`, `napi-derive`, `winapi` (Windows), `core-graphics`, `cocoa`, `objc` (macOS)

**The WH_KEYBOARD_LL hook in detail:**
`SetWindowsHookEx(WH_KEYBOARD_LL, hook_proc, NULL, 0)` installs a system-wide low-level keyboard hook. Unlike `WH_KEYBOARD` (process-specific), `WH_KEYBOARD_LL` fires for keystrokes in all processes on the desktop. The hook function must call `CallNextHookEx` or keyboard input breaks. The hook runs in the thread that installed it — PRMPT runs it on a dedicated background thread with its own Windows message pump.

**N-API thread safety:**
The keyboard hook fires on the hook thread. Node.js runs on the main thread. Calling Node.js from another thread requires `napi_threadsafe_function` — a mechanism that queues the callback call onto the Node.js event loop. `napi-rs` wraps this as `ThreadsafeFunction<TriggerAnchor>`.

**The text injection cascade:**
On Windows, PRMPT tries three injection methods in order:

1. `UIAutomation.SetValue()` — works for standard Win32 edit controls, WPF text inputs, WinForms inputs. Direct, no clipboard involvement, invisible to the user.
2. `SendInput(Ctrl+V)` after setting clipboard — works universally including web apps in Chrome/Edge (which don't expose UIA). User may see clipboard change momentarily.
3. Fallback: if the clipboard approach fails (some apps block synthetic Ctrl+V), report an error.

### 6.2 Electron Main Process (`electron/main/index-new.ts`)

1092 lines covering:

- **Application lifecycle:** `app.on('ready')` → create main window → create overlay window (hidden) → start Python services → check Supabase auth → show main window
- **Python service management:** `spawn`/`kill` the two Python processes, retry on crash, surface "service unavailable" state to the UI
- **IPC handler registration:** 14 handler groups (auth, overlay, optimization, spaces, library, history, settings, system, MCP, benchmark utilities)
- **OverlayWindowManager:** The class managing the floating overlay window

**The DWM pre-heat trick (Windows-specific):**
When a transparent `alwaysOnTop` window is shown for the first time, Windows' Desktop Window Manager (DWM) needs to set up its compositing layer. This takes ~100ms and produces a visible flash/artifact on first appearance. PRMPT's workaround: after creating the overlay BrowserWindow (but before showing it), send a synthetic `WM_NCHITTEST` message to the window. This forces DWM to initialize the layer. Now when the window is actually shown, DWM's layer is already ready — zero flash.

**IPC streaming pattern:**
For optimization streaming, the main process doesn't collect all tokens and send one message. Instead, it pipes each WebSocket frame from the Python service into a separate IPC event: `win.webContents.send('overlay:stream-chunk', chunk)`. This keeps the renderer's "first byte" latency at ~500ms regardless of total optimization time.

### 6.3 Python Optimizer Service (`:8001`)

**File layout:**

- `pipeline_v2/optimizer.py` — main FastAPI app + the 7-stage pipeline
- `pipeline_v2/decision_taker.py` — DT classification (NEW / REFINEMENT / ADDITION)
- `pipeline_v2/skill_selector.py` — SF domain selection + skill file loading
- `pipeline_v2/context_summarizer.py` — CC history compression
- `pipeline_v2/clarifier.py` — Clarifier stage + question generation
- `pipeline_v2/task_planner.py` — Task planner for multi-step prompts
- `pipeline_v2/memory.py` — Memory extraction and injection
- `pipeline_v2/project_context.py` — retrieval from code intelligence service + [PROBABLE LOCATIONS] formatting
- `files/` — skill files (8 .md files with domain-specific optimization hints) + system prompt files

**The Decision Taker:**
A lightweight LLM call (Claude Haiku) with a focused prompt: "Classify this prompt as NEW, REFINEMENT, or ADDITION based on the conversation context." The classification determines how context is handled:

- NEW: no previous context relevant; fresh optimization
- REFINEMENT: previous output exists; optimize with awareness of what was already produced
- ADDITION: user is adding more detail to an existing prompt; merge intelligently

**The Skill Selector:**
Keyword-based (no LLM call needed — fast). Each skill file has associated keywords. The prompt is scored against each domain's keyword set. Top 1-2 domain skills are loaded and appended to the optimizer's system prompt.

Example: "fix the Stripe webhook signature bug" → keywords "bug", "fix", "stripe", "webhook" → technical skill selected → `files/skills/technical.md` appended to system prompt.

**The system prompts:**
`files/system_prompt_optimizer.md` — the main system prompt for the optimizer. Key rules: always use the `[PROBABLE LOCATIONS]` block if provided, never fabricate file names, never write code, always produce actionable instructions, keep the output compact.

`files/system_prompt_code_optimizer.md` — the specialized system prompt for code-context optimization. Additional rules: prefer exact file paths and line numbers, tell the downstream agent to start from provided locations and not to do broad searches, instruct the agent to run tests before and after.

**The `[PROBABLE LOCATIONS]` format:**

```
[PROBABLE LOCATIONS]
These files are the most relevant to your task based on codebase analysis.
Start here. Do not Glob/Grep unless a failing stack trace explicitly names another file.

PRIMARY: <up to 3 files with line ranges and context>
SECONDARY: <up to 5 additional related files>
```

The format is designed to be both machine-parseable (primary/secondary distinction) and read as natural instructions by LLMs (the "Start here" instruction is meant for the downstream agent to read and follow).

### 6.4 Code Intelligence Service (`:8002`) — Full Technical Detail

This is the most complex component. 56 files, ~10,000+ lines of Python.

`**local_store.py` (1,550 lines):**
The data access layer for all code intelligence operations. Manages:

- SQLite connection pooling (thread-safe, per-project connection pool)
- Chunk CRUD (insert, update, delete, batch upsert)
- Embedding storage and cosine similarity search (manual implementation using numpy dot products — SQLite doesn't natively support vector operations, so PRMPT implements ANN search as: load top-k candidates by FTS, then exact cosine re-rank in memory)
- FTS5 queries (full-text search with ranking via BM25, SQLite's built-in FTS ranking)
- Graph edge storage and retrieval
- Community report storage
- PageRank score storage and lookup

`**graph_builder.py` (559 lines):**
Builds the call graph from Tree-sitter extracted call edges:

1. Receives `{chunk_id: str, callee_names: list[str]}` for each chunk (Tree-sitter extracted which function names are called in each chunk's body)
2. Resolves callee names to chunk IDs by symbol lookup in SQLite
3. Builds an `igraph.Graph(directed=True)` with chunks as vertices and call relationships as edges
4. Runs `igraph.Graph.community_leiden()` with `objective_function='modularity'` (optimizes for dense internal connections, sparse external connections)
5. Runs `igraph.Graph.pagerank()` (damping factor 0.85, default)
6. Generates community reports: for each community, concatenate the top 10 functions' docstrings/signatures and call the optimizer LLM to summarize the community's purpose
7. Stores all results in SQLite

**The 4 search modes:**

**FIND mode** (looking for a specific symbol/file):
Five boosters for each candidate chunk:

1. Path match boost: does the query mention a file name that appears in this chunk's path?
2. Signature match boost: does any query term exactly match a function/class name in this chunk?
3. Body match boost: do multiple query terms appear in the chunk's body?
4. Signal term boost: does the query contain "in " pattern that matches?
5. Concept match boost: does the query concept (auth, payment, user) match the chunk's community label?

One penalty: if the chunk matches zero query terms (pure semantic match with no lexical overlap), apply a minimum relevance gate.

**ASK mode** (knowledge question about the codebase):

- Global vector search (no lexical component)
- Community report injection: find the top community by relevance, prepend its LLM-generated summary
- Answer generation: call the optimizer LLM to produce a natural language answer citing the retrieved chunks

**BUG mode** (something is broken):

- Combined vector + FTS + drift scoring
- Git blame drift: query git log for recently changed files (recent changes = likely bug introduction sites); boost chunks from these files
- Test file demotion: chunks from `*.test.js`, `*.spec.ts` etc. are demoted (they describe the bug symptom, not the bug location)
- Emphasis on primary files from BUG-mode results: the files that are both semantically relevant AND recently changed

**OPTIMIZE mode** (adding a feature or improving something):

- Call-graph centrality emphasis: boost high-PageRank chunks (the architectural keystones that need to be understood before changing anything)
- MMR diversity: maximize coverage across multiple parts of the codebase (implementing a feature might touch 5 different areas; OPTIMIZE mode tries to surface all 5)
- Graph expansion to depth 3: for the top results, follow edges outward 3 hops to collect transitive dependencies

`**agent_loop.py` (309 lines):**
The bounded multi-hop agentic retrieval loop.

When called, it has access to 6 tools:

- `vector_search(query, k)` — semantic search in SQLite
- `fts_search(query, k)` — full-text search in SQLite
- `get_chunk(chunk_id)` — get the full content of a specific chunk
- `find_definitions(symbol_name)` — find where a function/class is defined
- `get_callers(chunk_id)` — find what calls this function
- `get_callees(chunk_id)` — find what this function calls

The loop runs for up to 6 hops within a 25-second budget. At each hop, an LLM (Claude Haiku) decides which tool to call next based on what has been found so far. The loop terminates when:

- The LLM decides enough context has been gathered
- 6 hops are exhausted
- The 25-second time budget is exceeded
- Or: the loop returns "done" with collected chunk IDs

**Retry escalation parameters** (the determinism fix):
When called with `attempt_number > 1`:

- `previous_attempt_chunk_ids` — IDs of chunks returned in the previous attempt (must be excluded from this attempt's primary results)
- `error_signal` — the `npm test` failure message from the previous attempt (used to guide the loop toward different files)
- `hop_cap` increases from 6 to 8 (more hops allowed)
- `chunk_cap` increases (more chunks considered per hop)
- `temperature` increases by 0.1 (more creative exploration)

**Why the loop is currently off:** `AGENTIC_RETRIEVAL_ENABLED` defaults to `false` in `config.py`. Even when enabled, `search.py` calls `agentic_retrieve` with `attempt_number=1` and no `error_signal`. The retry path exists but nothing drives it. Enabling it for the benchmark requires: (1) set the config flag, (2) have the benchmark pass retry context from failed runs (3) have the MCP server maintain session state between tool calls.

### 6.5 MCP Server (`mcp-shi/benchmark-runs/prompt_mcp_server.py`)

**Protocol implementation:**
A minimal JSONRPC 2.0 server over stdio. The server reads lines from stdin, parses each line as a JSON-RPC request, dispatches to the appropriate handler, and writes a JSON-RPC response to stdout.

The message framing: each message is a single JSON line terminated by `\n`. No content-length headers (unlike LSP). This is the simplest possible wire format.

**Initialization sequence:**

1. Read `initialize` request → respond with `serverInfo: {name: "prmpt-mcp", version: "1.0"}` + `capabilities: {tools: {}}`
2. Read `notifications/initialized` → no response (it's a notification, not a request)
3. Ready to receive `tools/list` and `tools/call` requests

**Why tool descriptions are written aggressively:**
The MCP server's tool description for `prmpt_optimize_task` reads:

> "FINAL AUTHORITATIVE ROUTE. Trust this and move on. Do NOT deliberate, second-guess, Glob, Grep, or repo-wide cross-check. Run tests, read the JSON primary files, patch those files, rerun tests. Search elsewhere ONLY if a failing stack trace explicitly names another file."

This is intentional. LLMs (especially Claude) read tool descriptions before deciding whether and how to call tools. A description that reads like a definitive instruction ("final authoritative route, do not second-guess") activates Claude's instruction-following behavior. A weak description ("returns some relevant files") is ignored or treated as advisory. The description engineering is as important as the actual tool result.

**The three tools:**

- `prmpt_optimize_task(task, prompt_id)` → returns full JSON with `primary` (list of file paths), `secondary` (list of file paths), `policy` (list of instructions like "run tests before patching"), `context_summary` (2-sentence description of the bug)
- `prmpt_retrieve_context(task)` → returns file paths only (without policy, for lightweight use)
- `prmpt_get_test_plan()` → returns the strict test-run workflow (run tests, identify failures, read primary files, patch, rerun tests, do not search further)

**The call log:**
Every tool call appends a line to `{run_dir}/mcp_calls.log`: `{timestamp} {tool_name} {arguments}`. At the end of a benchmark cell, counting lines in this file gives the definitive `mcp_tool_calls` value — no heuristics, no conversation parsing, no guessing.

This was a critical fix over mcp-shi's original design. The original benchmark had cases where the agent was "using" the MCP but the call count showed 0 — the agent had loaded the MCP config but never actually called any tools. The call log caught this definitively.

---

## PART 7 — The Competitive Landscape

### Claude Code (The Incumbent)

**Architecture:** Open-source CLI agent (released February 2025). Anthropic maintains it actively. Claude Code has three key components for context management:

1. **File reading tools:** `Read`, `Glob`, `Grep` — standard file operations that cost tokens but are unrestricted by default
2. **Bash tool:** Can run `npm test`, `grep -r`, `find`, etc. — very flexible but also expensive
3. **Native prompt caching:** Claude Code uses Anthropic's prompt caching aggressively. System prompts and frequently-read files are cached. Cache-read tokens cost $0.30/million (vs $3.00/million for non-cached). This is Claude Code's structural advantage: its context replay cost is 90% cheaper than naive context replay.

**Why PRMPT doesn't help Claude much:** The 60-run benchmark confirmed this. Claude's baseline cost is already low (aided by aggressive caching) and its native exploration is efficient (it reads the right files in 2–3 turns). Adding PRMPT's $0.049 overhead to a $0.22 Claude session is a 22% surcharge — more than any routing savings can recover in a short session.

**What would make PRMPT help Claude:** Longer, more complex tasks where exploration cost is genuinely high and early routing could skip 5+ turns of search. Or rate-limit-sensitive scenarios (Claude Max users who care about turns/hour, not dollar cost).

### Codex CLI (The Opportunity)

**Architecture:** OpenAI's CLI agent, running GPT-5 Codex. MCP support via `.codex/config.toml`. The agent architecture is similar to Claude Code but the underlying model handles context management differently. Codex without guidance tends to do broader exploration — more `grep` calls, more files read — which costs more tokens.

**Why PRMPT helps Codex significantly:** The benchmark showed Codex saves 20–52% with PRMPT on the atlas and nova repos. Codex's exploration cost is high by default; PRMPT's routing eliminates most of it. The structural explanation: GPT-5 Codex doesn't have Claude's level of file navigation optimization built-in. It's capable but not as targeted. PRMPT fills that gap.

### Cursor

**Architecture:** VS Code fork with deeply integrated AI. Cursor's context pipeline:

- **Tab autocomplete:** Predicts the next code lines using a fine-tuned model
- **Composer:** Multi-file editing with AI; builds its own semantic index of the codebase
- **Codebase index:** Cursor maintains a cloud-side index of the user's codebase for semantic search

**Why Cursor doesn't compete directly with PRMPT:** Cursor is an IDE, not an agent layer. Using Cursor means switching your entire editor. PRMPT works alongside Cursor — or, more likely, alongside Claude Code and Codex for developers who don't want to leave their current editor. Cursor's power users are often precisely the developers who have strong preferences about their editor and won't switch.

### Serena

**Architecture:** Open-source MCP server (Python, MIT license) that uses the **LSP (Language Server Protocol)** for code navigation. Instead of building its own index, Serena delegates to the language server that's already running in the developer's editor (TypeScript's `tsserver`, Python's `pylance`, etc.). LSP gives compiler-accurate results: symbol resolution that matches the compiler's understanding.

**Strengths vs PRMPT:** LSP accuracy is better than embedding similarity for exact symbol lookups. If you ask "find the definition of `validateToken`", LSP will find it exactly, where embedding search might find semantically similar functions.

**Limitations vs PRMPT:**

- Requires running a language server per language (complex setup, multiple processes)
- Language server must be initialized (takes 10–30 seconds for large TypeScript projects)
- No prompt optimization layer — Serena finds files but doesn't rewrite your prompt
- No cost tracking — Serena has no awareness of what the agent is spending
- No cross-language unified index — if your project mixes TypeScript and Python, you need two language servers

**The combination:** PRMPT and Serena are complementary. PRMPT optimizes the prompt AND routes the agent. Serena gives compiler-accurate symbol resolution. A future PRMPT version could use Serena's LSP data as a signal in its retrieval pipeline.

### Continue.dev

An open-source VS Code extension providing AI-assisted coding. Has its own codebase indexing. IDE-bound — can't be used with CLI agents. Targets developers who want AI assistance inside VS Code specifically. Not a direct competitor to PRMPT's CLI-layer approach.

### Aider

A well-established open-source CLI coding agent with ~12k GitHub stars. Has its own "repo map" (a compressed representation of the codebase's structure). Handles Git operations natively. No MCP support (as of June 2026). Aider's repo map is a clever heuristic — it builds a tree-of-abstractions view of the codebase — but it doesn't use embedding-based semantic search or graph analysis. PRMPT's code intelligence is more sophisticated, but Aider's approach is simpler and works well for many use cases.

### Why PRMPT's Angle Is Structurally Different

Every competitor either:
A. Is an IDE tool (Cursor, Continue.dev, Copilot) — tied to one editor
B. Is an agent with its own context management (Aider, Claude Code, Codex) — not a layer
C. Provides context but not prompt optimization (Serena) — missing the prompt rewrite step
D. Provides prompt optimization but not code context (generic prompt tools) — missing the routing step

PRMPT is the only tool in this space that:

- Is agent-agnostic (works with any MCP-compatible agent)
- Combines prompt optimization AND code-context routing
- Works outside the IDE (in the OS, in any app)
- Measures its own cost impact (OpenRouter delta)

This positioning is both a moat and a challenge: the moat is that no single competitor does all four. The challenge is that each of these capabilities can be built by the incumbents (Anthropic could add prompt optimization to Claude Code; Cursor could add CLI support). The defensible version of PRMPT is one where the codebase intelligence (graph, PageRank, Leiden communities) is deep enough that it's not easily replicated in a weekend.

---

## PART 8 — Current Limitations (Honest)

### Limitation 1: MCP Server Is Precomputed

The `prompt_mcp_server.py` used in the 60-run benchmark serves precomputed answers. The `PRMPT_CONTEXT_FILE` environment variable points to a JSON file generated by `prepare.py` before the benchmark ran. When the agent calls `prmpt_optimize_task`, it gets a pre-made answer, not a live retrieval.

**Implication:** The 60 runs tested whether having the right file pointers early in a session saves money. They did not test whether PRMPT's live retrieval (calling code intelligence during the agent's turn) is accurate or useful. Those are different questions.

**Why this is valid for the first test:** Controlled experiments require controlled variables. Using precomputed prompts meant the routing quality was fixed across all cells — any difference in outcome was due to the agent variant (raw/mcp_only/mcp_optimizer) and hardening, not to variation in retrieval quality. Once the routing value is confirmed with precomputed data, the next test can introduce live retrieval as a variable.

### Limitation 2: Agentic Loop Is Off

`AGENTIC_RETRIEVAL_ENABLED=false` in `code-intelligence-service/app/config.py`. The multi-hop agentic loop in `agent_loop.py` exists and is complete, but is not exercised in any current user path or benchmark run.

Even if set to `true`: `search.py` always calls `agentic_retrieve` with `attempt_number=1` and no `error_signal`. The retry escalation path (different files on second attempt, higher hop cap, escalated temperature) requires a caller that passes these parameters — and currently no caller does.

**The determinism problem is half-fixed:** The code to solve deterministic output on retry (escalating exploration on each attempt) exists in `agent_loop.py`. The infrastructure to drive it (passing retry context from the benchmark oracle, having the MCP server maintain session state) is not built yet.

### Limitation 3: Claude Structural Loss

Claude + PRMPT cost MORE in 20/24 tests. This is structural. Claude Code's native prompt caching gives it a 10x cost advantage on context replay. PRMPT's $0.049 overhead ($0.05 flat per task from the prepare phase) adds 20–25% to a $0.22 Claude session. No amount of routing improvement can overcome a $0.05 overhead added to a $0.22 baseline.

**What this means for product positioning:** PRMPT's token savings story is a Codex story, not a Claude story. For Claude users, the pitch is different: rate-limit throughput (do more sessions before hitting your monthly cap) or multi-attempt success rate (PRMPT's retry logic, once live, would help Claude on tasks it fails on the first attempt).

### Limitation 4: Single Repeat Per Cell

The 60 runs are 60 unique cells — 1 run each. LLM agent output has variance. Run the same task with the same prompt twice and you'll get different token counts due to model temperature and caching effects. Variance in agentic tasks can be 10–30% of total cost. This means a 14.41% saving (atlas-p2/codex/mcp_only/soft) might not survive 3 repeats — it could swing negative.

**What's needed:** 3+ repeats per cell, with median and interquartile range reported. The benchmark harness supports this (K repeats configuration) but wasn't used for the first run due to compute time and cost.

### Limitation 5: p1 Tasks Excluded

Only p2 and p3 bugs were tested (2 bugs per repo = 6 tasks total). The p1 bugs (simpler, more straightforward) and more complex p1 scenarios were excluded from the first run. Orbit-p1 specifically (the complex CRM import reconciliation bug with 6 interacting components) was too expensive to run reliably in the first pass.

### Limitation 6: Orbit Repo Structural Loss for Codex

Orbit-p2 and orbit-p3 are in the orbit-crm codebase — the largest and most complex of the three test repos. PRMPT's prepare cost for orbit tasks is higher ($0.09–$0.17 per task vs $0.049 for atlas/nova) because the CRM import bug required more optimization tokens. Even Codex + PRMPT was more expensive than raw Codex on all 4 orbit-p2 cells.

This reveals a real limitation: PRMPT's prepare cost is not constant. Complex tasks with multi-component bugs cost more to optimize. For high-complexity tasks where the PRMPT overhead exceeds the routing savings, the ROI is negative.

### Limitation 7: No Real User Data

All 60 runs used synthetic tasks — bugs seeded into generated codebases. Real developer prompts are messier, more ambiguous, more varied in length and domain. The benchmark validates "routing value in controlled conditions," not "routing value in real developer workflows." The 6-user pilot study (planned for after the first benchmark results) will address this.

---

## PART 9 — What We're Working Towards

### Near-Term: Pipeline Hardening (Weeks)

**1. Live MCP server**

Replace the precomputed `PRMPT_CONTEXT_FILE` approach with a live retrieval call. When the agent calls `prmpt_optimize_task(task="...")`, the MCP server:

1. Calls `:8002/api/retrieve` with the task description
2. Returns the live retrieval result

This makes every MCP call reflect the actual current state of the indexed codebase. Cost impact: adds ~200–300ms latency per tool call and adds a small OpenRouter cost (for the retrieval LLM call if using the agentic loop). The benchmark engine already captures this via usage delta — no harness changes needed.

**2. Enable and test the agentic loop**

Set `AGENTIC_RETRIEVAL_ENABLED=true` in the benchmark config. This means the first retrieval attempt already runs multi-hop. Measure: does the live agentic loop produce better routing than the one-shot pipeline? This is a separate test from the routing value already confirmed.

**3. Wire the retry oracle**

The retry mechanism requires three components working together:

- **Test runner passes failure signals:** When `npm test` fails, the runner extracts the failure message and passes it as `error_signal` to the next MCP call
- **MCP server maintains session state:** Each benchmark cell has a session ID; the server stores what it returned in the previous call for that session
- `**search.py` propagates retry context:** Instead of always calling with `attempt_number=1`, the server calls with the actual attempt number and `previous_attempt_chunk_ids`

Once this is wired: "fix it again" produces genuinely different file suggestions, not the same ones that didn't work. This directly addresses the original determinism blocker identified before benchmarks.

### Medium-Term: CLI Fork Strategy (Months)

**The opportunity:** OpenCode is fully open-source. Its architecture is public. Forking and modifying it is legally and technically feasible. The strategy: replace OpenCode's context retrieval layer with PRMPT's code-intelligence service.

**What changes in a fork vs a plugin:**

- Right now: PRMPT is an MCP plugin. The agent can load it, ignore it, partially follow it, or call it at the wrong time. The agent makes the final decision on what to do with PRMPT's output.
- In a fork: PRMPT's retrieval IS the agent's retrieval. When the agent wants to find relevant files, it calls PRMPT's code intelligence directly. There's no "ignore the MCP server" option because there's no separate MCP layer — it's built in.

**The 70% hypothesis:**

A PRMPT-native open-source agent achieves 70%+ of Claude Code's fix rate at 40–60% lower cost per task.

Why 70% might be achievable: the benchmark showed that on tasks where routing is the bottleneck (Codex cases), PRMPT's routing dramatically improves outcomes. A purpose-built agent with PRMPT routing native is not constrained by the soft/hard hardening problem — it doesn't need to be blocked from searching because PRMPT IS its search.

Why 100% is not the target: Claude Code's model (Claude Sonnet) is genuinely better than open-source model alternatives at complex multi-file reasoning, understanding subtle bugs, and writing maintainable fixes. PRMPT can narrow the gap but can't close it entirely. 70% is a real, defensible, measurable target.

**The 40–60% cost reduction math:**
If raw Claude Code costs $0.30/task and PRMPT-native open-source costs $0.15/task (open-source model at lower per-token rates + PRMPT routing reducing turns), that's 50% cost reduction. For a team spending $10,000/month on Claude Code that achieves 70% of Claude Code quality from the PRMPT-native agent, that's $5,000/month on the PRMPT tool for 70% quality = same per-unit-quality cost as Claude Code, with better scalability (PRMPT subscription flat, not per-token).

### Long-Term: Stateful Sessions (Quarters)

**The vision:** PRMPT's MCP server is not a stateless file-serving lookup. It's a stateful session manager. For each agent session:

- Session ID assigned at start
- Each MCP tool call updates the session state: what was returned, what the agent did with it, whether tests passed
- On retry: the session provides `exclude_chunk_ids` (previous attempt's files) and `error_signal` (the test failure)
- After session end: session data feeds into PRMPT's improvement loop (which file suggestions actually led to fixes vs which were unhelpful)

This closes the feedback loop that makes PRMPT better over time. The system learns from real usage: "when the agent is given file X for task type Y, it succeeds 85% of the time. When given file Z, it succeeds 30% of the time." This is the data that makes PRMPT's retrieval model improve.

**The open data play:** Anonymized session data (task type, file routing decisions, success/failure) is valuable for training better code retrieval models. This could become a collaboration with the research community or a data asset that makes PRMPT's retrieval model hard to replicate without the same data.

---

## PART 10 — The Token Economy: Why This Is a Real Problem

### LLM API Pricing in 2026

**Anthropic Claude Sonnet 4.5 (June 2026):**

- Input tokens: $3.00 / million tokens
- Output tokens: $15.00 / million tokens
- Cache write tokens: $3.75 / million tokens (slightly more expensive to write to cache)
- Cache read tokens: $0.30 / million tokens (10x cheaper than non-cached input)

**OpenAI GPT-5 Codex (June 2026):**

- Pricing varies by tier and usage volume; broadly similar to Anthropic's range
- Cache efficiency varies by model and usage pattern

**The math on a single session:**
Consider a 15-turn Claude Code session on a 100k-line codebase, bug-fixing task:

- System prompt: ~5,000 tokens
- User messages (15 turns × ~500 tokens each): 7,500 tokens
- File content read (15 files × ~2,000 tokens each): 30,000 tokens
- Tool results (grep outputs, bash outputs): ~10,000 tokens
- Context replay (all of the above replayed each turn): Turn 1 sends 5k, Turn 5 sends 20k, Turn 10 sends 45k, Turn 15 sends 70k
- Total approximate input tokens: 400,000–600,000 (dominated by replay)
- Output tokens: ~20,000 (code patches, analysis)
- Approximate cost at full price: $1.20–$1.80 for input + $0.30 for output = $1.50–$2.10

With aggressive caching (Claude Code's reality):

- Most context replay tokens are cache-read: $0.30/million instead of $3.00/million
- Cache writes are amortized across repeated access to the same files
- Effective cost: much closer to $0.20–$0.40 for a typical session

With PRMPT (6-turn session instead of 15):

- 6 turns of context replay instead of 15
- Eliminates turns 7–15 entirely
- Approximate total input tokens: ~200,000 (roughly half)
- Effective cost with caching: $0.15–$0.25

**The counter-argument (honest):**
Claude Code's caching is so effective that the cost of context replay is already 90% reduced. The savings from reducing 15 turns to 6 turns, when each of those turns is mostly cache-read tokens, is smaller than naive math suggests. This is why the benchmark shows modest savings for Claude — the caching nearly eliminates the replay cost that PRMPT would otherwise address.

**Codex doesn't have the same caching efficiency.** Without aggressive caching, context replay at full input token price is the dominant cost. PRMPT's turn reduction has full impact — which is why the benchmark shows 20–52% savings for Codex.

### The Team Economics

**10-person team, heavy AI usage:**

- Each engineer: 5 Claude Code sessions/day × $0.30/session = $1.50/day per engineer
- Team total: $15/day = $450/month on Claude Code alone
- With GPT-5 Codex for some tasks: add another $200–300/month
- Total AI coding spend: $650–750/month for 10 engineers

**At scale (50-person team):**

- Claude Code: $2,250/month
- Codex and other tools: $1,000/month
- Total: $3,250/month just on API-based AI coding tools

**PRMPT's addressable savings:**
On the Codex portion (say 40% of spend = $1,300/month for 50 engineers):

- 25% average saving (conservative benchmark result) = $325/month saved
- PRMPT subscription (hypothetical $500/month for 50-seat team): net -$175/month

At this scale, the pure cost savings story is marginal. The more compelling pitch for large teams:

1. **Rate limit throughput:** Flat-rate plan users (Claude Max) care about tasks per hour, not dollars per task. PRMPT's turn reduction means more tasks complete before hitting hourly rate limits.
2. **Consistency:** PRMPT ensures every engineer follows the same retrieval protocol. The variance between "good prompter engineers" and "bad prompter engineers" shrinks.
3. **Audit trail:** PRMPT's session logs give CTOs visibility into what the AI is doing and how much it's costing per task type.

### Subscription vs API Users

**API users** (pay per token): PRMPT's ROI is directly calculable. Every saved token = saved dollars. The benchmark proves this for Codex.

**Subscription users** (Claude Max $100/month, rate limited not per-token): Token savings don't reduce their bill. BUT turn reduction means they can complete more sessions per hour before hitting rate limits. For a developer doing 20 coding sessions per day on Claude Max, rate limits are a real constraint. PRMPT's pitch: "complete the same work in 6 turns instead of 15 means you can do 2.5x as many sessions before your daily limit."

This is a different value proposition — throughput rather than cost savings. It's arguably more compelling for power users who have already optimized their AI spending by switching to flat-rate plans.

---

## PART 11 — Benchmark Results (First Real Run, Full Analysis)

### Setup

**Test repos:** Three JavaScript/TypeScript ESM codebases generated by Nihal, scaled to ~100,000 lines each:

- `orbit-crm-generated` — CRM system with contacts, leads, workspaces, import reconciliation
- `atlas-commerce-generated` — E-commerce platform with orders, inventory, payments
- `nova-support-generated` — Customer support platform with tickets, routing, SLAs

**Why these repos:**

1. Realistic scale (100k lines is a medium-sized real startup codebase)
2. JavaScript/TypeScript (the language of the largest segment of developers using AI coding tools)
3. Comprehensive test suites (`npm test`) that serve as objective oracles
4. Seeded bugs that are realistic (multi-file interactions, subtle logic errors) but unambiguous (either the test passes or it doesn't)

**Seeded bugs:**

- orbit-p2: workspace import reconciliation with duplicate lead creation
- orbit-p3: workspace visibility authorization bug (missing workspace status check)
- atlas-p2: order fulfillment discount application bug
- atlas-p3: inventory reconciliation import mismatch
- nova-p2: SLA breach notification timing bug
- nova-p3: ticket routing priority scoring bug

**The oracle:** `npm test` in the worktree. Exit code 0 = fixed. Any non-zero = broken. Clean pass/fail with no human judgment.

**Prepare cost:** $0.4404 total for indexing all 3 repos (3 × 100k lines, ONNX embeddings, graph building) plus optimizing all 9 task prompts via the live optimizer. Amortized: $0.0489 per task.

### Matrix


| Agent     | Variants                     | Hardenings       | Total cells | × tasks   | = runs |
| --------- | ---------------------------- | ---------------- | ----------- | --------- | ------ |
| Claude    | raw, mcp_only, mcp_optimizer | none, soft, hard | 5 × 2       | × 3 tasks | = 30   |
| Codex     | raw, mcp_only, mcp_optimizer | none, soft, hard | 5 × 2       | × 3 tasks | = 30   |
| **Total** |                              |                  |             |           | **60** |


Note: "raw" has no hardening (it's the baseline), so it's counted once not twice, giving 5 configurations per agent per task (raw, mcp_only/soft, mcp_only/hard, mcp_optimizer/soft, mcp_optimizer/hard).

### Full Results Table


| Task     | Agent  | Variant       | Hardening | Pass | Net Cost ($) | vs Raw (%)  | MCP Calls | Result   |
| -------- | ------ | ------------- | --------- | ---- | ------------ | ----------- | --------- | -------- |
| atlas-p2 | claude | raw           | —         | 1.0  | 0.2201       | —           | 0         | BASELINE |
| atlas-p2 | claude | mcp_only      | hard      | 1.0  | 0.2630       | -19.47%     | 1         | LOSS     |
| atlas-p2 | claude | mcp_only      | soft      | 1.0  | 0.3320       | -50.85%     | 1         | LOSS     |
| atlas-p2 | claude | mcp_optimizer | hard      | 1.0  | 0.3405       | -54.68%     | 1         | LOSS     |
| atlas-p2 | claude | mcp_optimizer | soft      | 1.0  | 0.3348       | -52.11%     | 1         | LOSS     |
| atlas-p2 | codex  | raw           | —         | 1.0  | 0.3393       | —           | 0         | BASELINE |
| atlas-p2 | codex  | mcp_only      | hard      | 1.0  | 0.2638       | **+22.27%** | 1         | WIN      |
| atlas-p2 | codex  | mcp_only      | soft      | 1.0  | 0.2904       | **+14.41%** | 1         | WIN      |
| atlas-p2 | codex  | mcp_optimizer | hard      | 1.0  | 0.2631       | **+22.47%** | 1         | WIN      |
| atlas-p2 | codex  | mcp_optimizer | soft      | 1.0  | 0.2682       | **+20.95%** | 1         | WIN      |
| atlas-p3 | claude | raw           | —         | 1.0  | 0.3291       | —           | 0         | BASELINE |
| atlas-p3 | claude | mcp_only      | hard      | 1.0  | 0.2923       | **+11.17%** | 1         | WIN      |
| atlas-p3 | claude | mcp_only      | soft      | 1.0  | 0.3057       | **+7.12%**  | 1         | WIN      |
| atlas-p3 | claude | mcp_optimizer | hard      | 1.0  | 0.3238       | **+1.60%**  | 1         | WIN      |
| atlas-p3 | claude | mcp_optimizer | soft      | 1.0  | 0.3309       | -0.55%      | 1         | LOSS     |
| atlas-p3 | codex  | raw           | —         | 1.0  | 0.4212       | —           | 0         | BASELINE |
| atlas-p3 | codex  | mcp_only      | hard      | 1.0  | 0.2022       | **+52.00%** | 1         | WIN      |
| atlas-p3 | codex  | mcp_only      | soft      | 1.0  | 0.2257       | **+46.41%** | 1         | WIN      |
| atlas-p3 | codex  | mcp_optimizer | hard      | 1.0  | 0.2940       | **+30.19%** | 1         | WIN      |
| atlas-p3 | codex  | mcp_optimizer | soft      | 1.0  | 0.2905       | **+31.04%** | 1         | WIN      |
| nova-p2  | claude | raw           | —         | 1.0  | 0.2321       | —           | 0         | BASELINE |
| nova-p2  | claude | mcp_only      | hard      | 1.0  | 0.2661       | -14.68%     | 1         | LOSS     |
| nova-p2  | claude | mcp_only      | soft      | 1.0  | 0.2898       | -24.88%     | 1         | LOSS     |
| nova-p2  | claude | mcp_optimizer | hard      | 1.0  | 0.3072       | -32.37%     | 1         | LOSS     |
| nova-p2  | claude | mcp_optimizer | soft      | 1.0  | 0.3227       | -39.07%     | 1         | LOSS     |
| nova-p2  | codex  | raw           | —         | 1.0  | 0.4001       | —           | 0         | BASELINE |
| nova-p2  | codex  | mcp_only      | hard      | 1.0  | 0.2672       | **+33.22%** | 1         | WIN      |
| nova-p2  | codex  | mcp_only      | soft      | 1.0  | 0.2609       | **+34.80%** | 1         | WIN      |
| nova-p2  | codex  | mcp_optimizer | hard      | 1.0  | 0.3043       | **+23.96%** | 1         | WIN      |
| nova-p2  | codex  | mcp_optimizer | soft      | 1.0  | 0.2333       | **+41.68%** | 1         | WIN      |
| nova-p3  | claude | raw           | —         | 1.0  | 0.2747       | —           | 0         | BASELINE |
| nova-p3  | claude | mcp_only      | hard      | 1.0  | 0.2824       | -2.80%      | 1         | LOSS     |
| nova-p3  | claude | mcp_only      | soft      | 1.0  | 0.2859       | -4.06%      | 1         | LOSS     |
| nova-p3  | claude | mcp_optimizer | hard      | 1.0  | 0.3085       | -12.30%     | 1         | LOSS     |
| nova-p3  | claude | mcp_optimizer | soft      | 1.0  | 0.3276       | -19.24%     | 1         | LOSS     |
| nova-p3  | codex  | raw           | —         | 1.0  | 0.3328       | —           | 0         | BASELINE |
| nova-p3  | codex  | mcp_only      | hard      | 1.0  | 0.2669       | **+19.79%** | 1         | WIN      |
| nova-p3  | codex  | mcp_only      | soft      | 1.0  | 0.2975       | **+10.59%** | 1         | WIN      |
| nova-p3  | codex  | mcp_optimizer | hard      | 1.0  | 0.2745       | **+17.51%** | 1         | WIN      |
| nova-p3  | codex  | mcp_optimizer | soft      | 1.0  | 0.3059       | **+8.08%**  | 1         | WIN      |
| orbit-p2 | claude | raw           | —         | 1.0  | 0.4034       | —           | 0         | BASELINE |
| orbit-p2 | claude | mcp_only      | hard      | 1.0  | 0.6020       | -49.23%     | 1         | LOSS     |
| orbit-p2 | claude | mcp_only      | soft      | 1.0  | 0.5330       | -32.11%     | 1         | LOSS     |
| orbit-p2 | claude | mcp_optimizer | hard      | 1.0  | 0.4024       | **+0.25%**  | 1         | WIN      |
| orbit-p2 | claude | mcp_optimizer | soft      | 1.0  | 0.4705       | -16.63%     | 1         | LOSS     |
| orbit-p2 | codex  | raw           | —         | 1.0  | 0.2553       | —           | 0         | BASELINE |
| orbit-p2 | codex  | mcp_only      | hard      | 1.0  | 0.3208       | -25.68%     | 1         | LOSS     |
| orbit-p2 | codex  | mcp_only      | soft      | 1.0  | 0.3568       | -39.79%     | 1         | LOSS     |
| orbit-p2 | codex  | mcp_optimizer | hard      | 1.0  | 0.3195       | -25.16%     | 1         | LOSS     |
| orbit-p2 | codex  | mcp_optimizer | soft      | 1.0  | 0.2995       | -17.33%     | 1         | LOSS     |
| orbit-p3 | claude | raw           | —         | 1.0  | 0.3392       | —           | 0         | BASELINE |
| orbit-p3 | claude | mcp_only      | hard      | 1.0  | 0.4819       | -42.08%     | 1         | LOSS     |
| orbit-p3 | claude | mcp_only      | soft      | 1.0  | 0.4980       | -46.82%     | 1         | LOSS     |
| orbit-p3 | claude | mcp_optimizer | hard      | 1.0  | 0.4275       | -26.06%     | 1         | LOSS     |
| orbit-p3 | claude | mcp_optimizer | soft      | 1.0  | 0.5988       | -76.55%     | 1         | LOSS     |
| orbit-p3 | codex  | raw           | —         | 1.0  | 0.4790       | —           | 0         | BASELINE |
| orbit-p3 | codex  | mcp_only      | hard      | 1.0  | 0.3506       | **+26.81%** | 1         | WIN      |
| orbit-p3 | codex  | mcp_only      | soft      | 1.0  | 0.4036       | **+15.75%** | 1         | WIN      |
| orbit-p3 | codex  | mcp_optimizer | hard      | 1.0  | 0.2884       | **+39.79%** | 1         | WIN      |
| orbit-p3 | codex  | mcp_optimizer | soft      | 1.0  | 0.3371       | **+29.62%** | 1         | WIN      |


### Summary Statistics

- Total runs: 60 (6 tasks × 5 variants × 2 agents)
- 100% pass rate: every run fixed the bug (correctness is confirmed)
- **Codex wins: 20/24 non-raw cells (83.3%)**
- **Claude wins: 4/24 non-raw cells (16.7%)**
- Best single saving: atlas-p3/codex/mcp_only/hard = **52.00%** saving
- Worst single loss: orbit-p3/claude/mcp_optimizer/soft = **76.55%** cost increase
- Average Codex saving across wins: **~28%**
- Average Claude loss across non-wins: **~28%**

### What the MCP Call Count Proves

Every MCP cell shows `mcp_calls_median = 1.0`. Zero cells show `mcp_calls = 0` for MCP variants. This is important: in mcp-shi's original benchmark, some cells had the MCP configured but zero actual calls — the agent loaded the MCP config but never used the tools. PRMPT's hardened instruction ("Call `mcp__prompt__prmpt_optimize_task` first") plus the tool description engineering ("FINAL AUTHORITATIVE ROUTE") worked perfectly. Every agent that had the MCP available actually used it.

---

## PART 12 — Decision Log

Every major architectural decision: what options existed, what was chosen, and the full reasoning.

**1. Why Electron over native app**

Options: Swift (macOS only), C++ + Win32 (Windows only or complex cross-platform), Flutter (still maturing for desktop), Tauri (lightweight but smaller ecosystem), Electron.

Chosen: Electron.

Reasons: The team had strong React/TypeScript skills. Building a cross-platform desktop app with Swift required macOS-only development; building with C++ required a separate Windows and macOS codebase. Electron provided a single codebase for both platforms. The tradeoffs (memory overhead, binary size) are real but acceptable for a background tool used by developers — developers understand that "it uses RAM" is not a fatal objection.

**2. Why Rust for the keyboard hook and text injection**

Options: Python + ctypes (worked on Windows, fragile on macOS), Node.js native addons in C++ (memory safety concerns), Go (no good N-API ecosystem), Rust via napi-rs.

Chosen: Rust via napi-rs.

Reasons: Text injection must be instantaneous (<50ms). Python with ctypes introduced GC-induced latency on macOS during heavy workloads. C++ had no memory safety guarantees — a crash in the keyboard hook could kill the entire PRMPT process. Rust's ownership model prevents use-after-free and data races at compile time. The N-API binding is stable and well-documented.

**3. Why @prompt trigger not a global hotkey**

Options: Ctrl+Shift+P (or similar), system tray click, @prompt passive detection.

Chosen: @prompt passive detection.

Reasons: Global hotkeys (registered via `RegisterHotKey` on Windows, `CGEventTap` on macOS) conflict with other applications. VS Code uses Ctrl+Shift+P for the command palette; Slack uses various Ctrl+Shift combinations for formatting. Any hotkey PRMPT chose would conflict with some common developer tool. @prompt is passive: it fires only when the user deliberately types that specific sequence, in any app, without occupying any hotkey combination.

**4. Why Python for the optimizer service**

Options: Node.js with AI SDK libraries, Go, Rust (too slow for prototyping), Python.

Chosen: Python.

Reasons: LiteLLM, Hugging Face transformers, ONNX Runtime, faster-whisper (speech recognition), Silero VAD (voice activity detection) — the entire AI tooling ecosystem is Python-first. Node.js AI libraries are significantly less mature. The team had strong Python experience. Iteration speed in Python is significantly higher than in compiled languages, which matters when the optimizer's system prompts and pipeline logic change frequently.

**5. Why LiteLLM → OpenRouter not direct API calls**

Options: Anthropic SDK directly, OpenAI SDK directly, LiteLLM → providers directly (no aggregator), LiteLLM → OpenRouter.

Chosen: LiteLLM → OpenRouter.

Reasons: With direct API calls, switching from Claude Haiku to GPT-4o-mini requires changing authentication, request format, response parsing, error handling, and retry logic. LiteLLM normalizes all of this. OpenRouter adds: single API key for all models, cumulative usage tracking (critical for benchmark cost measurement), volume discounts, fallback routing.

**6. Why two separate Python services**

Options: Single monolithic FastAPI app serving both optimization and code intelligence, separate services.

Chosen: Separate services.

Reasons: The code intelligence service takes 3–5 seconds to warm up (loading the ONNX model into memory). If it's combined with the optimizer service, a code intelligence restart takes down prompt optimization for 5 seconds. The optimizer should always be available — it's the core product feature. The code intelligence service has different memory requirements (keeps ONNX model in memory), different restart needs, and different scaling characteristics (more I/O-heavy). Separate services isolate failures and allow independent restarts.

**7. Why local ONNX embeddings not OpenAI API embeddings**

Options: OpenAI `text-embedding-3-small` ($0.00002/1k tokens), OpenAI `text-embedding-3-large` ($0.00013/1k tokens), Cohere embeddings, local `bge-small-en-v1.5` via ONNX.

Chosen: Local `bge-small-en-v1.5` via ONNX.

Reasons: Privacy (source code should not be sent to any third-party embedding service — enterprise non-starter), cost (5,000-10,000 chunks × $0.00002 = $0.10-0.20 per index × multiple developers re-indexing = real cost creep), latency (50ms local vs 150-400ms API round trip), offline operation (developers frequently work without internet). The quality tradeoff (384-dim local vs 1536-dim OpenAI) is acceptable for code retrieval — benchmarks show bge-small performs well on code tasks.

**8. Why SQLite not Supabase for code intelligence**

Options: PostgreSQL + pgvector on Supabase (remote), SQLite local, DuckDB (analytical but not designed for embedded use in an app).

Chosen: SQLite local.

Reasons: Already covered in Part 3. The three killers: (1) 2ms local vs 150ms Supabase query latency for embedding lookups, (2) source code privacy, (3) offline operation. Supabase is still used for user auth, chat history, and settings — things that must be cross-device. Code intelligence is inherently local (you're working on a local codebase).

**9. Why Graph RAG over pure vector search**

Options: Vector-only (embed everything, find most similar), keyword-only (FTS5), hybrid vector + keyword (no graph), graph-augmented hybrid.

Chosen: Graph-augmented hybrid.

Reasons: Pure vector search finds semantically similar chunks but misses structurally important ones. A utility function used by 30 modules has a mundane docstring — vector search buries it. Call-graph + PageRank surfaces it as a high-centrality node. The graph is most valuable for FIND mode (finding a specific file that's architecturally central) and BUG mode (following call edges to find what else is affected by a suspected bug location).

**10. Why MCP plugin not a VS Code extension**

Options: VS Code extension (most IDE users), JetBrains plugin (IntelliJ users), CLI wrapper (intercepts all CLI agent calls), MCP server (plugs into any MCP-compatible agent).

Chosen: MCP server (primary), keyboard hook (secondary).

Reasons: MCP is agent-agnostic. A VS Code extension only helps VS Code users. Claude Code and Codex users may be in any terminal. The MCP standard is being adopted widely — Claude Code, Codex, OpenCode, Cursor all support MCP. Building an MCP server means one integration that works everywhere. The keyboard hook is the ergonomic delivery mechanism (in-app trigger); the MCP is the integration mechanism (agent-time routing).

**11. Why precomputed MCP for the first benchmark**

Options: Live retrieval (call code intelligence during the benchmark run), precomputed (prepare answers before the run starts).

Chosen: Precomputed.

Reasons: Scientific methodology. The first experiment tests one variable: "does routing help?" Using precomputed answers controls routing quality — it's the same for all cells that use MCP. If live retrieval were used, each cell would have different routing quality depending on the retrieval run — conflating two variables (routing value AND retrieval quality). Once routing value is confirmed, add live retrieval as the next variable.

**12. Why soft AND hard hardening**

Options: Only hard hardening (block native search), only soft hardening (allow all native tools), both.

Chosen: Both.

Reasons: If PRMPT only shows savings under hard hardening (when native search is blocked), the product has a deployment problem. Operators have to explicitly deny Glob/Grep in their agent config — that's friction and a behavior change for users. The soft result shows whether agents organically choose PRMPT over their native tools when given both options. An organic preference (agent uses MCP over Grep when both are available) is stronger evidence of product value than a forced preference.

**13. Why Codex over Claude as the primary savings target**

This emerged from data, not a pre-decision. The 60-run benchmark showed Codex saves 20–52% with PRMPT; Claude mostly loses. The strategic consequence: position PRMPT as a Codex optimizer for the token savings story; develop a separate rate-limit throughput story for Claude subscribers. The team didn't choose Codex in advance — the data pointed there.

**14. Why seeded bugs not real bugs for the benchmark**

Options: Use real open-source bugs (from GitHub Issues), ask developers to report real bugs they've seen, generate synthetic bugs.

Chosen: Generated/seeded synthetic bugs in generated codebases.

Reasons: Real bugs are ambiguous. "Is this actually a bug or a design decision?" requires human judgment. Human judgment introduces scorer bias. The test suite oracle (`npm test`) is objective — the code either passes or it doesn't, independent of human judgment. Seeded bugs have known fixes and known test coverage. The tradeoff: synthetic bugs may not represent the full distribution of real bugs (they're likely biased toward well-defined logic errors rather than ambiguous design issues). The 6-user pilot study addresses this.

---

*End of PRMPT Deep Dive. See `[ARCHITECTURE.md](./ARCHITECTURE.md)` for all Mermaid diagrams. See `[TIMELINE.md](./TIMELINE.md)` for the full commit history story. See `[BENCHMARK_RESULTS.md](./BENCHMARK_RESULTS.md)` for the complete benchmark analysis. See `[SIMPLE.md](./SIMPLE.md)` for the plain-language version.*