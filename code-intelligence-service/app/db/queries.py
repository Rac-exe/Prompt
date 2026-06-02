"""
Queries for pgvector search, full-text search, chunk upserts, graph
operations, and observation tracking.  Uses the Supabase client's rpc()
for vector/text search and standard table operations for CRUD.
"""

import logging
import time
from typing import Optional
from app.db.supabase_client import get_client
from app.db import local_store as _local_store
from app.config import (
    CACHE_TTL_SECONDS,
    EMBEDDING_BACKEND,
    EMBEDDING_DIMENSIONS,
    EMBEDDING_LOCAL_MODEL,
    EMBEDDING_MODEL,
    GRAPH_MAX_DEPTH,
    GRAPH_MAX_RELATED,
    STORAGE_BACKEND,
    STRUCTURE_EMBEDDING_DIMENSIONS,
    UPSERT_BATCH_PAUSE_SECONDS,
    UPSERT_BATCH_SIZE,
)
from app.db.storage_backend import get_storage_backend
from app.services import cache as _cache

logger = logging.getLogger("code-intel.queries")


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
    client = get_client()
    data = {
        "user_id": user_id,
        "name": name,
        "repo_url": repo_url,
        "local_path": local_path,
        "default_branch": default_branch,
        "index_status": "stale",
        "github_repo_owner": github_repo_owner,
        "github_repo_name": github_repo_name,
    }
    result = client.table("projects").insert(data).execute()
    project = result.data[0] if result.data else {}
    _local_store.sync_project(project)
    return project


