import sys
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    _env_path = Path(__file__).parent.parent / ".env"
    load_dotenv(dotenv_path=_env_path, override=False)
except ImportError:
    pass

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import logging
import sentry_sdk
from sentry_sdk.integrations.logging import LoggingIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response as StarletteResponse

from app.config import (
    APP_ENV, APP_VERSION, SENTRY_DSN,
    EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, SUMMARIZER_MODEL,
    QUERY_DECOMPOSE_MODEL,
    SUMMARIZER_CONCURRENCY, GRAPH_MAX_DEPTH, GRAPH_MAX_RELATED,
    RETRIEVAL_DEFAULT_LIMIT,
)

log_level = logging.INFO
logging.basicConfig(
    level=log_level,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("code-intel")

sentry_sdk.init(
    dsn=SENTRY_DSN,
    release=f"prmpt-code-intel@{APP_VERSION}",
    environment=APP_ENV,
    traces_sample_rate=1.0 if APP_ENV == "development" else 0.2,
    send_default_pii=False,
    integrations=[
        LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
        FastApiIntegration(),
    ],
)


class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        import uuid
        req_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        response: StarletteResponse = await call_next(request)
        response.headers["X-Request-ID"] = req_id
        return response


app = FastAPI(title="Prmpt Code Intelligence Service", version=APP_VERSION)
app.add_middleware(RequestIDMiddleware)

logger.info(
    "Code Intelligence Service starting — env=%s, version=%s, "
    "embed_model=%s (dim=%s), summarizer=%s, decomposer=%s, "
    "concurrency=%d, graph_depth=%d, graph_max_related=%d, retrieval_limit=%d",
    APP_ENV, APP_VERSION,
    EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, SUMMARIZER_MODEL,
    QUERY_DECOMPOSE_MODEL, SUMMARIZER_CONCURRENCY,
    GRAPH_MAX_DEPTH, GRAPH_MAX_RELATED, RETRIEVAL_DEFAULT_LIMIT,
)

limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

_raw_origins = os.environ.get("ALLOWED_ORIGINS", "")
_allowed_origins = (
    [o.strip() for o in _raw_origins.split(",") if o.strip()]
    if _raw_origins
    else ["http://127.0.0.1", "http://localhost"]
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)

from app.routes.projects import router as projects_router
from app.routes.ingest import router as ingest_router
from app.routes.retrieve import router as retrieve_router
from app.routes.context import router as context_router
from app.routes.sync import router as sync_router
from app.routes.webhooks import router as webhooks_router
from app.routes.feedback import router as feedback_router

app.include_router(projects_router, prefix="/api")
app.include_router(ingest_router, prefix="/api")
app.include_router(retrieve_router, prefix="/api")
app.include_router(context_router, prefix="/api")
app.include_router(sync_router, prefix="/api")
app.include_router(webhooks_router, prefix="/api")
app.include_router(feedback_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "code-intelligence"}


@app.get("/health/ready")
async def health_ready():
    from app.db.supabase_client import get_client
    checks: dict = {}
    try:
        client = get_client()
        checks["supabase"] = client is not None
    except Exception as e:
        checks["supabase"] = False
        sentry_sdk.capture_exception(e)
    from app.config import OPENAI_API_KEY, OPENROUTER_API_KEY
    checks["embedding_key"] = bool(OPENAI_API_KEY) or bool(OPENROUTER_API_KEY)
    all_ok = checks.get("supabase") and checks.get("embedding_key")
    return {"status": "ready" if all_ok else "degraded", "checks": checks}


@app.get("/")
async def root():
    return {
        "service": "Prmpt Code Intelligence Service",
        "version": APP_VERSION,
        "endpoints": {
            "projects": "POST/GET /api/projects",
            "ingest": "POST /api/index/ingest",
            "retrieve": "GET /api/retrieve",
            "context": "POST /api/context",
            "feedback": "POST /api/feedback",
            "sync": "POST /api/sync",
            "webhooks": "POST /api/webhooks/github",
        },
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8002")))
