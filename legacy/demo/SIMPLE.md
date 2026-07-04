# PRMPT — Explained Simply

> This document is written for anyone. No coding background required. Every buzzword is decoded the moment it appears. If you're a developer, it's still worth reading — it's the clearest version of what we've built and why.

---

## 1. The One Problem We Solve

Imagine you hired a contractor to fix a leaking pipe in your house. Instead of telling them "the leak is under the kitchen sink, third joint from the wall, the brass fitting is cracked," you just said "the house is broken, fix it." The contractor would spend the first three hours walking through every room with a flashlight, checking the bathroom, the basement, the attic — before they ever found the kitchen sink. Every minute of that search is money you paid for nothing.

That is exactly what happens when a developer gives a vague instruction to an AI coding tool. The developer says "fix the login bug." The AI has no idea where the login bug lives in a project with 300 files. So it reads dozens of files one by one, searching for clues, before it can even start fixing anything. All of that searching costs real money — charged per word read and per word written.

PRMPT is the thing that gives the contractor the exact address before they start. It intercepts your vague instruction, figures out which 2–3 files the bug almost certainly lives in, rewrites the instruction to include those file names, and sends the precise version to the AI. The AI skips the search and goes straight to the fix.

That's it. That's the whole product.

---

## 2. Why AI Coding Is Expensive Right Now

### What a "Token" Is

AI systems charge by the word — except they measure words in units called **tokens** (roughly one word = one token, but punctuation and code symbols count too). Every word you send to an AI costs money. Every word it sends back costs money. A typical coding session might exchange 100,000 tokens — which at current pricing (June 2026) is $0.20 to $0.60 for a single session.

### The Hidden Cost: Context Replay

Here is the part most people don't know about. AI tools don't "remember" previous messages the way a human colleague would. Every time you send a new message, the AI needs the entire conversation history resent to it from the beginning — like replaying a tape from the start every single time.

Turn 1: you send 1,000 words. Turn 5: you send 1,000 words of new message PLUS the 4,000 words of everything said before. Turn 10: 1,000 new words plus 9,000 words of history. By the end of a 15-turn session, you're resending tens of thousands of words you already paid for, just to provide context for one new question.

This **context replay** is the single biggest hidden cost in AI-assisted development today. It's not the file reading. It's not the code writing. It's the fact that every turn gets more expensive than the last, compounding the whole session.

### The Math for a Team

A 20-person engineering team where everyone uses AI coding tools daily might run 5 sessions each day. At $0.30 per session average, that's $30/day per person — $600/day for the team — $18,000/month. And that's conservative. Teams doing heavy feature work with long context sessions can run 3–5x that.

PRMPT's bet: if you fix the bug in 6 turns instead of 15, you've eliminated 9 turns of compounding context replay. That's where the real savings come from.

---

## 3. What PRMPT Actually Does — Step by Step

Let's walk through what happens the moment a developer uses PRMPT.

**Step 1: Developer writes a vague request**

The developer types: "fix the login bug" — in any app on their computer. VS Code, Slack, a web browser, anywhere. They type `@prompt` first to activate PRMPT, then type their request.

**Step 2: PRMPT's window appears**

A small floating window pops up near their cursor. It's ready to receive their request. This window is part of PRMPT — it's not tied to any particular app. It appears in front of everything on the screen, like a spotlight overlay.

**Step 3: PRMPT reads the codebase**

Before PRMPT can help with the "login bug," it needs to understand the developer's project. PRMPT has already been given access to the project folder. It has read through every file, parsed every function, and built a map of how the code connects — which functions call which other functions, which files import which other files. This map is stored locally on the developer's computer and kept up to date as files change.

**Step 4: PRMPT figures out which files matter**

When the developer says "login bug," PRMPT searches its map for anything login-related. It finds `auth/jwt.ts` (the JSON Web Token handler), `middleware/validate.ts` (the request validation layer), and `routes/auth.ts` (the login route handler). These are the 3 files most likely to contain the bug, out of 300 total files.

**Step 5: PRMPT rewrites the request**

Instead of "fix the login bug," PRMPT produces something like:

> "There is a login authentication bug. The most probable location is `auth/jwt.ts` (token expiry validation, around line 42) and `middleware/validate.ts` (request validation middleware). Check the token expiry logic — there may be an off-by-one error in the timestamp comparison. Run the auth test suite (`npm test -- --grep auth`) before and after your fix. Do not broadly search the repository."

