# PRMPT Product Timeline

> The story of PRMPT from the first line of code (January 12, 2026) to the first real benchmark run (June 12, 2026) — told through the git commit history. Every era explains what was built, what problem it solved, what external factor drove the decision, and who built it.

---

## Reading This Document

The git log contains ~500 commits across 5 months. This document groups them into meaningful eras and explains each one as a product decision, not just a code change. The "Why now?" column answers the question that most technical timelines skip: what made this the right thing to build at this moment.

**Team:**

- **Prabhat** — lead developer, Electron/React, product architecture, Supabase, deployment
- **Aarush** — Python services, pipeline engineering, LiteLLM integration, FastAPI
- **Nihal** — code intelligence service, benchmarks, macOS contributions, test infrastructure

---

## Era 1 — Zero to One (Jan 12–26, 2026)

### What was happening in the world

January 2026 was peak excitement about AI coding tools. Claude 3.5 Sonnet had just been updated to claude-3-5-sonnet-20241022. Cursor had crossed 1 million users. GitHub Copilot was seeing massive enterprise adoption. The dominant narrative: AI will write most code within 2 years.

The counternarrative, which PRMPT was built on: these tools are powerful but expensive and wasteful when used with vague prompts. The opportunity is not to build another coding agent — it's to make the existing ones better.

### What was built

**First commit (Jan 12)** — `feat: first commit` — project scaffolding. Electron app with React, Python FastAPI service, basic IPC between them. No keyboard hook, no overlay, no streaming. Just: can we call an LLM and get back a better prompt?

**Jan 14–20** — Core optimization pipeline taking shape. The first LiteLLM integration. Early system prompts being written and tested. The critical question being answered: does LLM-based prompt rewriting actually produce better results?

**Jan 22** — `"Optimization works, Basic App Built"` — the milestone commit. The pipeline is working. A user can type a vague prompt in the Electron UI, click a button, and get back a more precise version. The UX is crude — no streaming, no overlay, no @prompt trigger — but the core value proposition is proven.

**Jan 26** — `"code starts getting organized"` — first refactoring pass. The initial prototype was a single large file; this commit begins separating concerns.

### Why this mattered

Most startups build the UX before proving the core value. PRMPT did it backwards: build the LLM pipeline, prove it works, then build the delivery mechanism. The Jan 22 commit is the proof-of-concept moment. Everything after this was product delivery, not discovery.

---

## Era 2 — Streaming and Real-Time UX (Feb 5–9, 2026)

### What was happening in the world

OpenAI had just released streaming improvements to their API. ChatGPT's "words appearing as they're generated" UX had set user expectations: AI responses should feel instant. Any tool that makes you wait 3–5 seconds for a full response before showing anything felt broken compared to the streaming standard.

### What was built

**Feb 5** — Streaming optimization. Instead of waiting for the full optimized prompt, tokens stream back from the Python service to the Electron UI as they're generated. The Python side used FastAPI's WebSocket support. The Electron side handled WebSocket messages from the main process and forwarded them to the renderer via IPC chunks.

**Feb 7–9** — Phase 4 IPC refactor. The IPC layer between Electron main and renderer was rebuilt to handle streaming events properly. The old architecture assumed single request → single response. Streaming required: open request → multiple chunk events → close event. The IPC channels were restructured accordingly.

### Why this mattered

Perceived latency is a product metric as important as actual latency. A 4-second streaming response feels faster than a 3-second non-streaming response because the user sees progress starting at ~400ms. The streaming refactor didn't change the total optimization time — it changed how that time felt to the user.

**The IPC architecture established in this era is still in use.** The `overlay:stream-chunk` pattern (main process forwards WebSocket frames one at a time to the renderer) became the foundation for all subsequent streaming features.

---

## Era 3 — Pipeline v2: From Monolith to Stages (Mar 6, 2026)

### What was happening in the world

By March 2026, LLM application developers had learned the hard way that monolithic "one big prompt" pipelines don't scale. The pattern emerging across the industry: **multi-step pipelines** where each step has a single, clear responsibility. LangChain (despite its complexity) had popularized the concept of chained LLM calls. The PRMPT team's insight: instead of one large LLM call that does everything, separate the concerns.

### What was built

The entire Python optimizer service was rewritten from scratch. The key commits:

