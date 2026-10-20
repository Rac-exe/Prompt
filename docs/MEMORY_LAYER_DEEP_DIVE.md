# Memory Layer — Complete Technical Documentation

> **Scope**: This document covers the **user personalization memory** system — the feature that learns facts about a user from their prompt optimization history and injects those facts back into future optimizations. It does **not** cover code-intelligence embeddings (`code-intelligence-service/`, per-project SQLite indexes with on-device ONNX embeddings), which index repository code, not user facts.
>
> Prmpt is a local-first, single-user desktop app. Memory lives in the app's local SQLite database on the user's machine; there is no server-side copy and no login.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Database Schema](#2-database-schema)
3. [Core Backend Service — `MemoryService`](#3-core-backend-service--memoryservice)
4. [Orchestration — `MemoryAnalyzer`](#4-orchestration--memoryanalyzer)
5. [Python Extraction Endpoint](#5-python-extraction-endpoint)
6. [IPC Bridge (Electron Main ↔ Renderer)](#6-ipc-bridge-electron-main--renderer)
7. [Chat Integration — How Memory Gets Used](#7-chat-integration--how-memory-gets-used)
8. [Frontend UI — `MemoryView`](#8-frontend-ui--memoryview)
9. [Priority System (Explicit vs Inferred)](#9-priority-system-explicit-vs-inferred)
10. [End-to-End Data Flow](#10-end-to-end-data-flow)
11. [Security & Sanitization](#11-security--sanitization)
12. [Configuration Reference](#12-configuration-reference)
13. [File Inventory](#13-file-inventory)
14. [Known Gaps & Limitations](#14-known-gaps--limitations)

---

## 1. Architecture Overview

The memory layer is a **user personalization system** that learns facts about the user from their prompt optimization history and injects those facts back into future optimizations. It spans the React renderer, the Electron main process (which owns the local SQLite database) and the local Python optimizer service:

```
┌──────────────────────────────────────────────────────────────────────┐
│                         RENDERER (React)                             │
│  MemoryView.tsx ─── Settings > Memory tab                            │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐                  │
│  │ About You   │  │ Usage       │  │ Recurring    │   Toggle: Learn  │
│  │ (user)      │  │ Patterns    │  │ Themes       │   from my usage  │
│  │             │  │ (behavioral)│  │ (context)    │                  │
│  └─────────────┘  └─────────────┘  └──────────────┘                  │
│         │                │                │                          │
│         └────────────────┼────────────────┘                          │
│                          │  window.electronAPI.memory.*              │
└──────────────────────────┼───────────────────────────────────────────┘
                           │  IPC (invoke / on)
┌──────────────────────────┼───────────────────────────────────────────┐
│                  ELECTRON MAIN PROCESS                               │
│                          │                                           │
│  ┌───────────────────────▼───────────────────────┐                   │
│  │  user-handlers.ts (IPC controllers)           │                   │
│  │  memory:get · memory:upsert · memory:delete   │                   │
│  │  memory:get-enabled · memory:set-enabled      │                   │
│  └───────────────────────┬───────────────────────┘                   │
│                          │                                           │
│  ┌───────────────────────▼───────────────────────┐                   │
│  │  MemoryService                                │                   │
│  │  getMemory() · upsertMemoryEntry()            │                   │
│  │  upsertInferredEntries() · deleteMemoryEntry()│                   │
│  │  buildMemoryContext() · hasExplicitEntry()    │                   │
│  │  reads/writes prmpt.db via better-sqlite3     │                   │
│  └───────────────────────┬───────────────────────┘                   │
│                          │                                           │
│  ┌───────────────────────▼───────────────────────┐                   │
│  │  MemoryAnalyzer                               │                   │
│  │  onNewOptimization() — every 3rd optimization │                   │
│  │  extractAndUpsert() — LLM extraction pipeline │                   │
│  │  isMemoryEnabled() — toggle check             │                   │
│  └───────────────────────┬───────────────────────┘                   │
│                          │                                           │
│  ┌───────────────────────▼───────────────────────┐                   │
│  │  chat-handlers.ts / overlay-ipc-handlers.ts   │                   │
│  │  Inject memory into customInstructions before │                   │
│  │  optimization; fire analyzer after each result│                   │
│  └───────────────────────┬───────────────────────┘                   │
└──────────────────────────┼───────────────────────────────────────────┘
                           │  HTTP (axios) to 127.0.0.1:8001
                           │  headers: X-Prmpt-OpenRouter-Key + chosen models
┌──────────────────────────┼───────────────────────────────────────────┐
│                  PYTHON SERVICE (FastAPI, local)                     │
│                          │                                           │
│  ┌───────────────────────▼───────────────────────┐                   │
│  │  POST /extract-memory-facts                   │                   │
│  │  LiteLLM completion → JSON array of facts     │                   │
│  │  model: MEMORY_MODEL  temp: 0.1  max: 300 tok │                   │
│  │  → OpenRouter with the user's key             │                   │
│  └───────────────────────────────────────────────┘                   │
│                                                                      │
│  ┌───────────────────────────────────────────────┐                   │
│  │  optimizer.py                                 │                   │
│  │  Appends custom_instructions (incl. memory)   │                   │
│  │  to system prompt with anti-override guard    │                   │
│  └───────────────────────────────────────────────┘                   │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│        LOCAL SQLITE  {userData}/prmpt.db                             │
│        (opened in-process by the Electron main process)              │
│                                                                      │
│  ┌───────────────────────────────────────────────┐                   │
│  │  user_memory                                  │                   │
│  │  PK: id (TEXT, UUID)                          │                   │
│  │  UNIQUE: (user_id, memory_type, key)          │                   │
│  │  user_id = LOCAL_USER_ID (single local user)  │                   │
│  │  Columns: memory_type, key, value, confidence,│                   │
│  │    source, observation_count, timestamps      │                   │
│  └───────────────────────────────────────────────┘                   │
│                                                                      │
│  ┌───────────────────────────────────────────────┐                   │
│  │  user_settings.memory_enabled (INTEGER 0/1)   │                   │
│  └───────────────────────────────────────────────┘                   │
└──────────────────────────────────────────────────────────────────────┘
```

Key design decisions:

- **No vectors, no embeddings, no semantic search** on user memory. Facts are literal key-value strings; retrieval is "load all for user → filter by confidence → format string."
- **No vector database**. Code intelligence (Spaces) keeps its own per-project SQLite index with on-device embeddings; it is unrelated to this feature.
- **No dedicated REST API**. The renderer communicates via Electron IPC; the main process reads and writes the local SQLite database in-process (better-sqlite3) and calls the Python service over HTTP on `127.0.0.1`.
- **Local and single-user**. There is no login. Every row is written with `user_id = LOCAL_USER_ID` (`'00000000-0000-0000-0000-000000000001'`, from `electron/main/database/local-db.ts`); the column is kept so row shapes match the earlier API.
- **No background workers or queues**. Extraction is fire-and-forget promises triggered inline after each optimization.
- **Bring your own key**. Extraction calls OpenRouter with the user's own API key, which the Electron app sends to the Python service per request. Nothing about memory is stored outside the user's machine.

---

## 2. Database Schema

### 2.1 Table: `user_memory`

**Defined in**: `electron/main/database/local-db.ts` (`migrate()`)

The app keeps all user data in one SQLite file, `{userData}/prmpt.db` (Electron's `app.getPath('userData')`, overridable with the `PRMPT_USER_DATA_DIR` env var). `getDb()` opens it lazily with better-sqlite3, sets `journal_mode = WAL`, `synchronous = NORMAL` and `foreign_keys = ON`, then runs `migrate()`. `migrate()` creates every table with `CREATE TABLE IF NOT EXISTS` and records `PRAGMA user_version = 1` (`SCHEMA_VERSION`); it does nothing on later opens.

```sql
CREATE TABLE IF NOT EXISTS user_memory (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('user', 'behavioral', 'context')),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  source TEXT NOT NULL DEFAULT 'inferred' CHECK (source IN ('inferred', 'explicit')),
  observation_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, memory_type, key)
);
```

### 2.2 Column Reference


| Column              | Type    | Default      | Constraints                                | Purpose                                                                 |
| ------------------- | ------- | ------------ | ------------------------------------------ | ----------------------------------------------------------------------- |
| `id`                | TEXT    | —            | PK                                         | Row identifier, a UUID from `newId()` (`crypto.randomUUID()`)           |
| `user_id`           | TEXT    | —            | NOT NULL, part of UNIQUE constraint        | Always `LOCAL_USER_ID`. No foreign key (there is no users table)        |
| `memory_type`       | TEXT    | —            | CHECK IN (`user`, `behavioral`, `context`) | Bucket categorization (see §2.3)                                        |
| `key`               | TEXT    | —            | Part of UNIQUE constraint                  | Snake_case label within a bucket (e.g. `role`, `preferred_tone`)        |
| `value`             | TEXT    | —            | NOT NULL                                   | The factual statement (e.g. "Full-stack developer")                     |
| `confidence`        | REAL    | `1.0`        | NOT NULL (range not enforced by the DB)    | How certain the system is. Explicit = 1.0; inferred ≤ 0.95 (see §5.3)   |
| `source`            | TEXT    | `'inferred'` | CHECK IN (`inferred`, `explicit`)          | Who created it: the user or the LLM                                     |
| `observation_count` | INTEGER | `1`          | NOT NULL                                   | How many times the LLM independently observed this fact                 |
| `created_at`        | TEXT    | —            | NOT NULL                                   | ISO 8601 timestamp from `nowIso()`, written on first insert only        |
| `updated_at`        | TEXT    | —            | NOT NULL                                   | ISO 8601 timestamp from `nowIso()`, rewritten on every upsert (§2.5)    |


### 2.3 Memory Type Buckets


| Type         | Label in UI        | What it stores                                                                  | Examples                                               |
| ------------ | ------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `user`       | "About You"        | Identity facts — role, domain, occupation, preferences the user explicitly sets | `role: "Senior Backend Engineer"`, `domain: "fintech"` |
| `behavioral` | "Usage Patterns"   | Inferred usage patterns — writing style, tone preferences, model choices        | `preferred_tone: "Technical and concise"`              |
| `context`    | "Recurring Themes" | Common topics and subjects detected across prompts                              | `primary_framework: "React with TypeScript"`           |


### 2.4 Indexes & Constraints

- **Unique constraint**: `UNIQUE (user_id, memory_type, key)` — one value per type per key. This is what makes upsert work via `INSERT ... ON CONFLICT(user_id, memory_type, key) DO UPDATE`. SQLite backs it with an automatic unique index, which also serves the per-user lookups; there is no separate index.
- **CHECK constraints** on `memory_type` and `source` reject unknown buckets or sources at write time.
- **No row-level security or grants**. Only the Electron main process opens `prmpt.db`; the renderer reaches memory only through the IPC channels in §6. See §11.1.

### 2.5 Timestamps

There is no trigger. `MemoryService.upsertRow()` writes `created_at` and `updated_at` from `nowIso()` on insert, and its `ON CONFLICT ... DO UPDATE` clause sets `updated_at = excluded.updated_at` while leaving `created_at` unchanged:

```sql
INSERT INTO user_memory
  (id, user_id, memory_type, key, value, confidence, source, observation_count, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(user_id, memory_type, key) DO UPDATE SET
  value = excluded.value,
  confidence = excluded.confidence,
  source = excluded.source,
  observation_count = excluded.observation_count,
  updated_at = excluded.updated_at
```

### 2.6 Settings Toggle

The toggle is a column of the local `user_settings` table, created in the same `migrate()`:

```sql
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  ...
  memory_enabled INTEGER NOT NULL DEFAULT 1,
  ...
);
```

SQLite has no boolean type: `SettingsService` (`electron/main/database/services/settings-service.ts`) writes `0`/`1` and converts back to a boolean with `toBool()` on read. `DEFAULT_SETTINGS.memory_enabled` is `true`.

When `false`, automatic fact extraction is disabled and memory is no longer injected into optimizations. Users can still add/edit facts manually.

### 2.7 Deleting Memory

There are no accounts, so there is no account-deletion flow and no cascade. Memory is removed:

- one fact at a time from Settings > Memory (`memory:delete` → `MemoryService.deleteMemoryEntry()`), or
- all at once by deleting `prmpt.db` (or the whole user-data folder) while the app is closed.

---

## 3. Core Backend Service — `MemoryService`

**File**: `electron/main/database/services/memory-service.ts`

This is the data-access layer. Every read/write to `user_memory` goes through it. It uses the shared better-sqlite3 connection from `getDb()` (`local-db.ts`) with prepared statements, and every query filters on `user_id = LOCAL_USER_ID`. better-sqlite3 is synchronous; the methods keep their `async` signatures so callers did not change.

### 3.1 Types

```typescript
export type MemoryType = 'user' | 'behavioral' | 'context';
export type MemorySource = 'inferred' | 'explicit';

export interface MemoryEntry {
  id: string;
  user_id: string;
  memory_type: MemoryType;
  key: string;
  value: string;
  confidence: number;
  source: MemorySource;
  observation_count: number;
  created_at: string;
  updated_at: string;
}

export interface UserMemoryMap {
  user: Record<string, MemoryEntry>;
  behavioral: Record<string, MemoryEntry>;
  context: Record<string, MemoryEntry>;
}
```

`UserMemoryMap` is the canonical shape used everywhere — three dictionaries keyed by the fact's `key` field.

### 3.2 Methods

#### `getMemory(): Promise<UserMemoryMap>`

Fetches all entries for the local user (`SELECT * FROM user_memory WHERE user_id = ? ORDER BY memory_type ASC, key ASC`) and groups them into the three-bucket map. This powers both the Settings UI and the context builder.

#### `upsertMemoryEntry(memoryType, key, value, source, confidence)`

Single-entry upsert used by the IPC handler when users manually add or edit a fact from the UI. Writes through the private `upsertRow()` helper (`INSERT ... ON CONFLICT(user_id, memory_type, key) DO UPDATE`, see §2.5). Always resets `observation_count` to 1 (explicit entries don't accumulate observations).

Default `source` is `'inferred'` and default `confidence` is `1.0`; the `memory:upsert` handler defaults `source` to `'explicit'`, and the UI passes `'explicit'` anyway.

#### `hasExplicitEntry(memoryType, key): Promise<boolean>`

Checks if a user-set (`source = 'explicit'`) entry exists for a given `(memoryType, key)`. This is the gatekeeper that prevents inferred facts from overwriting user-set facts.

#### `upsertInferredEntry(memoryType, key, value, confidence)`

Single inferred upsert with explicit-priority check and observation count incrementing (default `confidence` is `0.7`). Calls `hasExplicitEntry()` first and bails if it returns `true`. If the row already exists, increments `observation_count` by 1. Not used by the analyzer, which goes through the batch method below.

#### `upsertInferredEntries(facts[]): Promise<number>`

**Batch upsert** — the primary write path for automated fact extraction. It runs two reads and one write transaction regardless of how many facts are being written:

1. **Read all explicit entries** → builds a `Set<"memoryType::key">` for O(1) skip checks.
2. **Read existing rows** (`memory_type`, `key`, `observation_count`) → builds a `Map` of current counts.
3. **Sanitize** keys/values (§3.3) and drop rows that end up empty.
4. **One transaction** (`conn.transaction(...)`) that runs `upsertRow()` for each eligible fact with its incremented count.

Returns the number of rows actually written (after filtering out explicit-blocked and empty-after-sanitization rows).

#### `deleteMemoryEntry(memoryType, key)`

Deletes a specific entry filtered by `(user_id, memory_type, key)`.

#### `buildMemoryContext(): Promise<string>`

The critical method that transforms stored facts into a string injected into the optimizer's system prompt. This is where memory becomes actionable.

**Algorithm:**

1. Load all memory entries via `getMemory()` (returns an empty string if that throws).
2. Filter to entries with `confidence >= 0.5`.
3. Split `user`-type entries into two groups:
  - **Persona keys** (from a hardcoded set: `occupation`, `role`, `job_title`, `profession`, `industry`, `expertise`, `background`, `identity`, `title`, `position`)
  - **Preference keys** (everything else in the `user` bucket)
4. Build labeled sections:
  - **User Identity** (persona keys) → wrapped in `[USER PERSONA — background context only. Use to calibrate tone and technical depth. NEVER use to change the type or purpose of the prompt.]`
  - **User Preferences** (non-persona user keys) → wrapped in `[USER PREFERENCES — apply where relevant to enrich the optimized prompt.]`
  - **Usage Patterns** (all `behavioral` entries)
  - **Recurring Themes** (all `context` entries)
5. Concatenate all sections.
6. **Hard cap at 800 characters** to prevent overwhelming the system prompt.
7. Return empty string if no qualifying entries exist.

**Format example** (what gets injected):

```
[USER PERSONA — background context only. Use to calibrate tone and technical depth. NEVER use to change the type or purpose of the prompt. If the user asks to build software, it is a coding task regardless of their occupation.]
User Identity:
  - role: Senior Backend Engineer
  - industry: Fintech

[USER PREFERENCES — apply where relevant to enrich the optimized prompt.]
User Preferences:
  - preferred_tone: Technical and concise
Usage Patterns:
  - default_mode: thinking
Recurring Themes:
  - primary_framework: React with TypeScript
```

### 3.3 Sanitization

Keys and values pass through `sanitizeField()` in two places: before storage in the batch inferred path (`upsertInferredEntries()`), and again for every entry at injection time in `buildMemoryContext()`. Manual entries (`upsertMemoryEntry()`) and the single-entry `upsertInferredEntry()` store the text as given, so they are sanitized only at injection.

```typescript
private static sanitizeField(raw: string, maxLen: number): string {
  return raw
    .slice(0, maxLen)
    .replace(/\[|\]|\{|\}/g, '')            // remove bracket markers
    .replace(/SYSTEM\s*:/gi, '')            // strip SYSTEM: prefixes
    .replace(/IGNORE\s+(ALL\s+)?PREVIOUS/gi, '') // strip jailbreak phrases
    .replace(/OVERRIDE\s*:/gi, '')
    .replace(/INSTRUCTION\s*:/gi, '')
    .trim();
}
```

This strips common prompt injection patterns before they can reach the LLM.

### 3.4 Constants


| Constant             | Value             | Purpose                                                        |
| -------------------- | ----------------- | -------------------------------------------------------------- |
| `MAX_KEY_LEN`        | 60                | Maximum characters for a fact key                              |
| `MAX_VALUE_LEN`      | 300               | Maximum characters for a fact value                            |
| `PERSONA_KEYS`       | Set of 10 strings | Keys that get the strict persona treatment in context building |
| Context hard cap     | 800 chars         | Maximum total injected memory context                          |
| Confidence threshold | 0.5               | Minimum confidence for inclusion in `buildMemoryContext()`     |


---

## 4. Orchestration — `MemoryAnalyzer`

**File**: `electron/main/database/services/memory-analyzer.ts`

This is the brain that decides **when** to extract facts and coordinates the extraction pipeline. It sits between the chat handlers and the MemoryService + PythonClient.

### 4.1 Construction

```typescript
constructor(
  pythonClient: PythonClient,
  memoryService?: MemoryService,
  settingsService?: SettingsService,
  userService?: UserService,
  appWindowManager?: AppWindowManager | null,
)
```

Lazily instantiated in `chat-handlers.ts` (via `getServices()`) and in `overlay-ipc-handlers.ts` (via `getMemoryAnalyzer()`). Each file keeps its own instance. Receives the shared `PythonClient` and `AppWindowManager` for HTTP calls and UI event pushing.

### 4.2 Throttling

```typescript
private optimizationsSinceLastRun = 0;
private readonly runEveryN = 3;
```

Extraction only runs every **3rd** successful optimization. This prevents hammering the LLM endpoint during rapid-fire usage. The counter is **in-memory** and resets on app restart — there is no persistent tracking of the count. Because the chat and overlay handlers hold separate analyzer instances, each path counts on its own.

### 4.3 `onNewOptimization(userId, rawPrompt, optimizedText, skill)`

The public entry point, called fire-and-forget after every successful optimization (`userId` is always `LOCAL_USER_ID` and is only used for logging):

1. Increment `optimizationsSinceLastRun`.
2. If counter < `runEveryN` (3), return immediately (no extraction this time).
3. Reset counter to 0.
4. Call `extractAndUpsert()` inside a try/catch — failures are logged but **never** block the main flow.

### 4.4 `extractAndUpsert()` — Core Pipeline

1. **Check toggle**: `isMemoryEnabled()` reads `user_settings.memory_enabled`. Defaults to `true` if settings can't be read (fail-open). If disabled, logs and returns.
2. **Extract facts**: `pythonClient.extractMemoryFacts(rawPrompt, optimizedText, skill)` → HTTP POST to the local Python service, which calls OpenRouter with the user's key.
3. **Filter**: Only accepts facts with valid categories (`user`, `behavioral`, `context`).
4. **Batch upsert**: `memoryService.upsertInferredEntries(eligibleFacts)` — two reads plus one transaction, respects explicit priority.
5. **Push to UI**: If any rows were upserted and `appWindowManager` is available, sends `memory:updated` event with the full updated `UserMemoryMap`.

### 4.5 `isMemoryEnabled(): Promise<boolean>`

Reads the local settings to check the memory toggle. Returns `true` by default if:

- The local profile can't be read (`UserService.getUserProfile()` creates the profile row on first use, so this is rare)
- No `user_settings` row has been saved yet
- Reading the settings throws

This is a **fail-open** design: memory features stay active unless explicitly disabled.

---

## 5. Python Extraction Endpoint

**File**: `python-service/app/main.py` (the `MEMORY FACT EXTRACTION` block, about lines 880–1021)

### 5.1 Pydantic Models

```python
class MemoryFact(BaseModel):
    category: str    # 'user' | 'behavioral' | 'context'
    key: str         # short label, e.g. "role", "preferred_tone"
    value: str       # the fact, e.g. "Senior Backend Engineer"
    confidence: float  # 0.0 – 1.0

class ExtractMemoryRequest(BaseModel):
    raw_prompt: str = Field(..., max_length=50_000)
    optimized_text: str = Field(..., max_length=50_000)
    skill: Optional[str] = Field(None, max_length=200)

class ExtractMemoryResponse(BaseModel):
    facts: List[MemoryFact]
```

### 5.2 System Prompt

```
You are a silent profiling engine. Given a user's raw prompt and the optimized
version, extract factual observations about the user.

Return a JSON array of facts. Each fact must have:
- "category": one of "user" (identity, role, domain), "behavioral" (writing
  style, preferences), or "context" (recurring topics/tools)
- "key": a short snake_case label (e.g. "role", "primary_language",
  "preferred_tone", "domain")
- "value": a concise factual statement
- "confidence": 0.0 to 1.0 (how certain you are)

Rules:
- Only extract facts you are reasonably confident about (>= 0.5)
- Do NOT invent facts — only observe what is clearly present in the prompt
- Do NOT extract generic observations (e.g. "uses AI" is useless)
- Prefer specific, actionable facts (e.g. "works with React and TypeScript"
  over "is a developer")
- Return an empty array [] if nothing meaningful can be inferred
- Return ONLY the JSON array, no markdown, no explanation
```

### 5.3 Endpoint Logic (`POST /extract-memory-facts`)

1. **No auth, local only**: The service listens on `127.0.0.1` and serves a single local user. The `BrowserOriginGuard` middleware (`app/origin_guard.py`) rejects requests that carry a browser `Origin` other than the service's own host or `ALLOWED_ORIGINS`; the Electron app sends no `Origin`.
2. **Provider settings**: The `llm_from_headers` dependency builds an `LLMSettings` from the request headers (`X-Prmpt-OpenRouter-Key`, `X-Prmpt-Optimizer-Model`, `X-Prmpt-Rag-Model`). Only the API key is used here; the key is used for this one call and never stored.
3. **Input validation**: Raw prompt must be ≥ 10 characters. If shorter, returns empty facts.
4. **User content construction**: `"Raw prompt:\n{raw}\n\nOptimized version:\n{optimized}"`, plus `"\n\nDetected skill: {skill}"` when a skill is given.
5. **LLM call** via LiteLLM:
  - **Model**: `MEMORY_MODEL` (defaults to `SUMMARIZER_MODEL` → `openrouter/openai/gpt-4o-mini`). The optimizer model the user picks in the app does not apply here.
  - **Temperature**: 0.1 (near-deterministic)
  - **Max tokens**: 300 (compact output)
  - **Key**: `provider_kwargs(model, llm.api_key)` passes the request's OpenRouter key for `openrouter/` models, falling back to the `OPENROUTER_API_KEY` env var. With neither, it raises `MissingAPIKeyError`, which the endpoint's error handling turns into empty facts.
6. **Usage logging**: Logged as `memory_extraction` call type with prompt/completion tokens and latency via `pipeline_v2/usage_logger.py`, which appends to local JSONL files under `pipeline_v2/storage/usage/`.
7. **JSON parsing**:
  - Strips markdown code fences if the LLM wraps its output in them.
  - Parses as JSON array; rejects non-array responses.
  - Validates each item: must have a valid category, non-empty key/value, confidence in [0.0, 1.0].
8. **Confidence cap**: All inferred confidences are clamped to **max 0.95** so explicit entries (1.0) always win in priority comparisons.
9. **Error handling**: Returns empty `facts: []` on any failure — missing key, JSON parse error, LLM timeout, network error, etc. Never throws to the caller.

### 5.4 Model Configuration

**File**: `python-service/pipeline_v2/config.py`

```python
OPTIMIZER_MODEL  = os.environ.get("OPTIMIZER_MODEL",  "openrouter/openai/gpt-4o-mini")
SUMMARIZER_MODEL = os.environ.get("SUMMARIZER_MODEL", "openrouter/openai/gpt-4o-mini")
TITLE_MODEL      = os.environ.get("TITLE_MODEL",      SUMMARIZER_MODEL)
MEMORY_MODEL     = os.environ.get("MEMORY_MODEL",     SUMMARIZER_MODEL)
```

`MEMORY_MODEL` cascades: env var → `SUMMARIZER_MODEL` env var → hardcoded `openrouter/openai/gpt-4o-mini`. The same file defines `LLMSettings`, the header names and `provider_kwargs()`.

### 5.5 HTTP Client (Electron Side)

**File**: `electron/main/api/python-client.ts`

```typescript
async extractMemoryFacts(
  rawPrompt: string,
  optimizedText: string,
  skill: string | null = null
): Promise<Array<{ category: string; key: string; value: string; confidence: number }>> {
  try {
    const response = await this.client.post('/extract-memory-facts', {
      raw_prompt: rawPrompt,
      optimized_text: optimizedText,
      skill: skill || undefined,
    }, { timeout: 15000 });
    const facts = response.data?.facts;
    return Array.isArray(facts) ? facts : [];
  } catch (error) {
    console.warn('[PythonClient] extractMemoryFacts failed (non-critical):', error);
    return [];
  }
}
```

- **Headers**: An axios request interceptor in the `PythonClient` constructor adds `aiSettings.pythonHeaders()` (the user's OpenRouter key and chosen models, from `ai-settings-service.ts`) to every request.
- **Timeout**: 15 seconds.
- **Failure mode**: Returns empty array. Never throws. Logged as a warning.

---

## 6. IPC Bridge (Electron Main ↔ Renderer)

### 6.1 Preload Exposure

**File**: `electron/preload.ts`

The renderer accesses memory through `window.electronAPI.memory`, which is exposed via context bridge:

```typescript
memory: {
  get:        () => ipcRenderer.invoke('memory:get'),
  upsert:     (data) => ipcRenderer.invoke('memory:upsert', data),
  delete:     (data) => ipcRenderer.invoke('memory:delete', data),
  getEnabled: () => ipcRenderer.invoke('memory:get-enabled'),
  setEnabled: (enabled) => ipcRenderer.invoke('memory:set-enabled', enabled),
  onUpdated:  (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('memory:updated', handler);
    return () => ipcRenderer.removeListener('memory:updated', handler);
  },
}
```

### 6.2 IPC Handlers

**File**: `electron/main/ipc-handlers/user-handlers.ts`


| Channel              | Type                    | Purpose                                                                            |
| -------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `memory:get`         | invoke (req/res)        | Fetch all memory grouped by type                                                   |
| `memory:upsert`      | invoke (req/res)        | Create or update a fact. Defaults to `source: 'explicit'`, `confidence: 1.0`       |
| `memory:delete`      | invoke (req/res)        | Remove a fact by `(memoryType, key)`                                               |
| `memory:get-enabled` | invoke (req/res)        | Check if auto-learning toggle is on                                                |
| `memory:set-enabled` | invoke (req/res)        | Toggle auto-learning on/off (writes `memory_enabled` to `user_settings`)           |
| `memory:updated`     | event (main → renderer) | Pushed after background extraction completes with the full updated `UserMemoryMap` |


The handlers still check `authState.isAuthenticated`, but in the local build `electron/main/utils/auth-state.ts` is a constant (`isAuthenticated: true`, `currentUserId: LOCAL_USER_ID`), so those checks always pass.

All handlers wrap in try/catch and log failures with `console.error`. On failure, `memory:get` returns `{ user: {}, behavioral: {}, context: {} }`, `memory:get-enabled` returns `true` (fail-open), and the write channels return `{ success: false, error }` instead of throwing.

### 6.3 TypeScript Contracts (Renderer Side)

**File**: `app-ui/src/types/electron.d.ts`

```typescript
export type MemoryType = 'user' | 'behavioral' | 'context';
export type MemorySource = 'inferred' | 'explicit';

export interface MemoryEntry {
  key: string;
  value: string;
  source: MemorySource;
  confidence: number;
  memory_type: MemoryType;
  updated_at: string;
  observation_count?: number;
}

export type UserMemoryMap = {
  user: Record<string, MemoryEntry>;
  behavioral: Record<string, MemoryEntry>;
  context: Record<string, MemoryEntry>;
};
```

Note: The renderer-side `MemoryEntry` omits `id` and `user_id` compared to the backend type — these are not needed in the UI.

---

## 7. Chat Integration — How Memory Gets Used

Memory is consumed at two points in every optimization: **injection** (before) and **extraction** (after).

### 7.1 Memory Injection (Before Optimization)

Memory context is injected into the optimization pipeline at **four** distinct code paths:


| File                      | Code Path                                              |
| ------------------------- | ------------------------------------------------------ |
| `chat-handlers.ts`        | `app:optimize-prompt` (main chat optimization)         |
| `chat-handlers.ts`        | `app:send-message` (send with attachment/chat message) |
| `chat-handlers.ts`        | `app:regenerate-response` (regeneration)               |
| `overlay-ipc-handlers.ts` | Overlay optimize                                       |


All four follow the same pattern (shown here from `chat-handlers.ts`):

```typescript
// Append user memory context (guarded by toggle, non-blocking, silent failure)
if (authState.isAuthenticated && memory && analyzer) {
    try {
        const memEnabled = await analyzer.isMemoryEnabled();
        if (memEnabled) {
            const memCtx = await memory.buildMemoryContext();
            if (memCtx) {
                customInstructions = customInstructions
                    ? `${customInstructions}\n\n${memCtx}`
                    : memCtx;
            }
        }
    } catch { /* non-critical */ }
}
```

`customInstructions` may already contain `user_settings.prompt_instructions` (the user's manually entered custom instructions, read from the local database). Memory context is appended after it. Clarification follow-ups reuse the `customInstructions` captured by the original request.

### 7.2 How the Optimizer Receives Memory

The combined `customInstructions` string is passed to `PythonClient.optimizeStream()`, which sends it to the Python service. In `optimizer.py`:

```python
if custom_instructions and custom_instructions.strip():
    system_prompt += (
        f"\n\nUSER CUSTOM INSTRUCTIONS (Apply these as secondary enrichment "
        f"to the optimized prompt. Do not let user memory override the user's "
        f"explicit intent):\n"
        f"{custom_instructions.strip()}"
    )
```

The fast path uses a variant of this block that also states the detected prompt category is authoritative.

The anti-override language ("Do not let user memory override the user's explicit intent") is a guardrail to prevent persona facts from changing what the user is actually asking for. For example, if a user's memory says `role: "Marketing Manager"` but they ask to write a Python script, the optimizer should treat it as a coding task, not a marketing task.

### 7.3 Memory Extraction (After Optimization)

After each successful optimization, the analyzer fires:

```typescript
// Trigger background memory analysis (fire-and-forget, non-critical)
if (analyzer && authState.currentUserId) {
    analyzer.onNewOptimization(
        authState.currentUserId,
        promptText,
        optimizedText,
        null, // or data.forcedSkill
    ).catch((e: unknown) =>
        console.warn('[Chat] Memory analysis error (non-critical):', e)
    );
}
```

This is a `.catch()`-guarded promise — it **never** blocks the optimization response from reaching the user. The extraction happens entirely in the background.

---

## 8. Frontend UI — `MemoryView`

**File**: `app-ui/src/components/settings/MemoryView.tsx`

### 8.1 Component Hierarchy

```
SettingsView (settings/SettingsView.tsx)
  └── TabsContent value="memory"
       └── ScrollArea
            └── MemoryView
                 ├── Header
                 │    ├── Brain icon (10×10 rounded box, primary/10 bg)
                 │    ├── "App Memory" title
                 │    └── "{N} facts stored" subtitle
                 │
                 ├── Toggle Card
                 │    ├── "Learn from my usage" label
                 │    ├── Description text (context-sensitive)
                 │    └── ToggleSwitch component
                 │
                 ├── Loading Spinner (if loading)
                 │
                 └── MemorySection × 3 (user, behavioral, context)
                      ├── Collapsible Header
                      │    ├── Type icon (User / Pulse / BookOpen)
                      │    ├── Label ("About You" / "Usage Patterns" / "Recurring Themes")
                      │    ├── Fact count badge
                      │    └── Caret (expand/collapse)
                      │
                      ├── Empty State (italic description if no facts)
                      │
                      ├── MemoryRow × N
                      │    ├── Key (muted, truncated at 180px)
                      │    ├── ConfidenceBadge
                      │    │    ├── "You set this" (if explicit, indigo bg)
                      │    │    ├── "X% confident" (green ≥70%, amber <70%)
                      │    │    └── Eye icon + count (if observation_count > 1)
                      │    ├── Value text (or inline edit input)
                      │    └── Hover actions: Edit (pencil) / Delete (trash)
                      │
                      └── "Add fact" button
                           └── Expand to: Key input + Value input + Save/Cancel
```

### 8.2 Section Metadata


| Type         | Label              | Icon     | Color              | Empty-state description                                            |
| ------------ | ------------------ | -------- | ------------------ | ------------------------------------------------------------------ |
| `user`       | "About You"        | User     | `text-indigo-400`  | "Personal facts (role, domain, preferences you've explicitly set)" |
| `behavioral` | "Usage Patterns"   | Pulse    | `text-emerald-400` | "Automatically inferred from your optimization habits"             |
| `context`    | "Recurring Themes" | BookOpen | `text-amber-400`   | "Common topics and subjects detected across your prompts"          |


### 8.3 State Management

All local React state — no global store (Zustand, Redux), no context, no custom hooks:


| State Variable   | Type            | Purpose                       |
| ---------------- | --------------- | ----------------------------- |
| `memory`         | `UserMemoryMap` | The three-bucket fact map     |
| `loading`        | `boolean`       | Controls initial load spinner |
| `memoryEnabled`  | `boolean`       | Toggle state                  |
| `togglingMemory` | `boolean`       | Prevents double-toggle clicks |


### 8.4 Data Loading

On mount, `load()` fetches both the memory map and toggle state in parallel:

```typescript
const [result, enabled] = await Promise.all([
  window.electronAPI.memory.get(),
  window.electronAPI.memory.getEnabled(),
]);
```

If `window.electronAPI` is unavailable (non-Electron environment), loading completes immediately with empty state.

### 8.5 Live Sync

A `useEffect` subscribes to `memory:updated` events from the main process:

```typescript
useEffect(() => {
  if (!isElectron || !window.electronAPI.memory.onUpdated) return;
  const cleanup = window.electronAPI.memory.onUpdated((updatedMemory) => {
    setMemory(updatedMemory);
  });
  return cleanup;
}, [isElectron]);
```

When the `MemoryAnalyzer` finishes background extraction and pushes `memory:updated`, the UI updates in real-time without manual refresh. The cleanup function removes the listener on unmount.

### 8.6 User Interactions


| Action              | UI Element                                     | IPC Call                                                      | Optimistic Update                                  |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------- |
| **Toggle learning** | `ToggleSwitch`                                 | `memory.setEnabled(enabled)`                                  | Updates `memoryEnabled` on success + toast         |
| **Edit fact value** | Inline input (Enter to save, Escape to cancel) | `memory.upsert({ ..., source: 'explicit' })`                  | Patches entry with `confidence: 1.0`               |
| **Delete fact**     | Trash icon (hover reveal)                      | `memory.delete({ memoryType, key })`                          | Removes key from local state                       |
| **Add fact**        | "Add fact" → key/value inputs → Save           | `memory.upsert({ ..., source: 'explicit', confidence: 1.0 })` | Adds new entry with `observation_count: 1` + toast |


All mutations are optimistic: local state updates immediately on IPC success, with toast error notifications on failure.

### 8.7 Footer

```
You have full control. Edit or delete any fact at any time. Facts you set
manually always take priority over inferred ones. Inferred facts update
automatically when learning is enabled.
```

---

## 9. Priority System (Explicit vs Inferred)

The priority hierarchy is the most important design decision in the memory layer. It ensures user agency is never undermined by automated inference.

### 9.1 Rules

1. **Explicit entries always win**: If a user sets `role = "Data Scientist"`, no amount of inferred observations will overwrite it.
2. **Confidence capping**: Python caps all inferred confidence at **0.95**, so explicit entries at **1.0** are always numerically higher.
3. **Skip-on-conflict**: `upsertInferredEntries()` builds a `Set` of all `"memoryType::key"` pairs with `source = 'explicit'` and skips any inferred fact that collides.
4. **Edit promotes to explicit**: When a user edits any fact (even an inferred one), it becomes `source: 'explicit'` with `confidence: 1.0`, permanently locking it from automated updates.
5. **Observation accumulation**: Inferred facts that are re-observed have their `observation_count` incremented, showing the user how many times the LLM independently confirmed a fact. This provides a confidence signal without overwriting existing values.
6. **Persona isolation**: In `buildMemoryContext()`, persona keys get a stricter prompt directive ("NEVER use to change the type or purpose of the prompt") while preferences get a softer one ("apply where relevant").

### 9.2 Priority Matrix


| Existing Entry | Incoming Entry      | Result                                                  |
| -------------- | ------------------- | ------------------------------------------------------- |
| None           | Inferred            | Created with inferred confidence (≤0.95)                |
| None           | Explicit            | Created with confidence 1.0                             |
| Inferred       | Inferred (same key) | Value updated, `observation_count` incremented          |
| Inferred       | Explicit (same key) | Overwritten, becomes explicit with confidence 1.0       |
| Explicit       | Inferred (same key) | **Skipped** — explicit is never overwritten by inferred |
| Explicit       | Explicit (same key) | Updated (user edited their own fact)                    |


---

## 10. End-to-End Data Flow

### 10.1 Injection Flow (Memory → Optimizer)

```
User types a prompt in the app
        │
        ▼
[Renderer] emits IPC 'app:optimize-prompt'
        │
        ▼
[Electron Main — chat-handlers.ts]
  │
  ├─ 1. Read user_settings.prompt_instructions (custom instructions, local SQLite)
  │
  ├─ 2. Check: authState guard (always true locally)? Do memory + analyzer exist?
  │     │
  │     └─ YES → analyzer.isMemoryEnabled()
  │              │
  │              ├─ FALSE → skip memory, use only prompt_instructions
  │              │
  │              └─ TRUE → memory.buildMemoryContext()
  │                        │
  │                        ├─ Load all user_memory rows (local SQLite)
  │                        ├─ Filter: confidence >= 0.5
  │                        ├─ Split user entries: persona vs preferences
  │                        ├─ Build [USER PERSONA] and [USER PREFERENCES] blocks
  │                        ├─ Cap at 800 chars
  │                        └─ Append to customInstructions
  │
  ├─ 3. customInstructions = prompt_instructions + "\n\n" + memoryContext
  │
  └─ 4. pythonClient.optimizeStream(promptText, ..., customInstructions, ...)
           │
           ▼
     [Python — optimizer.py]
       │
       ├─ system_prompt += "\n\nUSER CUSTOM INSTRUCTIONS (Apply these as
       │                    secondary enrichment... Do not let user memory
       │                    override the user's explicit intent):\n"
       │                    + customInstructions
       │
       └─ LLM generates optimized prompt with memory context baked in
```

### 10.2 Extraction Flow (Optimization → Memory)

```
Optimization completes successfully
        │
        ▼
[Electron Main — chat-handlers.ts]
  │
  ├─ Save optimization record to the local DB (prompt_optimizations)
  │
  └─ Fire-and-forget: analyzer.onNewOptimization(userId, raw, optimized, skill)
           │
           ├─ Increment counter (optimizationsSinceLastRun++)
           │
           ├─ Counter < 3? → return (skip this time)
           │
           └─ Counter == 3 → reset to 0, proceed:
                │
                ├─ 1. Check memory toggle → isMemoryEnabled()
                │     └─ FALSE → return
                │
                ├─ 2. pythonClient.extractMemoryFacts(raw, optimized, skill)
                │     │
                │     └─ POST /extract-memory-facts (headers carry the user's OpenRouter key)
                │        │
                │        ├─ LLM via OpenRouter (MEMORY_MODEL, default gpt-4o-mini,
                │        │  temp 0.1, max 300 tokens)
                │        ├─ System: MEMORY_EXTRACTION_SYSTEM_PROMPT
                │        ├─ User: "Raw prompt:\n{raw}\n\nOptimized version:\n{optimized}"
                │        │
                │        ├─ Parse JSON → validate categories, keys, values
                │        ├─ Cap confidence at 0.95
                │        └─ Return MemoryFact[]
                │
                ├─ 3. Filter to valid categories (user/behavioral/context)
                │
                ├─ 4. memoryService.upsertInferredEntries(facts)
                │     │
                │     ├─ Read 1: SELECT explicit entries → build skip set
                │     ├─ Read 2: SELECT existing rows → get observation counts
                │     ├─ Sanitize keys/values (strip injection patterns)
                │     ├─ Build rows (skip explicit-blocked, increment counts)
                │     └─ Write: one transaction of INSERT ... ON CONFLICT DO UPDATE
                │
                └─ 5. appWindowManager.send('memory:updated', updatedMemory)
                      │
                      └─ [Renderer] onUpdated callback → setMemory(updatedMemory)
                         → UI refreshes live in Settings > Memory
```

---

## 11. Security & Sanitization

### 11.1 Data Location & Access

- **Local only**: Memory lives in `{userData}/prmpt.db` on the user's machine. There is no server copy, no sync and no login.
- **Who can read it**: Only the Electron main process opens the database. The renderer (context isolation on) reaches memory only through the five `memory:*` IPC channels in §6. On disk, the file is protected only by the OS's permissions on the user's profile folder.
- **Not encrypted at rest**: `user_memory` rows are plain text in SQLite. (Only the API keys in `app_kv` are encrypted, with Electron `safeStorage` on Windows and Linux; macOS stores them as plain text to avoid keychain prompts.)
- **No RLS**: Queries filter on `user_id = LOCAL_USER_ID`, but that keeps row shapes consistent rather than enforcing access; there is only one user.
- **IPC guards**: Handlers still check `authState.isAuthenticated`, which is always `true` in the local build.
- **Python endpoint**: No auth. It listens on `127.0.0.1` only and `BrowserOriginGuard` blocks calls from web pages (foreign `Origin` headers). The OpenRouter key arrives per request and is not stored.
- **What leaves the machine**: For extraction, the raw prompt, the optimized text and the skill go to OpenRouter (with the user's key) on every 3rd optimization while learning is enabled. Injected memory context also reaches OpenRouter as part of the optimizer's system prompt.

### 11.2 Prompt Injection Defense

The `sanitizeField()` method strips:

- Bracket markers (`[`, `]`, `{`, `}`) — prevents injecting structured prompt blocks
- `SYSTEM:` prefixes — prevents role impersonation
- `IGNORE (ALL) PREVIOUS` — prevents jailbreak phrases
- `OVERRIDE:` — prevents override directives
- `INSTRUCTION:` — prevents instruction injection

Length caps (`MAX_KEY_LEN = 60`, `MAX_VALUE_LEN = 300`) prevent oversized payloads. The 800-character context cap prevents the memory block from dominating the system prompt.

### 11.3 Anti-Override in Optimizer

The Python optimizer wraps memory with explicit guardrail language:

- "Apply these as secondary enrichment to the optimized prompt"
- "Do not let user memory override the user's explicit intent"

The `buildMemoryContext()` method adds per-section guardrails:

- Persona: "NEVER use to change the type or purpose of the prompt. If the user asks to build software, it is a coding task regardless of their occupation."
- Preferences: "apply where relevant to enrich the optimized prompt"

### 11.4 User Control & Deletion

- **Off switch**: Turning off "Learn from my usage" stops both extraction and injection (§2.6).
- **Per-fact deletion**: Settings > Memory → trash icon → `DELETE FROM user_memory WHERE user_id = ? AND memory_type = ? AND key = ?`.
- **Full wipe**: Delete `prmpt.db` (or the user-data folder) while the app is closed. There is no account or server-side record to remove.

---

## 12. Configuration Reference

### 12.1 Environment Variables


| Variable             | Where Read                             | Default                                                            | Purpose                                                                                             |
| -------------------- | -------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `MEMORY_MODEL`       | `python-service/pipeline_v2/config.py` | Falls back to `SUMMARIZER_MODEL` → `openrouter/openai/gpt-4o-mini` | LLM model used for fact extraction                                                                  |
| `SUMMARIZER_MODEL`   | `python-service/pipeline_v2/config.py` | `openrouter/openai/gpt-4o-mini`                                    | Fallback for `MEMORY_MODEL`                                                                         |
| `OPENROUTER_API_KEY` | `python-service/pipeline_v2/config.py` | `""`                                                               | Fallback only, for calling the service directly (scripts/curl). The app sends the user's key per request |


Note: `MEMORY_MODEL` is documented in `README.md` but is **not** listed in `.env.example`.

The user's OpenRouter key is not an environment variable: it is entered in the app (onboarding or Settings > AI provider), stored by `electron/main/database/services/ai-settings-service.ts` in the local `app_kv` table, and sent to the service in the `X-Prmpt-OpenRouter-Key` header.

### 12.2 Database Settings


| Setting          | Table (local SQLite) | Default     | Purpose                                                                                        |
| ---------------- | -------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `memory_enabled` | `user_settings`      | `1` (true)  | User toggle for auto-learning. When `false`, extraction is disabled; injection is also skipped |


### 12.3 Hardcoded Constants


| Constant                   | Location                          | Value          | Purpose                                        |
| -------------------------- | --------------------------------- | -------------- | ---------------------------------------------- |
| `runEveryN`                | `MemoryAnalyzer`                  | `3`            | Extract facts every Nth optimization           |
| `MAX_KEY_LEN`              | `MemoryService`                   | `60`           | Max characters for fact keys                   |
| `MAX_VALUE_LEN`            | `MemoryService`                   | `300`          | Max characters for fact values                 |
| Context cap                | `buildMemoryContext()`            | `800` chars    | Max injected context size                      |
| Confidence threshold       | `buildMemoryContext()`            | `0.5`          | Minimum confidence for inclusion in prompts    |
| Inferred confidence cap    | Python endpoint                   | `0.95`         | Prevents inferred from matching explicit (1.0) |
| LLM temperature            | Python endpoint                   | `0.1`          | Near-deterministic extraction                  |
| LLM max_tokens             | Python endpoint                   | `300`          | Compact fact output                            |
| Input cap (raw prompt)     | Pydantic model                    | `50,000` chars | Prevents oversized extraction requests         |
| Input cap (optimized text) | Pydantic model                    | `50,000` chars | Prevents oversized extraction requests         |
| Min prompt length          | Python endpoint                   | `10` chars     | Skips trivially short prompts                  |
| HTTP timeout               | `PythonClient.extractMemoryFacts` | `15,000` ms    | Prevents indefinite waiting on extraction      |
| `LOCAL_USER_ID`            | `local-db.ts`                     | `00000000-0000-0000-0000-000000000001` | The single local user's id on every row |


---

## 13. File Inventory

### 13.1 Core Implementation


| File                                                  | Role                                                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `electron/main/database/local-db.ts`                  | Opens `{userData}/prmpt.db` (better-sqlite3), creates the schema incl. `user_memory`, exports `getDb()`, `LOCAL_USER_ID`, `newId()`, `nowIso()` |
| `electron/main/database/services/memory-service.ts`   | Data-access layer: types, CRUD, sanitization, `buildMemoryContext()`                                                 |
| `electron/main/database/services/memory-analyzer.ts`  | Orchestration: throttling, extraction pipeline, toggle check, UI push                                                |
| `electron/main/ipc-handlers/user-handlers.ts`         | IPC controllers: `memory:get`, `memory:upsert`, `memory:delete`, `memory:get-enabled`, `memory:set-enabled`          |
| `electron/main/ipc-handlers/chat-handlers.ts`         | Injects memory into `customInstructions` on optimize/send/regenerate; fires `analyzer.onNewOptimization` after saves |
| `electron/main/ipc-handlers/overlay-ipc-handlers.ts`  | Same injection + analyzer for overlay optimize and clarification-complete paths                                      |
| `electron/main/api/python-client.ts`                  | `extractMemoryFacts()` → HTTP `POST /extract-memory-facts`; interceptor adds the provider headers                    |
| `electron/main/database/services/settings-service.ts` | `UserSettings.memory_enabled` + defaults (local `user_settings` table)                                               |
| `electron/main/database/services/user-service.ts`     | Local profile used by `isMemoryEnabled()` and the toggle handlers                                                    |
| `electron/main/database/services/ai-settings-service.ts` | User's OpenRouter key and models; `pythonHeaders()` for the requests above                                        |
| `electron/main/utils/auth-state.ts`                   | Constant session for the single local user (no login)                                                                |
| `python-service/app/main.py`                          | FastAPI models + `MEMORY_EXTRACTION_SYSTEM_PROMPT` + `/extract-memory-facts` endpoint                                |
| `python-service/app/origin_guard.py`                  | `BrowserOriginGuard` middleware for the local API                                                                    |
| `python-service/pipeline_v2/config.py`                | `MEMORY_MODEL` env config, `LLMSettings`, `provider_kwargs()`                                                        |
| `python-service/pipeline_v2/optimizer.py`             | Appends `custom_instructions` (incl. memory) to system prompt with anti-override guard                               |


### 13.2 Schema

There are no SQL migration files. The schema lives in `migrate()` in `electron/main/database/local-db.ts` and is created on first open. `migrate()` only runs while `PRAGMA user_version` is below `SCHEMA_VERSION` (currently `1`), so a schema change needs a version bump plus steps that upgrade existing databases.

### 13.3 Bridge & Types


| File                             | Role                                                                |
| -------------------------------- | ------------------------------------------------------------------- |
| `electron/preload.ts`            | Exposes `window.electronAPI.memory.*` and `memory:updated` listener |
| `app-ui/src/types/electron.d.ts` | TypeScript contracts for memory API and `MemoryEntry`               |


### 13.4 Frontend


| File                                              | Role                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `app-ui/src/components/settings/MemoryView.tsx`   | Main memory UI: toggle, three sections, list/edit/delete/add, live sync                |
| `app-ui/src/components/settings/SettingsView.tsx` | Settings shell: "Memory" tab that renders `MemoryView`                                 |
| `app-ui/src/components/auth/OnboardingPage.tsx`   | Onboarding "Memory & Context" slide + `MemoryDemo` (presentational only, no real data) |


---

## 14. Known Gaps & Limitations


| Gap                                      | Description                                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **No automated tests**                   | Nothing tests the memory components (service, analyzer, IPC handlers, Python endpoint, or UI). `tests/e2e/overlay.test.ts` only mocks `MemoryService`/`MemoryAnalyzer`, and `tests/mocks/python-server.ts` stubs `/extract-memory-facts` |
| **No TTL / decay**                       | Facts never expire. Memory accumulates indefinitely with no cleanup mechanism                                                                                      |
| **No search or filter in UI**            | Users must scroll through all facts; no keyword search, date filter, or sort options                                                                               |
| **No compaction**                        | If the same key is re-inferred with a different value, it overwrites. There's no versioning or history                                                             |
| **In-memory throttle counter**           | `optimizationsSinceLastRun` resets on app restart, and the chat and overlay paths each keep their own counter, so the extraction cadence is unpredictable across sessions |
| **No dedicated background workers**      | Extraction runs on fire-and-forget promises in the main Electron process. If the app closes mid-extraction, the work is lost                                       |
| **No vector/semantic retrieval**         | All facts are loaded and filtered by confidence. As fact count grows, this doesn't scale — though the 800-char cap on output provides a natural ceiling            |
| **Priority check uses the raw key**      | `upsertInferredEntries()` checks explicit priority and observation counts against the key as returned by the LLM, but stores the sanitized key. If sanitization changes a key, the explicit check and the count lookup can miss |
| **Not encrypted at rest**                | Memory rows are plain text in `prmpt.db`; anyone with access to the user's profile folder can read them                                                           |
| **`MEMORY_MODEL` not in `.env.example`** | Documented in README but missing from the example env file                                                                                                         |
| **Documentation drift**                  | `ARCHITECTURE.md` references `domain`/`style`/`score` columns that don't exist in the actual schema; the real columns are `memory_type`/`key`/`value`/`confidence` |
| **No rate limiting on extraction**       | Beyond the every-3rd-optimization throttle, there's no per-minute or per-day cap on LLM extraction calls, which are billed to the user's own OpenRouter key        |
| **No UI for observation count context**  | The eye icon shows the count but doesn't explain what it means (no tooltip beyond the HTML `title` attribute)                                                      |
| **Fail-open toggle check**               | `isMemoryEnabled()` returns `true` on any error, meaning a settings-read failure could cause unwanted extraction                                                   |

