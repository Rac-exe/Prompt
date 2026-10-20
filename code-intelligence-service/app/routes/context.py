"""
POST /api/context — probable-location retrieval.
Returns a ranked list of probable files and line ranges (with code bodies)
that may be relevant to the user's query. No diagnosis, no hedged prose.
The downstream LLM decides what's broken.
"""

import json
import logging
import time
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app import llm
from app.auth import require_auth
from app.db import queries
from app.db.models import (
    ContextRequest,
    ContextResponse,
    ExpandedChunk,
    ExpandRequest,
    ProbableLocation,
    RetrievedChunk,
)
from app.services.answer_generator import answer_source_ids, generate_answer_stream
from app.services.search import retrieve_context_full
from app.services.query_preprocessor import preprocess_query

logger = logging.getLogger("code-intel.routes.context")
router = APIRouter(tags=["context"])


def _sse(event: str, data: dict | list | str) -> str:
    payload = data if isinstance(data, str) else json.dumps(data, default=str)
    return f"event: {event}\ndata: {payload}\n\n"


def _loc_dump(loc: ProbableLocation) -> dict:
    dump = getattr(loc, "model_dump", None)
    return dump() if dump else loc.dict()


def _to_probable(chunk: RetrievedChunk) -> ProbableLocation:
    return ProbableLocation(
        file_path=chunk.file_path,
        start_line=chunk.start_line,
        end_line=chunk.end_line,
        chunk_type=chunk.chunk_type,
        name=chunk.name,
        signature=chunk.signature,
        language=chunk.language,
        semantic_summary=chunk.semantic_summary,
        summary_purpose=chunk.summary_purpose,
        code_body=chunk.code_body,
        concepts=chunk.concepts or [],
        confidence_score=chunk.similarity_score,
        is_exported=False,
        branch=chunk.branch,
        branch_diverged=chunk.branch_diverged,
        relevance_reasoning=chunk.relevance_reasoning,
        probable_issue=chunk.probable_issue,
    )