**Step 6: Developer sends the precise version**

The developer sees the rewritten request in PRMPT's window and hits "Insert." PRMPT types it into the original app — replacing the original vague message as if the developer had typed it themselves.

**Step 7: The AI goes straight to the fix**

The AI coding tool (Claude Code, Codex, or whatever the developer uses) receives the precise version. It reads 2 files instead of 30. It patches the bug. It runs the tests. Session costs $0.18 instead of $0.45.

**The net result:** 60% of that session's cost eliminated, for the same outcome.

---

## 4. The Tech Behind It — Explained Without Code

### The Keyboard Watcher (Rust)

PRMPT runs quietly in the background on your computer. It watches what you type — but only to detect the specific trigger `@prompt`. It doesn't record or store your typing; it just watches for that exact sequence of characters in any application.

This watcher is written in a programming language called **Rust**, chosen because it's extremely fast and uses almost no memory. More importantly, it can inject text directly into any other application — meaning when you hit "Insert," PRMPT can type the optimized prompt into VS Code, Slack, Chrome, or anywhere else without you switching windows.

On Windows, it uses a system API called `WH_KEYBOARD_LL` (Low-Level Keyboard Hook) — essentially a system-approved way to watch keystrokes globally. On macOS, it uses `CGEventTap`, the equivalent macOS mechanism, which requires a one-time Accessibility permission from the user.

### The Desktop App (Electron)

The floating overlay window and the main settings app are built with **Electron** — the same technology behind VS Code, Slack, Figma, and Notion. Electron lets you build desktop applications using web technologies. The benefit: write the UI once, ship it on both Windows and macOS. The tradeoff: Electron apps use more memory than purely native apps (about 150MB at idle vs 20MB for native). For a background tool that runs all day, this is an acceptable tradeoff.

### The Optimizer (Python AI Service)

When you submit a prompt through the PRMPT overlay, it gets sent to a small local AI service running on your computer (port 8001). This service is written in Python — the dominant language for AI work — and uses a library called **LiteLLM** (a unified wrapper that can call any AI model through a single interface) to send your prompt to a smaller, cheaper AI model.

This "optimizer AI" doesn't write code or fix bugs. Its only job is to take your vague instruction and rewrite it into a precise one. Think of it as a translator that converts vague English into precise technical instructions. The optimizer is guided by a detailed set of rules that tell it: never make up file names, always reference actual files from the codebase map, never write code, always tell the downstream AI where to start.

### The Codebase Reader (Code Intelligence Service)

This is the most technically sophisticated part. A separate service (port 8002) is responsible for understanding your code.

When you add a project folder to PRMPT, this service reads every file in the project and does several things:

1. **Parses the structure** using a tool called **Tree-sitter** (an incremental parser — like a very fast reader that converts code into a structured outline, regardless of programming language). It extracts every function name, class name, method, import, and line range.
2. **Creates embeddings** (think of this as converting each code chunk into a list of 384 numbers that represent its meaning). Similar chunks — functions that do similar things — will have similar numbers. This lets the system answer "what's most similar to what the user is asking?" in milliseconds.
3. **Builds a graph** showing which functions call which other functions, which files import which other files. This graph is analyzed using an algorithm called **PageRank** (the same algorithm Google originally used to rank web pages) to figure out which files are most "central" to the project — the ones everything else depends on.
4. **Detects communities** within the graph using an algorithm called **Leiden** (a graph clustering algorithm that finds groups of tightly related functions). This helps the system understand that "the payment processing cluster" is a different part of the codebase than "the user authentication cluster."

All of this is stored locally on your computer in a database called **SQLite** — a file-based database that works entirely offline, with no data sent anywhere. Your source code never leaves your machine.

### The MCP Plugin (The Universal Connector)

**MCP** stands for **Model Context Protocol** — a standard developed by Anthropic (the company that makes Claude) that lets external tools plug into AI coding agents. Think of it as a USB standard for AI tools: if your tool speaks MCP, any AI agent that supports MCP can use it.

