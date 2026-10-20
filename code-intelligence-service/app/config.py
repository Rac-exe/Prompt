import hashlib
import json
import os

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
PRMPT_AI_PROXY_URL = os.environ.get("PRMPT_AI_PROXY_URL", "")
PRMPT_AI_PROXY_TOKEN = os.environ.get("PRMPT_AI_PROXY_TOKEN", "")
CODE_INTEL_DB_ROOT = os.environ.get("CODE_INTEL_DB_ROOT", "")
STORAGE_BACKEND = os.environ.get("STORAGE_BACKEND", "local").lower()

# ── LLM Models ──────────────────────────────────────────────────────────────
SUMMARIZER_MODEL = os.environ.get("SUMMARIZER_MODEL", "openrouter/deepseek/deepseek-chat")
RERANKER_MODEL = os.environ.get("RERANKER_MODEL", "openrouter/deepseek/deepseek-chat")
RERANKER_BACKEND = os.environ.get("RERANKER_BACKEND", "local").lower()
RERANKER_LOCAL_MODEL = os.environ.get("RERANKER_LOCAL_MODEL", "Xenova/bge-reranker-base")
RERANKER_LOCAL_MAX_LENGTH = int(os.environ.get("RERANKER_LOCAL_MAX_LENGTH", "512"))
QUERY_REFINER_MODEL = os.environ.get("QUERY_REFINER_MODEL", "openrouter/deepseek/deepseek-chat")
QUERY_DECOMPOSE_MODEL = os.environ.get("QUERY_DECOMPOSE_MODEL", "openrouter/openai/gpt-4o-mini")
ANSWER_MODEL = os.environ.get("ANSWER_MODEL", "openrouter/deepseek/deepseek-chat")

# ── Agentic multi-hop retrieval (Bet 2) ──────────────────────────────────────
# Opt-in: when enabled, Ask/Bug/Optimize gather context with a bounded local
# tool-calling loop (zero-network SQLite tools) before answering. Falls back to
# one-shot RAG on any failure or cap. Off by default so the baseline pipeline
# stays stable for benchmarking.
AGENTIC_RETRIEVAL_ENABLED = os.environ.get("AGENTIC_RETRIEVAL_ENABLED", "false").lower() == "true"
AGENT_MODEL = os.environ.get("AGENT_MODEL", ANSWER_MODEL)
AGENT_MAX_HOPS = int(os.environ.get("AGENT_MAX_HOPS", "6"))
AGENT_TIME_BUDGET_S = float(os.environ.get("AGENT_TIME_BUDGET_S", "25"))
AGENT_MAX_CHUNKS = int(os.environ.get("AGENT_MAX_CHUNKS", "15"))

EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "text-embedding-3-large")
# Local-first by default: embeddings run on-device via ONNX (no network hop/cost).
EMBEDDING_BACKEND = os.environ.get("EMBEDDING_BACKEND", "local").lower()
# bge-small-en-v1.5 (384-dim) is the default — fast CPU-only (~90MB RAM, ~33M params).
# Switch to Xenova/bge-base-en-v1.5 + 768 dims only when a GPU/ample RAM is available.
EMBEDDING_LOCAL_MODEL = os.environ.get("EMBEDDING_LOCAL_MODEL", "Xenova/bge-small-en-v1.5")
_LOCAL_EMBED_DIM_DEFAULT = "768" if "base" in EMBEDDING_LOCAL_MODEL.lower() else "384"
_EMBEDDING_DIM_DEFAULT = _LOCAL_EMBED_DIM_DEFAULT if EMBEDDING_BACKEND == "local" else "1536"
EMBEDDING_DIMENSIONS = int(os.environ.get("EMBEDDING_DIMENSIONS", _EMBEDDING_DIM_DEFAULT))
STRUCTURE_EMBEDDING_DIMENSIONS = int(os.environ.get("STRUCTURE_EMBEDDING_DIMENSIONS", _EMBEDDING_DIM_DEFAULT))

GITHUB_WEBHOOK_SECRET = os.environ.get("GITHUB_WEBHOOK_SECRET", "")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")

APP_ENV = os.environ.get("APP_ENV", "development")
APP_VERSION = os.environ.get("APP_VERSION", "1.1.0")
SENTRY_DSN = os.environ.get("SENTRY_DSN", "")

GITHUB_POLLING_INTERVAL_SECONDS = 300
MAX_CHUNKS_PER_INGEST = 10_000
SUMMARY_MAX_TOKENS = int(os.environ.get("SUMMARY_MAX_TOKENS", "240"))
RETRIEVAL_DEFAULT_LIMIT = 15
RETRIEVAL_MAX_LIMIT = 50