def get_project(project_id: str, user_id: str) -> Optional[dict]:
    client = get_client()
    result = (
        client.table("projects")
        .select("*")
        .eq("id", project_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    project = result.data[0] if result.data else None
    if project:
        _local_store.sync_project(project)
        return project
    return _local_store.get_local_project(project_id)


def get_projects_for_user(user_id: str) -> list[dict]:
    client = get_client()
    result = (
        client.table("projects")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    )
    projects = result.data or []
    for project in projects:
        _local_store.sync_project(project)
    return projects


def update_project_status(project_id: str, status: str, last_indexed_at: Optional[str] = None):
    client = get_client()
    data: dict = {"index_status": status}
    if last_indexed_at:
        data["last_indexed_at"] = last_indexed_at
    try:
        client.table("projects").update(data).eq("id", project_id).execute()
    except Exception as e:
        logger.warning("Failed to update remote project status for %s: %s", project_id, e)
    _local_store.update_project_status(project_id, status, last_indexed_at)


def delete_project(project_id: str, user_id: str):
    client = get_client()
    _local_store.delete_project_index(project_id)
    client.table("projects").delete().eq("id", project_id).eq("user_id", user_id).execute()


# ── Chunks ──────────────────────────────────────────────────────────────────
#
# DEPRECATED (Phase 1 local migration):
# Supabase code-intel chunk/graph runtime paths below are retained only as
# commented rollback reference. Active runtime dispatch is controlled by the
# single STORAGE_BACKEND switch at the end of this file.

def upsert_chunk(
    project_id: str,
    user_id: str,
    file_path: str,
    start_line: int,
    end_line: int,
    chunk_type: str,
    name: str,
    signature: Optional[str],
    language: str,
    semantic_summary: str,
    embedding: list[float],
    content_hash: str,
    branch: Optional[str] = None,
    last_modified_commit: Optional[str] = None,
    code_body: Optional[str] = None,
    concepts: Optional[list[str]] = None,
    is_exported: bool = False,
) -> dict:
    client = get_client()
    data = {
        "project_id": project_id,
        "user_id": user_id,
        "file_path": file_path,
        "start_line": start_line,
        "end_line": end_line,
        "chunk_type": chunk_type,
        "name": name,
        "signature": signature,
        "language": language,
        "semantic_summary": semantic_summary,
        "embedding": embedding,
        "content_hash": content_hash,
        "branch": branch,
        "last_modified_commit": last_modified_commit,
        "branch_diverged": False,
        "code_body": code_body,
        "concepts": concepts or [],
        "is_exported": is_exported,
    }
    result = (
        client.table("code_chunks")
        .upsert(data, on_conflict="project_id,file_path,name,chunk_type")
        .execute()
    )
    return result.data[0] if result.data else {}


def get_existing_chunk_hashes(project_id: str) -> dict[tuple[str, str, str], dict]:
    """Fetch lightweight chunk identity/hash data for project-level dedupe.

    Paginates in PAGE_SIZE batches to avoid PostgREST's default 1000-row cap
    which would silently truncate large projects and cause unchanged chunks to
    be re-indexed on every ingest.
    """
    client = get_client()
    lookup: dict[tuple[str, str, str], dict] = {}
    page_size = 1000
    offset = 0
    while True:
        result = (
            client.table("code_chunks")
            .select("file_path,name,chunk_type,content_hash")
            .eq("project_id", project_id)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = result.data or []
        for row in rows:
            key = (row["file_path"], row["name"], row["chunk_type"])
            lookup[key] = row
        if len(rows) < page_size:
            break
        offset += page_size
    return lookup


def _is_fk_violation(error: Exception) -> bool:
    """Check if a Supabase/PostgREST error is a foreign-key violation (23503).
    This means the parent row (project) was deleted mid-ingest."""
    err_str = str(error)
    return "23503" in err_str or "foreign key constraint" in err_str.lower()


def upsert_chunks_batch(chunks_data: list[dict], batch_size: int = UPSERT_BATCH_SIZE) -> int:
    """Bulk upsert chunks in batches instead of one-at-a-time."""
    if not chunks_data:
        return 0
    client = get_client()
    total_batches = (len(chunks_data) + batch_size - 1) // batch_size
    logger.info(
        f"[BATCH UPSERT] Starting: {len(chunks_data)} rows in {total_batches} "
        f"batches (batch_size={batch_size})"
    )
    processed = 0
    for i in range(0, len(chunks_data), batch_size):
        batch = chunks_data[i:i + batch_size]
        batch_num = (i // batch_size) + 1
        try:
            client.table("code_chunks").upsert(
                batch, on_conflict="project_id,file_path,name,chunk_type"
            ).execute()
            processed += len(batch)
            logger.info(
                f"[BATCH UPSERT] Batch {batch_num}/{total_batches}: "
                f"{len(batch)} rows OK (total processed={processed})"
            )
            if UPSERT_BATCH_PAUSE_SECONDS > 0 and batch_num < total_batches:
                time.sleep(UPSERT_BATCH_PAUSE_SECONDS)
        except Exception as e:
            if _is_fk_violation(e):
                project_id = batch[0].get("project_id", "unknown") if batch else "unknown"
                logger.warning(
                    f"[BATCH UPSERT] Project {project_id} was deleted mid-ingest "
                    f"(FK violation at batch {batch_num}/{total_batches}), aborting"
                )
                break
            logger.error(
                f"[BATCH UPSERT] Batch {batch_num}/{total_batches} failed ({e}), "
                f"retrying in sub-batches of 10 for {len(batch)} rows"
            )
            retry_batch_size = 10
            aborted = False
            for j in range(0, len(batch), retry_batch_size):
                retry_batch = batch[j:j + retry_batch_size]
                try:
                    client.table("code_chunks").upsert(
                        retry_batch, on_conflict="project_id,file_path,name,chunk_type"
                    ).execute()
                    processed += len(retry_batch)
                except Exception as inner_e:
                    if _is_fk_violation(inner_e):
                        project_id = retry_batch[0].get("project_id", "unknown") if retry_batch else "unknown"
                        logger.warning(
                            f"[BATCH UPSERT] Project {project_id} deleted, "
                            f"aborting remaining rows"
                        )
                        aborted = True
                        break
                    logger.error(
                        f"[BATCH UPSERT] Sub-batch retry failed "
                        f"({retry_batch[0].get('name', '?')}..): {inner_e}"
                    )
            if aborted:
                break
            if UPSERT_BATCH_PAUSE_SECONDS > 0 and batch_num < total_batches:
                time.sleep(UPSERT_BATCH_PAUSE_SECONDS)
    logger.info(f"[BATCH UPSERT] Complete: {processed}/{len(chunks_data)} rows processed")
    return processed


def cleanup_stale_chunks(project_id: str, valid_keys: set[tuple[str, str, str]]) -> int:
    """Delete chunks not in the latest ingest batch using server-side SQL when available."""
    client = get_client()

    valid_keys_list = [
        {"f": fp, "n": name, "t": ct} for fp, name, ct in valid_keys
    ]
    logger.info(
        f"[STALE CLEANUP] Calling SQL function for project {project_id} "
        f"with {len(valid_keys)} valid keys"
    )
    try:
        result = client.rpc("cleanup_stale_chunks", {
            "p_project_id": project_id,
            "p_valid_keys": valid_keys_list,
        }).execute()
        count = result.data if isinstance(result.data, int) else 0
        logger.info(
            f"[STALE CLEANUP] SQL function returned: {count} stale chunks deleted "
            f"for project {project_id}"
        )
        return count
    except Exception as e:
        logger.warning(
            f"[STALE CLEANUP] SQL function failed ({e}), "
            f"falling back to Python-side cleanup"
        )

    result = (
        client.table("code_chunks")
        .select("id,file_path,name,chunk_type")
        .eq("project_id", project_id)
        .execute()
    )
    stale_ids = [
        row["id"] for row in (result.data or [])
        if (row["file_path"], row["name"], row["chunk_type"]) not in valid_keys
    ]
    if not stale_ids:
        return 0
    for i in range(0, len(stale_ids), 100):
        batch = stale_ids[i:i + 100]
        client.table("code_relationships").delete().in_("from_chunk_id", batch).execute()
        client.table("code_relationships").delete().in_("to_chunk_id", batch).execute()
        client.table("code_chunks").delete().in_("id", batch).execute()
    return len(stale_ids)


def cleanup_stale_chunks_for_files(
    project_id: str,
    file_paths: set[str],
    valid_keys: set[tuple[str, str, str]],
) -> int:
    """Delete stale chunks only within files included in a partial ingest."""
    if not file_paths:
        return 0
    client = get_client()
    result = (
        client.table("code_chunks")
        .select("id,file_path,name,chunk_type")
        .eq("project_id", project_id)
        .in_("file_path", list(file_paths))
        .execute()
    )
    stale_ids = [
        row["id"] for row in (result.data or [])
        if (row["file_path"], row["name"], row["chunk_type"]) not in valid_keys
    ]
    if not stale_ids:
        return 0
    for i in range(0, len(stale_ids), 100):
        batch = stale_ids[i:i + 100]
        client.table("code_relationships").delete().in_("from_chunk_id", batch).execute()
        client.table("code_relationships").delete().in_("to_chunk_id", batch).execute()
        client.table("code_chunks").delete().in_("id", batch).execute()
    return len(stale_ids)


def delete_chunks_for_file(project_id: str, file_path: str):
    client = get_client()
    client.table("code_chunks").delete().eq("project_id", project_id).eq("file_path", file_path).execute()


# ── Relationships ───────────────────────────────────────────────────────────

def upsert_relationship(project_id: str, from_chunk_id: str, to_chunk_id: str, relationship_type: str):
    client = get_client()
    data = {
        "project_id": project_id,
        "from_chunk_id": from_chunk_id,
        "to_chunk_id": to_chunk_id,
        "relationship_type": relationship_type,
    }
    client.table("code_relationships").upsert(
        data, on_conflict="from_chunk_id,to_chunk_id,relationship_type"
    ).execute()


def find_chunk_by_name(project_id: str, name: str, file_path: Optional[str] = None) -> Optional[dict]:
    client = get_client()
    query = (
        client.table("code_chunks")
        .select("id,name,file_path")
        .eq("project_id", project_id)
        .eq("name", name)
    )
    if file_path:
        query = query.eq("file_path", file_path)
    result = query.limit(1).execute()
    return result.data[0] if result.data else None


def find_chunks_by_names(
    project_id: str,
    names: list[str],
) -> dict[str, list[dict]]:
    """Batch-fetch chunks by name for the whole project.

    Returns a dict mapping name → list of matching rows (there may be multiple
    chunks with the same name in different files).  Callers should disambiguate
    using file_path when available.
    """
    if not names:
        return {}
    client = get_client()
    unique_names = list(dict.fromkeys(names))
    result = (
        client.table("code_chunks")
        .select("id,name,file_path")
        .eq("project_id", project_id)
        .in_("name", unique_names)
        .execute()
    )
    lookup: dict[str, list[dict]] = {}
    for row in (result.data or []):
        lookup.setdefault(row["name"], []).append(row)
    return lookup


def find_chunks_by_file_paths(
    project_id: str,
    file_paths: list[str],
) -> dict[str, list[dict]]:
    """Batch-fetch chunks whose file_path matches any of the given paths.

    Returns a dict mapping file_path → list of matching rows.
    """
    if not file_paths:
        return {}
    client = get_client()
    unique_paths = list(dict.fromkeys(file_paths))
    result = (
        client.table("code_chunks")
        .select("id,name,file_path,is_exported")
        .eq("project_id", project_id)
        .in_("file_path", unique_paths)
        .execute()
    )
    lookup: dict[str, list[dict]] = {}
    for row in (result.data or []):
        lookup.setdefault(row["file_path"], []).append(row)
    return lookup


def upsert_relationships_batch(rows: list[dict]) -> None:
    """Batch upsert a list of code_relationships rows in one call."""
    if not rows:
        return
    client = get_client()
    client.table("code_relationships").upsert(
        rows, on_conflict="from_chunk_id,to_chunk_id,relationship_type"
    ).execute()


# ── Vector search ───────────────────────────────────────────────────────────

_CHUNK_SELECT_FIELDS = (
    "id,file_path,start_line,end_line,chunk_type,name,signature,"
    "language,semantic_summary,summary_code,summary_purpose,code_body,concepts,"
    "branch,branch_diverged,is_exported,relevance_reasoning,parent_id,"
    "context_header,parent_summary"
)

_CHUNK_LITE_SELECT_FIELDS = (
    "id,file_path,start_line,end_line,chunk_type,name,signature,"
    "language,semantic_summary,summary_code,summary_purpose,concepts,"
    "branch,branch_diverged,is_exported,relevance_reasoning,parent_id,"
    "scope_type,observation_count"
)


def hydrate_chunks_by_ids(chunk_ids: list[str], project_id: str, user_id: Optional[str] = None) -> list[dict]:
    """Fetch full chunk bodies for the final small result set after lite recall."""
    if not chunk_ids:
        return []
    client = get_client()
    query = (
        client.table("code_chunks")
        .select(_CHUNK_SELECT_FIELDS)
        .eq("project_id", project_id)
        .in_("id", chunk_ids)
    )
    if user_id:
        query = query.eq("user_id", user_id)
    result = query.execute()
    by_id = {str(row["id"]): row for row in (result.data or [])}
    return [by_id[cid] for cid in chunk_ids if cid in by_id]


def get_chunk_structure_embeddings(
    chunk_ids: list[str],
    project_id: str,
    user_id: Optional[str] = None,
) -> dict[str, object]:
    """Fetch structure vectors only for the small reranker candidate set."""
    if not chunk_ids:
        return {}
    client = get_client()
    query = (
        client.table("code_chunks")
        .select("id,embedding_structure")
        .eq("project_id", project_id)
        .in_("id", chunk_ids)
    )
    if user_id:
        query = query.eq("user_id", user_id)
    result = query.execute()
    return {
        str(row["id"]): row.get("embedding_structure")
        for row in (result.data or [])
        if row.get("embedding_structure") is not None
    }


def vector_search(
    project_id: str,
    user_id: str,
    query_embedding: list[float],
    limit: int = 10,
    branch: Optional[str] = None,
) -> list[dict]:
    """Cosine similarity search via the lite match_code_chunks RPC."""
    client = get_client()
    params = {
        "query_embedding": query_embedding,
        "match_count": limit,
        "filter_project_id": project_id,
        "filter_user_id": user_id,
    }
    if branch:
        params["filter_branch"] = branch

    try:
        result = client.rpc("match_code_chunks_lite", params).execute()
        rows = result.data or []
        logger.debug(f"vector_search: {len(rows)} results for project {project_id}")
        return rows
    except Exception as e:
        logger.warning(f"vector_search lite RPC failed ({e}), falling back to full RPC")
        try:
            result = client.rpc("match_code_chunks", params).execute()
            return result.data or []
        except Exception as fallback_e:
            logger.error(f"vector_search RPC failed for project {project_id}: {fallback_e}")
            return []


def concept_search(
    project_id: str,
    user_id: str,
    concepts: list[str],
    limit: int = 10,
) -> list[dict]:
    """Concept-overlap search via the lite search_by_concepts RPC (uses GIN index)."""
    if not concepts:
        return []
    client = get_client()
    params = {
        "filter_concepts": concepts,
        "match_count": limit,
        "filter_project_id": project_id,
        "filter_user_id": user_id,
    }
    try:
        result = client.rpc("search_by_concepts_lite", params).execute()
        rows = result.data or []
        logger.debug(f"concept_search: {len(rows)} results for concepts={concepts}")
        return rows
    except Exception as e:
        logger.warning(f"concept_search lite RPC failed ({e}), falling back to full RPC")
        try:
            result = client.rpc("search_by_concepts", params).execute()
            return result.data or []
        except Exception as fallback_e:
            logger.error(f"concept_search RPC failed for project {project_id}: {fallback_e}")
            return []


def text_search(
    project_id: str,
    user_id: str,
    query: str,
    limit: int = 10,
) -> list[dict]:
    """Full-text keyword search via the lite search_code_chunks_text RPC."""
    client = get_client()
    params = {
        "search_query": query,
        "match_count": limit,
        "filter_project_id": project_id,
        "filter_user_id": user_id,
    }
    try:
        result = client.rpc("search_code_chunks_text_lite", params).execute()
        rows = result.data or []
        logger.debug(f"text_search: {len(rows)} results for query={query[:60]!r}")
        return rows
    except Exception as e:
        logger.warning(f"text_search lite RPC failed ({e}), falling back to full RPC")
        try:
            result = client.rpc("search_code_chunks_text", params).execute()
            return result.data or []
        except Exception as fallback_e:
            logger.error(f"text_search RPC failed for project {project_id}: {fallback_e}")
            return []


# ── Graph traversal ─────────────────────────────────────────────────────────

EDGE_WEIGHTS = {
    "calls": 3,
    "imports": 2,
    "parent_of": 2,
    "child_of": 2,
    "sibling_next": 1,
    "inherits": 1,
    "implements": 1,
}


def get_related_chunks(chunk_ids: list[str], project_id: str) -> list[dict]:
    """Fetch direct callers and callees for a set of chunks, preserving edge type."""
    if not chunk_ids:
        return []
    client = get_client()

    outgoing = (
        client.table("code_relationships")
        .select("to_chunk_id,relationship_type")
        .eq("project_id", project_id)
        .in_("from_chunk_id", chunk_ids)
        .execute()
    )
    incoming = (
        client.table("code_relationships")
        .select("from_chunk_id,relationship_type")
        .eq("project_id", project_id)
        .in_("to_chunk_id", chunk_ids)
        .execute()
    )

    best_edge: dict[str, str] = {}
    for row in outgoing.data or []:
        cid = row["to_chunk_id"]
        rtype = row["relationship_type"]
        if cid not in best_edge or EDGE_WEIGHTS.get(rtype, 0) > EDGE_WEIGHTS.get(best_edge[cid], 0):
            best_edge[cid] = rtype
    for row in incoming.data or []:
        cid = row["from_chunk_id"]
        rtype = row["relationship_type"]
        if cid not in best_edge or EDGE_WEIGHTS.get(rtype, 0) > EDGE_WEIGHTS.get(best_edge[cid], 0):
            best_edge[cid] = rtype

    related_ids = set(best_edge.keys()) - set(chunk_ids)
    if not related_ids:
        return []

    result = (
        client.table("code_chunks")
        .select(_CHUNK_SELECT_FIELDS)
        .in_("id", list(related_ids))
        .execute()
    )
    chunks = result.data or []
    for chunk in chunks:
        chunk["_edge_type"] = best_edge.get(chunk["id"], "imports")
    return chunks


def get_related_chunks_multihop(
    chunk_ids: list[str],
    project_id: str,
    max_depth: int = GRAPH_MAX_DEPTH,
    max_total: int = GRAPH_MAX_RELATED,
) -> list[dict]:
    """
    BFS walk on the code_relationships graph up to *max_depth* hops.
    Returns chunks at each depth with a ``graph_depth`` annotation.
    Neighbors are sorted by edge weight (calls > imports > inherits)
    so high-value relationships fill the budget first.
    """
    visited: set[str] = set(chunk_ids)
    frontier: list[str] = list(chunk_ids)
    all_related: list[dict] = []

    for depth in range(1, max_depth + 1):
        if not frontier or len(all_related) >= max_total:
            break

        neighbors = get_related_chunks(frontier, project_id)
        neighbors.sort(
            key=lambda n: EDGE_WEIGHTS.get(n.get("_edge_type", ""), 0),
            reverse=True,
        )
        new_frontier: list[str] = []

        for n in neighbors:
            if n["id"] in visited:
                continue
            visited.add(n["id"])
            n["graph_depth"] = depth
            all_related.append(n)
            new_frontier.append(n["id"])
            if len(all_related) >= max_total:
                break

        logger.debug(
            f"Graph hop {depth}: {len(frontier)} seeds → {len(neighbors)} neighbors, "
            f"{len(new_frontier)} new, {len(all_related)} total related"
        )
        frontier = new_frontier

    return all_related


# ── Observation tracking ────────────────────────────────────────────────────

def increment_observation_counts(chunk_ids: list[str]):
    """Atomically increment observation_count for retrieved chunks."""
    if not chunk_ids:
        return
    client = get_client()
    try:
        client.rpc("increment_observation_counts", {"chunk_ids": chunk_ids}).execute()
    except Exception as e:
        logger.warning(f"Failed to increment observation counts: {e}")


# ── Branches ────────────────────────────────────────────────────────────────

def get_branch_context(project_id: str, branch: Optional[str] = None) -> Optional[dict]:
    if not branch:
        return None
    cache_key = f"branch_context:{project_id}:{branch}"
    cached = _cache.get(cache_key, CACHE_TTL_SECONDS)
    if cached is not None:
        return cached
    client = get_client()
    result = (
        client.table("project_branches")
        .select("*")
        .eq("project_id", project_id)
        .eq("branch_name", branch)
        .limit(1)
        .execute()
    )
    ctx = result.data[0] if result.data else None
    if ctx is not None:
        _cache.set(cache_key, ctx)
    return ctx


def upsert_branch(
    project_id: str,
    branch_name: str,
    last_commit_sha: Optional[str] = None,
    last_commit_message: Optional[str] = None,
    ahead_of_main_by: int = 0,
    behind_main_by: int = 0,
    diverged_files: Optional[list[str]] = None,
):
    client = get_client()
    data = {
        "project_id": project_id,
        "branch_name": branch_name,
        "last_commit_sha": last_commit_sha,
        "last_commit_message": last_commit_message,
        "ahead_of_main_by": ahead_of_main_by,
        "behind_main_by": behind_main_by,
        "diverged_files": diverged_files or [],
    }
    client.table("project_branches").upsert(
        data, on_conflict="project_id,branch_name"
    ).execute()


def flag_diverged_chunks(project_id: str, file_paths: list[str]):
    if not file_paths:
        return
    client = get_client()
    client.table("code_chunks").update(
        {"branch_diverged": True}
    ).eq("project_id", project_id).in_("file_path", file_paths).execute()


def get_all_github_projects() -> list[dict]:
    client = get_client()
    result = (
        client.table("projects")
        .select("id,user_id,github_repo_owner,github_repo_name,default_branch,current_branch")
        .not_.is_("github_repo_owner", "null")
        .not_.is_("github_repo_name", "null")
        .limit(100)
        .execute()
    )
    return result.data or []


# ── File-path search ─────────────────────────────────────────────────────────

def file_path_search(
    project_id: str,
    user_id: str,
    file_patterns: list[str],
    limit: int = 20,
) -> list[dict]:
    """Search chunks by file path patterns using the lite search_chunks_by_file_paths RPC."""
    if not file_patterns:
        return []
    client = get_client()
    try:
        result = client.rpc("search_chunks_by_file_paths_lite", {
            "p_project_id": project_id,
            "p_user_id": user_id,
            "p_file_patterns": file_patterns,
            "p_limit": limit,
        }).execute()
        rows = result.data or []
        logger.debug(f"file_path_search: {len(rows)} results for patterns={file_patterns}")
        return rows
    except Exception as e:
        logger.warning(f"file_path_search lite RPC failed ({e}), trying full RPC")
        try:
            result = client.rpc("search_chunks_by_file_paths", {
                "p_project_id": project_id,
                "p_user_id": user_id,
                "p_file_patterns": file_patterns,
                "p_limit": limit,
            }).execute()
            return result.data or []
        except Exception as fallback_e:
            logger.warning(f"file_path_search full RPC failed ({fallback_e}), using fallback ILIKE query")
        try:
            # PostgREST stacks .ilike() calls as AND, not OR.
            # Issue one query per pattern and union the results in Python.
            seen: set = set()
            merged: list[dict] = []
            for pattern in file_patterns[:5]:
                rows = (
                    client.table("code_chunks")
                    .select(_CHUNK_LITE_SELECT_FIELDS)
                    .eq("project_id", project_id)
                    .eq("user_id", user_id)
                    .ilike("file_path", pattern)
                    .limit(limit)
                    .execute()
                ).data or []
                for row in rows:
                    if row["id"] not in seen:
                        seen.add(row["id"])
                        merged.append(row)
            return merged[:limit]
        except Exception:
            return []


# ── Graph data writeback ─────────────────────────────────────────────────────

def upsert_communities(project_id: str, community_rows: list[dict]) -> dict[str, str]:
    """
    Upsert community rows and return a label → UUID mapping for chunk writeback
    — delegates to local SQLite store.
    """
    return _local_store.upsert_communities(project_id, community_rows)


def get_all_project_chunk_ids(project_id: str) -> list[dict]:
    """Return all (id, name, file_path, chunk_type) rows for a project — used by graph builder."""
    return _local_store.get_all_project_chunk_ids(project_id)


def get_all_project_relationships(project_id: str) -> list[dict]:
    """Return all relationship rows for a project — used by graph builder."""
    return _local_store.get_all_project_relationships(project_id)


def update_chunks_graph_data(
    chunk_graph_rows: list[dict],
    batch_size: int = 50,
) -> int:
    """
    Write back pagerank_score, centrality_score, community_id, and
    concept_embedding_1/2/3 to code_chunks — delegates to local SQLite store.
    """
    return _local_store.update_chunks_graph_data(chunk_graph_rows, batch_size)


def update_relationship_embeddings(
    rel_rows: list[dict],
    batch_size: int = 50,
) -> int:
    """
    Write relationship_summary and relationship_embedding back to code_relationships
    — delegates to local SQLite store.
    """
    return _local_store.update_relationship_embeddings(rel_rows, batch_size)


# ── Graph-aware retrieval RPCs ────────────────────────────────────────────────
#
# DEPRECATED (Phase 1 local migration):
# Supabase RPC-based community/concept retrieval remains as rollback reference.
# Runtime chunk/graph reads and writes are routed through STORAGE_BACKEND.

def match_community_reports(
    project_id: str,
    query_embedding: list[float],
    match_count: int = 5,
) -> list[dict]:
    """Search community reports by semantic similarity — Global Search."""
    client = get_client()
    try:
        result = client.rpc("match_community_reports", {
            "query_embedding": query_embedding,
            "filter_project_id": project_id,
            "match_count": match_count,
        }).execute()
        return result.data or []
    except Exception as e:
        logger.warning("[COMMUNITY_MATCH] RPC failed: %s", e)
        return []


def match_concept_embeddings(
    project_id: str,
    query_embedding: list[float],
    match_count: int = 20,
) -> list[dict]:
    """Search chunks by semantic concept embeddings — Local Search anchor discovery."""
    client = get_client()
    try:
        result = client.rpc("match_concept_embeddings", {
            "query_embedding": query_embedding,
            "filter_project_id": project_id,
            "match_count": match_count,
        }).execute()
        return result.data or []
    except Exception as e:
        logger.warning("[CONCEPT_EMBED_MATCH] RPC failed: %s", e)
        return []


def get_community_members_ranked(
    community_id: str,
    limit: int = 20,
) -> list[dict]:
    """Fetch community members ordered by PageRank — used in Local/Global Search."""
    client = get_client()
    try:
        result = client.rpc("get_community_members", {
            "p_community_id": community_id,
            "p_limit": limit,
        }).execute()
        return result.data or []
    except Exception as e:
        logger.warning("[COMMUNITY_MEMBERS] RPC failed for community %s: %s", community_id, e)
        # Fallback: direct table query
        try:
            result = (
                client.table("code_chunks")
                .select("id,name,file_path,start_line,end_line,chunk_type,language,"
                        "summary_code,summary_purpose,concepts,pagerank_score,is_exported")
                .eq("community_id", community_id)
                .order("pagerank_score", desc=True)
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception as inner_e:
            logger.error("[COMMUNITY_MEMBERS] Fallback also failed: %s", inner_e)
            return []


# ── Project summary ──────────────────────────────────────────────────────────

def update_project_summary(project_id: str, summary: str, tech_stack: dict | None = None):
    """Store the auto-generated project summary."""
    client = get_client()
    data: dict = {"project_summary": summary}
    if tech_stack is not None:
        data["tech_stack"] = tech_stack
    try:
        client.table("projects").update(data).eq("id", project_id).execute()
    except Exception as e:
        logger.warning(f"Failed to update project summary: {e}")
    _local_store.update_project_summary(project_id, summary, tech_stack)


def get_project_summary(project_id: str) -> Optional[str]:
    """Retrieve the stored project summary (cached for CACHE_TTL_SECONDS)."""
    cache_key = f"project_summary:{project_id}"
    cached = _cache.get(cache_key, CACHE_TTL_SECONDS)
    if cached is not None:
        return cached
    client = get_client()
    try:
        result = (
            client.table("projects")
            .select("project_summary")
            .eq("id", project_id)
            .limit(1)
            .execute()
        )
        if result.data:
            summary = result.data[0].get("project_summary")
            _cache.set(cache_key, summary)
            return summary
    except Exception as e:
        logger.warning(f"Failed to get project summary: {e}")
    return _local_store.get_project_summary(project_id)


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


def find_definitions(project_id: str, symbol: str, limit: int = 5) -> list[dict]:
    """Chunks that define `symbol` (for agentic get_definition tool)."""
    return _local_store.find_definitions(project_id, symbol, limit)


def get_callers(project_id: str, chunk_id: str, limit: int = 15) -> list[dict]:
    """Incoming-edge chunks (who calls/imports chunk_id)."""
    return _local_store.get_callers(project_id, chunk_id, limit)


def get_callees(project_id: str, chunk_id: str, limit: int = 15) -> list[dict]:
    """Outgoing-edge chunks (what chunk_id calls/imports)."""
    return _local_store.get_callees(project_id, chunk_id, limit)


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


# ── Phase 1 local code-intel backend overrides ───────────────────────────────
#
# Keep project auth/registry reads on Supabase, but route the heavy code-intel
# data plane (chunks, relationships, graph data, search telemetry) through one
# storage backend switch so there is a single place to change behavior.
#
# DEPRECATED (Phase 1 local migration):
# Supabase code-intel runtime bindings are intentionally disabled.
# Legacy shape (for rollback reference only):
#   get_existing_chunk_hashes = <supabase impl>
#   upsert_chunks_batch = <supabase impl>
#   vector_search = <supabase impl>
#   concept_search = <supabase impl>
#   text_search = <supabase impl>
#   get_related_chunks = <supabase impl>
#   get_related_chunks_multihop = <supabase impl>
#   file_path_search = <supabase impl>

_storage_backend = get_storage_backend(STORAGE_BACKEND)
logger.info("[STORAGE_BACKEND] Active backend: %s", _storage_backend.kind)

get_existing_chunk_hashes = _storage_backend.get_existing_chunk_hashes
upsert_chunks_batch = _storage_backend.upsert_chunks_batch
cleanup_stale_chunks = _storage_backend.cleanup_stale_chunks
cleanup_stale_chunks_for_files = _storage_backend.cleanup_stale_chunks_for_files
delete_chunks_for_file = _storage_backend.delete_chunks_for_file
upsert_relationship = _storage_backend.upsert_relationship
find_chunk_by_name = _storage_backend.find_chunk_by_name
find_chunks_by_names = _storage_backend.find_chunks_by_names
find_chunks_by_file_paths = _storage_backend.find_chunks_by_file_paths
upsert_relationships_batch = _storage_backend.upsert_relationships_batch
hydrate_chunks_by_ids = _storage_backend.hydrate_chunks_by_ids
get_chunk_structure_embeddings = _storage_backend.get_chunk_structure_embeddings
vector_search = _storage_backend.vector_search
concept_search = _storage_backend.concept_search
text_search = _storage_backend.text_search
get_related_chunks = _storage_backend.get_related_chunks
get_related_chunks_multihop = _storage_backend.get_related_chunks_multihop
increment_observation_counts = _storage_backend.increment_observation_counts
get_branch_context = _storage_backend.get_branch_context
upsert_branch = _storage_backend.upsert_branch
flag_diverged_chunks = _storage_backend.flag_diverged_chunks
file_path_search = _storage_backend.file_path_search
upsert_communities = _storage_backend.upsert_communities
get_all_project_chunk_ids = _storage_backend.get_all_project_chunk_ids
get_all_project_relationships = _storage_backend.get_all_project_relationships
update_chunks_graph_data = _storage_backend.update_chunks_graph_data
update_relationship_embeddings = _storage_backend.update_relationship_embeddings
match_community_reports = _storage_backend.match_community_reports
match_concept_embeddings = _storage_backend.match_concept_embeddings
get_community_members_ranked = _storage_backend.get_community_members_ranked

if STORAGE_BACKEND == "local":
    _runtime_supabase_chunk_funcs = (
        get_existing_chunk_hashes,
        upsert_chunks_batch,
        cleanup_stale_chunks,
        vector_search,
        text_search,
        concept_search,
    )
    if any(func.__module__ == __name__ for func in _runtime_supabase_chunk_funcs):
        raise RuntimeError(
            "STORAGE_BACKEND=local but chunk/graph operations still point at Supabase query functions"
        )
