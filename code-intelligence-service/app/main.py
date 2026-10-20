import sys
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    _env_path = Path(__file__).parent.parent / ".env"
    load_dotenv(dotenv_path=_env_path, override=False)
except ImportError:
    pass

# Use litellm's bundled model price list instead of fetching it from GitHub
# on import, and opt out of Hugging Face Hub telemetry for the model downloads.
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import logging
from fastapi import FastAPI
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response as StarletteResponse

from app import llm
from app.config import (
    APP_ENV, APP_VERSION,
    EMBEDDING_MODEL, EMBEDDING_BACKEND, EMBEDDING_LOCAL_MODEL, EMBEDDING_DIMENSIONS, SUMMARIZER_MODEL,
    QUERY_DECOMPOSE_MODEL,
    SUMMARIZER_CONCURRENCY, GRAPH_MAX_DEPTH, GRAPH_MAX_RELATED,
    RETRIEVAL_DEFAULT_LIMIT,
    PIPELINE_TAG, PIPELINE_FINGERPRINT,
    GRAPH_BUILDER_ENABLED, CONCEPT_PHRASE_PER_CHUNK, FIND_PAGERANK_WEIGHT,
    RERANKER_BACKEND, RERANKER_LOCAL_MODEL,
)
from app.origin_guard import BrowserOriginGuard
from app.runtime_state import is_service_ready, set_service_ready

log_level = logging.INFO
logging.basicConfig(
    level=log_level,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("code-intel")


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Per-request context: request id, the index root announced by the desktop
    app, and the user's LLM settings (API key + RAG model) from headers."""

    async def dispatch(self, request: StarletteRequest, call_next):
        import uuid
        req_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        db_root = request.headers.get("x-prmpt-code-intel-root")
        if db_root:
            from app.db.local_store import set_runtime_db_root
            set_runtime_db_root(db_root)
        token = llm.use_settings(llm.settings_from_headers(request.headers))
        try:
            response: StarletteResponse = await call_next(request)
        finally:
            llm.reset_settings(token)
        response.headers["X-Request-ID"] = req_id
        return response


app = FastAPI(title="Prmpt Code Intelligence Service", version=APP_VERSION)
app.add_middleware(RequestContextMiddleware)
app.add_middleware(BrowserOriginGuard)

logger.info(
    "Code Intelligence Service starting — env=%s, version=%s, pipeline_tag=%s (fingerprint=%s), "
    "embed_backend=%s, embed_model=%s (dim=%s), summarizer=%s, decomposer=%s, "
    "concurrency=%d, graph_depth=%d, graph_max_related=%d, retrieval_limit=%d, "
    "reranker_backend=%s, reranker_local_model=%s",
    APP_ENV, APP_VERSION, PIPELINE_TAG, PIPELINE_FINGERPRINT,
    EMBEDDING_BACKEND,
    (EMBEDDING_LOCAL_MODEL if EMBEDDING_BACKEND == "local" else EMBEDDING_MODEL),
    EMBEDDING_DIMENSIONS, SUMMARIZER_MODEL,
    QUERY_DECOMPOSE_MODEL, SUMMARIZER_CONCURRENCY,
    GRAPH_MAX_DEPTH, GRAPH_MAX_RELATED, RETRIEVAL_DEFAULT_LIMIT,
    RERANKER_BACKEND,
    (RERANKER_LOCAL_MODEL if RERANKER_BACKEND == "local" else "n/a"),
)
logger.info(
    "Knowledge graph pipeline — GRAPH_BUILDER_ENABLED=%s | "
    "concept_phrases_per_chunk=%d | find_pagerank_weight=%.2f | "
    "search_paths: FIND=local ASK=global BUG=drift OPTIMIZE=local_centrality",
    GRAPH_BUILDER_ENABLED, CONCEPT_PHRASE_PER_CHUNK, FIND_PAGERANK_WEIGHT,
)
if not GRAPH_BUILDER_ENABLED:
    logger.warning(
        "GRAPH_BUILDER_ENABLED=false — graph pipeline is OFF. "
        "Set GRAPH_BUILDER_ENABLED=true in .env and re-index to activate."
    )

from app.routes.projects import router as projects_router
from app.routes.ingest import router as ingest_router
from app.routes.retrieve import router as retrieve_router
from app.routes.context import router as context_router
from app.routes.feedback import router as feedback_router
from app.routes.pipeline import router as pipeline_router
from app.routes.graph_viz import router as graph_viz_router
from app.routes.debug import router as debug_router

app.include_router(projects_router, prefix="/api")
app.include_router(ingest_router, prefix="/api")
app.include_router(retrieve_router, prefix="/api")
app.include_router(context_router, prefix="/api")
app.include_router(feedback_router, prefix="/api")
app.include_router(pipeline_router, prefix="/api")
app.include_router(graph_viz_router, prefix="/api")
app.include_router(debug_router, prefix="/api")


@app.on_event("startup")
async def _on_startup() -> None:
    import asyncio
    from app.db.local_store import warmup_local_store
    from app.services.reranker import initialize_local_reranker

    set_service_ready(False)
    ok = warmup_local_store()
    set_service_ready(ok)
    if ok:
        logger.info("Startup warmup complete: service ready for ingest")
    else:
        logger.error("Startup warmup failed: ingest will return 503 until next successful warmup")

    if RERANKER_BACKEND == "local":
        reranker_ok = await asyncio.to_thread(initialize_local_reranker)
        if not reranker_ok:
            logger.warning(
                "Local reranker unavailable at startup (model=%s); "
                "reranking will fall back to LLM reranker",
                RERANKER_LOCAL_MODEL,
            )


@app.get("/health")
async def health():
    return {"status": "ok", "service": "code-intelligence"}


@app.get("/health/ready")
async def health_ready():
    checks: dict = {}
    checks["service_ready"] = is_service_ready()
    from app.db.local_store import get_db_root
    try:
        db_root = get_db_root()
        checks["local_sqlite"] = db_root.exists() and os.access(db_root, os.W_OK)
        checks["db_root"] = str(db_root)
    except Exception:
        logger.warning("Local SQLite root check failed", exc_info=True)
        checks["local_sqlite"] = False
    if RERANKER_BACKEND == "local":
        from app.services import reranker as _reranker_mod
        checks["reranker_local"] = _reranker_mod._local_model_loaded
        checks["reranker_local_model"] = RERANKER_LOCAL_MODEL
    else:
        checks["reranker_local"] = None
    all_ok = checks.get("service_ready") and checks.get("local_sqlite")
    return {"status": "ready" if all_ok else "degraded", "checks": checks}


@app.get("/")
async def root():
    return {
        "service": "Prmpt Code Intelligence Service",
        "version": APP_VERSION,
        "pipeline_tag": PIPELINE_TAG,
        "endpoints": {
            "projects": "POST/GET /api/projects",
            "ingest": "POST /api/index/ingest",
            "retrieve": "GET /api/retrieve",
            "context": "POST /api/context",
            "context_stream": "POST /api/context/stream",
            "feedback": "POST /api/feedback",
            "pipeline_status": "GET /api/pipeline/status",
            "pipeline_compare": "GET /api/pipeline/compare",
            "graph_data": "GET /api/graph/data/{project_id}",
            "debug_retrieve": "POST /api/debug/retrieve",
        },
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8002")))
