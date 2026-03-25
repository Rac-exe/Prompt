# Memory System: Consolidated Implementation Plan

## Status: Implementing Steps 1 & 2

---

## Problem Statement

The current `MemoryAnalyzer` uses hardcoded keyword lists (`DOMAIN_KEYWORDS`, `STYLE_PATTERNS`) to infer user facts. This is brittle, produces generic/useless facts, and once a fact is deleted it never regenerates. There is no way to disable memory, and no priority system for explicit vs. inferred facts.

---

## Architecture

```
User sends prompt
       │
       ▼
  Electron Main ──────────► Python FastAPI (/ws/optimize-stream)
       │                          │
       │                     LLM optimizes prompt (streamed)
       │                          │
       │◄─────────────────────────┘
       │
       ▼
  Show result to user (instant — no delay)
       │
       ▼ (fire-and-forget, async, non-blocking)
  Check memory_enabled toggle
       │
       ├─ Toggle OFF → skip
       │
       └─ Toggle ON → POST /extract-memory-facts
                            │
                       LLM extracts facts (~550 tokens, cheap call)
                            │
                       Return JSON facts
                            │
                       Upsert into Supabase user_memory
                       (skip if explicit fact exists with same key)
                            │
                       Push updated memory to UI via IPC
```

---

## Step 1: LLM-Powered Fact Extraction

### 1.1 New Python Endpoint: `/extract-memory-facts`

**File:** `python-service/app/main.py`

- `POST /extract-memory-facts`
- Receives: `{ raw_prompt, optimized_text, skill }`
- Calls claude-haiku-4.5 with a structured system prompt
- Returns: `{ facts: [{ category, key, value, confidence }] }`
- Categories: `user`, `behavioral`, `context`
- Logs usage via `usage_logger.log_usage()` with `call_type="memory_extraction"`

### 1.2 New PythonClient Method

**File:** `electron/main/api/python-client.ts`

- Add `extractMemoryFacts(rawPrompt, optimizedText, skill)` method
- Uses HTTP POST (not WebSocket — simple request/response)
- Returns `ExtractedFact[]`

### 1.3 Rewrite MemoryAnalyzer

**File:** `electron/main/database/services/memory-analyzer.ts`

- Remove ALL hardcoded keyword lists (`DOMAIN_KEYWORDS`, `STYLE_PATTERNS`)
- `onNewOptimization()` now:
  1. Checks if `memory_enabled` toggle is ON (via SettingsService)
  2. Calls `pythonClient.extractMemoryFacts()`
  3. For each returned fact, checks if an `explicit` source fact with same key exists → skip
  4. Upserts inferred facts
  5. Pushes updated memory to app window via IPC
- Constructor takes `PythonClient`, `MemoryService`, `SettingsService` as deps

### 1.4 Update MemoryService

**File:** `electron/main/database/services/memory-service.ts`

- `upsertMemoryEntry()` already handles upsert correctly
- Add `hasExplicitEntry(memoryType, key)` helper for explicit-priority check

### 1.5 Wire Up Extraction in Optimization Paths

**Files:** `electron/main/ipc-handlers/chat-handlers.ts`, `overlay-ipc-handlers.ts`

- After optimization completes, call `analyzer.onNewOptimization()` with raw prompt, optimized text, and skill
- Guard memory context injection with toggle check

---

## Step 2: Memory Toggle & UI

### 2.1 Database Migration

- Add `memory_enabled BOOLEAN NOT NULL DEFAULT true` to `user_settings`
- Add `observation_count INT NOT NULL DEFAULT 1` to `user_memory`

### 2.2 Settings Service Update

**File:** `electron/main/database/services/settings-service.ts`

- Add `memory_enabled: boolean` to `UserSettings` interface
- Add to `DEFAULT_SETTINGS`

### 2.3 IPC & Preload

- Add `memory:get-enabled` and `memory:set-enabled` IPC handlers
- Add `memory:updated` event for live UI refresh
- Expose in preload.ts as `memory.getEnabled()`, `memory.setEnabled(enabled)`, `memory.onUpdated(callback)`

### 2.4 MemoryView UI

**File:** `app-ui/src/components/settings/MemoryView.tsx`

- Add toggle switch: "Learn from my usage"
- When OFF: note says "Memory will not update automatically. You can still add facts manually."
- Listen for `memory:updated` IPC event to auto-refresh
- Show observation count as subtle indicator on inferred facts

---

## Token Usage Impact

Based on actual usage logs (2026-03-23):

| Component | Avg Tokens | Model | Cost/Call |
|-----------|-----------|-------|-----------|
| Optimizer (fast) | ~900 | claude-haiku-4.5 | ~$0.0007 |
| Optimizer (thinking) | ~5,800 | claude-haiku-4.5 | ~$0.005 |
| **Memory extraction** | **~550** | **claude-haiku-4.5** | **~$0.0004** |
| Memory context inject | ~150 added | same model | ~$0.0001 |

- Memory extraction adds ~10-15% token overhead per optimization
- Cost: ~$0.0004/call (negligible)
- The call is fire-and-forget (async) → **zero latency** for the user
- Projected: ~$0.50-2.00/month for typical user (50-100 optimizations/day)

---

## What Does NOT Change

- `user_memory` table schema stays (one column added)
- `MemoryService` CRUD methods stay
- `buildMemoryContext()` logic stays
- Python optimization pipeline untouched
- Overlay/app IPC structure stays