PRMPT implements an MCP server. When configured, AI coding tools like Claude Code or Codex can call PRMPT's MCP tools mid-session to ask "what files should I be looking at for this bug?" and receive a precise answer. This means PRMPT can guide the AI not just at the start of a session (through prompt optimization) but throughout the session (through live file routing).

---

## 5. What the Numbers Show

We ran 60 controlled tests to measure whether PRMPT actually saves money.

### How the tests worked

We used three realistic codebases — projects roughly the same size as a real startup's codebase (about 100,000 lines of code each). We seeded each codebase with real, realistic bugs. We then ran AI coding tools (Claude Code from Anthropic, and Codex CLI from OpenAI) on each bug three ways:

1. **Raw** — just send the bug description as-is, no PRMPT
2. **MCP only** — PRMPT's plugin is available, vague prompt
3. **MCP + Optimizer** — PRMPT rewrites the prompt AND provides file routing

For each variant, we also tested two conditions:

- **Soft** — PRMPT is available but the AI can still search files on its own
- **Hard** — PRMPT is the ONLY way the AI can look up files (broad search blocked)

Every test had an objective pass/fail: `npm test` — the project's automated test suite. 0 = the bug is fixed. Anything else = it isn't. All 60 tests passed; the only question was cost.

### Codex results

PRMPT saved money on **20 out of 24 Codex tests**. The biggest single saving was **52%** — a task where raw Codex spent $0.42 exploring, and PRMPT-guided Codex spent $0.20 going straight to the answer.

Average saving across winning tasks: about **18–35%** depending on the variant.

Codex benefits from PRMPT because it doesn't have sophisticated built-in context management. Without guidance, it explores broadly. With PRMPT's routing, it goes directly to the relevant files.

### Claude results

PRMPT saved money on only **4 out of 24 Claude tests** — and those 4 were modest (7–11% savings on a single task type).

This is not a bug or a failure. Claude Code is already very good at navigating code on its own. It uses aggressive caching that makes context replay much cheaper than it would otherwise be. When you add PRMPT's overhead ($0.049 per task for indexing and optimization) to a session that Claude was going to handle efficiently anyway, you're adding cost, not removing it.

The finding: PRMPT is a cost optimizer for AI tools that aren't already optimized. Right now, Codex is the clear target. As the AI market grows — and it will — there will be many more Codex-class tools: capable but not deeply optimized for context efficiency. PRMPT's value grows with that pool.

### The structural insight

Claude Code has a roughly 90% prompt-cache efficiency — it only pays full price for a small fraction of the context it re-reads. Codex does not. This structural difference explains the entire result. PRMPT doesn't change whether the bug gets fixed (all 60 did). It changes how many tokens it took to get there.

---

## 6. Who PRMPT Is For

### The Solo Developer Paying Out of Pocket

This person uses Claude or Codex via the API — paying per token. They watch $200 disappear from their account each month and can't tell exactly why. They'd pay $20/month for a tool that visibly reduced that. The challenge: they also use Claude Max ($100/month flat rate), and flat-rate users care about rate limits, not bills. PRMPT's pitch to them shifts from "save money" to "do more before hitting your monthly cap."

### The Tech Startup CTO

15 engineers, all using AI tools daily. The AI bill just crossed $8,000/month. The board noticed. The CTO can't cut the tools — productivity would drop — but needs to show the spend is justified and controlled. PRMPT becomes the layer that puts a ceiling on AI exploration waste and produces a ledger: here's what each task cost, here's what PRMPT saved, here's the monthly trend. Provable ROI from logs.

### The AI-Native Development Team

These are teams building with AI agents at the core of their workflow — not just using Copilot occasionally, but running Claude Code or Codex on hundreds of tasks per week. They've already optimized their prompts manually. They want to switch between AI models without rewriting their tool setup. PRMPT's MCP layer sits above the model choice, so swapping from Codex to the next best thing doesn't require changing anything in PRMPT.

---

## 7. What Makes PRMPT Different From Everything Else

### Cursor

Cursor is a full IDE — a replacement for VS Code with AI built directly into the editor. To use Cursor you switch your entire development environment. It has powerful built-in context features but they only work inside Cursor. PRMPT works with whatever editor, CLI, or AI tool you already use. No workflow change required.

### Serena

