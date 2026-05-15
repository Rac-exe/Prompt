# Code Intelligence Service — Architecture & Pipeline Documentation

## Overview

The Code Intelligence Service is a standalone FastAPI backend that provides **semantic code understanding** for the prompt optimizer. It ingests a user's project codebase, builds a searchable knowledge base (embeddings, summaries, call graphs), and exposes retrieval endpoints. The goal: when a user describes a bug or feature request, the service finds the **probable files and line ranges** most likely related to the query so the downstream prompt optimizer can generate a highly specific, token-efficient prompt — instead of feeding an entire codebase to an LLM.

The service does NOT diagnose bugs. It surfaces probable locations with code bodies and lets the downstream LLM (Haiku) do the reasoning.

**Stack:** Python 3.12, FastAPI, Supabase (PostgreSQL + pgvector), LiteLLM, OpenRouter, Redis (optional, for arq job queue).

**Default port:** `8002`

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Electron Client                              │
│  (parses local project → sends chunks + call graph + query)         │
└────────┬──────────────────────┬──────────────────────┬──────────────┘
         │ POST /api/index/ingest  │ GET /api/retrieve      │ POST /api/context
         ▼                      ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Code Intelligence Service                         │
│                                                                     │
│         ┌──────────┐      ┌──────────────┐     ┌────────────┐      │
│         │ Ingestion│      │  Retrieval   │     │  GitHub    │      │
│         │ Pipeline │      │  Pipeline    │     │  Sync      │      │
│         └────┬─────┘      └──────┬───────┘     └────┬───────┘      │
│              │                   │                  │               │
│              ▼                   ▼                  ▼               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Supabase (PostgreSQL + pgvector)               │   │
│  │  tables: projects, code_chunks, code_relationships,        │   │
│  │          project_branches                                   │   │
│  │  RPCs:   match_code_chunks, search_code_chunks_text,       │   │
│  │          search_by_concepts, increment_observation_counts   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## The Two Core Pipelines

### Pipeline 1: Ingestion (Code Indexing)

Transforms raw code into a searchable knowledge base. Triggered when the Electron client sends parsed code chunks from the user's project.

**Endpoint:** `POST /api/index/ingest`

#### Step-by-step flow:

```
Raw Code Chunks (from Electron)
        │
        ▼
   ┌─────────┐
   │  Auth &  │  JWT verification, project ownership check
   │  Validate│  Max 10,000 chunks per request
   └────┬─────┘
        │
        ▼
   ┌──────────────┐
   │ Hash Filter   │  Compare content_hash of each chunk against DB.
   │ (dedup)       │  Skip chunks whose code hasn't changed since last index.
   └────┬──────────┘  Saves compute — only new/modified chunks proceed.
        │
        ▼
   ┌──────────────────────┐
   │ Parallel Summarize    │  Each chunk → LLM (GPT-4o-mini via OpenRouter)
   │ (15 concurrent)       │  Produces:
   │                       │    • 1-2 sentence semantic summary
   │                       │    • Concept tags (e.g., "authentication",
   │                       │      "state-management", "error-handling")
   └────┬──────────────────┘
        │
        ▼
   ┌──────────────────────┐
   │ Build Embedding Text  │  Combines: summary + concepts + name + signature
   │                       │  + first 600 chars of code body.
   │                       │  This composite string is what gets embedded —
   │                       │  NOT just the summary alone.
   └────┬──────────────────┘
        │
        ▼
   ┌──────────────────────┐
   │ Batch Embed            │  text-embedding-3-small (512 dimensions)
   │ (2048 per batch)       │  Via OpenAI direct or OpenRouter.
   │                       │  Produces a 512-dim vector per chunk.
   └────┬──────────────────┘
        │
        ▼
   ┌──────────────────────┐
   │ Upsert to DB          │  Each chunk stored in `code_chunks` table:
   │                       │    file_path, name, chunk_type, code_body,
   │                       │    summary, concepts[], embedding, content_hash,
   │                       │    is_exported, branch, line_start, line_end,
   │                       │    signature, language, callees[]
   │                       │  Conflict key: (project_id, file_path, name, chunk_type)
   └────┬──────────────────┘
        │
        ▼
   ┌──────────────────────┐
   │ Stale Cleanup         │  Chunks in DB that are NOT in the current ingest
   │                       │  batch get deleted (along with their relationships).
   │                       │  Keeps DB in sync with the actual codebase.
   └────┬──────────────────┘
        │
        ▼
   ┌──────────────────────┐
   │ Call Graph Processing │  Client sends call_graph edges:
   │                       │    from_name/file → to_name/file + relationship_type
   │                       │  Resolves names to chunk IDs in DB.
   │                       │  Upserts into `code_relationships` table.
   │                       │  Enables graph-based retrieval expansion later.
   └────┬──────────────────┘
        │
        ▼
   Project status → "ready"
```

