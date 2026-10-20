"""
Data access for the code-intelligence service.

Everything lives in local SQLite (one database per project, see local_store).
This module is the stable import surface the routes, services and workers use.
"""

import logging
from typing import Optional

from app.db import local_store as _local_store
from app.db.local_store import (  # noqa: F401  (re-exported data-plane API)
    cleanup_stale_chunks,
    cleanup_stale_chunks_for_files,
    concept_search,
    delete_chunks_for_file,
    file_path_search,
    find_chunk_by_name,
    find_chunks_by_file_paths,
    find_chunks_by_names,
    find_definitions,
    flag_diverged_chunks,
    get_all_project_chunk_ids,
    get_all_project_relationships,
    get_branch_context,
    get_callees,
    get_callers,
    get_chunk_structure_embeddings,
    get_chunks_source,
    get_community_members_ranked,
    get_existing_chunk_hashes,
    get_project_summary,
    get_related_chunks,
    get_related_chunks_multihop,
    hydrate_chunks_by_ids,
    increment_observation_counts,
    match_community_reports,
    match_concept_embeddings,
    sparse_search,
    text_search,
    update_chunks_graph_data,
    update_project_status,
    update_project_summary,
    update_relationship_embeddings,
    upsert_branch,
    upsert_chunks_batch,
    upsert_communities,
    upsert_relationship,
    upsert_relationships_batch,
    vector_search,
)
from app.config import (
    EMBEDDING_BACKEND,
    EMBEDDING_DIMENSIONS,
    EMBEDDING_LOCAL_MODEL,
    EMBEDDING_MODEL,
    STRUCTURE_EMBEDDING_DIMENSIONS,
)
from app.auth import LOCAL_USER_ID
from app.services import cache as _cache

logger = logging.getLogger("code-intel.queries")


def _with_owner(project: dict) -> dict:
    """Rows from older installs may lack user_id; responses require one."""
    if not project.get("user_id"):
        project["user_id"] = LOCAL_USER_ID
    return project


# ── Projects ────────────────────────────────────────────────────────────────

def upsert_project(
    user_id: str,
    name: str,
    repo_url: Optional[str] = None,
    local_path: Optional[str] = None,
    default_branch: str = "main",
    github_repo_owner: Optional[str] = None,
    github_repo_name: Optional[str] = None,
) -> dict:
    """Register a new project. repo_url and github_* are accepted for API
    compatibility but not stored: everything is indexed from local_path."""
    return _with_owner(_local_store.create_project(
        user_id=user_id,
        name=name,
        local_path=local_path,
        default_branch=default_branch,
    ))


def get_project(project_id: str, user_id: str) -> Optional[dict]:
    """The project row, or None if no such project exists. Single-user local
    app: user_id is accepted for API compatibility and not used as a filter."""
    if not _local_store.project_exists(project_id):
        return None
    project = _local_store.get_local_project(project_id)
    if not project or not project.get("name"):
        return None
    return _with_owner(project)


def get_projects_for_user(user_id: str) -> list[dict]:
    return [_with_owner(p) for p in _local_store.list_projects()]


def delete_project(project_id: str, user_id: str) -> None:
    if _local_store.project_exists(project_id):
        _local_store.delete_project_index(project_id)


def set_current_branch(project_id: str, branch: str) -> None:
    _local_store.upsert_branch(project_id, branch)


# ── Retrieval cache warmup and diagnostics ──────────────────────────────────

def warm_project_retrieval_cache(project_id: str) -> None:
    """
    Preload community reports and top PageRank metadata into in-memory cache.
    Called in the background on project open/select so first Ask/Optimize is less cold.
    """
    try:
        community_reports = _local_store.list_community_reports(project_id, limit=20)
        _cache.set(f"warm_communities:{project_id}", community_reports)
    except Exception as e:
        logger.warning("Warm community cache failed for %s: %s", project_id, e)
    try:
        top_chunks = _local_store.list_top_pagerank_chunks(project_id, limit=50)
        _cache.set(f"warm_top_pagerank:{project_id}", top_chunks)
    except Exception as e:
        logger.warning("Warm pagerank cache failed for %s: %s", project_id, e)


def get_graph_health(project_id: str) -> dict:
    """Graph-health snapshot (edge/pagerank/community counts) for diagnostics."""
    try:
        return _local_store.get_graph_health(project_id)
    except Exception as e:
        logger.warning("get_graph_health failed for %s: %s", project_id, e)
        return {"project_id": project_id, "healthy": False, "error": str(e)[:200]}


# ── Embedding config compatibility ──────────────────────────────────────────

def active_embedding_signature() -> tuple[str, int, int]:
    model_name = EMBEDDING_LOCAL_MODEL if EMBEDDING_BACKEND == "local" else EMBEDDING_MODEL
    return model_name, EMBEDDING_DIMENSIONS, STRUCTURE_EMBEDDING_DIMENSIONS


def update_project_embedding_config(project_id: str) -> None:
    model_name, embed_dim, structure_dim = active_embedding_signature()
    _local_store.update_project_embedding_config(
        project_id,
        embedding_model=model_name,
        embedding_dimensions=embed_dim,
        structure_embedding_dimensions=structure_dim,
    )


def ensure_project_embedding_compatibility(project_id: str) -> bool:
    """
    Returns True when project vectors were built with the active embedding config.
    Returns False and marks project stale when mismatch is detected.
    """
    stored = _local_store.get_project_embedding_config(project_id)
    if stored is None:
        return True
    model_name, embed_dim, structure_dim = active_embedding_signature()
    if (
        stored.get("embedding_model") == model_name
        and int(stored.get("embedding_dimensions") or 0) == int(embed_dim)
        and int(stored.get("structure_embedding_dimensions") or 0) == int(structure_dim)
    ):
        return True
    local_project = _local_store.get_local_project(project_id) or {}
    current_status = str(local_project.get("index_status") or "").lower()
    # Don't flip to stale mid-index. During active indexing, the new embedding
    # signature will be persisted at completion by the worker.
    if current_status in {"indexing", "partial"}:
        logger.info(
            "[EMBEDDING_MISMATCH] project=%s deferred while status=%s",
            project_id,
            current_status,
        )
        return False
    logger.warning(
        "[EMBEDDING_MISMATCH] project=%s stored=(%s,%s,%s) active=(%s,%s,%s) -> marking stale",
        project_id,
        stored.get("embedding_model"),
        stored.get("embedding_dimensions"),
        stored.get("structure_embedding_dimensions"),
        model_name,
        embed_dim,
        structure_dim,
    )
    update_project_status(project_id, "stale")
    return False