Serena is an open-source tool that connects a Language Server (a program that understands code structure for a specific programming language) to AI coding tools via MCP. It gives accurate code navigation to any MCP-compatible AI. It's free. The limitations: complex setup (you need to run a separate language server per language), no prompt optimization layer, no cost tracking, no cross-language unified index. PRMPT provides a single index that works across all languages simultaneously, plus the prompt optimization layer that Serena doesn't have.

### GitHub Copilot / Continue.dev

These are IDE extensions — they live inside VS Code or JetBrains and provide code completions and chat. They can't plug into Claude Code or Codex running in a terminal. PRMPT works at the CLI level, which is where the expensive agentic sessions happen.

### Aider

Aider is an open-source CLI agent with its own "repo map" — it builds its own index of your codebase. It doesn't support MCP. It works well for smaller codebases but doesn't have the graph-based retrieval or prompt optimization layer PRMPT has. Also: it's a full agent, not a layer. PRMPT doesn't replace Aider; it could theoretically work alongside it.

### Just Using Claude/Codex As-Is

Works. Both are genuinely capable tools. The cost: you're paying full price for every exploration step. PRMPT's value is that it skips the exploration. If your sessions are short and your prompts are already precise, PRMPT adds overhead rather than value. If your sessions are long, your prompts are vague, and you're using Codex — PRMPT likely pays for itself.

---

## 8. Where We Are Right Now and Where We're Going

### What Works Today

You can install PRMPT on Windows or macOS right now. It sits in your system tray, activates on `@prompt`, reads your codebase, rewrites your prompts, and injects them back into whatever app you're using.

The MCP plugin is working and tested — the 60-run benchmark used it. Every AI agent correctly called PRMPT's tools and used the routing it provided.

### What We're Building Next

**Live retrieval.** Right now, PRMPT's MCP plugin serves pre-prepared answers (generated before the session starts). The next version will query your codebase in real-time during the AI's session — so if the AI is on turn 8 and finds a clue pointing to a different file, it can call PRMPT again and get updated guidance.

**The retry fix.** If the AI fixes the wrong files and the tests still fail, PRMPT's next call will know about the failure and will deliberately return different files — not the same ones that didn't work. This directly solves the "deterministic output problem" (the issue that PRMPT was returning identical file lists on every retry regardless of what had already been tried).

### The Bigger Bet

The real pivot is forking an open-source AI coding agent and baking PRMPT directly into the agent's navigation system. Right now, PRMPT is a plugin that a human has to configure — the AI can still choose to ignore it. In a fork, PRMPT's file routing IS the agent's file navigation. There's no way to bypass it because it's not a plugin anymore; it's the engine.

The hypothesis: a PRMPT-native open-source agent can fix 70% of what Claude Code can fix, at 40–60% lower cost. For teams spending $10,000/month on Claude Code, that's a $4,000–$6,000/month saving with a small quality tradeoff — a tradeoff most CTOs would take.

---

## 9. The Business Case in Plain Math

We're not going to pretend we have a revenue model fully figured out. Here's what the math looks like based on real data.

**The cost landscape (2026)**

A team of 20 engineers using AI coding tools (mix of Claude Code and Codex) is spending $5,000–$15,000/month on AI API costs. That range is wide because it depends on how aggressively they use the tools. Teams doing long agentic sessions on large codebases are at the high end.

**Where PRMPT saves**

On the Codex portion of that spend, PRMPT saves 18–35% per session (from the benchmark data). If half the team uses Codex-class tools:

- 10 engineers × $400/month each = $4,000 Codex spend
- 20% saving = $800/month saved

**The subscription model**

PRMPT subscription at a team plan (speculative pricing: $200/month for 10 seats):

- Saving $800/month, paying $200/month = $600/month net benefit = 4x ROI

The key: this is provable from logs. PRMPT records every session's cost — before and after. An investor, a CTO, or a skeptical developer can open the dashboard, see the real numbers, and verify the claim. We're not asking anyone to trust a projection; we're showing them a ledger.

**The rate-limit story (for Claude Max users)**

For developers on flat-rate plans (Claude Max at $100/month, rate-limited not per-token), the savings pitch shifts. PRMPT saves turns, and fewer turns means you hit your monthly rate limit later. You can do more work in the same subscription period. This is a different story — "unlock more throughput" vs "save money" — but it's real for the significant segment of developers who use subscription plans.

---

