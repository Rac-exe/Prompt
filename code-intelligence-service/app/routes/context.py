"""
POST /api/context — combined retrieval + analysis + tiered formatting.
Single endpoint that the python-service calls instead of separate
retrieve + local analyze.
"""

import asyncio
import logging
import time
from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_auth
from app.db import queries
from app.db.models import ContextRequest, ContextResponse
from app.services.search import retrieve_context
from app.services.query_preprocessor import preprocess_query
from app.services.code_analyzer import analyze_code

logger = logging.getLogger("code-intel.routes.context")
router = APIRouter(tags=["context"])

FULL_CODE_BODY_LIMIT = 2000
TOP_N_FULL_CODE = 3


def _format_tiered_context(
    ranked_chunks,
    related_chunks,
    already_correct_files: set[str] | None = None,
    project_summary: str | None = None,
) -> str:
    """
    Format chunks into tiered context:
    - Top N ranked: full code body (truncated to FULL_CODE_BODY_LIMIT)
    - Remaining ranked: signature + summary
    - Related: name + one-line summary
    - Already correct files: name only
    """
    parts: list[str] = []

    if project_summary:
        parts.append(f"[PROJECT OVERVIEW]\n{project_summary}\n")

    if ranked_chunks:
        parts.append("[RANKED CODE CHUNKS]")
        for i, chunk in enumerate(ranked_chunks):
            file_line = f"{chunk.file_path}:{chunk.start_line}-{chunk.end_line}"

            if already_correct_files and chunk.file_path in already_correct_files:
                parts.append(
                    f"\n--- {chunk.name} ({file_line}) [already_correct] ---\n"
                    f"Type: {chunk.chunk_type} | Language: {chunk.language}"
                )
                continue

            if i < TOP_N_FULL_CODE and chunk.code_body:
                body = chunk.code_body[:FULL_CODE_BODY_LIMIT]
                if len(chunk.code_body) > FULL_CODE_BODY_LIMIT:
                    body += "\n... (truncated)"
                parts.append(
                    f"\n--- {chunk.name} ({file_line}) ---\n"
                    f"Type: {chunk.chunk_type} | Language: {chunk.language}"
                    f"{f' | Score: {chunk.similarity_score:.3f}' if chunk.similarity_score else ''}\n"
                    f"{f'Summary: {chunk.semantic_summary}' if chunk.semantic_summary else ''}\n"
                    f"```{chunk.language}\n{body}\n```"
                )
            else:
                sig = chunk.signature or chunk.name
                summary = chunk.semantic_summary or ""
                parts.append(
                    f"\n--- {chunk.name} ({file_line}) [signature only] ---\n"
                    f"Type: {chunk.chunk_type} | Language: {chunk.language}\n"
                    f"Signature: {sig}\n"
                    f"Summary: {summary}"
                )

    if related_chunks:
        parts.append("\n[RELATED CODE (via call graph)]")
        for chunk in related_chunks:
            summary = chunk.semantic_summary or ""
            parts.append(
                f"  - {chunk.name} ({chunk.file_path}) — {summary[:120]}"
            )

    return "\n".join(parts)


def _format_analysis_block(findings: dict) -> str:
    """Format code analysis findings into a readable block."""
    lines: list[str] = ["[CODE ANALYSIS]"]

    root_cause = findings.get("root_cause", "")
    if root_cause:
        lines.append(f"Root cause: {root_cause}")

    for f in findings.get("findings", []):
        status = f.get("status", "unknown")
        priority = f.get("fix_priority", "")
        lines.append(f"\n  File: {f.get('file', 'unknown')} — {status} (priority: {priority})")

        for correct in f.get("already_correct", []):
            lines.append(f"    ✓ {correct}")
        for bug in f.get("actual_bugs", []):
            lines.append(f"    ✗ {bug}")

    missing = findings.get("missing_context", [])
    if missing:
        lines.append("\n  Missing context:")
        for m in missing:
            lines.append(f"    - {m}")

    scope = findings.get("affected_scope", "")
    if scope:
        lines.append(f"\n  Affected scope: {scope}")

    return "\n".join(lines)


