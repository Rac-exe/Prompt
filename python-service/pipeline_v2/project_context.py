"""
Project context retrieval — calls the Code Intelligence Service
to fetch probable code locations (with code bodies) before prompt
optimization.

Prefers the /api/context endpoint which returns structured
probable_locations. Falls back to /api/retrieve if that fails.
Formats everything locally into a plain-text "[PROBABLE LOCATIONS]"
block that is prepended to the final prompt — no diagnosis, no
hedged prose. The downstream LLM reads the code and decides what
is broken.
"""

import os
import time
import logging
import sentry_sdk
from dataclasses import dataclass, field
from collections import OrderedDict
import httpx

logger = logging.getLogger("prmpt.project_context")

# Default to the local code-intel service when unset. Electron's code-intel
# client uses the same default, and in packaged builds both services run on
# the same machine, so 127.0.0.1:8002 is correct across dev and prod. An
# explicit env var still overrides this.
CODE_INTEL_URL = (os.environ.get("CODE_INTELLIGENCE_SERVICE_URL", "").strip() or "http://127.0.0.1:8002").rstrip("/")

MAX_BODY_PER_CHUNK = 2000
MAX_PROBABLE_IN_CONTEXT = 8
MAX_RELATED_IN_CONTEXT = 4


@dataclass
class ProjectContext:
    text: str
    intent: str = "general"
    concepts: list[str] = field(default_factory=list)


class ProjectContextUnavailableError(RuntimeError):
    """Raised when project-attached optimization cannot obtain code context."""