- `"v2 of the whole pipeline"` — the new architecture with 7 distinct stages
- Decision Taker, Skill Selector, Context Summarizer, Prompt Optimizer, Clarifier, Task Planner, Memory Extraction — each as a separate module with a clear interface
- Skill files as domain-specific Markdown documents. The first 8 skill files: technical, creative, business, communication, educational, visual, automation, research
- `"standalone pipeline working"` — the new pipeline running end-to-end
- `"CLI added"` — a command-line interface to the pipeline for testing without the full Electron app

### Why this mattered

**The Decision Taker (DT) was the most important new component.** It classified whether a user was starting fresh (NEW), improving a previous output (REFINEMENT), or adding to an existing prompt (ADDITION). This classification changed how conversation history was handled — REFINEMENT needed access to the previous output, NEW needed to start clean. Without the DT, every optimization treated every request the same way.

**Skill files introduced domain-specific optimization.** "Fix the Stripe webhook validation bug" and "Write a product launch announcement" need different optimization heuristics. The skill system allowed PRMPT to apply domain-specific rules without retraining the model — the skill file is simply appended to the system prompt for the relevant domain.

---

## Era 4 — Security and Authentication (Mar 28, 2026)

### What was happening in the world

Security was becoming a real concern for AI developer tools. Several prominent developer tools had been caught sending more data than they disclosed. The regulatory environment was tightening. For PRMPT — which runs on developers' machines and has access to their prompts — auth and security weren't optional.

### What was built

**JWT authentication on all Python service endpoints.** Every request to `:8001` and `:8002` requires a valid JWT signed by the Electron app. The Electron app issues tokens at startup and refreshes them automatically.

**Dev auth fallback.** `DEV_AUTH_BYPASS=true` environment variable allows the CLI and benchmark scripts to call the Python services without a full Electron session. Without this, running benchmarks would have required launching the full Electron app — impossible in a headless CI environment.

**Security hardening in Electron.** Password reset flow moved OTP secrets to the Python backend (removed from the packaged Electron app). Rate limiting on auth endpoints. RLS (Row Level Security) policies in Supabase audited and fixed.

### Why this mattered

The dev auth fallback turned out to be critical for benchmarking. The benchmark harness (built two months later) needed to call the optimizer service headlessly. Without the `DEV_AUTH_BYPASS`, the benchmark would have been impossible. Sometimes security work accidentally enables future architecture — the fallback auth mechanism became the bridge between the desktop app and the CLI/benchmark world.

---

## Era 5 — macOS Port (Apr 10–17, 2026)

### What was happening in the world

Developer tooling statistics consistently show ~50–60% of professional software developers use macOS as their primary machine (Stack Overflow Developer Survey data). Claude Code was released for both platforms simultaneously. Cursor was originally Mac-first. Being Windows-only was an existential product limitation.

The specific technical challenge: Apple's security model (System Integrity Protection, Hardened Runtime, Gatekeeper, code signing requirements) makes keyboard hooks and text injection significantly harder on macOS than on Windows. Several competing tools had launched Mac versions and then quietly abandoned them after running into these restrictions.

### What was built

Twenty-plus commits over eight days, the most intensive development sprint of the entire project.

**April 10 — Planning and research.** Which APIs are available? What restrictions apply? The macOS accessibility API model is fundamentally different from Windows' WH_KEYBOARD_LL model.

**April 15–16 — Native Rust additions for macOS:**

- `feat(native): add macOS dispatch for all exports` — the Rust module now compiles different code for Windows vs macOS via conditional compilation
- `feat(native): add macOS CGEventTap keyboard hook with NSWorkspace PID caching` — the macOS keyboard hook implementation
- `feat(native): add macOS text replacement via CGEventPost backspace and Cmd+V clipboard paste` — the macOS text injection strategy
- `feat(native): add macOS dependencies to Cargo.toml` — `core-graphics`, `core-foundation`, `cocoa`, `objc` crates added

**April 17 — The big day (15+ commits):**

- Electron platform-aware code for overlay (different window behavior on macOS vs Windows)
- macOS Accessibility permission check and guided prompt on startup
- macOS dock icon, menu bar template images, `titleBarStyle: hiddenInset`
- Silent auto-launch at login for macOS
- Icon and branding for macOS (`.icns` format)
- macOS entitlements plist for hardened runtime
- New native binary: `darwin-arm64` (Apple Silicon)

