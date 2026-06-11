"""
Debug endpoints — no auth required.

POST /api/debug/retrieve  — run the retrieval pipeline and see full score breakdown
GET  /api/debug/projects  — list all locally indexed projects and their IDs

These endpoints bypass authentication so they work immediately in local dev
without a Supabase token. Do NOT expose port 8002 publicly in production.

Usage:
    # Discover your project ID
    curl http://localhost:8002/api/debug/projects

    # Test retrieval
    curl -X POST http://localhost:8002/api/debug/retrieve \
         -H "Content-Type: application/json" \
         -d '{"project_id": "<id>", "query": "where is JWT verified", "mode": "FIND"}'
"""

from __future__ import annotations

import logging
import time
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.db.models import ModeEnum
from app.services.query_preprocessor import preprocess_query

logger = logging.getLogger("code-intel.debug")
router = APIRouter(tags=["debug"])


class DebugRetrieveRequest(BaseModel):
    project_id: str
    query: str = Field(..., min_length=1, max_length=10_000)
    mode: ModeEnum = ModeEnum.ASK
    limit: int = Field(default=20, ge=1, le=50)
    branch: Optional[str] = None
    include_code_body: bool = False
    variant: Optional[str] = None


class DebugChunkResult(BaseModel):
    rank: int
    file_path: str
    name: str
    chunk_type: str
    start_line: int
    end_line: int
    language: str
    signature: Optional[str] = None
    summary: Optional[str] = None
    summary_purpose: Optional[str] = None
    concepts: list[str] = Field(default_factory=list)
    relevance_reasoning: Optional[str] = None
    code_body: Optional[str] = None
    scores: dict = Field(default_factory=dict)
    similarity_pct: float


class DebugRetrieveResponse(BaseModel):
    project_id: str
    query: str
    mode: str
    elapsed_ms: float
    timing: dict
    total_results: int
    results: list[DebugChunkResult]
    query_intent: str
    query_concepts: list[str]
    pipeline_tag: str


@router.get("/debug/projects")
async def debug_list_projects():
    """List all locally indexed projects — use this to find your project_id."""
    from app.db.local_store import get_db_root
    from pathlib import Path

    db_root = get_db_root()
    projects_dir = db_root / "projects"
    results = []
    if projects_dir.exists():
        for db_path in sorted(projects_dir.glob("*/index.db")):
            project_id = db_path.parent.name
            try:
                from app.db.local_store import get_local_project
                proj = get_local_project(project_id)
                if proj:
                    results.append({
                        "project_id": project_id,
                        "name": proj.get("name"),
                        "local_path": proj.get("local_path"),
                        "index_status": proj.get("index_status"),
                        "last_indexed_at": proj.get("last_indexed_at"),
                        "current_branch": proj.get("current_branch"),
                    })
                else:
                    results.append({"project_id": project_id, "name": None, "index_status": "unknown"})
            except Exception as e:
                results.append({"project_id": project_id, "error": str(e)})
    return {"count": len(results), "projects": results}


@router.post("/debug/retrieve", response_model=DebugRetrieveResponse)
async def debug_retrieve(body: DebugRetrieveRequest):
    """
    Debug retrieval endpoint: runs the full pipeline and returns ranked chunks
    with all internal score components and per-step timing.

    Designed for local testing — project_id is logged prominently so you can
    correlate with the service logs.
    """
    from app.config import PIPELINE_TAG

    t_total = time.perf_counter()
    user_id = "debug"

    logger.info(
        "[DEBUG_RETRIEVE] ═══════════════════════════════════════════════════"
    )
    logger.info(
        "[DEBUG_RETRIEVE] project_id=%s | mode=%s | query=%r | user=%s",
        body.project_id, body.mode.value, body.query[:120], user_id,
    )
    logger.info(
        "[DEBUG_RETRIEVE] ═══════════════════════════════════════════════════"
    )

    # Use local store directly — skips Supabase entirely so the endpoint works
    # without a service role key or auth token.
    from app.db.local_store import get_local_project, get_project_summary as _local_summary

    project = get_local_project(body.project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project not found: {body.project_id!r}. Run GET /api/debug/projects to list indexed projects.")
    if project.get("index_status") == "indexing":
        raise HTTPException(status_code=409, detail="Project is currently indexing. Wait and retry.")

    timing: dict[str, float] = {}

    t = time.perf_counter()
    signals = preprocess_query(body.query)
    timing["preprocess_ms"] = round((time.perf_counter() - t) * 1000, 1)

    project_summary = _local_summary(body.project_id)

    from app.services.search import retrieve_context_full
    t = time.perf_counter()
    result = await retrieve_context_full(
        project_id=body.project_id,
        user_id=user_id,
        query=body.query,
        branch=body.branch,
        limit=body.limit,
        signals=signals,
        mode=body.mode,
        project_summary=project_summary,
        variant=body.variant,
        include_code_body=body.include_code_body,
    )
    timing["retrieval_ms"] = round((time.perf_counter() - t) * 1000, 1)
    timing["total_ms"] = round((time.perf_counter() - t_total) * 1000, 1)

    debug_results: list[DebugChunkResult] = []
    for rank, chunk in enumerate(result.ranked_chunks):
        final_score = float(chunk.get("final_score") or chunk.get("rrf_score") or chunk.get("similarity") or 0.0)
        similarity_pct = round(min(final_score * 100, 100.0), 1)

        scores = {}
        for score_key in ("final_score", "rrf_score", "rerank_score", "similarity",
                          "structure_similarity", "concept_similarity", "_find_raw"):
            val = chunk.get(score_key)
            if val is not None:
                try:
                    scores[score_key] = round(float(val), 4)
                except (TypeError, ValueError):
                    pass

        concepts = chunk.get("concepts") or []
        if isinstance(concepts, str):
            import json as _json
            try:
                concepts = _json.loads(concepts)
            except Exception:
                concepts = []

        debug_results.append(DebugChunkResult(
            rank=rank + 1,
            file_path=str(chunk.get("file_path") or ""),
            name=str(chunk.get("name") or ""),
            chunk_type=str(chunk.get("chunk_type") or ""),
            start_line=int(chunk.get("start_line") or 0),
            end_line=int(chunk.get("end_line") or 0),
            language=str(chunk.get("language") or ""),
            signature=chunk.get("signature"),
            summary=chunk.get("summary_code") or chunk.get("semantic_summary"),
            summary_purpose=chunk.get("summary_purpose"),
            concepts=concepts if isinstance(concepts, list) else [],
            relevance_reasoning=chunk.get("relevance_reasoning"),
            code_body=chunk.get("code_body") if body.include_code_body else None,
            scores=scores,
            similarity_pct=similarity_pct,
        ))

    logger.info(
        "[DEBUG_RETRIEVE] Done — project=%s mode=%s results=%d elapsed=%.0fms top=%s (%.1f%%)",
        body.project_id, body.mode.value, len(debug_results),
        timing["total_ms"],
        debug_results[0].name if debug_results else "—",
        debug_results[0].similarity_pct if debug_results else 0.0,
    )

    return DebugRetrieveResponse(
        project_id=body.project_id,
        query=body.query,
        mode=result.mode.value if hasattr(result.mode, "value") else str(result.mode),
        elapsed_ms=timing["total_ms"],
        timing=timing,
        total_results=len(debug_results),
        results=debug_results,
        query_intent=result.query_intent or "general",
        query_concepts=result.query_concepts or [],
        pipeline_tag=PIPELINE_TAG,
    )