def fetch_project_context(
    project_id: str,
    user_query: str,
    branch: str | None = None,
    auth_token: str | None = None,
    limit: int = 20,
    mode: str | None = None,
    code_intel_root: str | None = None,
) -> ProjectContext | None:
    """
    Call the Code Intelligence Service to get probable locations.
    Tries /api/context first (structured probable_locations), falls back
    to /api/retrieve if that fails.

    code_intel_root: the Electron-announced local DB root (userData/code-intel).
    It MUST be forwarded as the X-Prmpt-Code-Intel-Root header so the service
    reads the same per-project index.db Electron wrote to. Find requests go
    Electron→service directly (header set there); optimize/ask/bug go
    Electron→python-service→service, so we re-attach the header here. Relying on
    the service's sticky global root is unsafe (resets on reload / first call).
    """
    if not CODE_INTEL_URL:
        logger.debug("CODE_INTELLIGENCE_SERVICE_URL not set — skipping project context")
        return None

    if not project_id:
        return None

    logger.info(
        f"[PROJECT CTX] Fetching context: project={project_id}, "
        f"query={user_query[:80]!r}, branch={branch}, limit={limit}, "
        f"service_url={CODE_INTEL_URL or '(not set)'}, "
        f"db_root={'set' if code_intel_root else 'MISSING'}"
    )

    headers = {"Content-Type": "application/json"}
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"
    if code_intel_root:
        headers["X-Prmpt-Code-Intel-Root"] = code_intel_root

    logger.info("[PROJECT CTX] Trying /api/context endpoint first...")
    result = _try_context_endpoint(project_id, user_query, branch, limit, headers, mode)
    if result is not None:
        logger.info(
            f"[PROJECT CTX] SUCCESS via /api/context: "
            f"context={len(result.text)} chars, "
            f"intent={result.intent}, concepts={result.concepts}"
        )
        return result

    logger.info("[PROJECT CTX] /api/context failed, falling back to /api/retrieve...")
    fallback = _fallback_retrieve_endpoint(project_id, user_query, branch, limit, headers)
    if fallback:
        logger.info(
            f"[PROJECT CTX] SUCCESS via /api/retrieve (fallback): "
            f"context={len(fallback.text)} chars"
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
    mode: str | None = None,
) -> ProjectContext | None:
    """Call POST /api/context for structured probable-location retrieval."""
    body = {
        "project_id": project_id,
        "query": user_query[:5000],
        "limit": limit,
        "mode": mode or _infer_mode(user_query),
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
        probable_locations = data.get("probable_locations", [])
        related_locations = data.get("related_locations", [])
        intent = data.get("intent", "general")
        concepts = data.get("concepts", [])
        project_summary = data.get("project_summary") or None
        branch_context = data.get("branch_context") or None

        if not probable_locations:
            logger.info("/api/context returned no probable_locations — falling back")
            return None

        logger.info(
            f"/api/context responded in {elapsed:.2f}s: "
            f"{len(probable_locations)} probable + {len(related_locations)} related, "
            f"intent={intent}, concepts={concepts}, "
            f"summary={'yes' if project_summary else 'no'}"
        )

        formatted = _format_probable_locations(
            probable_locations,
            related_locations,
            project_summary=project_summary,
            branch_context=branch_context,
        )

        return ProjectContext(
            text=formatted,
            intent=intent,
            concepts=concepts,
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
    """Fallback: call GET /api/retrieve and format locally."""
    logger.info(
        f"Fetching project context via /api/retrieve: project={project_id}, "
        f"query={user_query[:80]!r}, branch={branch}, limit={limit}"
    )

    params = {
        "project_id": project_id,
        "query": user_query[:5000],
        "limit": limit,
        "mode": _infer_mode(user_query),
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

        probable = [_chunk_to_location_dict(c) for c in ranked_chunks]
        related = [_chunk_to_location_dict(c) for c in related_chunks]

        formatted = _format_probable_locations(
            probable,
            related,
            project_summary=None,
            branch_context=branch_context,
        )
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


def _chunk_to_location_dict(chunk: dict) -> dict:
    """Adapt a raw /api/retrieve chunk dict to the probable_location shape."""
    return {
        "file_path": chunk.get("file_path", ""),
        "start_line": chunk.get("start_line", 0),
        "end_line": chunk.get("end_line", 0),
        "chunk_type": chunk.get("chunk_type", ""),
        "name": chunk.get("name", ""),
        "signature": chunk.get("signature"),
        "language": chunk.get("language", ""),
        "semantic_summary": chunk.get("semantic_summary"),
        "summary_purpose": chunk.get("summary_purpose"),
        "code_body": chunk.get("code_body"),
        "concepts": chunk.get("concepts") or [],
        "confidence_score": chunk.get("similarity_score", 0.0),
        "branch_diverged": chunk.get("branch_diverged", False),
        "relevance_reasoning": chunk.get("relevance_reasoning"),
        "probable_issue": chunk.get("probable_issue"),
    }


def _format_probable_locations(
    probable_locations: list[dict],
    related_locations: list[dict],
    project_summary: str | None = None,
    branch_context: dict | None = None,
) -> str:
    """
    Render probable locations as a plain-text block to prepend to the
    final user prompt. No diagnosis, no "already correct" claims —
    just "here are the files most likely relevant, with code."
    """
    lines: list[str] = [
        "[PROBABLE LOCATIONS - auto-retrieved from project index]",
        "These files/lines MAY be relevant to the user's request. "
        "Treat them as hints, not authoritative. Read the code and decide yourself.",
        "",
    ]

    selected = probable_locations[:MAX_PROBABLE_IN_CONTEXT]

    file_groups: OrderedDict[str, list[tuple[int, dict]]] = OrderedDict()
    for i, loc in enumerate(selected):
        fp = loc["file_path"]
        file_groups.setdefault(fp, []).append((i, loc))

    for file_path, locs_in_file in file_groups.items():
        lines.append(f"[FILE: {file_path}]")
        for rank_idx, loc in locs_in_file:
            conf = loc.get("confidence_score", 0.0) or 0.0
            chunk_type = (loc.get("chunk_type") or "").title() or "Chunk"
            lang = loc.get("language", "") or ""
            lines.append(
                f"  [PROBABLE #{rank_idx + 1}] {chunk_type}: {loc.get('name', '?')} "
                f"(lines {loc.get('start_line', 0)}-{loc.get('end_line', 0)}) "
                f"| confidence {conf:.2f}"
            )

            concepts = loc.get("concepts") or []
            if concepts:
                lines.append(f"  Concepts: {', '.join(concepts)}")

            summary = loc.get("semantic_summary")
            if summary:
                lines.append(f"  Summary: {summary}")
            purpose = loc.get("summary_purpose")
            if purpose:
                lines.append(f"  Purpose: {purpose}")
            if loc.get("relevance_reasoning"):
                lines.append(f"  Why retrieved: {loc.get('relevance_reasoning')}")
            if loc.get("probable_issue"):
                lines.append(f"  Possible issue: {loc.get('probable_issue')}")

            if loc.get("branch_diverged"):
                lines.append("  Note: modified in current branch")

            code_body = loc.get("code_body")
            include_code_body = rank_idx < 3
            if code_body and include_code_body:
                lines.append(f"  ```{lang}")
                for code_line in code_body[:MAX_BODY_PER_CHUNK].split("\n"):
                    lines.append(f"  {code_line}")
                lines.append("  ```")
            elif loc.get("signature"):
                lines.append(f"  Signature: {loc['signature']}")

            lines.append("")

    if related_locations:
        rel_groups: OrderedDict[str, list[dict]] = OrderedDict()
        for loc in related_locations[:MAX_RELATED_IN_CONTEXT]:
            fp = loc["file_path"]
            rel_groups.setdefault(fp, []).append(loc)

        lines.append("[RELATED - connected via call graph]")
        for file_path, locs_in_file in rel_groups.items():
            lines.append(f"  {file_path}:")
            for loc in locs_in_file:
                lines.append(
                    f"    {loc.get('name', '?')} "
                    f"(lines {loc.get('start_line', 0)}-{loc.get('end_line', 0)})"
                )
                summary = loc.get("semantic_summary")
                if summary:
                    lines.append(f"      {summary[:160]}")
                code_body = loc.get("code_body")
                if code_body:
                    lang = loc.get("language", "")
                    lines.append(f"      ```{lang}")
                    for code_line in code_body[:MAX_BODY_PER_CHUNK].split("\n"):
                        lines.append(f"      {code_line}")
                    lines.append("      ```")
        lines.append("")

    if project_summary:
        lines.append("[PROJECT OVERVIEW]")
        lines.append(project_summary)
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

    lines.append("[END PROBABLE LOCATIONS]")
    return "\n".join(lines)


def _infer_mode(query: str) -> str:
    q = (query or "").lower()
    if any(word in q for word in ("where is", "find ", "defined", "references", "uses ")):
        return "find"
    if any(word in q for word in ("bug", "broken", "error", "fix", "crash", "fails", "not working")):
        return "bug"
    if any(word in q for word in ("how does", "explain", "what is", "why does")):
        return "ask"
    return "optimize"
