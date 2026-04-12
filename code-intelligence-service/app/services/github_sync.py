"""
GitHub API integration for polling branch diffs and processing webhooks.
"""

import hashlib
import hmac
import logging
from typing import Optional
import httpx
from app.config import GITHUB_WEBHOOK_SECRET
from app.db.queries import (
    get_all_github_projects,
    upsert_branch,
    flag_diverged_chunks,
)

logger = logging.getLogger("code-intel.github")

GITHUB_API_BASE = "https://api.github.com"


async def poll_all_projects(github_token: Optional[str] = None):
    """
    Phase 1: Poll GitHub for branch diffs on all connected projects.
    Called by cron every 5 minutes.
    """
    projects = get_all_github_projects()
    logger.info(f"Polling {len(projects)} GitHub-connected projects")

    for project in projects:
        try:
            await poll_project(project, github_token)
        except Exception as e:
            logger.error(f"Failed to poll project {project['id']}: {e}")


async def poll_project(project: dict, github_token: Optional[str] = None):
    owner = project.get("github_repo_owner")
    repo = project.get("github_repo_name")
    default_branch = project.get("default_branch", "main")
    current_branch = project.get("current_branch")

    if not owner or not repo:
        return
    if not current_branch or current_branch == default_branch:
        return

    headers = {"Accept": "application/vnd.github.v3+json"}
    if github_token:
        headers["Authorization"] = f"token {github_token}"

    url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/compare/{default_branch}...{current_branch}"

    async with httpx.AsyncClient() as client:
        resp = await client.get(url, headers=headers)

    if resp.status_code != 200:
        logger.warning(f"GitHub compare API returned {resp.status_code} for {owner}/{repo}")
        return

    data = resp.json()
    ahead_by = data.get("ahead_by", 0)
    behind_by = data.get("behind_by", 0)
    files = data.get("files", [])
    diverged_files = [f["filename"] for f in files]

    commits = data.get("commits", [])
    last_commit = commits[-1] if commits else {}
    last_sha = last_commit.get("sha")
    last_message = last_commit.get("commit", {}).get("message", "")

    upsert_branch(
        project_id=project["id"],
        branch_name=current_branch,
        last_commit_sha=last_sha,
        last_commit_message=last_message[:500],
        ahead_of_main_by=ahead_by,
        behind_main_by=behind_by,
        diverged_files=diverged_files,
    )

    flag_diverged_chunks(project["id"], diverged_files)

    logger.info(
        f"Project {project['id']}: {current_branch} is "
        f"+{ahead_by}/-{behind_by} vs {default_branch}, "
        f"{len(diverged_files)} diverged files"
    )


def verify_webhook_signature(payload: bytes, signature: str) -> bool:
    if not GITHUB_WEBHOOK_SECRET:
        logger.warning("No GITHUB_WEBHOOK_SECRET configured — rejecting webhook")
        return False

    expected = hmac.new(
        GITHUB_WEBHOOK_SECRET.encode(),
        payload,
        hashlib.sha256,
    ).hexdigest()

    received = signature.replace("sha256=", "")
    return hmac.compare_digest(expected, received)


def extract_changed_files_from_webhook(payload: dict) -> list[str]:
    """Extract modified file paths from a push webhook payload."""
    changed = set()
    for commit in payload.get("commits", []):
        changed.update(commit.get("added", []))
        changed.update(commit.get("modified", []))
        changed.update(commit.get("removed", []))
    return list(changed)


def extract_branch_from_ref(ref: str) -> Optional[str]:
    if ref and ref.startswith("refs/heads/"):
        return ref[len("refs/heads/"):]
    return None
