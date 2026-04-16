import os

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")

# ── LLM Models ──────────────────────────────────────────────────────────────
SUMMARIZER_MODEL = os.environ.get("SUMMARIZER_MODEL", "openrouter/openai/gpt-4.1-nano")
ANALYZER_MODEL = os.environ.get("ANALYZER_MODEL", "openrouter/google/gemini-2.5-flash")
QUERY_DECOMPOSE_MODEL = os.environ.get("QUERY_DECOMPOSE_MODEL", "openrouter/openai/gpt-4o-mini")

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 512

GITHUB_WEBHOOK_SECRET = os.environ.get("GITHUB_WEBHOOK_SECRET", "")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")

APP_ENV = os.environ.get("APP_ENV", "development")
APP_VERSION = os.environ.get("APP_VERSION", "0.0.1-dev")
SENTRY_DSN = os.environ.get("SENTRY_DSN", "")

GITHUB_POLLING_INTERVAL_SECONDS = 300
MAX_CHUNKS_PER_INGEST = 10_000
SUMMARY_MAX_TOKENS = 150
RETRIEVAL_DEFAULT_LIMIT = 15
RETRIEVAL_MAX_LIMIT = 50

MAX_CODE_BODY_LEN = 3000
SUMMARIZER_CONCURRENCY = 15
SUMMARIZER_BATCH_SIZE = 5
UPSERT_BATCH_SIZE = 50
GRAPH_MAX_DEPTH = 2
GRAPH_MAX_RELATED = 20
SIMPLE_QUERY_WORD_THRESHOLD = 20
GRAPH_SIMILARITY_THRESHOLD = 0.25
