import logging
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
        logger.error(f"Failed to create project: {e}")
        raise HTTPException(status_code=500, detail="Failed to create project")


@router.get("/projects", response_model=list[ProjectResponse])
async def list_projects(auth: dict = Depends(require_auth)):
    user_id = auth.get("sub")
    return queries.get_projects_for_user(user_id)


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str, auth: dict = Depends(require_auth)):
    user_id = auth.get("sub")
    project = queries.get_project(project_id, user_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


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
