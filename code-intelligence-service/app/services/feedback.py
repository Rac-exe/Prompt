from __future__ import annotations

import logging
import uuid

from app.db.supabase_client import get_client

logger = logging.getLogger("code-intel.feedback")


DEV_USER_UUID = "00000000-0000-0000-0000-000000000000"


def normalize_user_id(user_id: str | None) -> str | None:
    if not user_id:
        return None
    try:
        uuid.UUID(str(user_id))
        return str(user_id)
    except ValueError:
        return DEV_USER_UUID


def record_search(
    project_id: str,
    user_id: str,
    query_text: str,
    mode: str,
    retrieved_chunk_ids: list[str],
    query_embedding: list[float] | None = None,
    variant: str | None = None,
) -> str:
    search_id = str(uuid.uuid4())
    client = get_client()
    data = {
        "id": search_id,
        "project_id": project_id,
        "user_id": normalize_user_id(user_id),
        "query_text": query_text,
        "mode": mode,
        "retrieved_chunk_ids": retrieved_chunk_ids,
    }
    if query_embedding:
        data["query_embedding"] = query_embedding
    if variant:
        data["variant"] = variant
    try:
        client.table("retrieval_searches").insert(data).execute()
    except Exception as e:
        logger.warning(f"Failed to record retrieval search: {e}")
    return search_id


def record_feedback(
    search_id: str,
    project_id: str,
    user_id: str,
    mode: str,
    selected_chunk_ids: list[str],
    was_useful: bool | None,
):
    client = get_client()
    data = {
        "search_id": search_id,
        "project_id": project_id,
        "user_id": normalize_user_id(user_id),
        "mode": mode,
        "selected_chunk_ids": selected_chunk_ids,
        "was_useful": was_useful,
    }
    try:
        client.table("retrieval_feedback").insert(data).execute()
    except Exception as e:
        logger.warning(f"Failed to record retrieval feedback: {e}")
