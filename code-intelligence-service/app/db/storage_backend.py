from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from app.db import local_store


@dataclass(frozen=True)
class StorageBackend:
    kind: str
    get_existing_chunk_hashes: Callable
    upsert_chunks_batch: Callable
    cleanup_stale_chunks: Callable
    cleanup_stale_chunks_for_files: Callable
    delete_chunks_for_file: Callable
    upsert_relationship: Callable
    find_chunk_by_name: Callable
    find_chunks_by_names: Callable
    find_chunks_by_file_paths: Callable
    upsert_relationships_batch: Callable
    hydrate_chunks_by_ids: Callable
    get_chunk_structure_embeddings: Callable
    vector_search: Callable
    concept_search: Callable
    text_search: Callable
    get_related_chunks: Callable
    get_related_chunks_multihop: Callable
    increment_observation_counts: Callable
    get_branch_context: Callable
    upsert_branch: Callable
    flag_diverged_chunks: Callable
    file_path_search: Callable
    upsert_communities: Callable
    get_all_project_chunk_ids: Callable
    get_all_project_relationships: Callable
    update_chunks_graph_data: Callable
    update_relationship_embeddings: Callable
    match_community_reports: Callable
    match_concept_embeddings: Callable
    get_community_members_ranked: Callable


def get_storage_backend(kind: str) -> StorageBackend:
    normalized = (kind or "local").lower()
    if normalized != "local":
        raise ValueError(f"Unsupported STORAGE_BACKEND={kind!r}; only 'local' is allowed in this build")
    return StorageBackend(
        kind="local",
        get_existing_chunk_hashes=local_store.get_existing_chunk_hashes,
        upsert_chunks_batch=local_store.upsert_chunks_batch,
        cleanup_stale_chunks=local_store.cleanup_stale_chunks,
        cleanup_stale_chunks_for_files=local_store.cleanup_stale_chunks_for_files,
        delete_chunks_for_file=local_store.delete_chunks_for_file,
        upsert_relationship=local_store.upsert_relationship,
        find_chunk_by_name=local_store.find_chunk_by_name,
        find_chunks_by_names=local_store.find_chunks_by_names,
        find_chunks_by_file_paths=local_store.find_chunks_by_file_paths,
        upsert_relationships_batch=local_store.upsert_relationships_batch,
        hydrate_chunks_by_ids=local_store.hydrate_chunks_by_ids,
        get_chunk_structure_embeddings=local_store.get_chunk_structure_embeddings,
        vector_search=local_store.vector_search,
        concept_search=local_store.concept_search,
        text_search=local_store.text_search,
        get_related_chunks=local_store.get_related_chunks,
        get_related_chunks_multihop=local_store.get_related_chunks_multihop,
        increment_observation_counts=local_store.increment_observation_counts,
        get_branch_context=local_store.get_branch_context,
        upsert_branch=local_store.upsert_branch,
        flag_diverged_chunks=local_store.flag_diverged_chunks,
        file_path_search=local_store.file_path_search,
        upsert_communities=local_store.upsert_communities,
        get_all_project_chunk_ids=local_store.get_all_project_chunk_ids,
        get_all_project_relationships=local_store.get_all_project_relationships,
        update_chunks_graph_data=local_store.update_chunks_graph_data,
        update_relationship_embeddings=local_store.update_relationship_embeddings,
        match_community_reports=local_store.match_community_reports,
        match_concept_embeddings=local_store.match_concept_embeddings,
        get_community_members_ranked=local_store.get_community_members_ranked,
    )