#### Key details:

- **Summarizer model:** `openrouter/openai/gpt-4o-mini` (configurable via `SUMMARIZER_MODEL` env var)
- **Embedding model:** `text-embedding-3-small` at 512 dimensions
- **Concurrency:** 15 parallel summarization tasks (configurable via `SUMMARIZER_CONCURRENCY`)
- **Chunk limit:** 10,000 per ingest request
- **Queue options:** If Redis is configured, ingestion runs via arq worker (async job queue with retries). Otherwise, runs as a FastAPI `BackgroundTask`.

---

### Pipeline 2: Retrieval (Semantic Search)

Finds the most relevant code chunks for a user's query using hybrid search (vector + full-text + concept matching) with intelligent reranking.

**Endpoint:** `GET /api/retrieve`

#### Step-by-step flow:

```
User Query (e.g., "authorization bypass in updateVideo")
        │
        ▼
   ┌──────────────────────┐
   │ Query Decomposition    │  LLM (GPT-4o-mini) analyzes the query:
   │                       │    • intent: "bug_fix" | "feature" | "refactor" | ...
   │                       │    • sub_queries: 2-4 focused search strings
   │                       │    • concepts: ["authentication", "authorization", ...]
   │                       │  Fallback: if LLM fails, use original query as-is.
   └────┬──────────────────┘
        │
        ▼
   ┌──────────────────────────────────────────────────────┐
   │ Parallel Search (for each sub-query)                  │
   │                                                       │
   │  ┌─────────────┐   ┌──────────────┐                  │
   │  │Vector Search │   │  FTS Search  │                  │
   │  │(pgvector)    │   │  (tsvector)  │                  │
   │  │              │   │              │                  │
   │  │ Embed the    │   │ Expand query │                  │
   │  │ sub-query →  │   │ (camelCase   │                  │
   │  │ cosine sim   │   │  split +     │                  │
   │  │ match in DB  │   │  concept     │                  │
   │  │              │   │  keywords)   │                  │
   │  └──────┬───────┘   └──────┬───────┘                  │
   │         │                  │                          │
   │         └────────┬─────────┘                          │
   │                  ▼                                    │
   │         ┌────────────────┐                            │
   │         │ + Concept Search│  Chunks tagged with       │
   │         │   (if concepts) │  matching concepts        │
   │         └────────┬───────┘                            │
   │                  │                                    │
   └──────────────────┼────────────────────────────────────┘
                      │
                      ▼
              ┌───────────────┐
              │  RRF Merge     │  Reciprocal Rank Fusion (k=60)
              │               │  Combines ranked lists from all sub-queries
              │               │  into a single unified ranking.
              │               │  score = Σ 1/(k + rank) across all lists
              └───────┬───────┘
                      │
                      ▼
              ┌───────────────────┐
              │  Rerank            │  Adjusts scores based on:
              │                   │    • observation_count (popular chunks boost)
              │                   │    • branch match (+30% if same branch)
              │                   │    • branch_diverged (+20% for changed files)
              │                   │    • concept overlap (query↔chunk concepts)
              │                   │    • is_exported (×1.2 for public APIs)
              └───────┬───────────┘
                      │
                      ▼
              ┌───────────────────┐
              │  Graph Expansion   │  Top 5 chunks → BFS through call graph
              │                   │  (max depth 2, max 20 related chunks).
              │                   │  Finds callers, callees, imports, inheritors
              │                   │  — code the user didn't search for but is
              │                   │  structurally connected to what was found.
              └───────┬───────────┘
                      │
                      ▼
              ┌───────────────────┐
              │  Observation Bump  │  Increment observation_count for top chunks.
              │                   │  Frequently retrieved chunks get a higher
              │                   │  boost in future queries (popularity signal).
              └───────┬───────────┘
                      │
                      ▼
   Response: { ranked_chunks, related_chunks, branch_context,
               query_intent, query_concepts }
```

#### Key details:

- **Hybrid search:** Combines semantic (vector), lexical (full-text), and metadata (concept tags) search for maximum recall.
- **RRF fusion:** Merges multiple ranked lists without requiring calibrated scores — just ranks. Robust to score scale differences between vector and FTS.
- **Graph expansion:** Uses the call graph from ingestion to find structurally related code that didn't match the query directly but is connected to matching code. This is how the system finds, e.g., a helper function called by the vulnerable endpoint.
- **Branch awareness:** Chunks from the user's active branch get a score boost; diverged files (changed since branch creation) get an additional boost.

