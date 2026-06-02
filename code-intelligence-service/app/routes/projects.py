import logging
import asyncio
import sentry_sdk
from fastapi import APIRouter, Depends, HTTPException
from app.auth import require_auth
from app.db.models import ProjectCreate, ProjectResponse
from app.db import queries

logger = logging.getLogger("code-intel.routes.projects")
router = APIRouter(tags=["projects"])


@router.post("/projects", response_model=ProjectResponse, status_code=201)
async def create_project(body: ProjectCreate, auth: dict = Depends(require_auth)):
    user_id = auth.get("sub")
    try:
        result = queries.upsert_project(
            user_id=user_id,
            name=body.name,
            repo_url=body.repo_url,
            local_path=body.local_path,
            default_branch=body.default_branch,
            github_repo_owner=body.github_repo_owner,
            github_repo_name=body.github_repo_name,
        )
        logger.info(f"Created project '{body.name}' for user {user_id}")
        return result
    except Exception as e:
        sentry_sdk.capture_exception(e)
        logger.error(f"Failed to create project: {e}")
        raise HTTPException(status_code=500, detail="Failed to create project")


@router.get("/projects", response_model=list[ProjectResponse])
async def list_projects(auth: dict = Depends(require_auth)):
    user_id = auth.get("sub")
    projects = queries.get_projects_for_user(user_id)
    for project in projects:
        pid = project.get("id")
        if pid:
            queries.ensure_project_embedding_compatibility(str(pid))
    return projects


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str, auth: dict = Depends(require_auth)):
    user_id = auth.get("sub")
    project = queries.get_project(project_id, user_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    queries.ensure_project_embedding_compatibility(project_id)
    asyncio.create_task(asyncio.to_thread(queries.warm_project_retrieval_cache, project_id))
    return project


@router.get("/projects/{project_id}/graph-health")
async def project_graph_health(project_id: str, auth: dict = Depends(require_auth)):
    user_id = auth.get("sub")
    project = queries.get_project(project_id, user_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return queries.get_graph_health(project_id)


@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(project_id: str, auth: dict = Depends(require_auth)):
    user_id = auth.get("sub")
    project = queries.get_project(project_id, user_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    queries.delete_project(project_id, user_id)
    logger.info(f"Deleted project {project_id} for user {user_id}")


@router.delete("/projects/{project_id}/chunks", status_code=204)
async def delete_chunks_for_file(project_id: str, file_path: str, auth: dict = Depends(require_auth)):
    user_id = auth.get("sub")
    project = queries.get_project(project_id, user_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    queries.delete_chunks_for_file(project_id, file_path)
    logger.info(f"Deleted chunks for file {file_path} in project {project_id}")