MAX_CODE_BODY_LEN = 3000
SUMMARIZER_CONCURRENCY = int(os.environ.get("SUMMARIZER_CONCURRENCY", "10"))
SUMMARIZER_BATCH_SIZE = int(os.environ.get("SUMMARIZER_BATCH_SIZE", "8"))
UPSERT_BATCH_SIZE = 50
UPSERT_BATCH_PAUSE_SECONDS = float(os.environ.get("UPSERT_BATCH_PAUSE_SECONDS", "0.15"))
GRAPH_MAX_DEPTH = 2
GRAPH_MAX_RELATED = 20
GRAPH_SIMILARITY_THRESHOLD = 0.25
CACHE_TTL_SECONDS = float(os.environ.get("CACHE_TTL_SECONDS", "60"))

# ── Mode-specific retrieval tuning ─────────────────────────────────────────
FIND_BROAD_LIMIT = int(os.environ.get("FIND_BROAD_LIMIT", "50"))
ASK_BROAD_LIMIT = int(os.environ.get("ASK_BROAD_LIMIT", "30"))
BUG_BROAD_LIMIT = int(os.environ.get("BUG_BROAD_LIMIT", "50"))
OPTIMIZE_BROAD_LIMIT = int(os.environ.get("OPTIMIZE_BROAD_LIMIT", "60"))

ASK_RERANK_LIMIT = int(os.environ.get("ASK_RERANK_LIMIT", "15"))
BUG_RERANK_LIMIT = int(os.environ.get("BUG_RERANK_LIMIT", "12"))
OPTIMIZE_RERANK_LIMIT = int(os.environ.get("OPTIMIZE_RERANK_LIMIT", "20"))

MMR_LAMBDA = float(os.environ.get("MMR_LAMBDA", "0.7"))
MMR_ASK_LAMBDA = float(os.environ.get("MMR_ASK_LAMBDA", "0.6"))
MMR_OPTIMIZE_LAMBDA = float(os.environ.get("MMR_OPTIMIZE_LAMBDA", "0.5"))

GRAPH_SEEDS_BUG = int(os.environ.get("GRAPH_SEEDS_BUG", "3"))
GRAPH_SEEDS_ASK = int(os.environ.get("GRAPH_SEEDS_ASK", "3"))
GRAPH_SEEDS_OPTIMIZE = int(os.environ.get("GRAPH_SEEDS_OPTIMIZE", "5"))
GRAPH_DEPTH_OPTIMIZE = int(os.environ.get("GRAPH_DEPTH_OPTIMIZE", "3"))
GRAPH_MAX_OPTIMIZE = int(os.environ.get("GRAPH_MAX_OPTIMIZE", "30"))

ITERATIVE_REFINEMENT_THRESHOLD = float(os.environ.get("ITERATIVE_REFINEMENT_THRESHOLD", "0.25"))
MAX_ITERATIONS = int(os.environ.get("MAX_ITERATIONS", "2"))
STRUCTURE_SIMILARITY_WEIGHT = float(os.environ.get("STRUCTURE_SIMILARITY_WEIGHT", "0.25"))

# ── FIND mode scoring weights ────────────────────────────────────────────────
FIND_BOOST_LEXICAL = float(os.environ.get("FIND_BOOST_LEXICAL", "0.05"))
FIND_BOOST_PATH = float(os.environ.get("FIND_BOOST_PATH", "0.35"))
FIND_BOOST_SIGNATURE = float(os.environ.get("FIND_BOOST_SIGNATURE", "0.20"))
FIND_BOOST_BODY = float(os.environ.get("FIND_BOOST_BODY", "0.12"))
FIND_BOOST_SIGNAL = float(os.environ.get("FIND_BOOST_SIGNAL", "0.12"))
FIND_BOOST_CONCEPT = float(os.environ.get("FIND_BOOST_CONCEPT", "0.15"))
FIND_PENALTY_MISS = float(os.environ.get("FIND_PENALTY_MISS", "-0.20"))
FIND_MIN_SCORE = float(os.environ.get("FIND_MIN_SCORE", "0.40"))
# Definition-vs-reference: a chunk whose own name IS a requested symbol is the
# definition; chunks that merely call/import it are references and rank lower.
FIND_BOOST_NAME_DEF = float(os.environ.get("FIND_BOOST_NAME_DEF", "0.45"))
# Betweenness-centrality tie-breaker among near-equal candidates (small).
FIND_BOOST_CENTRALITY = float(os.environ.get("FIND_BOOST_CENTRALITY", "0.08"))
FIND_DOMAIN_SIGNAL_TERMS: frozenset[str] = frozenset(
    os.environ.get(
        "FIND_DOMAIN_SIGNAL_TERMS",
        "token,tokens,access,refresh,jwt,bearer,cookie,cookies,"
        "auth,authentication,authorize,authorization,login,logout,"
        "session,user,google,oauth,middleware",
    ).split(",")
)