---

### `POST /api/context` — Probable-Location Retrieval

A thin orchestrator on top of Pipeline 2. Given a query, it:

1. Runs the query preprocessor (extracts file paths, stack traces, error types, function names).
2. Runs the full retrieval pipeline.
3. Fetches the stored project summary.
4. Returns a structured `ContextResponse` with:
   - `probable_locations[]` — ranked chunks with full code bodies, scored by `confidence_score`
   - `related_locations[]` — graph-expanded neighbors
   - `intent`, `concepts`, `project_summary`, `branch_context`

No LLM analysis, no "findings", no "root cause" claims. The downstream prompt optimizer takes these probable locations and weaves them into a prompt that tells the final LLM (Haiku) *where* to look — never claiming *what* is broken.

---

## Supporting Systems

### Authentication (`auth.py`)

- **Production:** Supabase JWT verification using JWKS (ES256/RS256) fetched from the Supabase project, or HS256 with `SUPABASE_JWT_SECRET`.
- **Development:** If neither `SUPABASE_URL` nor `SUPABASE_JWT_SECRET` is configured, uses a dev bypass that returns `user_id = "dev-user"`. This mode is blocked in production (`APP_ENV=production`).
- All endpoints use `require_auth` dependency injection to extract the authenticated `user_id`.

### GitHub Sync (`github_sync.py`, `sync_worker.py`, `webhooks.py`)

Two mechanisms for keeping indexed code in sync with remote repositories:

1. **Polling:** `POST /api/sync` triggers a GitHub Compare API call to detect changes since last indexed commit. Flags diverged files in the database.
2. **Webhooks:** `POST /api/webhooks/github` receives push events from GitHub. Verifies HMAC signature, extracts changed files, updates branch metadata, and flags diverged chunks. Does not perform full re-indexing — that's triggered separately by the client.

### Database Schema (Supabase)

| Table | Purpose |
|-------|---------|
| `projects` | Project metadata: name, repo_url, user_id, index_status, current_branch, last_indexed_at |
| `code_chunks` | Indexed code: file_path, name, chunk_type, code_body, summary, concepts[], embedding (vector), content_hash, observation_count, is_exported, branch, line_start/end, signature, language, callees[] |
| `code_relationships` | Call graph edges: from_chunk_id, to_chunk_id, relationship_type, weight |
| `project_branches` | Branch tracking: project_id, branch_name, last_commit_sha, is_default |

#### Database RPCs (PostgreSQL functions):

| RPC | Purpose |
|-----|---------|
| `match_code_chunks` | Vector similarity search using pgvector cosine distance |
| `search_code_chunks_text` | Full-text search using PostgreSQL tsvector |
| `search_by_concepts` | Filter chunks by concept tag overlap (GIN index) |
| `increment_observation_counts` | Bump popularity counter for retrieved chunks |

### Job Queue (arq + Redis)

When `REDIS_URL` is configured (and not localhost), ingestion and sync tasks run asynchronously via arq:

- **`index_chunks_task`**: Processes ingest batches with retry (max 3 attempts, 600s timeout)
- **`sync_project_task`**: Processes GitHub sync operations
- **Worker config:** 10 max concurrent jobs, 30s health check interval

When Redis is not available, tasks run inline via FastAPI's `BackgroundTasks`.

