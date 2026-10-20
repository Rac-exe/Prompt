import logging

from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_auth
from app.db import queries
from app.db.models import FeedbackRequest, FeedbackResponse
from app.services.feedback import record_feedback

logger = logging.getLogger("code-intel.routes.feedback")
router = APIRouter(tags=["feedback"])


@router.post("/feedback", response_model=FeedbackResponse)
async def feedback(body: FeedbackRequest, auth: dict = Depends(require_auth)):
    user_id = auth.get("sub")
    project = queries.get_project(body.project_id, user_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    record_feedback(
        search_id=body.search_id,
        project_id=body.project_id,
        user_id=user_id,
        mode=body.mode.value,
        selected_chunk_ids=body.selected_chunk_ids,
        was_useful=body.was_useful,
    )
    logger.info(f"Feedback recorded: project={body.project_id}, search={body.search_id}")
    return FeedbackResponse()
