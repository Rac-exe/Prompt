"""
Project context retrieval — calls the Code Intelligence Service
to fetch relevant code chunks before prompt optimization.
"""

import os
import logging
import httpx

logger = logging.getLogger("prmpt.project_context")

CODE_INTEL_URL = os.environ.get("CODE_INTELLIGENCE_SERVICE_URL", "").rstrip("/")


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
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(f"{CODE_INTEL_URL}/api/retrieve", params=params, headers=headers)

        if resp.status_code != 200:
            logger.warning(f"Code Intel retrieve returned {resp.status_code}: {resp.text[:200]}")
            return None

        data = resp.json()
        ranked_chunks = data.get("ranked_chunks", [])
        related_chunks = data.get("related_chunks", [])
        branch_context = data.get("branch_context")

        if not ranked_chunks:
            return None

        return _format_context(ranked_chunks, related_chunks, branch_context)

    except httpx.TimeoutException:
        logger.warning("Code Intelligence Service timed out")
        return None
    except Exception as e:
        logger.error(f"Failed to fetch project context: {e}")
        return None


def _format_context(
    ranked_chunks: list[dict],
    related_chunks: list[dict],
    branch_context: dict | None,
) -> str:
    lines = ["[CODEBASE CONTEXT — auto-retrieved from project index]", ""]

    for i, chunk in enumerate(ranked_chunks[:5]):
        label = "PRIMARY" if i == 0 else f"RELEVANT #{i+1}"
        lines.append(f"[{label}]")
        lines.append(f"{chunk['file_path']} (lines {chunk['start_line']}–{chunk['end_line']})")
        lines.append(f"{chunk['chunk_type'].title()}: {chunk['name']}")
        if chunk.get("signature"):
            lines.append(f"Signature: {chunk['signature']}")
        if chunk.get("semantic_summary"):
            lines.append(f"Summary: {chunk['semantic_summary']}")
        if chunk.get("branch_diverged"):
            lines.append("(modified in current branch)")
        lines.append("")

    if related_chunks:
        lines.append("[RELATED CODE — called by / calls into the above]")
        for chunk in related_chunks[:5]:
            lines.append(f"  {chunk['file_path']}:{chunk['start_line']}–{chunk['end_line']} — {chunk['name']}")
            if chunk.get("semantic_summary"):
                lines.append(f"    {chunk['semantic_summary']}")
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
            lines.append(f"  {len(diverged)} files diverged from main")
        lines.append("")

    lines.append("[END CODEBASE CONTEXT]")
    return "\n".join(lines)
