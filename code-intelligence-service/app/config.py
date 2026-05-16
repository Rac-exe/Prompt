import os

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")

# ── LLM Models ──────────────────────────────────────────────────────────────
SUMMARIZER_MODEL = os.environ.get("SUMMARIZER_MODEL", "openrouter/deepseek/deepseek-chat")
RERANKER_MODEL = os.environ.get("RERANKER_MODEL", "openrouter/deepseek/deepseek-chat")
QUERY_REFINER_MODEL = os.environ.get("QUERY_REFINER_MODEL", "openrouter/deepseek/deepseek-chat")
QUERY_DECOMPOSE_MODEL = os.environ.get("QUERY_DECOMPOSE_MODEL", "openrouter/openai/gpt-4o-mini")
ANSWER_MODEL = os.environ.get("ANSWER_MODEL", "openrouter/moonshotai/kimi-k2")

EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "text-embedding-3-large")
EMBEDDING_DIMENSIONS = int(os.environ.get("EMBEDDING_DIMENSIONS", "1536"))
STRUCTURE_EMBEDDING_DIMENSIONS = int(os.environ.get("STRUCTURE_EMBEDDING_DIMENSIONS", "1536"))

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
SIMPLE_QUERY_WORD_THRESHOLD = 20
GRAPH_SIMILARITY_THRESHOLD = 0.25

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

ITERATIVE_REFINEMENT_THRESHOLD = float(os.environ.get("ITERATIVE_REFINEMENT_THRESHOLD", "0.5"))
MAX_ITERATIONS = int(os.environ.get("MAX_ITERATIONS", "2"))
