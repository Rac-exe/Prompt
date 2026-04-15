"""
Queries for pgvector search, full-text search, chunk upserts, graph
operations, and observation tracking.  Uses the Supabase client's rpc()
for vector/text search and standard table operations for CRUD.
"""

import logging
from typing import Optional
from app.db.supabase_client import get_client
from app.config import GRAPH_MAX_DEPTH, GRAPH_MAX_RELATED

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
    return result.data[0] if result.data else {}


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
    return result.data[0] if result.data else None


def get_projects_for_user(user_id: str) -> list[dict]:
    client = get_client()
    result = (
        client.table("projects")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


def update_project_status(project_id: str, status: str, last_indexed_at: Optional[str] = None):
    client = get_client()
    data: dict = {"index_status": status}
    if last_indexed_at:
        data["last_indexed_at"] = last_indexed_at
    client.table("projects").update(data).eq("id", project_id).execute()


def delete_project(project_id: str, user_id: str):
    client = get_client()
    client.table("code_relationships").delete().eq("project_id", project_id).execute()
    client.table("code_chunks").delete().eq("project_id", project_id).execute()
    client.table("project_branches").delete().eq("project_id", project_id).execute()
    client.table("projects").delete().eq("id", project_id).eq("user_id", user_id).execute()


# ── Chunks ──────────────────────────────────────────────────────────────────

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


def get_existing_chunk_hashes(project_id: str) -> dict[tuple[str, str], dict]:
    """Fetch all (file_path, name) -> {content_hash, embedding} for a project in one query."""
    client = get_client()
    result = (
        client.table("code_chunks")
        .select("file_path,name,content_hash,embedding")
        .eq("project_id", project_id)
        .execute()
    )
    lookup: dict[tuple[str, str], dict] = {}
    for row in (result.data or []):
        key = (row["file_path"], row["name"])
        lookup[key] = row
    return lookup


def cleanup_stale_chunks(project_id: str, valid_keys: set[tuple[str, str, str]]) -> int:
    """Delete chunks not in the latest ingest batch. valid_keys = {(file_path, name, chunk_type)}."""
    client = get_client()
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


# ── Vector search ───────────────────────────────────────────────────────────

_CHUNK_SELECT_FIELDS = (
    "id,file_path,start_line,end_line,chunk_type,name,signature,"
    "language,semantic_summary,code_body,concepts,branch,branch_diverged,is_exported"
)


def vector_search(
    project_id: str,
    user_id: str,
    query_embedding: list[float],
    limit: int = 10,
    branch: Optional[str] = None,
) -> list[dict]:
    """Cosine similarity search via the match_code_chunks RPC."""
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
        result = client.rpc("match_code_chunks", params).execute()
        rows = result.data or []
        logger.debug(f"vector_search: {len(rows)} results for project {project_id}")
        return rows
    except Exception as e:
        logger.error(f"vector_search RPC failed for project {project_id}: {e}")
        return []


def concept_search(
    project_id: str,
    user_id: str,
    concepts: list[str],
    limit: int = 10,
) -> list[dict]:
    """Concept-overlap search via the search_by_concepts RPC (uses GIN index)."""
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
        result = client.rpc("search_by_concepts", params).execute()
        rows = result.data or []
        logger.debug(f"concept_search: {len(rows)} results for concepts={concepts}")
        return rows
    except Exception as e:
        logger.error(f"concept_search RPC failed for project {project_id}: {e}")
        return []


def text_search(
    project_id: str,
    user_id: str,
    query: str,
    limit: int = 10,
) -> list[dict]:
    """Full-text keyword search via the search_code_chunks_text RPC."""
    client = get_client()
    params = {
        "search_query": query,
        "match_count": limit,
        "filter_project_id": project_id,
        "filter_user_id": user_id,
    }
    try:
        result = client.rpc("search_code_chunks_text", params).execute()
        rows = result.data or []
        logger.debug(f"text_search: {len(rows)} results for query={query[:60]!r}")
        return rows
    except Exception as e:
        logger.error(f"text_search RPC failed for project {project_id}: {e}")
        return []


# ── Graph traversal ─────────────────────────────────────────────────────────

EDGE_WEIGHTS = {"calls": 3, "imports": 2, "inherits": 1, "implements": 1}


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
    client = get_client()
    result = (
        client.table("project_branches")
        .select("*")
        .eq("project_id", project_id)
        .eq("branch_name", branch)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


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
        .execute()
    )
    return result.data or []