**May 8 — NSPasteboard race condition fix:** `replace pbcopy/pbpaste with direct NSPasteboard API to fix clipboard race condition on macOS` — a subtle timing bug where the clipboard was being read before the write had flushed to the system clipboard. The fix: use the NSPasteboard Objective-C API directly from Rust via the `objc` crate instead of spawning shell processes.

### Why this mattered

The macOS port unlocked half the addressable market overnight. But beyond the numbers, the macOS port forced the architecture to be truly cross-platform. The Rust module's conditional compilation pattern (same API, different implementation per platform) became the template for future platform-specific code.

**The Accessibility permission UX** was a product insight as much as a technical challenge. macOS's privacy model requires user consent for keyboard monitoring. PRMPT designed a first-run onboarding flow that explained why the permission was needed, took the user directly to System Settings, and confirmed when the permission was granted. This turned a potential friction point into a trust-building moment.

---

## Era 6 — v1.0 Release (Apr 13, 2026)

### What was happening in the world

The AI coding tool market was consolidating. Cursor had raised a major funding round. GitHub Copilot was being integrated into more enterprise environments. The window for launching a new tool in this space was narrowing — but also, the problem of AI spend management was growing. Teams were starting to notice their monthly AI bills.

### What was built

**Apr 10 — `Bump version to 1.0.0 and switch auto-updater to Supabase Storage`** — the milestone commit.

**Also in this era:**

- Supabase integration for user auth, chat history, prompt library, settings, analytics
- Download tracking via Supabase Edge Function (measuring adoption)
- Sentry error tracking (main process + renderer + Python services)
- Analytics service (session counts, feature usage — privacy-preserving, anonymized)
- Password security improvements (OTP flow, rate limiting, GDPR account deletion)
- Download tracking endpoint — counts how many times each version is downloaded

**Apr 13 — `bump version to 1.0.1`** — first patch release, one day after v1.0.

### Why this mattered

Version 1.0 isn't just a number — it's a commitment. Before v1.0, the team could change anything without consequence. After v1.0, real users are depending on the product. The Sentry integration meant bugs reported by users would be visible immediately, not just when the user emailed in. The download tracking meant the team would know if the v1.0 announcement actually drove adoption.

**The Supabase choice** was made at this point. Supabase provided auth, database, storage, and Edge Functions in one service with a generous free tier. The alternative (self-hosted Postgres + custom auth) would have taken weeks to build and maintain. Supabase let the team ship v1.0 with production-grade auth in hours.

---

## Era 7 — Spaces: The Pivot to Code Context (Apr 19–20, 2026)

### What was happening in the world

The realization that changed the product: prompt optimization in isolation is only half the story. An optimized prompt that says "there's a bug in the authentication middleware" is better than "fix the auth bug" — but an optimized prompt that says "the bug is in `middleware/validate.ts` line 47, the token expiry check compares unix timestamps incorrectly" is orders of magnitude better. The second prompt requires knowing what's actually in the codebase.

Competitors at this point: Cursor had codebase indexing built in to its IDE. Serena (being developed by an open-source community) was adding LSP-based code navigation to MCP. The opportunity: build codebase-aware optimization that isn't tied to an IDE.

### What was built

**Apr 19 — `feat(spaces): redesign UI, fix watcher reliability, and harden indexing lifecycle`** — the major architectural commit.

What shipped in this era:

- Spaces UI in the main app (add project folder, name it, see indexing status, manage multiple spaces)
- `spaces-bridge-handlers.ts` — Electron-side handlers for the Space lifecycle (ingest → index → update)
- Chokidar file watcher — watches the project folder for changes, triggers re-indexing of changed files
- Tree-sitter WASM integration — parses project files in the Electron main process
- Overlay integration — the overlay shows the active Space's status and uses it during optimization
- Context leaking fixes — multiple bugs where context from one Space bled into another session

**Apr 20 — `changes overlay design for spaces`** — UI updates to expose Space status in the overlay.

### Why this mattered

**The `[PROBABLE LOCATIONS]` format was established in this era.** The structured block injected into the optimizer's context (`PRIMARY:` files, `SECONDARY:` files, with line ranges) became the canonical way PRMPT communicated code routing to downstream agents. This format is still used in the MCP server's responses today.

