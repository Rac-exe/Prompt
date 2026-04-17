"""
Project context retrieval — calls the Code Intelligence Service
to fetch relevant code chunks (with code bodies) before prompt
optimization.

Prefers the combined /api/context endpoint which returns pre-formatted
tiered context + analysis. Falls back to /api/retrieve + local formatting.
"""

import os
import time
import logging
import sentry_sdk
from dataclasses import dataclass, field
from collections import OrderedDict
import httpx

logger = logging.getLogger("prmpt.project_context")

CODE_INTEL_URL = os.environ.get("CODE_INTELLIGENCE_SERVICE_URL", "").rstrip("/")

MAX_BODY_PER_CHUNK = 2000
MAX_RANKED_IN_CONTEXT = 8
MAX_RELATED_IN_CONTEXT = 8


@dataclass
class ProjectContext:
    text: str
    intent: str = "general"
    concepts: list[str] = field(default_factory=list)
    analysis_block: str = ""


def fetch_project_context(
    project_id: str,
    user_query: str,
    branch: str | None = None,
    auth_token: str | None = None,
    limit: int = 10,
) -> ProjectContext | None:
    """
    Call the Code Intelligence Service to get relevant code context.
    Tries /api/context first (combined retrieval+analysis), falls back to
    /api/retrieve + local formatting.
    """
    if not CODE_INTEL_URL:
        logger.debug("CODE_INTELLIGENCE_SERVICE_URL not set — skipping project context")
        return None

    if not project_id:
        return None

    logger.info(
        f"[PROJECT CTX] Fetching context: project={project_id}, "
        f"query={user_query[:80]!r}, branch={branch}, limit={limit}, "
        f"service_url={CODE_INTEL_URL or '(not set)'}"
    )

    headers = {"Content-Type": "application/json"}
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"

    logger.info("[PROJECT CTX] Trying /api/context endpoint first...")
    result = _try_context_endpoint(project_id, user_query, branch, limit, headers)
    if result is not None:
        logger.info(
            f"[PROJECT CTX] SUCCESS via /api/context: "
            f"context={len(result.text)} chars, "
            f"analysis={'present (' + str(len(result.analysis_block)) + ' chars)' if result.analysis_block else 'absent'}, "
            f"intent={result.intent}, concepts={result.concepts}"
        )
        return result

    logger.info("[PROJECT CTX] /api/context failed, falling back to /api/retrieve...")
    fallback = _fallback_retrieve_endpoint(project_id, user_query, branch, limit, headers)
    if fallback:
        logger.info(
            f"[PROJECT CTX] SUCCESS via /api/retrieve (fallback): "
            f"context={len(fallback.text)} chars, no server-side analysis"
        )
    else:
        logger.warning("[PROJECT CTX] Both endpoints failed — no project context available")
    return fallback


def _try_context_endpoint(
    project_id: str,
    user_query: str,
    branch: str | None,
    limit: int,
    headers: dict,
) -> ProjectContext | None:
    """Call POST /api/context for combined retrieval + analysis."""
    body = {
        "project_id": project_id,
        "query": user_query[:5000],
        "limit": limit,
    }
    if branch:
        body["branch"] = branch

    try:
        t0 = time.perf_counter()
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                f"{CODE_INTEL_URL}/api/context",
                json=body,
                headers=headers,
            )
        elapsed = time.perf_counter() - t0

        if resp.status_code != 200:
            logger.warning(
                f"/api/context returned {resp.status_code} in {elapsed:.2f}s: "
                f"{resp.text[:200]} — falling back to /api/retrieve"
            )
            return None

        data = resp.json()
        context_text = data.get("context_text", "")
        analysis_block = data.get("analysis_block", "")
        intent = data.get("intent", "general")
        concepts = data.get("concepts", [])
        ranked_count = data.get("ranked_count", 0)
        related_count = data.get("related_count", 0)

        if not context_text:
            logger.info("/api/context returned empty context — falling back")
            return None

        logger.info(
            f"/api/context responded in {elapsed:.2f}s: "
            f"{ranked_count} ranked + {related_count} related, "
            f"analysis={'yes' if analysis_block else 'no'}, "
            f"intent={intent}, concepts={concepts}, "
            f"context={len(context_text)} chars"
        )

        return ProjectContext(
            text=context_text,
            intent=intent,
            concepts=concepts,
            analysis_block=analysis_block,
        )

    except httpx.TimeoutException as e:
        sentry_sdk.capture_exception(e)
        logger.warning("/api/context timed out (30s) — falling back to /api/retrieve")
        return None
    except Exception as e:
        sentry_sdk.capture_exception(e)
        logger.warning(f"/api/context failed ({e}) — falling back to /api/retrieve")
        return None


