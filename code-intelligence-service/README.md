# Code Intelligence Service — Architecture Guide

> How the retrieval (RAG) pipeline works: the what, why, and how, without code.
> Last synced to source: June 2026.

---

## The One Problem This Service Solves

When a user types *"fix the auth bug"*, an LLM has no idea which files in their
private codebase are relevant. It guesses — burning tokens on that guessing, often
getting it wrong. This service eliminates the guessing. It maintains a private,
structured knowledge graph of the user's codebase and returns the 5–10 most
relevant code chunks with precision, so the downstream optimizer can build a
tight, correct prompt instead of stuffing an entire repo into context.

**The index never leaves the user's machine.** Electron parses the codebase with
tree-sitter (AST parsing), reduces it to structural skeletons (function names,
signatures, call edges), and sends only those skeletons to this service. Source
code bodies are stored in a **local SQLite database** (one per project, on the
user's machine). Nothing goes to a cloud database.

> **Storage note:** The default `STORAGE_BACKEND=local` keeps all data in SQLite
> on the user's machine. A Supabase backend exists as an optional alternative
> but is not the default.

---

## The Three Phases of Life

Everything the service does maps to one of three phases:

```
┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐
│   PHASE 1: INDEX    │   │   PHASE 2: STORE     │   │  PHASE 3: RETRIEVE  │
│  (runs once when    │   │  (permanent, local)  │   │  (runs per query,   │
│   project opens or  │──▶│                      │──▶│   sub-second)       │
│   files change)     │   │  Local SQLite:       │   │                     │
│                     │   │  vectors, PageRank   │   │  Query comes in →   │
│  Electron sends     │   │  communities,        │   │  right chunks come  │
│  chunks + edges     │   │  concept embeddings  │   │  back out           │
└─────────────────────┘   └─────────────────────┘   └─────────────────────┘
```

---

## Layer 1 — Ingestion Pipeline

**Purpose:** Transform raw source code into a searchable, structured knowledge base.

**Triggered by:** `POST /api/index/ingest` — Electron sends parsed chunks + call graph

**Runs as:** A background job. Project status goes `indexing → ready`.

```
Electron sends:
  ~200–1000 chunks (functions, classes, methods)
  + call graph edges (loginUser → calls → generateTokens)
  + import statements (video.routes → imports → verifyJWT)

         │
         ▼

┌── Step 1: Hash Filter ─────────────────────────────────────────────────────┐
│                                                                             │
│  Every chunk has a content_hash (MD5 of its source code).                  │
│  Compare against the DB. If the hash hasn't changed, skip this chunk.      │
│                                                                             │
│  Special case: if the embedding model/dimensions changed since the last     │
│  index (detected by comparing stored config vs active config), ALL chunks   │
│  are re-embedded regardless of hash — prevents dimension mismatches.        │
│                                                                             │
│  WHY: Re-indexing should be instant for unchanged files. Only new or       │
│  modified code goes through the expensive summarization + embedding steps.  │
└─────────────────────────────────────────────────────────────────────────────┘
         │  (only new/changed chunks proceed)
         ▼

┌── Step 2: Context Enrichment ──────────────────────────────────────────────┐
│                                                                             │
│  Each chunk gets surrounding context attached:                              │
│    • The import/require block at the top of its file                        │
│    • Names of sibling functions defined in the same file                    │
│    • Summary of its parent class (if it's a method)                         │
│    • What comes immediately before/after it in the file                     │
│                                                                             │
│  WHY: A function seen in isolation looks different from a function seen     │
│  in context. "validateToken" means more when the LLM also sees that the    │
│  file imports jwt and is in an auth/ folder. Richer context = better        │
│  summaries.                                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼

┌── Step 3: Parallel Summarization ──────────────────────────────────────────┐
│                                                                             │
│  🤖 LLM CALL #1 — SUMMARIZER                                                │
│  Model:     deepseek-chat (via OpenRouter, configurable)                    │
│  Batching:  8 chunks per LLM call, up to 10 calls running in parallel       │
│  Frequency: First index only for each chunk (hash-deduplicated after)       │
│                                                                             │
│  For each chunk the LLM produces:                                           │
│    • summary_code    — "What does this code do?" (1–2 sentences)           │
│    • summary_purpose — "Why does this exist in the architecture?" (1 sentence)│
│    • concepts[]      — fixed-vocab domain tags: ["auth", "JWT", "middleware"]│
│    • concept_phrases[]— 3 free-form semantic phrases (if GRAPH_BUILDER_ENABLED):│
│                         "JWT bearer token verification"                      │
│                         "Express authentication middleware"                   │
│                         "protected route access control"                     │
│                                                                             │
│  If the LLM returns malformed JSON, one automatic retry is performed with   │
│  a stricter prompt. If that also fails, a fallback result is generated from │
│  the chunk name + signature alone (no LLM cost, but lower quality).         │
│                                                                             │
│  The service logs `summary_empty_count` so degraded quality is visible      │
│  in the ingest logs rather than silently polluting the index.               │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼

┌── Step 4: Dual Embedding ──────────────────────────────────────────────────┐
│                                                                             │
│  Each chunk gets TWO vectors computed:                                      │
│                                                                             │
│  embedding_summary   = embed(summary_code + summary_purpose + concepts)    │
│  → captures SEMANTIC MEANING: "what this code does"                         │
│                                                                             │
│  embedding_structure = embed(file_path + name + signature + imports         │
│                              + sibling names + concepts)                    │
│  → captures STRUCTURAL IDENTITY: "what this thing is called and where"     │
│                                                                             │
│  WHY two vectors? Summary catches intent. Structure catches identity.       │
│  When a user types "where is verifyJWT", structure embedding finds it       │
│  even if the summary never mentions the function name explicitly.            │
│                                                                             │
│  EMBEDDING BACKEND (important):                                             │
│  Default: EMBEDDING_BACKEND=local — runs bge-small-en-v1.5 (384-dim) or   │
│  bge-base-en-v1.5 (768-dim) via ONNX on CPU. Zero network hop, zero cost.  │
│  Fallback: EMBEDDING_BACKEND=openai — uses text-embedding-3-large (1536d)  │
│  via OpenAI API. Higher quality but costs money and requires network.       │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼

┌── Step 5: Upsert to Local SQLite ──────────────────────────────────────────┐
│                                                                             │
│  Each chunk row stored in code_chunks table:                                │
│    file_path, name, chunk_type, start_line, end_line                        │
│    code_body, summary_code, summary_purpose, concepts[]                     │
│    embedding_summary (vector), embedding_structure (vector)                  │
│    content_hash, branch, is_exported, signature, language                   │
│                                                                             │
│  Conflict key: (project_id, file_path, name, chunk_type)                   │
│  → Updating an existing function updates its row in place.                  │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼

┌── Step 6: Edge Processing ─────────────────────────────────────────────────┐
│                                                                             │
│  Two types of edges get written to the code_relationships table:            │
│                                                                             │
│  Call edges:    loginUser ──[calls]──▶ generateAccessAndRefreshToken        │
│  Import edges:  video.routes ──[imports]──▶ verifyJWT                       │
│                 user.routes  ──[imports]──▶ verifyJWT                       │
│                 like.routes  ──[imports]──▶ verifyJWT                       │
│                                                                             │
│  Edge processing runs BEFORE the graph pipeline so PageRank sees the        │
│  latest edges. Even when all chunks are unchanged (hash filter skips them), │
│  edges are refreshed — the call graph from the client may have changed.     │
│                                                                             │
│  NOTE: Only project-internal imports are tracked. node_modules is ignored.  │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼

┌── Step 7: Graph Pipeline (if GRAPH_BUILDER_ENABLED=true) ──────────────────┐
│                                                                             │
│  See Layer 2 below.                                                         │
│                                                                             │
│  If the graph pipeline fails (e.g. due to transient DB error), the project  │
│  status is set to "partial" and a single automatic retry is scheduled after │
│  a 3-second delay. The ingest does NOT fail — code retrieval still works    │
│  with the flat path; graph-aware features just won't have fresh data.       │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼

┌── Step 8: Stale Cleanup ────────────────────────────────────────────────────┐
│                                                                             │
│  Operates in two modes:                                                     │
│    cleanup_scope="project" — delete any chunk NOT in the current ingest     │
│      batch (full repo snapshot sent by Electron on project open).           │
│    cleanup_scope="file"    — delete only chunks in the specified file(s)    │
│      that are no longer present (used for incremental file-level updates).  │
│    cleanup_scope="none"    — skip cleanup (delta ingest, no deletions).     │
│                                                                             │
│  WHY: Deleted files disappear from the index automatically.                 │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼

  Project status → "ready"
```

---

## Layer 2 — The Knowledge Graph Pipeline

**Purpose:** Compute structural intelligence on top of the flat vector store.
Runs after every successful upsert. Operates on the **full project graph**
(not just the delta) because PageRank and community detection need the complete
picture.

**This layer is what separates Prmpt from a plain vector database.**

### The Core Problem It Solves

Flat vector search has a fundamental flaw. Example from a real test repo:

```
Query: "where is JWT verified before protected routes"

Flat vector result #1:  video.routes.js     ← just USES verifyJWT
Flat vector result #12: verifyJWT           ← IS the JWT verification
```

Route files scored higher because they contain the words "jwt", "protected",
"routes". The middleware that *is* JWT verification lost to files that merely
*reference* it. Vector similarity cannot distinguish **implementer** from
**caller**. The graph pipeline solves this with PageRank.

### The 9 Steps

```
Step 1: Load full project graph from DB
        All chunks + all relationships (not just the newly ingested ones)
        PageRank and Leiden need to see every node and edge.

Step 2: Build graph in memory
        Nodes = code chunks
        Edges = call relationships + import relationships
        Library: igraph
        Edge weights: calls=3.0, imports=2.0, parent_of=2.0, child_of=2.0,
                      inherits=1.5, implements=1.5, sibling_next=1.0

Step 3: PageRank + Betweenness Centrality computation
        PageRank: "A function is important if many other important functions
        depend on it."

        verifyJWT  ← imported by 6 route files → HIGH PageRank
        video.routes ← imported by nobody → LOW PageRank

        Result: every chunk gets a pagerank_score between 0 and 1.
        The implementer floats above the callers automatically.

        Betweenness centrality: a secondary signal measuring how often a node
        sits on the shortest path between other nodes. Used as a tie-breaker
        in FIND mode among candidates with similar PageRank.
        Both are rank-normalized within the candidate set at query time so
        a single hub node can't dominate the ranking.

        Graph health check: if edge_count == 0, a warning is logged:
        "Find will fall back to lexical-only ranking (no definition-vs-
        reference signal)." This surfaces call-graph issues early.

Step 4: Leiden Community Detection
        Finds clusters of densely connected nodes — groups of functions
        that call each other a lot.
        Library: leidenalg (ModularityVertexPartition, seed=42)
        Runs on undirected view of the graph.

        In a typical backend this produces natural subsystem clusters:
          Auth community:    verifyJWT, generateTokens, loginUser, logoutUser, ...
          Video community:   publishAVideo, uploadOnCloudinary, Video.create, ...
          Frontend Auth:     AuthContext, ProtectedRoute, Login, Register, ...

        Each cluster = one logical subsystem. Every chunk gets a community_id.

Step 5: LLM Community Reports
        ┌─────────────────────────────────────────────────────────────────┐
        │  🤖 LLM CALL #2 — COMMUNITY_MODEL (deepseek-chat)               │
        │  Batching: 5 communities per LLM call                           │
        │  Frequency: Every index run (communities re-detected from       │
        │  the full graph after each ingest)                              │
        │                                                                  │
        │  Input: list of chunk names + summaries in each cluster          │
        │  Output: { cluster_id, label, report } per cluster              │
        │           label: short human-readable name ("auth-backend")     │
        │           report: 2–4 sentence architecture description          │
        │                                                                  │
        │  Example output for Auth cluster:                                │
        │  "This cluster handles all JWT authentication flows. Entry point  │
        │   is verifyJWT middleware, applied to 6 route files. Token        │
        │   generation is in generateAccessAndRefreshToken (user.controller)│
        │   which calls model methods for 15-min access and 10-day refresh  │
        │   tokens. Google OAuth is an alternate path via google.controller."│
        └─────────────────────────────────────────────────────────────────┘

        WHY: Pre-synthesized architecture means the retrieval engine doesn't
        have to ask an LLM "what is the auth subsystem" at query time. The
        answer is already written and stored. This makes ASK and BUG modes
        dramatically faster and cheaper.

Step 6: Embed community reports
        Each report text → vector → stored in communities table.
        This enables: "find the subsystem most relevant to this query"
        by comparing the query embedding against all community report embeddings.
        Community reports are cached in-memory for 5 minutes (TTL configurable).

Step 7: Relationship summaries
        ┌─────────────────────────────────────────────────────────────────┐
        │  🤖 LLM CALL #3 — SUMMARIZER_MODEL (deepseek-chat)              │
        │  Top 50 edges by in-degree only (not every edge)               │
        │  Batching: 10 edges per LLM call                                │
        │                                                                  │
        │  Input: "loginUser --[calls]--> generateAccessAndRefreshToken"   │
        │  Output: "loginUser calls generateAccessAndRefreshToken to        │
        │   produce auth credentials after successful password validation"  │
        └─────────────────────────────────────────────────────────────────┘

        Each summary is immediately embedded and stored on the edge.

        WHY: Relationship embeddings enable finding causal connections.
        Query: "refresh token fails on second use" → finds the edge description
        "generateTokens updates User.refreshToken in DB; if this write fails,
        the tokens are generated but not persisted, causing next refresh to fail"
        This causal chain is invisible to any chunk-level text search.

Step 8: Concept phrase embeddings
        The 3 concept_phrases generated in Step 3 of ingestion are now embedded
        as individual vectors: concept_embedding_1, concept_embedding_2,
        concept_embedding_3 — stored back on the chunk.

        WHY: Semantic concept matching instead of fixed-vocab string matching.
        "token rotation", "JWT verification", and "bearer auth check" all embed
        close to each other. Fixed tags would only match one of them.

Step 9: Write everything back
        pagerank_score, community_id, centrality_score → code_chunks table
        concept_embedding_[1/2/3] → code_chunks table
        relationship_summary + embedding → code_relationships table
        community reports + embeddings → communities table
        Community cache invalidated.
```

---

## Layer 3 — The Mode Router

**Purpose:** Map the user's chosen mode to the correct retrieval strategy.
One frozen configuration object (`ModeConfig`) per mode — every downstream
decision is driven by this config.

**Why modes exist:** The four query types are fundamentally different problems.
A navigation query needs zero LLMs and a lexical scorer. A bug diagnosis needs
broad architecture context first, then causal drill-down. Treating them the same
makes both worse.

```
┌──────────────┬──────────────────────┬────────────────────────────────────────┐
│ Mode         │ search_path          │ What the user is asking                │
├──────────────┼──────────────────────┼────────────────────────────────────────┤
│ FIND         │ flat                 │ "Where is X?" — navigation             │
│ ASK          │ global               │ "How does X work?" — architecture      │
│ BUG          │ drift                │ "Why is X broken?" — debugging         │
│ OPTIMIZE     │ local_centrality     │ "Build/improve X" — feature work       │
└──────────────┴──────────────────────┴────────────────────────────────────────┘
```

Each config also controls a suite of other switches:

```
decompose       — run the query decomposition LLM call?
vector_search   — run embedding similarity search?
broad_limit     — how many candidates to retrieve per channel?
rerank          — run the reranker on the candidates?
mmr             — apply diversity (Maximal Marginal Relevance)?
mmr_lambda      — how much to penalize duplicate-file results? (0=max diversity)
graph_expand    — BFS through call graph to add structurally connected chunks?
graph_depth     — how many hops in the BFS?
refine          — run a second retrieval pass if confidence is low?
generate_answer — call an LLM to write a direct answer? (ASK only)
search_path     — which graph-aware path to use when GRAPH_BUILDER_ENABLED=true
```

**Pipeline variants** (A/B testing): Any mode config can be overridden per-request
by passing `?variant=<name>`. Built-in variants: `no_refine`, `no_rerank`,
`deep_graph`, `wide_recall`. All searches are tagged with an auto-computed
pipeline fingerprint (MD5 of all tuning params) so offline eval can compare
results without manual version bumping.

---

## Layer 4 — The Retrieval Engine

**Purpose:** Execute the strategy selected by the mode router and return ranked
code chunks.

**Entry point:** `retrieve_context_full()` — called by `POST /api/context`.

**Two execution modes:**

1. **Agentic mode** (default for ASK/BUG/OPTIMIZE; `AGENTIC_RETRIEVAL_ENABLED`):
   An LLM drives tool calls (search, get_definition, find_callers,
   expand_neighbors, grep, read_chunk) in a bounded loop (max 6 hops, 25s
   budget). It finds exactly the chunks it needs instead of running a fixed
   recall pass. Falls back to one-shot on any error or empty result.

2. **One-shot mode** (always used by FIND, and the fallback for the others):
   Fixed recall → rank → rerank → refine pipeline. Everything below describes
   this path.

### The Four Search Paths

---

#### Path A: `flat` — used by FIND mode

```
User: "where is JWT verified"
         │
         ▼
┌── Multi-channel Recall (parallel) ─────────────────────────────────────────┐
│                                                                             │
│  Vector Search   — embed query → cosine similarity against embedding_summary│
│  FTS Search      — full-text search on code_body + summaries               │
│  Concept Search  — filter chunks tagged with matching concepts              │
│  Filepath Search — pattern match query terms against file paths / names     │
│                                                                             │
│  All four channels run in parallel. Each returns its own ranked list.       │
│                                                                             │
│  Note: decomposition is skipped for FIND mode entirely (no concept of       │
│  "sub-queries" for navigation). The flat path also has a vector FALLBACK:   │
│  if lexical/path recall is too thin, one extra vector pass runs to recover  │
│  semantically related symbols that didn't match by name.                    │
└─────────────────────────────────────────────────────────────────────────────┘
         │  (4 ranked lists)
         ▼
┌── RRF — Reciprocal Rank Fusion ────────────────────────────────────────────┐
│                                                                             │
│  Merges the ranked lists into one using position, not raw scores.           │
│  score = Σ 1/(60 + rank) across all lists where the chunk appeared.         │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌── FIND Scorer ─────────────────────────────────────────────────────────────┐
│                                                                             │
│  Hand-tuned scoring formula on top of the RRF base score.                   │
│  Uses candidate-local IDF weighting: rare discriminating terms (e.g.        │
│  "clipboard") outrank ubiquitous terms (e.g. "capture") automatically.      │
│                                                                             │
│  find_score = base_score                                                    │
│             + (path/name hits       × 0.35)  ← strong signal               │
│             + (name_def hits        × 0.45)  ← THIS chunk IS the symbol    │
│             + (signature hits       × 0.20)                                 │
│             + (concept tag hits     × 0.15)                                 │
│             + (code body hits       × 0.12)                                 │
│             + (domain signal hits   × 0.12)  ← "jwt", "auth", "token" etc  │
│             + (pagerank_norm        × 0.30)  ← rank-normalized PageRank     │
│             + (centrality_norm      × 0.08)  ← betweenness tie-breaker      │
│             − 0.20 if no specific terms matched at all (miss penalty)       │
│                                                                             │
│  FIND_BOOST_NAME_DEF (0.45) is the primary fix for the verifyJWT problem:  │
│  A chunk whose OWN name contains "jwt" + "verify" is the DEFINITION.        │
│  Chunks that merely call it are references. This asymmetry + PageRank       │
│  together push the implementer to #1 even if every route file has higher    │
│  raw text similarity.                                                        │
│                                                                             │
│  Additional structural filters:                                             │
│    • Route handler detection: chunks in /api/ routes with GET/POST etc.    │
│    • HTTP method matching: user query mentions "POST /videos" → penalizes   │
│      non-route chunks                                                        │
│    • Per-file cap (2–3 chunks max per file to prevent flooding)             │
│    • Tail suppression: candidates far below the top score are dropped        │
│    • Generic symbol noise reduction ("get", "route", "handler" alone)       │
│    • Test file demotion: test files pushed below non-test results            │
│                                                                             │
│  ZERO LLM CALLS. Pure local scoring. Typically completes in ~150ms.         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

#### Path B: `global` — used by ASK mode

```
User: "how does authentication work end to end"
         │
         ▼
┌── Query Decomposition (lazy, parallel) ────────────────────────────────────┐
│  🤖 LLM CALL #4 — QUERY_DECOMPOSE_MODEL (gpt-4o-mini)                      │
│                                                                             │
│  Only runs if the query is ≥12 tokens AND contains no identifier hints      │
│  (backticks, dot.notation, function() calls). Short or identifier-specific  │
│  queries skip decomposition entirely as an optimization.                    │
│                                                                             │
│  Runs in PARALLEL with the first-pass recall (not blocking it).             │
│  Result is only used if the first-pass top score < 0.25 threshold.          │
│  If first pass is already confident, decompose result is discarded.         │
│                                                                             │
│  Output: intent, sub_queries[], concepts[]                                  │
└─────────────────────────────────────────────────────────────────────────────┘

When GRAPH_BUILDER_ENABLED=true, the global path takes over:

         │
         ▼
┌── Community Report Matching ───────────────────────────────────────────────┐
│                                                                             │
│  Embed the query → compare against ALL community report embeddings           │
│  (stored in communities table, cached for 5 minutes).                       │
│                                                                             │
│  Top 2–3 matching community reports are retrieved.                           │
│  Example match: "Auth community" report — the pre-written architecture       │
│  description of the entire auth subsystem.                                   │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌── Fetch Top Community Members ─────────────────────────────────────────────┐
│                                                                             │
│  Fetch top-PageRank chunks from the matched communities.                    │
│  These are the most structurally important functions in the relevant         │
│  subsystem — not just the most textually similar to the query.              │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌── Reranker ────────────────────────────────────────────────────────────────┐
│  Reranker backend (see below for details)                                   │
│  Takes the top candidates → scores each chunk for relevance.                │
│  Returns reranked list with relevance_reasoning per chunk.                  │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌── Answer Generation ───────────────────────────────────────────────────────┐
│  🤖 LLM CALL — ANSWER_MODEL (deepseek-chat)                                 │
│  ASK mode only (generate_answer=True)                                       │
│                                                                             │
│  Input: top ≤15 chunks + community context + user query                    │
│  Output: a direct natural language answer citing specific files + lines     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

#### Path C: `drift` — used by BUG mode

DRIFT = **D**rill-down with **R**ecursive **I**terative **F**ollow-up **T**raversal.
Mirrors how a senior engineer debugs: understand the subsystem first, then drill
into the specific execution paths.

```
User: "why does logout sometimes fail after refresh token expires"
         │
         ▼
┌── PRIMER: Community Context ───────────────────────────────────────────────┐
│                                                                             │
│  Embed query → match community reports (same as global path).               │
│  Format the top 2 community reports as a context string.                    │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌── Follow-up Question Generation ───────────────────────────────────────────┐
│  🤖 LLM CALL — QUERY_REFINER_MODEL (deepseek-chat)                         │
│                                                                             │
│  Input: original query + community context + top 3 initial chunks           │
│  Output: 2–3 focused follow-up questions                                    │
│                                                                             │
│  Example follow-ups for "why does logout fail":                              │
│    1. "How does refreshAccessToken validate the existing refresh token?"    │
│    2. "What happens if generateAccessAndRefreshToken fails mid-execution?"  │
│    3. "How are cookies cleared on logout vs token refresh?"                 │
│                                                                             │
│  If follow-up generation fails, falls back to original query as sole search. │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌── FOLLOW-UP: Parallel Local Searches ──────────────────────────────────────┐
│                                                                             │
│  Embed the original query + each follow-up question (all in one batch).     │
│  Run _local_search for [original query, follow_up_1, follow_up_2, ...]      │
│  all in parallel.                                                           │
│                                                                             │
│  _local_search for each follow-up:                                          │
│    concept embedding search → find anchor chunks                            │
│    collect community_ids from anchors                                       │
│    fetch all community members (PageRank-ordered)                           │
│    Personalized PageRank: chunks whose name matches query terms get 2× PR  │
│    final_score = max(personalized_pagerank, concept_sim, vector_sim)        │
└─────────────────────────────────────────────────────────────────────────────┘
         │  (N result sets, one per follow-up question)
         ▼
┌── MERGE ───────────────────────────────────────────────────────────────────┐
│                                                                             │
│  Deduplicate all chunks across all follow-up results.                       │
│  Sort by final_score (PageRank-driven).                                     │
│  Include primer members (community top chunks) that didn't appear yet.      │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
  Reranker → returns ranked chunks
  generate_answer=False for BUG mode.
  Returns ranked chunks to the optimizer. The optimizer writes the final prompt.
```

---

#### Path D: `local_centrality` — used by OPTIMIZE mode

```
User: "add rate limiting to all API endpoints"
         │
         ▼
┌── Anchor Discovery ────────────────────────────────────────────────────────┐
│                                                                             │
│  Concept embedding search: query embedding vs concept_embedding_[1/2/3]    │
│  + Standard vector search                                                   │
│  → top matching chunks become "anchors"                                     │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌── Community Scope ─────────────────────────────────────────────────────────┐
│                                                                             │
│  Collect community_ids from all anchors.                                    │
│  Fetch ALL members of those communities (PageRank-ordered).                  │
│  Cap at 3 communities.                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌── Personalized PageRank + MMR ─────────────────────────────────────────────┐
│                                                                             │
│  Chunks whose name matches query terms → 2× PageRank weight                │
│  final_score = max(personalized_pagerank, concept_sim, vector_sim)          │
│                                                                             │
│  MMR lambda=0.5 (maximum diversity): penalize chunks from the same file     │
│  after the first 2. Ensures returned files span the entire subsystem,       │
│  not 10 results from the same file.                                         │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
  Reranker → returns ranked chunks
  generate_answer=False → chunks go to optimizer for the final prompt
```

---

### The Reranker (Cross-cutting)

All modes except FIND use the reranker. It operates in two modes:

```
┌── RERANKER_BACKEND=local (DEFAULT) ────────────────────────────────────────┐
│                                                                             │
│  Uses bge-reranker-base (ONNX) loaded from HuggingFace Hub.                 │
│  Model: Xenova/bge-reranker-base (configurable via RERANKER_LOCAL_MODEL)    │
│  Max input: 512 tokens (configurable)                                       │
│  Inference: ONNX Runtime, CPU, 1-2 threads                                  │
│                                                                             │
│  Latency: ~150ms for 20 chunks (no network). Runs offline.                  │
│  Returns relevance score (sigmoid of logit output).                         │
│                                                                             │
│  Fallback: if ONNX load fails, automatically falls back to LLM reranker.   │
└─────────────────────────────────────────────────────────────────────────────┘

┌── RERANKER_BACKEND=llm (fallback) ─────────────────────────────────────────┐
│                                                                             │
│  🤖 LLM CALL — RERANKER_MODEL (deepseek-chat)                               │
│  Sends up to 60 chunk summaries + the query.                                │
│  Returns scored list with reasoning per chunk.                              │
│  Latency: 1–2 seconds (network round-trip).                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

Both paths apply a **test chunk penalty** (×0.60) when the query doesn't
mention tests — test files are kept in the result set but pushed below
production code. A final-stage `_demote_test_chunks` guarantees this even
after MMR or graph expansion re-surfaces them.

---

### Cross-cutting: Graph Expansion

After any search path, if `graph_expand=True` (all modes except FIND):

```
Top 5 ranked chunks
         │
         ▼
BFS through code_relationships (call edges + import edges)
  depth = 2 hops  |  max 20 additional chunks

Finds chunks that:
  • call into the ranked results
  • are called by the ranked results
  • import or are imported by the ranked results

These structurally connected chunks are added as related_chunks[]
in the response — the code the user didn't search for but is
connected to what was found.
```

---

### Cross-cutting: Structure Similarity Blending

For ASK, BUG, OPTIMIZE — after the main reranker pass:

```
1. Build a structure query = original query + split identifiers + concepts
2. Embed it with the structure embedding model
3. Fetch structure_embedding vectors for the top 60 reranked chunks
4. Compute cosine similarity between query structure vector and chunk vectors
5. Blend: final_score = (0.75 × rerank_score) + (0.25 × structure_similarity)
```

WHY: The semantic reranker scores "does this chunk help with the query?" but
the structure embedding captures "is this chunk literally what the query names?"
Blending both prevents the reranker from burying the exact function being asked
about when many related chunks also score high.

---

### Cross-cutting: Iterative Refinement

For ASK, BUG, OPTIMIZE — if the first pass returns low-confidence results:

```
Trigger conditions:
  • top result score < 0.25 threshold, AND
  • ≥ 3 candidates exist (too few candidates = second pass won't help), AND
  • top result score < 0.55 (if already confident, skip the extra LLM call)

Special case: complex multi-entity queries (>30 words + ≥2 conjunctions)
trigger refinement even at medium confidence.

         │
         ▼
┌── Refinement Query Generation ─────────────────────────────────────────────┐
│  🤖 LLM CALL — QUERY_REFINER_MODEL (deepseek-chat)                         │
│                                                                             │
│  Input: original query + top 3 initial results (with scores + summaries)   │
│  Output: 1–2 additional search queries covering missed angles               │
│    (data flow, callers, ownership checks, integration points)               │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
  Run a second broad recall pass with these refined queries.
  Re-rank the combined pool (original + refined results).

  OPTIMIZATION: If the decompose second-pass already ran (query was complex
  enough to trigger decomposition with different sub-queries), the refine
  round is skipped — it would be redundant work. Avoids double recall cost.
```

---

## Layer 5 — The API Surface

**Purpose:** Standard HTTP interface so Electron, the python-service optimizer,
and the future MCP server can all talk to the same engine.

```
POST /api/index/ingest     ← Electron: "here are the chunks, index this project"
GET  /api/retrieve         ← Spaces UI: "give me raw chunks for this query"
POST /api/context          ← python-service optimizer: "give me probable locations"
POST /api/projects         ← create/list/delete projects
POST /api/sync             ← trigger GitHub sync (polling)
POST /api/webhooks/github  ← receive GitHub push events
POST /api/feedback         ← user rating on search quality
GET  /api/pipeline/status  ← A/B pipeline comparison
GET  /api/graph/data/{id}  ← graph visualization data
GET  /health/ready         ← deep health check (DB + AI provider)
```

The key endpoint the optimizer calls is `POST /api/context`. It returns:
```
probable_locations[]   — ranked chunks with code bodies + confidence scores
related_locations[]    — graph-expanded structural neighbors
intent                 — "bug" / "architecture" / "feature" / etc.
concepts               — ["auth", "JWT", ...]
project_summary        — tech stack + framework detection
branch_context         — active branch + diverged files info
```

The optimizer takes `probable_locations[]` and weaves them into a
`[PROBABLE LOCATIONS]` block in the final prompt. The LLM reads the actual code
and decides what's wrong or what to change. The service never claims to know
the answer — it only surfaces *where* to look.

---

## Complete LLM Call Map

Every LLM call in the system, when it fires, what model, and why:

| # | Call | Model (default) | When | Why |
|---|------|----------------|------|-----|
| 1 | **Chunk summarization** | deepseek-chat | Index time, once per chunk (hash-deduped) | Convert raw code into searchable semantic representations |
| 2 | **Community reports** | deepseek-chat | Index time, every ingest (Leiden re-runs) | Pre-synthesize architecture descriptions so query time is fast |
| 3 | **Relationship summaries** | deepseek-chat | Index time, top 50 edges by in-degree | Capture causal connections between functions as searchable embeddings |
| 4 | **Query decomposition** | gpt-4o-mini | Query time, conditional (≥12 tokens, no identifier hints, low confidence) | Break complex query into focused sub-queries + classify intent |
| 5 | **DRIFT follow-ups** | deepseek-chat | Query time, BUG mode only | Generate drill-down questions from community context |
| 5 | **Refinement queries** | deepseek-chat | Query time, conditional (low confidence) | Cover missed angles when first pass is weak |
| 6 | **Reranker (LLM)** | deepseek-chat | Query time, fallback only when ONNX fails | Score each candidate chunk for relevance with reasoning |
| 7 | **Answer generation** | deepseek-chat | Query time, ASK mode only | Produce a direct natural language answer for "explain" queries |

**FIND mode: zero LLM calls.** Pure local scoring. Always instant.

**Reranker is now local-first (ONNX, ~150ms offline).** The LLM reranker
is only used as a fallback when the ONNX model fails to load.

**Index-time calls are the expensive ones** (called once, hash-deduped, no repeat
cost until code changes). Query-time calls are the latency problem.

---

## The Storage Schema

All stored locally in SQLite. One database per project per user machine.

```
code_chunks
  ├── id (UUID)
  ├── project_id
  ├── file_path, name, chunk_type (function/class/method/file)
  ├── start_line, end_line
  ├── code_body
  ├── summary_code, summary_purpose       ← from LLM call #1
  ├── concepts[]                          ← from LLM call #1
  ├── embedding_summary (vector)          ← semantic embedding
  ├── embedding_structure (vector)        ← structural identity embedding
  ├── content_hash                        ← for deduplication
  ├── pagerank_score                      ← from graph pipeline
  ├── centrality_score                    ← betweenness centrality
  ├── community_id                        ← from Leiden clustering
  ├── concept_embedding_[1/2/3]           ← from concept phrases
  ├── branch, branch_diverged
  ├── is_exported, signature, language
  └── observation_count                   ← bumped on every retrieval

code_relationships
  ├── from_chunk_id, to_chunk_id
  ├── relationship_type (calls/imports/inherits/etc.)
  ├── weight
  ├── relationship_summary                ← from LLM call #3
  └── relationship_embedding              ← embedded summary

communities
  ├── id (UUID)
  ├── project_id
  ├── label                               ← e.g. "auth-backend-0"
  ├── summary                             ← from LLM call #2
  ├── summary_embedding                   ← embedded summary
  ├── member_count
  └── level                               ← 0 = leaf cluster

project_branches
  ├── branch_name
  └── last_commit_sha
```

---

## The End-to-End Flow (One Example)

```
User opens their backend project → Electron parses 271 files with tree-sitter
  │
  └─► POST /api/index/ingest
      • Hash filter: 30 files changed since last open → 30 chunks re-indexed
      • Context enrichment: add import headers + sibling names
      • Summarize: LLM generates summary_code + summary_purpose + concepts (Call #1)
      • Dual embed: two vectors per chunk (local ONNX, ~384 dims)
      • Upsert: 30 rows updated in SQLite
      • Edge processing: call graph + import edges written
      • Graph pipeline: PageRank + centrality recomputed → Leiden re-clusters
        → community reports regenerated for all clusters (Call #2)
        → relationship summaries for top 50 edges by in-degree (Call #3)
        → concept phrase vectors embedded and written
      • Status → "ready"

User types in Spaces: "why can unauthorized users update videos they don't own"
  Mode = BUG
  │
  └─► POST /api/context
      • Mode router: BUG → search_path="drift"
      • PRIMER: embed query → match community reports
          → "Video operations community" + "Auth middleware community" matched
          → community context formatted as text
      • Follow-up generation (QUERY_REFINER_MODEL, deepseek-chat):
          "Where is the ownership check in the updateVideo controller?"
          "What middleware is applied to the video update route?"
          "How is the requesting user's ID compared to the video owner?"
      • 4 parallel local searches (original + 3 follow-ups):
          anchor discovery → community scope → PageRank ranking
      • MERGE: 4 result sets deduplicated, sorted by final_score
      • Reranker (local ONNX, ~150ms): top candidates re-scored
      • Graph expand: BFS from top 5 results → related chunks added
      • Returns:
          probable_locations[]: updateVideo (score 0.89), verifyJWT (0.76),
                                 video.routes (0.61), Video.findById (0.54), ...
          related_locations[]:  video.model, user.model, ...

python-service optimizer receives probable_locations[]
  │
  └─► Weaves into final prompt:
      "[PROBABLE LOCATIONS]
       1. updateVideo (controllers/video.controller.js:145-201) — score 0.89
          Updates video metadata. No ownership check found before the DB write.
       2. verifyJWT (middlewares/auth.middleware.js:1-28) — score 0.76
          JWT verification middleware. Attaches req.user.
       ..."
  │
  └─► Prompt streams back to user's input field
      User pastes it to Claude/Cursor/ChatGPT → model reads the exact code
      and identifies the missing req.user._id === video.owner check
```

---

## Known Limitations (Honest Flags)

1. **GRAPH_BUILDER_ENABLED is still a flag.** The graph pipeline (PageRank,
   Leiden, community reports, concept embeddings) is gated behind
   `GRAPH_BUILDER_ENABLED=true`. When off, all graph-aware search paths fall
   back to flat retrieval. The schema migration must be run before enabling.

2. **Community reports re-generate on every ingest.** Leiden runs on the full
   graph after every ingest, which means community reports are regenerated even
   if nothing changed in the relevant clusters. This is correct for accuracy but
   adds LLM cost on every ingest. Future optimization: cache community IDs and
   only regenerate reports when membership changes.

3. **Decompose is still paid sometimes when not needed.** Short queries (<12
   tokens) skip it, but longer natural-language queries that don't need it still
   pay. The first-pass result discards decompose results when confidence is high,
   but the LLM call itself already ran in parallel. Cost is low (gpt-4o-mini)
   but non-zero.

4. **Agentic retrieval costs LLM calls on every ASK/BUG query.** On a 38-file
   Express repo it raised recall@5 from 0.32 to ~0.79 and cut median latency
   from 38s to 14s versus one-shot, so it is on by default. Set
   `AGENTIC_RETRIEVAL_ENABLED=false` to run one-shot only (no per-query LLM cost).

5. **FIND is off-thesis.** It's a navigator, not an optimizer. Useful, but the
   core business value is BUG and OPTIMIZE (context injection → token savings).

6. **Silent quality dependence on graph density.** If Electron sends sparse
   call edges, PageRank is flat and the definition-vs-reference signal collapses.
   The service logs a `[GRAPH_HEALTH]` warning when `edge_count == 0` but this
   only surfaces in logs — no alert fires to the user.