The Spaces architecture introduced a dependency between the overlay and the code intelligence service. Before Spaces, the overlay was self-contained. After Spaces, every optimization potentially required a code intelligence retrieval call. This made the system more powerful and more complex simultaneously.

---

## Era 8 — v1.2 and v1.3: Usability Pass (Apr 30 – May 13, 2026)

### What was happening in the world

The team had real users for the first time. User feedback was coming in. The gap between "it works" and "it's a real product" was becoming visible. Typical early user complaints: "Why doesn't it start automatically?" "The clarification UI is hard to use." "macOS keeps asking for permissions again after updates."

### What was built

**Apr 30 — `chore: bump version to 1.2.0`** — the v1.2 release.

Key features:

- **Auto-launch at login** (`feat(startup): add silent auto-launch at login for macOS and Windows`) — PRMPT now starts with the computer. No more "I forgot to launch PRMPT." This was the most-requested feature from early users.
- **Skills picker** — UI for selecting 1–2 domain skills explicitly. Previously the skill was selected automatically by keyword; now users could override it.
- **Clarification card redesign** — single-card stepper with arrow key navigation, replacing the multi-question list. "Just one question at a time" made the clarification flow feel less interrogative.
- **Sentry on 30 more error paths** — expanded error tracking to cover paths previously invisible in production

**May 9 — `bump version to 1.3.0`**

**May 12 — `fix mac overlay, accessibility check, bump to 1.3.1`**

**May 13 — `Bump version to 1.3.2 and disable hardenedRuntime for macOS ad-hoc builds`** — ad-hoc signing (signing without a developer certificate, for distribution outside the App Store) had broken with hardenedRuntime enabled. Disabling it for ad-hoc builds allowed the macOS version to work on end-user machines without requiring Keychain prompts.

### Why this mattered

Three rapid patch versions (1.3.0 → 1.3.1 → 1.3.2) in two weeks is a sign of early user adoption. Real users find real edge cases. The macOS ad-hoc signing issue (1.3.2) only manifested on machines running certain macOS security configurations — configurations that don't appear in development environments. Getting this fixed quickly preserved trust with early Mac users.

**The auto-launch feature** changed the usage pattern. Before auto-launch, PRMPT was a tool you had to remember to start. After auto-launch, it became a background service that was always there — changing the mental model from "I have to use this" to "it's always available."

---

## Era 9 — Graph RAG: The Intelligence Upgrade (May 15–19, 2026)

### What was happening in the world

By May 2026, the broader AI/ML community had published extensive research on "Graph RAG" — using graph structure to augment retrieval-augmented generation. Microsoft's GraphRAG paper was widely discussed. The insight: in many domains (code, knowledge graphs, organizational hierarchies), relationships between items matter as much as the items themselves.

In code specifically, the problem was clear: vector search finds "what looks like this." But code needs "what's connected to this" and "what's important in this graph." A function used by 30 other functions is architecturally important regardless of what its docstring says.

### What was built

**May 15 — `damm son major changes in architecture`** — the major architectural overhaul commit (with the characteristically understated commit message). This introduced the graph-based code intelligence design.

**May 19 — `implemented graph rag system`** — the full implementation landed.

What changed:

- `graph_builder.py` written: igraph graph construction from Tree-sitter call edges, Leiden community detection, PageRank computation
- Spaces UI redesigned to show the new modes (FIND / ASK / BUG / OPTIMIZE)
- Mode-switching UI (`/` + tab in the Spaces interface)
- 40% threshold for FIND mode chunk relevance (below this score, chunks are excluded regardless of ranking)
- Graph-primary ranking for FIND mode: PageRank centrality as a primary signal, not a secondary booster

**May 15–17 (overlapping with graph work):**

- Stream resume for Spaces (mid-stream resume if the WebSocket dropped)
- Cancellable scan signals (stop an in-progress indexing if the user deletes the Space)
- Zombie scan prevention (guard against duplicate indexing runs)
- Active scan tracking across restarts

### Why this mattered

The graph RAG overhaul was not a feature — it was a fundamental change in how code intelligence worked. Before: "find chunks similar to the query." After: "find chunks that are both similar to the query AND structurally important in the codebase."

**The Leiden community detection** produced something new: community reports. LLM-generated summaries of each code cluster. These reports made ASK mode qualitatively better — instead of returning chunks that mentioned the query terms, ASK mode could orient the user with a high-level overview of the relevant part of the codebase before diving into specific functions.

