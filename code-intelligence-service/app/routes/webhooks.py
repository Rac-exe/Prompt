"""
Phase 2: GitHub webhook receiver.
Processes push events to trigger delta re-indexing.
"""

import logging
from fastapi import APIRouter, Request, HTTPException
from app.services.github_sync import verify_webhook_signature, extract_branch_from_ref
from app.workers.sync_worker import process_push_webhook
from app.db.supabase_client import get_client
from app.config import REDIS_URL

logger = logging.getLogger("code-intel.routes.webhooks")
router = APIRouter(tags=["webhooks"])


@router.post("/webhooks/github")
async def github_webhook(request: Request):
    """
    Receive GitHub push/PR webhooks.
    Signature-verified via GITHUB_WEBHOOK_SECRET.
    """
    signature = request.headers.get("X-Hub-Signature-256", "")
    event_type = request.headers.get("X-GitHub-Event", "")
    body = await request.body()

    if not verify_webhook_signature(body, signature):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    payload = await request.json()

    if event_type == "ping":
        return {"status": "pong"}

    if event_type != "push":
        logger.info(f"Ignoring event type: {event_type}")
        return {"status": "ignored", "event": event_type}

    repo = payload.get("repository", {})
    repo_owner = repo.get("owner", {}).get("login")
    repo_name = repo.get("name")

    if not repo_owner or not repo_name:
        raise HTTPException(status_code=400, detail="Missing repository info in webhook payload")

    client = get_client()
    result = (
        client.table("projects")
        .select("id")
        .eq("github_repo_owner", repo_owner)
        .eq("github_repo_name", repo_name)
        .execute()
    )

    if not result.data:
        logger.info(f"No projects found for {repo_owner}/{repo_name}")
        return {"status": "no_matching_projects"}

    use_arq = bool(REDIS_URL and REDIS_URL != "redis://localhost:6379")
    for project in result.data:
        if use_arq:
            try:
                from app.workers.arq_worker import enqueue_sync
                await enqueue_sync(project["id"], payload)
                continue
            except Exception as e:
                logger.warning(f"arq enqueue failed for project {project['id']}: {e}")
        await process_push_webhook(project["id"], payload)

    branch = extract_branch_from_ref(payload.get("ref", ""))
    return {
        "status": "processed",
        "projects": len(result.data),
        "branch": branch,
    }