def _fallback_retrieve_endpoint(
    project_id: str,
    user_query: str,
    branch: str | None,
    limit: int,
    headers: dict,
) -> ProjectContext | None:
    """Fallback: call GET /api/retrieve + local formatting."""
    logger.info(
        f"Fetching project context via /api/retrieve: project={project_id}, "
        f"query={user_query[:80]!r}, branch={branch}, limit={limit}"
    )

    params = {
        "project_id": project_id,
        "query": user_query[:5000],
        "limit": limit,
    }
    if branch:
        params["branch"] = branch

    try:
        t0 = time.perf_counter()
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(f"{CODE_INTEL_URL}/api/retrieve", params=params, headers=headers)
        elapsed = time.perf_counter() - t0

        if resp.status_code != 200:
            logger.warning(
                f"Code Intel retrieve returned {resp.status_code} in {elapsed:.2f}s: "
                f"{resp.text[:200]}"
            )
            return None

        data = resp.json()
        ranked_chunks = data.get("ranked_chunks", [])
        related_chunks = data.get("related_chunks", [])
        branch_context = data.get("branch_context")
        query_intent = data.get("query_intent", "general")
        query_concepts = data.get("query_concepts", [])

        bodies_count = sum(1 for c in ranked_chunks if c.get("code_body"))
        logger.info(
            f"Code Intel responded in {elapsed:.2f}s: "
            f"{len(ranked_chunks)} ranked ({bodies_count} with code), "
            f"{len(related_chunks)} related, "
            f"intent={query_intent}, concepts={query_concepts}"
        )

        if not ranked_chunks:
            logger.info("No ranked chunks returned — skipping project context")
            return None

        formatted = _format_context(ranked_chunks, related_chunks, branch_context)
        logger.info(
            f"Project context formatted: {len(formatted)} chars, "
            f"~{len(formatted.split())} words"
        )
        return ProjectContext(
            text=formatted,
            intent=query_intent or "general",
            concepts=query_concepts or [],
        )

    except httpx.TimeoutException as e:
        sentry_sdk.capture_exception(e)
        logger.warning(f"Code Intelligence Service timed out (15s) for project {project_id}")
        return None
    except Exception as e:
        sentry_sdk.capture_exception(e)
        logger.error(f"Failed to fetch project context: {e}", exc_info=True)
        return None


def _format_context(
    ranked_chunks: list[dict],
    related_chunks: list[dict],
    branch_context: dict | None,
) -> str:
    lines = ["[CODEBASE CONTEXT — auto-retrieved from project index]", ""]

    selected = ranked_chunks[:MAX_RANKED_IN_CONTEXT]

    file_groups: OrderedDict[str, list[tuple[int, dict]]] = OrderedDict()
    for i, chunk in enumerate(selected):
        fp = chunk["file_path"]
        if fp not in file_groups:
            file_groups[fp] = []
        file_groups[fp].append((i, chunk))

    for file_path, chunks_in_file in file_groups.items():
        lang = chunks_in_file[0][1].get("language", "")
        lines.append(f"[FILE: {file_path}]")

        for idx, chunk in chunks_in_file:
            label = "PRIMARY" if idx == 0 else f"RELEVANT #{idx+1}"
            lines.append(
                f"  [{label}] {chunk['chunk_type'].title()}: {chunk['name']} "
                f"(lines {chunk['start_line']}–{chunk['end_line']})"
            )

            concepts = chunk.get("concepts") or []
            if concepts:
                lines.append(f"  Concepts: {', '.join(concepts)}")

            if chunk.get("semantic_summary"):
                lines.append(f"  Summary: {chunk['semantic_summary']}")

            if chunk.get("branch_diverged"):
                lines.append("  ⚠ Modified in current branch")

            code_body = chunk.get("code_body")
            if code_body:
                lines.append(f"  ```{lang}")
                for code_line in code_body[:MAX_BODY_PER_CHUNK].split("\n"):
                    lines.append(f"  {code_line}")
                lines.append("  ```")
            elif chunk.get("signature"):
                lines.append(f"  Signature: {chunk['signature']}")

            lines.append("")

    if related_chunks:
        rel_groups: OrderedDict[str, list[dict]] = OrderedDict()
        for chunk in related_chunks[:MAX_RELATED_IN_CONTEXT]:
            fp = chunk["file_path"]
            if fp not in rel_groups:
                rel_groups[fp] = []
            rel_groups[fp].append(chunk)

        lines.append("[RELATED CODE — connected via call graph]")
        for file_path, chunks_in_file in rel_groups.items():
            lines.append(f"  {file_path}:")
            for chunk in chunks_in_file:
                lines.append(
                    f"    {chunk['name']} "
                    f"(lines {chunk['start_line']}–{chunk['end_line']})"
                )
                if chunk.get("semantic_summary"):
                    lines.append(f"      {chunk['semantic_summary']}")
                code_body = chunk.get("code_body")
                if code_body:
                    lang = chunk.get("language", "")
                    lines.append(f"      ```{lang}")
                    for code_line in code_body[:MAX_BODY_PER_CHUNK].split("\n"):
                        lines.append(f"      {code_line}")
                    lines.append("      ```")
        lines.append("")

    if branch_context:
        lines.append("[BRANCH CONTEXT]")
        branch_name = branch_context.get("branch_name", "")
        ahead = branch_context.get("ahead_of_main_by", 0)
        behind = branch_context.get("behind_main_by", 0)
        last_msg = branch_context.get("last_commit_message", "")
        diverged = branch_context.get("diverged_files", [])
        if branch_name:
            lines.append(f"Branch: {branch_name}")
        if ahead or behind:
            lines.append(f"  +{ahead} ahead / -{behind} behind main")
        if last_msg:
            lines.append(f"  Last commit: {last_msg[:100]}")
        if diverged:
            lines.append(f"  Diverged files: {', '.join(diverged[:10])}")
            if len(diverged) > 10:
                lines.append(f"  ... and {len(diverged) - 10} more")
        lines.append("")

    lines.append("[END CODEBASE CONTEXT]")
    return "\n".join(lines)
