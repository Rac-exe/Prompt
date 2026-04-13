"""
Project context retrieval — calls the Code Intelligence Service
to fetch relevant code chunks (with code bodies) before prompt
optimization.  Formats the result so the downstream LLM receives
actual source code, not just metadata pointers.
"""

import os
import time
import logging
import httpx

logger = logging.getLogger("prmpt.project_context")

CODE_INTEL_URL = os.environ.get("CODE_INTELLIGENCE_SERVICE_URL", "").rstrip("/")

MAX_BODY_PER_CHUNK = 2000
MAX_RANKED_IN_CONTEXT = 5
MAX_RELATED_IN_CONTEXT = 5


def fetch_project_context(
    project_id: str,
    user_query: str,
    branch: str | None = None,
    auth_token: str | None = None,
    limit: int = 10,
) -> str | None:
    """
    Call the Code Intelligence Service /api/retrieve endpoint to get
    relevant code context for a user's prompt. Returns a formatted
    context string to prepend to the user's prompt, or None on failure.
    """
    if not CODE_INTEL_URL:
        logger.debug("CODE_INTELLIGENCE_SERVICE_URL not set — skipping project context")
        return None

    if not project_id:
        return None

    logger.info(
        f"Fetching project context: project={project_id}, "
        f"query={user_query[:80]!r}, branch={branch}, limit={limit}"
    )

    headers = {"Content-Type": "application/json"}
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"

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

        bodies_count = sum(1 for c in ranked_chunks if c.get("code_body"))
        concepts_count = sum(1 for c in ranked_chunks if c.get("concepts"))
        logger.info(
            f"Code Intel responded in {elapsed:.2f}s: "
            f"{len(ranked_chunks)} ranked ({bodies_count} with code, "
            f"{concepts_count} with concepts), "
            f"{len(related_chunks)} related, "
            f"branch_ctx={'yes' if branch_context else 'no'}"
        )

        if not ranked_chunks:
            logger.info("No ranked chunks returned — skipping project context")
            return None

        formatted = _format_context(ranked_chunks, related_chunks, branch_context)
        logger.info(
            f"Project context formatted: {len(formatted)} chars, "
            f"~{len(formatted.split())} words"
        )
        return formatted

    except httpx.TimeoutException:
        logger.warning(f"Code Intelligence Service timed out (15s) for project {project_id}")
        return None
    except Exception as e:
        logger.error(f"Failed to fetch project context: {e}", exc_info=True)
        return None


def _format_context(
    ranked_chunks: list[dict],
    related_chunks: list[dict],
    branch_context: dict | None,
) -> str:
    lines = ["[CODEBASE CONTEXT — auto-retrieved from project index]", ""]

    for i, chunk in enumerate(ranked_chunks[:MAX_RANKED_IN_CONTEXT]):
        label = "PRIMARY" if i == 0 else f"RELEVANT #{i+1}"
        lines.append(f"[{label}]")
        lines.append(f"{chunk['file_path']} (lines {chunk['start_line']}–{chunk['end_line']})")
        lines.append(f"{chunk['chunk_type'].title()}: {chunk['name']}")

        concepts = chunk.get("concepts") or []
        if concepts:
            lines.append(f"Concepts: {', '.join(concepts)}")

        if chunk.get("semantic_summary"):
            lines.append(f"Summary: {chunk['semantic_summary']}")

        if chunk.get("branch_diverged"):
            lines.append("⚠ Modified in current branch")

        code_body = chunk.get("code_body")
        if code_body:
            lang = chunk.get("language", "")
            lines.append(f"```{lang}")
            lines.append(code_body[:MAX_BODY_PER_CHUNK])
            lines.append("```")
        elif chunk.get("signature"):
            lines.append(f"Signature: {chunk['signature']}")

        lines.append("")

    if related_chunks:
        lines.append("[RELATED CODE — connected via call graph]")
        for chunk in related_chunks[:MAX_RELATED_IN_CONTEXT]:
            lines.append(
                f"  {chunk['file_path']}:{chunk['start_line']}–{chunk['end_line']} "
                f"— {chunk['name']}"
            )
            if chunk.get("semantic_summary"):
                lines.append(f"    {chunk['semantic_summary']}")
            code_body = chunk.get("code_body")
            if code_body:
                lang = chunk.get("language", "")
                lines.append(f"    ```{lang}")
                for code_line in code_body[:MAX_BODY_PER_CHUNK].split("\n"):
                    lines.append(f"    {code_line}")
                lines.append("    ```")
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
