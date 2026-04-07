"""
Raw SQL queries for pgvector search, chunk upserts, and graph operations.
Uses the Supabase client's rpc() for vector operations and standard
table operations for CRUD.
"""

import logging
from typing import Optional
from app.db.supabase_client import get_client

logger = logging.getLogger("code-intel.queries")


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
    }
    result = (
        client.table("code_chunks")
        .upsert(data, on_conflict="project_id,file_path,name,chunk_type")
        .execute()
    )
    return result.data[0] if result.data else {}


def get_chunk_by_hash(project_id: str, file_path: str, name: str, content_hash: str) -> Optional[dict]:
    client = get_client()
    result = (
        client.table("code_chunks")
        .select("id,content_hash")
        .eq("project_id", project_id)
        .eq("file_path", file_path)
        .eq("name", name)
        .eq("content_hash", content_hash)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def delete_chunks_for_file(project_id: str, file_path: str):
    client = get_client()
    client.table("code_chunks").delete().eq("project_id", project_id).eq("file_path", file_path).execute()


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


def vector_search(
    project_id: str,
    user_id: str,
    query_embedding: list[float],
    limit: int = 10,
    branch: Optional[str] = None,
) -> list[dict]:
    """
    Cosine similarity search via Supabase RPC.
    Requires the match_code_chunks function to be created in the DB.
    """
    client = get_client()
    params = {
        "query_embedding": query_embedding,
        "match_count": limit,
        "filter_project_id": project_id,
        "filter_user_id": user_id,
    }
    if branch:
        params["filter_branch"] = branch

    result = client.rpc("match_code_chunks", params).execute()
    return result.data or []


def get_related_chunks(chunk_ids: list[str], project_id: str) -> list[dict]:
    """Fetch direct callers and callees for a set of chunks."""
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

    related_ids = set()
    for row in outgoing.data or []:
        related_ids.add(row["to_chunk_id"])
    for row in incoming.data or []:
        related_ids.add(row["from_chunk_id"])

    related_ids -= set(chunk_ids)
    if not related_ids:
        return []

    result = (
        client.table("code_chunks")
        .select("id,file_path,start_line,end_line,chunk_type,name,signature,language,semantic_summary,branch,branch_diverged")
        .in_("id", list(related_ids))
        .execute()
    )
    return result.data or []


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