@router.post("/context", response_model=ContextResponse)
async def get_context(
    request: ContextRequest,
    auth: dict = Depends(require_auth),
):
    """
    Combined retrieval + analysis + tiered formatting.
    Returns pre-formatted context text and analysis block.
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
        f"query={request.query[:80]!r}, branch={request.branch}, limit={request.limit}"
    )

    try:
        # 1. Preprocess the query for structured signals
        t_step = time.perf_counter()
        signals = preprocess_query(request.query)
        logger.info(
            f"[CONTEXT] Step 1 — Preprocess: {time.perf_counter() - t_step:.3f}s"
        )

        # 2. Run retrieval pipeline with all improvements
        t_step = time.perf_counter()
        result = await retrieve_context(
            project_id=request.project_id,
            user_id=user_id,
            query=request.query,
            branch=request.branch,
            limit=request.limit,
            signals=signals,
        )
        logger.info(
            f"[CONTEXT] Step 2 — Retrieval: {time.perf_counter() - t_step:.3f}s, "
            f"{len(result.ranked_chunks)} ranked + {len(result.related_chunks)} related"
        )

        # 3. Get project summary
        project_summary = queries.get_project_summary(request.project_id)
        logger.info(
            f"[CONTEXT] Step 3 — Project summary: "
            f"{'present (' + str(len(project_summary)) + ' chars)' if project_summary else 'not found'}"
        )

        # 4. Format initial tiered context for the analyzer
        t_step = time.perf_counter()
        initial_context = _format_tiered_context(
            result.ranked_chunks,
            result.related_chunks,
            project_summary=project_summary,
        )
        full_code_count = min(len(result.ranked_chunks), TOP_N_FULL_CODE)
        sig_only_count = max(0, len(result.ranked_chunks) - TOP_N_FULL_CODE)
        logger.info(
            f"[CONTEXT] Step 4 — Tiered format: {len(initial_context)} chars "
            f"({full_code_count} full code, {sig_only_count} signature-only, "
            f"{len(result.related_chunks)} related name-only), "
            f"took {time.perf_counter() - t_step:.3f}s"
        )

        # 5. Run code analysis
        t_step = time.perf_counter()
        logger.info(
            f"[CONTEXT] Step 5 — Starting code analysis with "
            f"intent={result.query_intent}, concepts={result.query_concepts}"
        )
        findings = await asyncio.to_thread(
            analyze_code,
            user_query=request.query,
            project_context_text=initial_context,
            intent=result.query_intent or "general",
            concepts=result.query_concepts,
        )
        logger.info(
            f"[CONTEXT] Step 5 — Analysis complete: "
            f"{'findings returned' if findings else 'no findings'}, "
            f"took {time.perf_counter() - t_step:.3f}s"
        )

        # 6. Iterative retrieval: if analysis found missing context, fetch more
        already_correct_files: set[str] = set()
        if findings:
            for f in findings.get("findings", []):
                if f.get("status") == "already_correct":
                    already_correct_files.add(f.get("file", ""))

            logger.info(
                f"[CONTEXT] Step 6 — Post-analysis: "
                f"already_correct_files={already_correct_files or 'none'}"
            )

            missing = findings.get("missing_context", [])
            if missing and len(missing) <= 5:
                logger.info(
                    f"[CONTEXT] Step 6 — Iterative retrieval: "
                    f"fetching {len(missing)} missing items: {missing}"
                )
                for missing_query in missing[:3]:
                    try:
                        extra = await retrieve_context(
                            project_id=request.project_id,
                            user_id=user_id,
                            query=missing_query,
                            branch=request.branch,
                            limit=3,
                        )
                        existing_ids = {c.id for c in result.ranked_chunks}
                        existing_ids.update(c.id for c in result.related_chunks)
                        added = 0
                        for chunk in extra.ranked_chunks:
                            if chunk.id not in existing_ids:
                                result.related_chunks.append(chunk)
                                existing_ids.add(chunk.id)
                                added += 1
                        logger.info(
                            f"[CONTEXT] Iterative retrieval for '{missing_query[:50]}': "
                            f"found {len(extra.ranked_chunks)}, added {added} new"
                        )
                    except Exception as e:
                        logger.warning(f"Iterative retrieval failed for '{missing_query}': {e}")

        # 7. Format final tiered context with already_correct filtering
        context_text = _format_tiered_context(
            result.ranked_chunks,
            result.related_chunks,
            already_correct_files=already_correct_files,
            project_summary=project_summary,
        )

        analysis_block = _format_analysis_block(findings) if findings else ""

        elapsed = time.perf_counter() - t_start
        logger.info(
            f"[CONTEXT] Step 7 — Final response: project={request.project_id}, "
            f"{len(result.ranked_chunks)} ranked + {len(result.related_chunks)} related, "
            f"context_text={len(context_text)} chars, "
            f"analysis_block={len(analysis_block)} chars, "
            f"already_correct={len(already_correct_files)} files, "
            f"total_elapsed={elapsed:.2f}s"
        )

        return ContextResponse(
            context_text=context_text,
            analysis_block=analysis_block,
            intent=result.query_intent or "general",
            concepts=result.query_concepts,
            ranked_count=len(result.ranked_chunks),
            related_count=len(result.related_chunks),
            project_summary=project_summary,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Context generation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Context generation failed")