---

## Era 10 — Local Code Intelligence: The Privacy and Performance Overhaul (May 20 – Jun 2, 2026)

### What was happening in the world

Two forces converged in May 2026:

1. **Enterprise developer tools** were increasingly requiring on-premise or local deployment. GitHub had Copilot for Business with enterprise data controls. Customers were asking "where does my code go?" for every AI tool.
2. **Vector database** options had proliferated (Pinecone, Weaviate, Qdrant, pgvector, ChromaDB) but all required either cloud infrastructure or complex self-hosting. For a desktop app, running a vector database felt like massive overkill.

The team's conclusion: the right architecture for a desktop app is local-first storage with zero cloud dependency for code intelligence.

### What was built

Thirty-plus commits in 13 days — the highest-density development period of the entire project.

**May 20 — `Add local code-intel SQLite backend`** — the move from Supabase/PostgreSQL to local SQLite for code intelligence.

**May 20 — `Add local code-intel index schema`** — the SQLite schema: chunks, embeddings, FTS5 tables, graph edges, communities, pagerank scores, file hashes, retrieval logs.

**May 29 — `fix: stable chunk IDs and move edge processing before graph pipeline`** — a critical bug fix: chunk IDs were being regenerated on each indexing run, breaking the graph's edge references. Stable chunk IDs (based on file path + function name hash, not an auto-increment) fixed this.

**Jun 2 — The big batch (20+ commits in one day):**

- `feat(code-intel): switch to local bge-small-en-v1.5 with ONNX sub-batching` — moved from API embeddings to local ONNX model
- `perf(code-intel): local bge-reranker cross-encoder behind RERANKER_BACKEND flag` — local re-ranking model
- `feat(code-intel): add bounded agentic multi-hop retrieval loop` — `agent_loop.py` added
- `feat(code-intel): add graph-health endpoint and local store helpers for agentic symbol traversal` — the six tools the agentic loop uses
- `feat(code-intel): graph-primary Find ranking with percentile-norm PageRank, definition boost, test-file demotion` — FIND mode scoring overhaul
- `feat(code-intel): IDF Find ranking, score-aware per-file cap, universal tail gate, test down-weight` — FIND mode precision improvements
- `feat(code-intel): stream Ask answers token-by-token via SSE` — streaming for ASK mode
- `feat(code-intel): Find planner with constraint lanes, score-spread ranking` — multi-constraint FIND mode
- `refactor(code-intel): single StorageBackend switch instead of per-function Supabase overrides` — clean architecture: one storage backend flag instead of per-function conditionals
- `chore(code-intel): comment out dormant Supabase chunk/graph paths (Phase 1 local)` — explicitly marking the Supabase paths as deferred (Phase 2)
- `fix(code-intel): local ONNX embedding backend behind EMBEDDING_BACKEND flag` — configuration flag to switch between local ONNX and API embeddings
- `perf(code-intel): LRU cache query embeddings + warm community/PageRank on project open` — performance: cache frequently-used query embeddings, pre-warm the graph data on startup
- `fix(code-intel): retry batch summaries on JSON failure + keyword-concept fallback` — robustness improvements

**Jun 2 — "fix: show active embed model in startup log, strip optimizer meta-preamble leaks, add project cleanup script"** — the final cleanup commit of this era.

### Why this mattered

**The local ONNX switch was a product-defining decision.** It answered the privacy question definitively: source code never leaves the machine. No API call is made with code content. The model runs in-process. This is the answer to any enterprise user who asks "where does my code go?" — it goes nowhere.

**The agentic loop (`agent_loop.py`) was the forward-looking bet.** The team knew that one-shot retrieval had a ceiling — if the first query doesn't find the right files, there's no recovery. The multi-hop loop could follow call-graph edges, consider error signals from failed runs, and escalate its search scope on retry. This loop was the technical foundation for fixing the determinism problem. It was added in anticipation of the benchmark revealing exactly the problem it was designed to solve.

---

## Era 11 — Benchmarks: Proof by Numbers (Jun 8–12, 2026)

### What was happening in the world

By June 2026, the AI developer tool market had matured enough that "we think it saves tokens" was insufficient evidence for adoption or investment. Cursor had published benchmark comparisons. Anthropic published pricing examples. GitHub Copilot published developer productivity studies. Data was becoming table stakes.

