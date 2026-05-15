# Memory Layer — Complete Technical Documentation

> **Scope**: This document covers the **user personalization memory** system — the feature that learns facts about a user from their prompt optimization history and injects those facts back into future optimizations. It does **not** cover code-intelligence embeddings/pgvector (`code-intelligence-service/`), which index repository code, not user facts.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Database Schema](#2-database-schema)
3. [Core Backend Service — `MemoryService](#3-core-backend-service--memoryservice)`
4. [Orchestration — `MemoryAnalyzer](#4-orchestration--memoryanalyzer)`
5. [Python Extraction Endpoint](#5-python-extraction-endpoint)
6. [IPC Bridge (Electron Main ↔ Renderer)](#6-ipc-bridge-electron-main--renderer)
7. [Chat Integration — How Memory Gets Used](#7-chat-integration--how-memory-gets-used)
8. [Frontend UI — `MemoryView](#8-frontend-ui--memoryview)`
9. [Priority System (Explicit vs Inferred)](#9-priority-system-explicit-vs-inferred)
10. [End-to-End Data Flow](#10-end-to-end-data-flow)
11. [Security & Sanitization](#11-security--sanitization)
12. [Configuration Reference](#12-configuration-reference)
13. [File Inventory](#13-file-inventory)
14. [Known Gaps & Limitations](#14-known-gaps--limitations)

---

## 1. Architecture Overview

The memory layer is a **user personalization system** that learns facts about the user from their prompt optimization history and injects those facts back into future optimizations. It operates across four layers:

```
┌──────────────────────────────────────────────────────────────────────┐
│                         RENDERER (React)                             │
│  MemoryView.tsx ─── Settings > Memory tab                            │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐                 │
│  │ About You   │  │ Usage       │  │ Recurring    │   Toggle: Learn  │
│  │ (user)      │  │ Patterns    │  │ Themes       │   from my usage  │
│  │             │  │ (behavioral)│  │ (context)    │                  │
│  └─────────────┘  └─────────────┘  └──────────────┘                 │
│         │                │                │                          │
│         └────────────────┼────────────────┘                          │
│                          │  window.electronAPI.memory.*               │
└──────────────────────────┼───────────────────────────────────────────┘
                           │  IPC (invoke / on)
┌──────────────────────────┼───────────────────────────────────────────┐
│                  ELECTRON MAIN PROCESS                                │
│                          │                                           │
│  ┌───────────────────────▼───────────────────────┐                   │
│  │           user-handlers.ts (IPC controllers)   │                   │
│  │  memory:get · memory:upsert · memory:delete    │                   │
│  │  memory:get-enabled · memory:set-enabled        │                   │
│  └───────────────────────┬───────────────────────┘                   │
│                          │                                           │
│  ┌───────────────────────▼───────────────────────┐                   │
│  │              MemoryService                      │                   │
│  │  getMemory() · upsertMemoryEntry()              │                   │
│  │  upsertInferredEntries() · deleteMemoryEntry()  │                   │
│  │  buildMemoryContext() · hasExplicitEntry()       │                   │
│  └───────────────────────┬───────────────────────┘                   │
│                          │                                           │
│  ┌───────────────────────▼───────────────────────┐                   │
│  │              MemoryAnalyzer                     │                   │
│  │  onNewOptimization() — every 3rd optimization   │                   │
│  │  extractAndUpsert() — LLM extraction pipeline   │                   │
│  │  isMemoryEnabled() — toggle check               │                   │
│  └───────────────────────┬───────────────────────┘                   │
│                          │                                           │
│  ┌───────────────────────▼───────────────────────┐                   │
│  │  chat-handlers.ts / overlay-ipc-handlers.ts    │                   │
│  │  Inject memory into customInstructions before   │                   │
│  │  optimization; fire analyzer after each result  │                   │
│  └───────────────────────┬───────────────────────┘                   │
└──────────────────────────┼───────────────────────────────────────────┘
                           │  HTTP (axios)
┌──────────────────────────┼───────────────────────────────────────────┐
│                  PYTHON SERVICE (FastAPI)                             │
│                          │                                           │
│  ┌───────────────────────▼───────────────────────┐                   │
│  │     POST /extract-memory-facts                 │                   │
│  │  LiteLLM completion → JSON array of facts      │                   │
│  │  model: MEMORY_MODEL  temp: 0.1  max: 300 tok  │                   │
│  └───────────────────────────────────────────────┘                   │
│                                                                      │
│  ┌───────────────────────────────────────────────┐                   │
│  │     optimizer.py                               │                   │
│  │  Appends custom_instructions (incl. memory)    │                   │
│  │  to system prompt with anti-override guard      │                   │
│  └───────────────────────────────────────────────┘                   │
└──────────────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────┼───────────────────────────────────────────┐
│                  SUPABASE POSTGRES                                    │
│                          │                                           │
│  ┌───────────────────────▼───────────────────────┐                   │
│  │  user_memory                                   │                   │
│  │  PK: id (UUID)                                 │                   │
│  │  UNIQUE: (user_id, memory_type, key)           │                   │
│  │  RLS: user_id = auth.uid()                     │                   │
│  │  Columns: memory_type, key, value, confidence, │                   │
│  │           source, observation_count, timestamps │                   │
│  └───────────────────────────────────────────────┘                   │
│                                                                      │
│  ┌───────────────────────────────────────────────┐                   │
│  │  user_settings.memory_enabled (boolean)        │                   │
│  └───────────────────────────────────────────────┘                   │
└──────────────────────────────────────────────────────────────────────┘
```

Key design decisions:

- **No vectors, no embeddings, no semantic search** on user memory. Facts are literal key-value strings; retrieval is "load all for user → filter by confidence → format string."
- **No external vector database** (Qdrant, Pinecone, Weaviate, Chroma). The `pgvector` infrastructure elsewhere in the repo is for code intelligence (Spaces), not this feature.
- **No dedicated REST API**. The renderer communicates via Electron IPC; the main process talks to Supabase via the JS client and to Python via HTTP.
- **No background workers or queues**. Extraction is fire-and-forget promises triggered inline after each optimization.

---

## 2. Database Schema

### 2.1 Table: `user_memory`

**Migration**: `supabase/migrations/20260315120000_add_user_memory.sql`

```sql
CREATE TABLE IF NOT EXISTS user_memory (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  memory_type  TEXT        NOT NULL CHECK (memory_type IN ('user', 'behavioral', 'context')),
  key          TEXT        NOT NULL,
  value        TEXT        NOT NULL,
  confidence   FLOAT       NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  source       TEXT        NOT NULL DEFAULT 'inferred' CHECK (source IN ('inferred', 'explicit')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_memory UNIQUE (user_id, memory_type, key)
);
```

**Added by follow-up migration** (`20260323_add_observation_count_to_user_memory.sql`):

```sql
ALTER TABLE user_memory
  ADD COLUMN IF NOT EXISTS observation_count INT NOT NULL DEFAULT 1;
```

### 2.2 Column Reference


| Column              | Type        | Default             | Constraints                                | Purpose                                                          |
| ------------------- | ----------- | ------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| `id`                | UUID        | `gen_random_uuid()` | PK                                         | Row identifier                                                   |
| `user_id`           | UUID        | —                   | FK → `auth.users(id)` ON DELETE CASCADE    | Owner. Cascade ensures account deletion removes all memory       |
| `memory_type`       | TEXT        | —                   | CHECK IN (`user`, `behavioral`, `context`) | Bucket categorization (see §2.3)                                 |
| `key`               | TEXT        | —                   | Part of UNIQUE constraint                  | Snake_case label within a bucket (e.g. `role`, `preferred_tone`) |
| `value`             | TEXT        | —                   | NOT NULL                                   | The factual statement (e.g. "Full-stack developer")              |
| `confidence`        | FLOAT       | `1.0`               | CHECK 0.0–1.0                              | How certain the system is. Explicit = 1.0; inferred ≤ 0.95       |
| `source`            | TEXT        | `'inferred'`        | CHECK IN (`inferred`, `explicit`)          | Who created it: the user or the LLM                              |
| `observation_count` | INT         | `1`                 | NOT NULL                                   | How many times the LLM independently observed this fact          |
| `created_at`        | TIMESTAMPTZ | `NOW()`             | NOT NULL                                   | Row creation time                                                |
| `updated_at`        | TIMESTAMPTZ | `NOW()`             | NOT NULL, auto-updated by trigger          | Last modification time                                           |


### 2.3 Memory Type Buckets


| Type         | Label in UI        | What it stores                                                                  | Examples                                               |
| ------------ | ------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `user`       | "About You"        | Identity facts — role, domain, occupation, preferences the user explicitly sets | `role: "Senior Backend Engineer"`, `domain: "fintech"` |
| `behavioral` | "Usage Patterns"   | Inferred usage patterns — writing style, tone preferences, model choices        | `preferred_tone: "Technical and concise"`              |
| `context`    | "Recurring Themes" | Common topics and subjects detected across prompts                              | `primary_framework: "React with TypeScript"`           |


### 2.4 Indexes & Constraints

- **Unique constraint**: `UNIQUE (user_id, memory_type, key)` — one value per user per type per key. This is what makes upsert work via `ON CONFLICT`.
- **Composite index**: `idx_user_memory_user_type ON (user_id, memory_type)` — efficient per-user filtered queries.
- **RLS policy**: "Users can manage own memory" — `USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())` for ALL operations.
- **Permissions**: `GRANT SELECT, INSERT, UPDATE, DELETE ON user_memory TO authenticated`.

### 2.5 Auto-update Trigger

```sql
CREATE OR REPLACE FUNCTION update_user_memory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_user_memory_updated_at
  BEFORE UPDATE ON user_memory
  FOR EACH ROW
  EXECUTE FUNCTION update_user_memory_updated_at();
```

### 2.6 Settings Toggle

**Migration**: `supabase/migrations/20260323_add_memory_enabled_to_settings.sql`

```sql
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS memory_enabled BOOLEAN NOT NULL DEFAULT true;
```

When `false`, automatic fact extraction is disabled. Users can still add/edit facts manually.

### 2.7 GDPR / Account Deletion

The migration `20260328_add_deletion_requests.sql` contains a comment noting that `user_memory` rows should be removed in GDPR processing. The `ON DELETE CASCADE` foreign key also ensures rows are removed when the `auth.users` row is deleted.

---

## 3. Core Backend Service — `MemoryService`

**File**: `electron/main/database/services/memory-service.ts`

This is the data-access layer. Every read/write to `user_memory` goes through it. It uses the Supabase JS client directly (not a REST API).

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

Fetches all entries for the authenticated user, ordered by `memory_type` then `key`, and groups them into the three-bucket map. This powers both the Settings UI and the context builder.

#### `upsertMemoryEntry(memoryType, key, value, source, confidence)`

Single-entry upsert used by the IPC handler when users manually add or edit a fact from the UI. Uses `ON CONFLICT (user_id, memory_type, key)` for conflict resolution. Always resets `observation_count` to 1 (explicit entries don't accumulate observations).

Default `source` is `'inferred'`; the UI always overrides to `'explicit'`. Default `confidence` is `1.0`.

#### `hasExplicitEntry(memoryType, key): Promise<boolean>`

Checks if a user-set (`source = 'explicit'`) entry exists for a given `(memoryType, key)`. This is the gatekeeper that prevents inferred facts from overwriting user-set facts.

#### `upsertInferredEntry(memoryType, key, value, confidence)`

Single inferred upsert with explicit-priority check and observation count incrementing. Calls `hasExplicitEntry()` first and bails if it returns `true`. If the row already exists, increments `observation_count` by 1.

#### `upsertInferredEntries(facts[]): Promise<number>`

**Batch upsert** — the primary write path for automated fact extraction. Optimized to exactly **3 DB round-trips** regardless of how many facts are being written:

1. **Fetch all explicit entries** → builds a `Set<"memoryType::key">` for O(1) skip checks.
2. **Fetch existing inferred entries** → builds a `Map` of current `observation_count` values.
3. **Single batch upsert** of all eligible rows with incremented counts.

Returns the number of rows actually written (after filtering out explicit-blocked and empty-after-sanitization rows).

#### `deleteMemoryEntry(memoryType, key)`

Deletes a specific entry filtered by `(user_id, memory_type, key)`. RLS is also enforced server-side.

#### `buildMemoryContext(): Promise<string>`

The critical method that transforms stored facts into a string injected into the optimizer's system prompt. This is where memory becomes actionable.

**Algorithm:**

1. Load all memory entries via `getMemory()`.
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

Every key and value passes through `sanitizeField()` before storage and before injection:

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

Lazily instantiated in `chat-handlers.ts` and `overlay-ipc-handlers.ts` via `getServices()`. Receives the shared `PythonClient` and `AppWindowManager` for HTTP calls and UI event pushing.

### 4.2 Throttling

```typescript
private optimizationsSinceLastRun = 0;
private readonly runEveryN = 3;
```

Extraction only runs every **3rd** successful optimization. This prevents hammering the LLM endpoint during rapid-fire usage. The counter is **in-memory** and resets on app restart — there is no persistent tracking of the count.

### 4.3 `onNewOptimization(userId, rawPrompt, optimizedText, skill)`

The public entry point, called fire-and-forget after every successful optimization:

1. Increment `optimizationsSinceLastRun`.
2. If counter < `runEveryN` (3), return immediately (no extraction this time).
3. Reset counter to 0.
4. Call `extractAndUpsert()` inside a try/catch — failures are logged but **never** block the main flow.

### 4.4 `extractAndUpsert()` — Core Pipeline

1. **Check toggle**: `isMemoryEnabled()` reads `user_settings.memory_enabled`. Defaults to `true` if settings can't be fetched (fail-open). If disabled, logs and returns.
2. **Extract facts**: `pythonClient.extractMemoryFacts(rawPrompt, optimizedText, skill)` → HTTP POST to Python service.
3. **Filter**: Only accepts facts with valid categories (`user`, `behavioral`, `context`).
4. **Batch upsert**: `memoryService.upsertInferredEntries(eligibleFacts)` — 3 DB round-trips, respects explicit priority.
5. **Push to UI**: If any rows were upserted and `appWindowManager` is available, sends `memory:updated` event with the full updated `UserMemoryMap`.

### 4.5 `isMemoryEnabled(): Promise<boolean>`

Reads the user's settings to check the memory toggle. Returns `true` by default if:

- The user profile can't be fetched
- The settings can't be fetched
- The `memory_enabled` field is `null` or missing (old DB rows)

This is a **fail-open** design: memory features stay active unless explicitly disabled.

---

## 5. Python Extraction Endpoint

**File**: `python-service/app/main.py` (lines 1086–1220)

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

1. **Auth**: Protected by `require_auth` (Supabase JWT verification).
2. **Input validation**: Raw prompt must be ≥ 10 characters. If shorter, returns empty facts.
3. **User content construction**: Concatenates raw prompt + optimized text + optional detected skill.
4. **LLM call** via LiteLLM:
  - **Model**: `MEMORY_MODEL` (defaults to `SUMMARIZER_MODEL` → `openrouter/openai/gpt-4o-mini`)
  - **Temperature**: 0.1 (near-deterministic)
  - **Max tokens**: 300 (compact output)
  - Uses `OPENROUTER_API_KEY` if the model name contains "openrouter"
5. **Usage logging**: Logged as `memory_extraction` call type with prompt/completion tokens and latency for cost tracking.
6. **JSON parsing**:
  - Strips markdown code fences if the LLM wraps its output in them.
  - Parses as JSON array; rejects non-array responses.
  - Validates each item: must have a valid category, non-empty key/value, confidence in [0.0, 1.0].
7. **Confidence cap**: All inferred confidences are clamped to **max 0.95** so explicit entries (1.0) always win in priority comparisons.
8. **Error handling**: Returns empty `facts: []` on any failure — JSON parse error, LLM timeout, network error, etc. Never throws to the caller.

### 5.4 Model Configuration

**File**: `python-service/pipeline_v2/config.py`

```python
OPTIMIZER_MODEL  = os.environ.get("OPTIMIZER_MODEL",  "openrouter/openai/gpt-4o-mini")
SUMMARIZER_MODEL = os.environ.get("SUMMARIZER_MODEL", "openrouter/openai/gpt-4o-mini")
TITLE_MODEL      = os.environ.get("TITLE_MODEL",      SUMMARIZER_MODEL)
MEMORY_MODEL     = os.environ.get("MEMORY_MODEL",     SUMMARIZER_MODEL)
```

`MEMORY_MODEL` cascades: env var → `SUMMARIZER_MODEL` env var → hardcoded `openrouter/openai/gpt-4o-mini`.

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


| Channel              | Type                    | Auth Required                  | Purpose                                                                            |
| -------------------- | ----------------------- | ------------------------------ | ---------------------------------------------------------------------------------- |
| `memory:get`         | invoke (req/res)        | Yes (returns empty map if not) | Fetch all memory grouped by type                                                   |
| `memory:upsert`      | invoke (req/res)        | Yes                            | Create or update a fact. UI defaults to `source: 'explicit'`, `confidence: 1.0`    |
| `memory:delete`      | invoke (req/res)        | Yes                            | Remove a fact by `(memoryType, key)`                                               |
| `memory:get-enabled` | invoke (req/res)        | Yes                            | Check if auto-learning toggle is on                                                |
| `memory:set-enabled` | invoke (req/res)        | Yes                            | Toggle auto-learning on/off (writes to `user_settings`)                            |
| `memory:updated`     | event (main → renderer) | —                              | Pushed after background extraction completes with the full updated `UserMemoryMap` |


All handlers wrap in try/catch with `Sentry.captureException` tagging the component and operation. On unauthenticated calls, `memory:get` returns `{ user: {}, behavioral: {}, context: {} }` instead of throwing.

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
| `chat-handlers.ts`        | `app:regenerate-prompt` (regeneration)                 |
| `overlay-ipc-handlers.ts` | Overlay optimize                                       |


All four follow the identical pattern:

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

`customInstructions` may already contain `user_settings.prompt_instructions` (the user's manually entered custom instructions). Memory context is appended after it.

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
  ├─ 1. Fetch user_settings.prompt_instructions (custom instructions)
  │
  ├─ 2. Check: is user authenticated? Do memory + analyzer exist?
  │     │
  │     └─ YES → analyzer.isMemoryEnabled()
  │              │
  │              ├─ FALSE → skip memory, use only prompt_instructions
  │              │
  │              └─ TRUE → memory.buildMemoryContext()
  │                        │
  │                        ├─ Load all user_memory rows
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
  ├─ Save optimization record to DB
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
                │     └─ POST /extract-memory-facts
                │        │
                │        ├─ LLM (gpt-4o-mini, temp 0.1, max 300 tokens)
                │        ├─ System: MEMORY_EXTRACTION_SYSTEM_PROMPT
                │        ├─ User: "Raw prompt:\n{raw}\n\nOptimized:\n{optimized}"
                │        │
                │        ├─ Parse JSON → validate categories, keys, values
                │        ├─ Cap confidence at 0.95
                │        └─ Return MemoryFact[]
                │
                ├─ 3. Filter to valid categories (user/behavioral/context)
                │
                ├─ 4. memoryService.upsertInferredEntries(facts)
                │     │
                │     ├─ Query 1: fetch all explicit entries → build skip set
                │     ├─ Query 2: fetch existing entries → get observation counts
                │     ├─ Sanitize keys/values (strip injection patterns)
                │     ├─ Build upsert payload (skip explicit-blocked, increment counts)
                │     └─ Query 3: batch upsert
                │
                └─ 5. appWindowManager.send('memory:updated', updatedMemory)
                      │
                      └─ [Renderer] onUpdated callback → setMemory(updatedMemory)
                         → UI refreshes live in Settings > Memory
```

---

## 11. Security & Sanitization

### 11.1 Authentication & Authorization

- **Database RLS**: Every query on `user_memory` is scoped to `auth.uid()`. Even if the Supabase client is misconfigured, Postgres enforces row-level access.
- **IPC guards**: All IPC handlers check `authState.isAuthenticated` before proceeding.
- **Python endpoint**: Protected by `require_auth` middleware (Supabase JWT verification).
- **Account deletion**: `ON DELETE CASCADE` on the foreign key ensures all memory is removed when the user's auth record is deleted.

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

### 11.4 GDPR Considerations

The migration `20260328_add_deletion_requests.sql` documents that `user_memory` should be included in GDPR deletion flows. The `ON DELETE CASCADE` FK handles the database side, but the comment suggests additional edge function work may be needed for complete compliance.

---

## 12. Configuration Reference

### 12.1 Environment Variables


| Variable             | Where Read                             | Default                                                            | Purpose                              |
| -------------------- | -------------------------------------- | ------------------------------------------------------------------ | ------------------------------------ |
| `MEMORY_MODEL`       | `python-service/pipeline_v2/config.py` | Falls back to `SUMMARIZER_MODEL` → `openrouter/openai/gpt-4o-mini` | LLM model used for fact extraction   |
| `SUMMARIZER_MODEL`   | `python-service/pipeline_v2/config.py` | `openrouter/openai/gpt-4o-mini`                                    | Fallback for `MEMORY_MODEL`          |
| `OPENROUTER_API_KEY` | `python-service/pipeline_v2/config.py` | `""`                                                               | API key for OpenRouter-hosted models |


Note: `MEMORY_MODEL` is documented in `README.md` but is **not** listed in `.env.example`.

### 12.2 Database Settings


| Setting          | Table           | Default | Purpose                                                                                        |
| ---------------- | --------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `memory_enabled` | `user_settings` | `true`  | User toggle for auto-learning. When `false`, extraction is disabled; injection is also skipped |


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


---

## 13. File Inventory

### 13.1 Core Implementation


| File                                                  | Role                                                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `electron/main/database/services/memory-service.ts`   | Data-access layer: types, CRUD, sanitization, `buildMemoryContext()`                                                 |
| `electron/main/database/services/memory-analyzer.ts`  | Orchestration: throttling, extraction pipeline, toggle check, UI push                                                |
| `electron/main/ipc-handlers/user-handlers.ts`         | IPC controllers: `memory:get`, `memory:upsert`, `memory:delete`, `memory:get-enabled`, `memory:set-enabled`          |
| `electron/main/ipc-handlers/chat-handlers.ts`         | Injects memory into `customInstructions` on optimize/send/regenerate; fires `analyzer.onNewOptimization` after saves |
| `electron/main/ipc-handlers/overlay-ipc-handlers.ts`  | Same injection + analyzer for overlay optimize and clarification-complete paths                                      |
| `electron/main/api/python-client.ts`                  | `extractMemoryFacts()` → HTTP `POST /extract-memory-facts`                                                           |
| `electron/main/database/services/settings-service.ts` | `UserSettings.memory_enabled` + defaults                                                                             |
| `python-service/app/main.py`                          | FastAPI models + `MEMORY_EXTRACTION_SYSTEM_PROMPT` + `/extract-memory-facts` endpoint                                |
| `python-service/pipeline_v2/config.py`                | `MEMORY_MODEL` env config                                                                                            |
| `python-service/pipeline_v2/optimizer.py`             | Appends `custom_instructions` (incl. memory) to system prompt with anti-override guard                               |


### 13.2 Database Migrations


| File                                                                    | Purpose                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------ |
| `supabase/migrations/20260315120000_add_user_memory.sql`                | Creates `user_memory` table, RLS, indexes, trigger     |
| `supabase/migrations/20260323_add_memory_enabled_to_settings.sql`       | Adds `user_settings.memory_enabled`                    |
| `supabase/migrations/20260323_add_observation_count_to_user_memory.sql` | Adds `observation_count` column                        |
| `supabase/migrations/20260328_add_deletion_requests.sql`                | GDPR comment: delete `user_memory` in account deletion |


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
| **No automated tests**                   | No test files found for any memory component (service, analyzer, IPC handlers, Python endpoint, or UI)                                                             |
| **No TTL / decay**                       | Facts never expire. Memory accumulates indefinitely with no cleanup mechanism                                                                                      |
| **No search or filter in UI**            | Users must scroll through all facts; no keyword search, date filter, or sort options                                                                               |
| **No compaction**                        | If the same key is re-inferred with a different value, it overwrites. There's no versioning or history                                                             |
| **In-memory throttle counter**           | `optimizationsSinceLastRun` resets on app restart, so the extraction cadence is unpredictable across sessions                                                      |
| **No dedicated background workers**      | Extraction runs on fire-and-forget promises in the main Electron process. If the app closes mid-extraction, the work is lost                                       |
| **No vector/semantic retrieval**         | All facts are loaded and filtered by confidence. As fact count grows, this doesn't scale — though the 800-char cap on output provides a natural ceiling            |
| `**MEMORY_MODEL` not in `.env.example`** | Documented in README but missing from the example env file                                                                                                         |
| **Documentation drift**                  | `ARCHITECTURE.md` references `domain`/`style`/`score` columns that don't exist in the actual schema; the real columns are `memory_type`/`key`/`value`/`confidence` |
| **No rate limiting on extraction**       | Beyond the every-3rd-optimization throttle, there's no per-minute or per-day cap on LLM extraction calls                                                           |
| **No UI for observation count context**  | The eye icon shows the count but doesn't explain what it means (no tooltip beyond the HTML `title` attribute)                                                      |
| **Fail-open toggle check**               | `isMemoryEnabled()` returns `true` on any error, meaning a settings-fetch failure could cause unwanted extraction                                                  |