## 10. Glossary

Every technical term used in this document, defined in one sentence.

**Token** — The unit that AI systems use to measure text; roughly one word = one token, but code symbols and punctuation count individually too.

**Context window** — The maximum amount of text an AI can hold in its "working memory" at one time; everything you've said in a session has to fit within this limit.

**Context replay** — The practice of resending the entire conversation history to the AI on every new message, because AI models don't retain memory between turns on their own.

**Prompt** — Any instruction or question you send to an AI.

**Prompt optimization** — The process of rewriting a vague prompt into a precise, detailed instruction that produces better AI output with less guessing.

**Embedding** — A representation of a piece of text as a list of numbers (typically 384 or 1,536 numbers), where similar texts produce similar number lists, allowing computers to measure semantic similarity.

**Vector search** — A search method that finds the most similar items by comparing their numerical embeddings, as opposed to keyword matching.

**Graph RAG** — "Retrieval-Augmented Generation using a Graph" — a technique where, instead of just finding similar text, you also follow the relationships between items (e.g., which function calls which other function) to find structurally important code.

**MCP (Model Context Protocol)** — A standard protocol developed by Anthropic that lets external tools plug into AI coding agents; PRMPT implements an MCP server so any MCP-compatible AI can call PRMPT for file routing guidance.

**Agentic** — Describes AI behavior where the model takes multiple independent actions (reading files, running commands, writing code) in a loop to complete a task, rather than just answering a single question.

**Agentic loop** — The iterative cycle an AI agent runs: observe → think → act → observe result → think again → act again, until the task is complete or time runs out.

**Code intelligence** — The system inside PRMPT that reads and understands your codebase — parsing files, building the function map, and answering "where does this bug probably live?"

**Tree-sitter** — An open-source parser that converts source code into a structured outline (AST — Abstract Syntax Tree) regardless of programming language; used by PRMPT to understand what's inside each file.

**ONNX** — Open Neural Network Exchange; a format for packaging AI models so they can run locally without needing cloud APIs or Python ML frameworks installed.

**API** — Application Programming Interface; a way for two software programs to talk to each other; when developers pay "per API call," they're paying per message sent to the AI service.

**CLI** — Command-Line Interface; a text-based terminal where you type commands instead of clicking buttons; Claude Code and Codex are both CLI tools.

**Hardening** — The practice of configuring an AI agent to restrict its behavior — in the benchmark context, "hard hardening" means blocking the AI from doing broad file searches so it must use PRMPT's routing.

**Benchmark** — A controlled test that measures performance or cost under specific conditions; PRMPT's 60-run benchmark measured cost savings across multiple AI tools, task types, and configurations.

**Oracle** — In software testing, the source of truth for whether something passed or failed; in PRMPT's benchmark, `npm test` (the project's automated test suite) was the oracle — exit code 0 means the bug is fixed.

**Semantic search** — Finding content based on meaning rather than exact word matches; "authentication failure" and "login error" would match semantically even though they share no words.

**PageRank** — An algorithm originally developed by Google to rank web pages by importance; PRMPT applies it to code graphs to identify which files are most "central" (depended upon by many other files).

**Community detection** — The process of finding clusters of tightly related items in a graph; in a code graph, community detection identifies which functions belong to the "payment processing cluster" vs the "user authentication cluster."

**Amortized cost** — Spreading a one-time cost across multiple uses; PRMPT's indexing cost ($0.44 total for all 9 test tasks) is amortized to $0.049 per task — the cost is real, just spread proportionally.

**OpenRouter** — A service that acts as a unified gateway to dozens of AI models; developers send one API request and OpenRouter routes it to Claude, GPT-5, Gemini, or others; PRMPT uses it for model flexibility and cost tracking.

**LiteLLM** — An open-source Python library that provides a single unified interface for calling any AI model from any provider; PRMPT uses it so the optimizer can switch models without rewriting the call code.

---

*This document covers the fundamentals. For the full technical architecture, see `[ARCHITECTURE.md](./ARCHITECTURE.md)`. For the complete system walkthrough with all implementation details, see `[PRMPT_DEEP_DIVE.md](./PRMPT_DEEP_DIVE.md)`. For the full benchmark data, see `[BENCHMARK_RESULTS.md](./BENCHMARK_RESULTS.md)`.*