The PRMPT team needed their own numbers — real, reproducible, honest.

### What was built

**Jun 8 — `benchmark stuff`** — the initial benchmark work landed. This was the first attempt at a controlled experiment.

**Jun 8–9 — The friend's benchmark (mcp-shi):**
Nihal pushed `mcp-shi` — a complete benchmark package: three 100k-line JavaScript repos with seeded bugs, a working MCP server (`prompt_mcp_server.py`), and the initial benchmark harness (`run_mcp_benchmark.py`, `run_benchmark.py`). This was real data from real runs, not estimates.

**Jun 9 — `Document Prompt MCP benchmark findings`** — capturing Nihal's early results and analysis. The main finding at this point: "without `--allowedTools` restricting Glob/Grep, Claude + Prompt MCP costs more than raw Claude." This was the honest observation that became the starting point for the harder, more rigorous benchmark design.

**Jun 11 — Multiple major commits:**

- `Add automated benchmark environment` — the full benchmark harness: runner, metrics, adapters, reporting
- `Add OpenRouter usage-delta cost capture and passive real-user logger` — real cost measurement replaces token estimates
- `Add mcp-shi benchmark package with bundled test workspaces` — Nihal's work integrated
- `Add LLM operator runbook to benchmark guide` — documentation for running the benchmark with an LLM doing the orchestration
- `Harden downstream guidance to discourage broad repo exploration` — system prompt improvements based on benchmark findings
- `Merge prmptf (brings mcp-shi) into benchmark-environment` — merging branches
- `Add mcp-ahh central benchmark unifying mcp-shi real server with our engine` — the unified harness
- `Remove Clean MCP comparison; keep only the three raw/mcp_only/mcp_optimizer tests` — scope reduction (the "Clean MCP" comparison was removed as it introduced a variable that wasn't relevant to PRMPT's core value test)
- `Document mcp-ahh scope (routing/optimizer baseline; agentic loop deferred)` — the explicit acknowledgment that the current benchmark measures routing only

**Jun 12 — `Fix benchmark harness MCP/Codex invocation and add first sequential run results`** — the 60-run result file committed. The data was in.

**Jun 11 — `Added Agentic Loop`** — the final piece: the agentic loop fix landed in the codebase, even though the benchmark couldn't test it yet. The problem was identified; the solution existed in code; the wiring that connects them was deferred to the next phase.

### Why this mattered

**The benchmark era produced PRMPT's most important strategic finding:** PRMPT consistently saves money for Codex but mostly adds cost for Claude. This wasn't the hypothesis. The hypothesis was "PRMPT saves money for all agents." The data contradicted it.

The right response to data that contradicts your hypothesis is not to explain it away — it's to update your strategy. The team's response: Codex is the primary target for the token savings story. For Claude, the pitch shifts to rate-limit throughput. This is a more honest and more defensible position than "we save money on everything."

**The unified mcp-ahh harness** combined two separate efforts (Nihal's real MCP server + repos, and the team's rigorous measurement engine) into a single, reproducible experiment. The fact that mcp-shi's original cost measurement was based on hardcoded estimates while mcp-ahh uses real OpenRouter deltas is the difference between a prototype result and a publishable one.

---

## Branch Map

All local branches and their purpose:


| Branch                          | Purpose                               | Status                          |
| ------------------------------- | ------------------------------------- | ------------------------------- |
| `main`                          | Production-stable code                | Active                          |
| `benchmark-environment`         | Benchmark harness development         | Active (current)                |
| `improvement/code-intel`        | Code intelligence improvements        | Merged to main                  |
| `macOS`                         | macOS port                            | Merged to main                  |
| `prmptf`                        | Nihal's benchmark work (mcp-shi)      | Merged to benchmark-environment |
| `local_improvement`             | Nihal's local benchmark runs          | Archived                        |
| `Authentication`                | Auth system work                      | Merged                          |
| `UI-prompt`                     | UI prompt-specific changes            | Merged                          |
| `feature/tasks-divide-question` | Task planner + clarification          | Merged                          |
| `fixes/new_bugs`                | Bug fix batch (May 2026)              | Merged                          |
| `mac/v1.3.2-fixes`              | macOS v1.3.2 specific fixes           | Merged                          |
| `project_context`               | Code intelligence v1 (Supabase-based) | Merged then superseded          |
| `ui/animations`                 | UI animation experiments              | Merged                          |
| `app-auto-update`               | Auto-updater infrastructure           | Merged                          |
| `dashboard`                     | Dashboard feature (planned)           | In progress                     |
| `onboarding_fix`                | Onboarding flow fixes                 | Merged                          |
| `localcase`                     | Local storage case work               | Merged                          |
| `toMac`                         | Initial macOS investigation           | Merged into macOS branch        |
| `upgrade-electron`              | Electron version upgrade              | Merged                          |