---

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `SUPABASE_URL` | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Supabase service role key (server-side DB access) |
| `SUPABASE_JWT_SECRET` | — | JWT secret for token verification (fallback to JWKS) |
| `OPENAI_API_KEY` | — | Direct OpenAI key (preferred for embeddings) |
| `OPENROUTER_API_KEY` | — | OpenRouter key (used for summarizer, query decomposer, and embeddings fallback) |
| `SUMMARIZER_MODEL` | `openrouter/openai/gpt-4.1-nano` | LLM for chunk summarization during ingest |
| `QUERY_DECOMPOSE_MODEL` | `openrouter/openai/gpt-4o-mini` | LLM for query decomposition (intent + sub-queries + concepts) |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model (fixed) |
| `EMBEDDING_DIMENSIONS` | `512` | Embedding vector dimensions (fixed) |
| `MAX_CHUNKS_PER_INGEST` | `10,000` | Max chunks accepted per ingest request |
| `SUMMARY_MAX_TOKENS` | `150` | Max tokens for summarizer LLM response |
| `MAX_CODE_BODY_LEN` | `3,000` | Max characters of code body sent to summarizer |
| `SUMMARIZER_CONCURRENCY` | `15` | Parallel summarization tasks during ingestion |
| `RETRIEVAL_DEFAULT_LIMIT` | `15` | Default number of chunks returned by retrieval |
| `RETRIEVAL_MAX_LIMIT` | `50` | Maximum retrievable chunks per query |
| `GRAPH_MAX_DEPTH` | `2` | BFS depth for call graph expansion |
| `GRAPH_MAX_RELATED` | `20` | Max related chunks from graph expansion |
| `REDIS_URL` | `redis://localhost:6379` | Redis URL for arq job queue |
| `APP_ENV` | — | `production` or `development` |
| `SENTRY_DSN` | — | Sentry error tracking DSN |
| `GITHUB_WEBHOOK_SECRET` | — | HMAC secret for GitHub webhook verification |
| `ALLOWED_ORIGINS` | localhost defaults | CORS allowed origins (comma-separated) |
| `PORT` | `8002` | Server port |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/projects` | Create a new project |
| `GET` | `/api/projects` | List user's projects |
| `GET` | `/api/projects/{id}` | Get project details |
| `DELETE` | `/api/projects/{id}` | Delete project and all indexed data |
| `DELETE` | `/api/projects/{id}/files` | Delete chunks for a specific file |
| `POST` | `/api/index/ingest` | Ingest code chunks + call graph |
| `GET` | `/api/retrieve` | Retrieve relevant code for a query (raw chunks) |
| `POST` | `/api/context` | Probable-location retrieval (structured, ranked) |
| `POST` | `/api/sync` | Trigger GitHub sync (polling) |
| `POST` | `/api/webhooks/github` | Receive GitHub push webhooks |
| `GET` | `/health` | Basic health check |
| `GET` | `/health/ready` | Deep readiness check (DB + embedding key) |

---

## End-to-End Flow: From User Query to Optimized Prompt

Here's how everything connects when a user asks about a bug in their project:

```
1. User opens project in the app
   └→ Electron client parses codebase (AST parsing)
   └→ Sends chunks + call graph to POST /api/index/ingest
   └→ Ingestion Pipeline runs (summarize → embed → store → graph)
   └→ Project status: "ready"

2. User types: "Unauthorized users can update videos that don't belong to them"
   └→ python-service calls POST /api/context
   └→ Retrieval Pipeline runs:
       • Decomposes query into sub-queries
       • Hybrid search finds relevant code chunks
       • RRF merges and reranks results
       • Graph expansion adds connected code
   └→ Returns structured probable_locations[] with code bodies and
      confidence scores — no diagnosis

3. python-service receives probable_locations
   └→ Weaves them into the final prompt as a "[PROBABLE LOCATIONS]" block
   └→ Final prompt tells Claude/Haiku WHERE to look (files + lines)
      without claiming what's broken — the model reads the code and decides
   └→ Token-efficient: only ~8-15 chunks instead of whole codebase
```

---

## File Structure

```
code-intelligence-service/
├── app/
│   ├── main.py                    # FastAPI app, middleware, router mounting
│   ├── config.py                  # All configuration constants and env vars
│   ├── auth.py                    # JWT authentication (Supabase)
│   ├── db/
│   │   ├── models.py              # Pydantic models for API contracts
│   │   ├── queries.py             # Database CRUD and RPC wrappers
│   │   └── supabase_client.py     # Singleton Supabase client
│   ├── services/
│   │   ├── search.py              # Hybrid search orchestration (vector+FTS+RRF)
│   │   ├── embedding.py           # Text → vector embedding via LiteLLM
│   │   ├── summarizer.py          # Code chunk → semantic summary via LLM
│   │   ├── query_analyzer.py      # Query → intent + sub-queries + concepts
│   │   ├── query_preprocessor.py  # Regex-based extraction of file paths, stack traces, etc.
│   │   ├── project_summary.py     # Heuristic tech-stack + framework detection
│   │   ├── graph.py               # Call graph edge resolution and storage
│   │   └── github_sync.py         # GitHub API polling and webhook handling
│   ├── workers/
│   │   ├── index_worker.py        # Core ingestion logic (filter→summarize→embed→store)
│   │   ├── arq_worker.py          # Redis job queue worker (async ingestion/sync)
│   │   └── sync_worker.py         # GitHub push webhook processing
│   └── routes/
│       ├── projects.py            # Project CRUD endpoints
│       ├── ingest.py              # POST /api/index/ingest
│       ├── retrieve.py            # GET /api/retrieve
│       ├── context.py             # POST /api/context (probable-location retrieval)
│       ├── sync.py                # POST /api/sync
│       └── webhooks.py            # POST /api/webhooks/github
├── requirements.txt
├── Dockerfile
├── render.yaml
├── .env.example
└── DOCUMENTATION.md               # This file
```