@router.post("/context", response_model=ContextResponse)
async def get_context(
    request: ContextRequest,
    auth: dict = Depends(require_auth),
):
    """
    Probable-location retrieval.
    Runs query preprocessing + hybrid retrieval, then returns the ranked
    chunks as structured ProbableLocation entries. No LLM analysis layer.
    """
    t_start = time.perf_counter()
    user_id = auth.get("sub")

    project = queries.get_project(request.project_id, user_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.get("index_status") == "indexing":
        raise HTTPException(
            status_code=409,
            detail="Project is currently indexing. Please wait.",
        )

    logger.info(
        f"Context request: project={request.project_id}, user={user_id}, "
        f"query={request.query[:80]!r}, mode={request.mode.value}, "
        f"branch={request.branch}, limit={request.limit}, "
        f"variant={request.variant}, index_status={project.get('index_status')}"
    )

    try:
        t_step = time.perf_counter()
        signals = preprocess_query(request.query)
        logger.info(
            f"[CONTEXT] Step 1 — Preprocess: {time.perf_counter() - t_step:.3f}s"
        )

        project_summary = queries.get_project_summary(request.project_id)

        t_step = time.perf_counter()
        result = await retrieve_context_full(
            project_id=request.project_id,
            user_id=user_id,
            query=request.query,
            branch=request.branch,
            limit=request.limit,
            signals=signals,
            mode=request.mode,
            project_summary=project_summary,
            variant=request.variant,
            include_code_body=request.include_code_body,
        )
        logger.info(
            f"[CONTEXT] Step 2 — Retrieval: {time.perf_counter() - t_step:.3f}s, "
            f"{len(result.ranked_chunks)} ranked + {len(result.related_chunks)} related"
        )

        logger.info(
            f"[CONTEXT] Step 3 — Project summary: "
            f"{'present (' + str(len(project_summary)) + ' chars)' if project_summary else 'not found'}"
        )

        from app.services.search import _to_retrieved_chunk
        probable_locations = [_to_probable(_to_retrieved_chunk(c)) for c in result.ranked_chunks]
        related_locations = [_to_probable(_to_retrieved_chunk(c, score=0.0)) for c in result.related_chunks]
        sources = [loc for loc in probable_locations if result.source_ids and loc.name]
        if result.source_ids:
            source_paths = {
                c.get("file_path") for c in result.ranked_chunks
                if str(c.get("id")) in set(result.source_ids)
            }
            sources = [loc for loc in probable_locations if loc.file_path in source_paths]

        elapsed = time.perf_counter() - t_start
        logger.info(
            f"[CONTEXT] Done: project={request.project_id}, "
            f"{len(probable_locations)} probable + {len(related_locations)} related, "
            f"intent={result.query_intent}, concepts={result.query_concepts}, mode={result.mode}, "
            f"total_elapsed={elapsed:.2f}s"
        )

        return ContextResponse(
            mode=result.mode,
            probable_locations=probable_locations,
            related_locations=related_locations,
            answer=result.answer,
            sources=sources,
            intent=result.query_intent or "general",
            concepts=result.query_concepts or [],
            project_summary=project_summary,
            branch_context=result.branch_context,
            search_id=result.search_id,
        )

    except HTTPException:
        raise
    except Exception as e:
        message = llm.user_facing_error(e)
        if message:
            raise HTTPException(status_code=400, detail=message)
        logger.error(f"Context retrieval failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Context retrieval failed")


@router.post("/context/stream")
async def get_context_stream(
    request: ContextRequest,
    auth: dict = Depends(require_auth),
):
    """Streaming variant of /context for Ask: returns retrieved locations first,
    then streams the answer token-by-token over Server-Sent Events. This is the
    biggest perceived-latency win — the UI shows sources + first tokens in
    seconds instead of waiting for the whole completion.

    Event sequence:
      event: locations  -> {probable_locations, related_locations, sources, ...}
      event: token      -> {delta: "..."}   (repeated)
      event: done        -> {source_ids: [...]}
      event: error       -> {message: "..."}
    """
    user_id = auth.get("sub")

    project = queries.get_project(request.project_id, user_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.get("index_status") == "indexing":
        raise HTTPException(status_code=409, detail="Project is currently indexing. Please wait.")

    async def event_stream() -> AsyncIterator[str]:
        t_start = time.perf_counter()
        try:
            signals = preprocess_query(request.query)
            project_summary = queries.get_project_summary(request.project_id)
            # Retrieve WITHOUT the blocking inline answer — we stream it below.
            result = await retrieve_context_full(
                project_id=request.project_id,
                user_id=user_id,
                query=request.query,
                branch=request.branch,
                limit=request.limit,
                signals=signals,
                mode=request.mode,
                project_summary=project_summary,
                variant=request.variant,
                generate_answer_override=False,
            )

            from app.services.search import _to_retrieved_chunk
            probable_locations = [_to_probable(_to_retrieved_chunk(c)) for c in result.ranked_chunks]
            related_locations = [_to_probable(_to_retrieved_chunk(c, score=0.0)) for c in result.related_chunks]
            source_ids = answer_source_ids(result.ranked_chunks)
            source_paths = {
                c.get("file_path") for c in result.ranked_chunks
                if str(c.get("id")) in set(source_ids)
            }
            sources = [loc for loc in probable_locations if loc.file_path in source_paths]

            yield _sse("locations", {
                "mode": result.mode.value if hasattr(result.mode, "value") else str(result.mode),
                "probable_locations": [_loc_dump(loc) for loc in probable_locations],
                "related_locations": [_loc_dump(loc) for loc in related_locations],
                "sources": [_loc_dump(loc) for loc in sources],
                "intent": result.query_intent or "general",
                "concepts": result.query_concepts or [],
                "project_summary": project_summary,
                "branch_context": result.branch_context,
                "search_id": result.search_id,
            })

            emitted_any = False
            async for delta in generate_answer_stream(request.query, result.ranked_chunks, project_summary):
                emitted_any = True
                yield _sse("token", {"delta": delta})

            yield _sse("done", {
                "source_ids": source_ids if emitted_any else [],
                "elapsed": round(time.perf_counter() - t_start, 2),
            })
            logger.info(
                "[CONTEXT_STREAM] done project=%s elapsed=%.2fs answer=%s",
                request.project_id, time.perf_counter() - t_start, "yes" if emitted_any else "no",
            )
        except Exception as e:
            message = llm.user_facing_error(e)
            if not message:
                logger.error(f"Context stream failed: {e}", exc_info=True)
            yield _sse("error", {"message": message or "Context streaming failed"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/chunks/expand", response_model=list[ExpandedChunk])
async def expand_chunks(
    body: ExpandRequest,
    auth: dict = Depends(require_auth),
):
    """
    Fetch full source (code_body + context_header) for a list of chunk IDs.

    This is the tiered-output companion to GET /api/context with
    include_code_body=False. The LLM calls this endpoint only for the chunks
    it actually wants to read, saving tokens on chunks it ignores.

    Each expand call is recorded as an implicit positive feedback signal —
    over time, consistently expanded chunks surface as high-relevance data.
    """
    user_id = auth.get("sub")

    project = queries.get_project(body.project_id, user_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    from app.db.local_store import get_chunks_source, record_feedback

    rows = get_chunks_source(body.project_id, body.chunk_ids)

    # Record expand as implicit positive feedback (no associated search_id here,
    # so we use a synthetic one keyed by project+user+chunks for idempotency).
    try:
        import uuid
        synthetic_search_id = str(uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"expand:{body.project_id}:{user_id}:{','.join(sorted(body.chunk_ids))}",
        ))
        record_feedback(
            search_id=synthetic_search_id,
            project_id=body.project_id,
            user_id=user_id or "",
            mode="expand",
            selected_chunk_ids=body.chunk_ids,
            was_useful=None,
        )
    except Exception as _fb_err:
        logger.warning("[EXPAND] feedback recording failed (non-fatal): %s", _fb_err)

    result: list[ExpandedChunk] = []
    for row in rows:
        result.append(ExpandedChunk(
            id=str(row.get("id", "")),
            file_path=str(row.get("file_path", "")),
            start_line=int(row.get("start_line") or 0),
            end_line=int(row.get("end_line") or 0),
            name=str(row.get("name", "")),
            code_body=row.get("code_body"),
            context_header=row.get("context_header"),
        ))
    return result