# ── Pipeline fingerprint ────────────────────────────────────────────────────
# Auto-computed from all retrieval-quality-affecting settings so every search
# is tagged with the exact config that produced it.  When any value changes and
# the service restarts, the fingerprint changes — results land in a new bucket
# automatically, with no manual version bumping required.
#
# Override with PIPELINE_VERSION env var for a human-readable label
# (e.g. "v2-deep-graph").  The final tag used in logging and DB writes is
# PIPELINE_TAG = PIPELINE_VERSION if set, else f"{APP_VERSION}-{fingerprint}".
_FINGERPRINT_INPUTS: dict = {
    "broad": [FIND_BROAD_LIMIT, ASK_BROAD_LIMIT, BUG_BROAD_LIMIT, OPTIMIZE_BROAD_LIMIT],
    "rerank": [ASK_RERANK_LIMIT, BUG_RERANK_LIMIT, OPTIMIZE_RERANK_LIMIT],
    "mmr": [MMR_LAMBDA, MMR_ASK_LAMBDA, MMR_OPTIMIZE_LAMBDA],
    "graph": [GRAPH_MAX_DEPTH, GRAPH_MAX_RELATED, GRAPH_SEEDS_BUG, GRAPH_SEEDS_ASK,
              GRAPH_SEEDS_OPTIMIZE, GRAPH_DEPTH_OPTIMIZE, GRAPH_MAX_OPTIMIZE],
    "refinement": [ITERATIVE_REFINEMENT_THRESHOLD, MAX_ITERATIONS],
    "structure_weight": STRUCTURE_SIMILARITY_WEIGHT,
    "find_boosts": [FIND_BOOST_LEXICAL, FIND_BOOST_PATH, FIND_BOOST_SIGNATURE,
                    FIND_BOOST_BODY, FIND_BOOST_SIGNAL, FIND_BOOST_CONCEPT, FIND_PENALTY_MISS],
    "models": [RERANKER_MODEL, QUERY_DECOMPOSE_MODEL, QUERY_REFINER_MODEL, SUMMARIZER_MODEL],
    "embedding": [EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, STRUCTURE_EMBEDDING_DIMENSIONS],
}
PIPELINE_FINGERPRINT: str = hashlib.md5(
    json.dumps(_FINGERPRINT_INPUTS, sort_keys=True).encode()
).hexdigest()[:8]

PIPELINE_VERSION: str = os.environ.get("PIPELINE_VERSION", "")
PIPELINE_TAG: str = PIPELINE_VERSION if PIPELINE_VERSION else f"{APP_VERSION}-{PIPELINE_FINGERPRINT}"

# ── Graph / Knowledge-graph pipeline ────────────────────────────────────────
# Set GRAPH_BUILDER_ENABLED=true to activate PageRank + Leiden + community
# reports + concept embeddings after every ingest.  Defaults to false so
# existing deployments are unaffected until the schema migration has been run.
GRAPH_BUILDER_ENABLED: bool = os.environ.get("GRAPH_BUILDER_ENABLED", "false").lower() == "true"
COMMUNITY_MODEL: str = os.environ.get("COMMUNITY_MODEL", SUMMARIZER_MODEL)
CONCEPT_PHRASE_PER_CHUNK: int = int(os.environ.get("CONCEPT_PHRASE_PER_CHUNK", "3"))
RELATIONSHIP_EMBED_TOP_N: int = int(os.environ.get("RELATIONSHIP_EMBED_TOP_N", "50"))
FIND_PAGERANK_WEIGHT: float = float(os.environ.get("FIND_PAGERANK_WEIGHT", "0.3"))
COMMUNITY_REPORT_CACHE_TTL: float = float(os.environ.get("COMMUNITY_REPORT_CACHE_TTL", "300"))

# ── Pipeline variants for A/B testing ───────────────────────────────────────
# Each variant is a dict of ModeConfig field overrides applied on top of the
# base mode config.  Callers opt in by passing ?variant=<name>.  Results are
# logged in retrieval_searches for offline comparison via eval.py.
PIPELINE_VARIANTS: dict[str, dict] = {
    "no_refine": {"refine": False},
    "no_rerank": {"rerank": False},
    "deep_graph": {"graph_depth": 4, "graph_seeds": 6, "graph_max": 40},
    "wide_recall": {"broad_limit": 80},
}

# ── SPLADE sparse neural retrieval ──────────────────────────────────────────
# Replaces FTS5 BM25 text_search with learned sparse token-weight vectors.
# Set SPLADE_ENABLED=true after re-indexing to activate. FTS5 fallback fires
# automatically when sparse_embedding is NULL for a project (not yet indexed).
SPLADE_ENABLED: bool = os.environ.get("SPLADE_ENABLED", "false").lower() == "true"
SPLADE_MODEL: str = os.environ.get("SPLADE_MODEL", "Xenova/splade-pp-en-v1")
SPLADE_MIN_WEIGHT: float = float(os.environ.get("SPLADE_MIN_WEIGHT", "0.01"))