---

## Version History


| Version     | Date         | Key Changes                                                                        |
| ----------- | ------------ | ---------------------------------------------------------------------------------- |
| Pre-release | Jan–Apr 12   | Development builds; no versioned releases                                          |
| 1.0.0       | Apr 10, 2026 | First production release. Supabase auth, Sentry, auto-updater via Supabase Storage |
| 1.0.1       | Apr 13, 2026 | Day-1 patches. Download tracking, admin policies, session cleanup                  |
| 1.2.0       | Apr 30, 2026 | Auto-launch at login (macOS + Windows). Skills picker. Clarification redesign      |
| 1.3.0       | May 9, 2026  | Multiple Sentry fixes, skill improvements, macOS clipboard fix                     |
| 1.3.1       | May 12, 2026 | macOS overlay and Accessibility check fixes                                        |
| 1.3.2       | May 13, 2026 | Disable hardenedRuntime for macOS ad-hoc builds. SafeStorage skip on macOS         |


---

## Commit Density by Era

A rough measure of development intensity (commits per week) by era:


| Era                 | Duration              | Approx Commits | Commits/Week |
| ------------------- | --------------------- | -------------- | ------------ |
| Zero to One         | Jan 12–26 (2 wks)     | ~30            | 15/week      |
| Streaming + IPC     | Feb 5–9 (1 wk)        | ~20            | 20/week      |
| Pipeline v2         | Mar 6 (3 days)        | ~25            | ~60/week     |
| Security + Auth     | Mar 28–Apr 9 (2 wks)  | ~35            | 17/week      |
| macOS Port          | Apr 10–17 (1 wk)      | ~30            | 30/week      |
| v1.0 + post-release | Apr 10–Apr 28 (3 wks) | ~60            | 20/week      |
| Spaces birth        | Apr 19–20 (2 days)    | ~15            | 50/week      |
| v1.2/v1.3 polish    | Apr 30–May 13 (2 wks) | ~40            | 20/week      |
| Graph RAG           | May 15–19 (1 wk)      | ~25            | 25/week      |
| Local code-intel    | May 20–Jun 2 (2 wks)  | ~35            | 17/week      |
| **Jun 2 (one day)** | Jun 2                 | **~20**        | **140/week** |
| Benchmarks          | Jun 8–12 (5 days)     | ~20            | 28/week      |


The June 2 single-day spike (20 commits) represents the biggest single-day output in the project's history — the completion of the local code intelligence overhaul.

---

## Key External Events That Shaped Development


| Date        | External Event                                        | PRMPT Response                               |
| ----------- | ----------------------------------------------------- | -------------------------------------------- |
| Feb 2026    | Streaming UX becomes industry standard expectation    | Streaming optimization pipeline built        |
| Mar 2026    | LangChain multi-step pipeline pattern popularized     | Pipeline v2 separated into distinct stages   |
| Apr 2026    | 50%+ of developer target market on macOS confirmed    | macOS port started                           |
| Apr 2026    | Enterprise customers asking "where does my code go?"  | Local SQLite architecture planned            |
| May 2026    | GraphRAG research published widely                    | Graph-based code intelligence built          |
| May 2026    | Token cost awareness rising among power users         | Benchmark architecture designed              |
| Jun 2026    | AI coding tool benchmarks becoming standard           | mcp-ahh rigorous harness built               |
| Jun 8, 2026 | Friend's benchmark data reveals Claude vs Codex split | Strategic positioning shifted to Codex-first |


---

*The timeline ends here — at the first real benchmark results. The next chapter (live MCP, agentic loop activation, CLI fork) is being written now. See `[PRMPT_DEEP_DIVE.md Part 9](./PRMPT_DEEP_DIVE.md)` for the roadmap.*