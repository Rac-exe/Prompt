"""
Sync worker — handles GitHub webhook-triggered re-indexing.
Fetches changed file contents from GitHub, re-parses, and updates the index.
"""

import logging
from app.db.queries import delete_chunks_for_file, flag_diverged_chunks, upsert_branch
from app.services.github_sync import extract_changed_files_from_webhook, extract_branch_from_ref

logger = logging.getLogger("code-intel.worker.sync")


async def process_push_webhook(project_id: str, payload: dict):
    """
    Handle a GitHub push webhook by flagging changed chunks
    and updating branch metadata.
    """
    ref = payload.get("ref", "")
    branch = extract_branch_from_ref(ref)
    if not branch:
        logger.warning(f"Could not extract branch from ref: {ref}")
        return

    changed_files = extract_changed_files_from_webhook(payload)
    if not changed_files:
        logger.info(f"Push to {branch} has no changed files, skipping")
        return

    flag_diverged_chunks(project_id, changed_files)

    commits = payload.get("commits", [])
    head_commit = payload.get("head_commit") or (commits[-1] if commits else {})

    upsert_branch(
        project_id=project_id,
        branch_name=branch,
        last_commit_sha=head_commit.get("id"),
        last_commit_message=(head_commit.get("message") or "")[:500],
        diverged_files=changed_files,
    )

    logger.info(
        f"Webhook processed for project {project_id}: "
        f"branch={branch}, {len(changed_files)} files changed"
    )
