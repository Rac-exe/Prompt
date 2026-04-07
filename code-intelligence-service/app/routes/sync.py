import logging
from fastapi import APIRouter, Depends, HTTPException
from app.auth import require_auth
from app.db.models import SyncRequest
from app.db import queries
from app.services.github_sync import poll_all_projects, poll_project

logger = logging.getLogger("code-intel.routes.sync")
router = APIRouter(tags=["sync"])


@router.post("/sync")
async def sync_projects(body: SyncRequest = SyncRequest(), auth: dict = Depends(require_auth)):
    """
    Phase 1: Cron-triggered GitHub polling endpoint.
    If project_id is provided, syncs only that project.
    Otherwise, syncs all GitHub-connected projects.
    """
    user_id = auth.get("sub")

    if body.project_id:
        project = queries.get_project(body.project_id, user_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if not project.get("github_repo_owner") or not project.get("github_repo_name"):
            raise HTTPException(
                status_code=400,
                detail="Project is not connected to a GitHub repository",
            )

        await poll_project(project)
        logger.info(f"Synced project {body.project_id}")
        return {"status": "synced", "project_id": body.project_id}

    await poll_all_projects()
    return {"status": "synced", "scope": "all"}
