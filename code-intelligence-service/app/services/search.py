"""
Semantic search + re-ranking logic for code chunk retrieval.
"""

import math
import logging
from typing import Optional
from app.services.embedding import embed_text
from app.db.queries import vector_search, get_related_chunks, get_branch_context
from app.db.models import RetrievedChunk, RetrieveResponse

logger = logging.getLogger("code-intel.search")


def _rerank(chunks: list[dict], branch: Optional[str] = None) -> list[dict]:
    """
    Re-rank candidates using:
    score = similarity * log(1 + observation_count) * branch_recency_weight
    """
    for chunk in chunks:
        similarity = chunk.get("similarity", 0.0)
        observation_count = chunk.get("observation_count", 1)
        branch_weight = 1.0

        if branch and chunk.get("branch") == branch:
            branch_weight = 1.3
        if chunk.get("branch_diverged"):
            branch_weight *= 1.2

        chunk["final_score"] = similarity * math.log(1 + observation_count) * branch_weight

    chunks.sort(key=lambda c: c.get("final_score", 0), reverse=True)
    return chunks


def retrieve_context(
    project_id: str,
    user_id: str,
    query: str,
    branch: Optional[str] = None,
    limit: int = 10,
) -> RetrieveResponse:
    query_embedding = embed_text(query)

    candidates = vector_search(
        project_id=project_id,
        user_id=user_id,
        query_embedding=query_embedding,
        limit=limit + 5,
        branch=branch,
    )

    ranked = _rerank(candidates, branch=branch)[:limit]

    ranked_chunks = [
        RetrievedChunk(
            id=c["id"],
            file_path=c["file_path"],
            start_line=c["start_line"],
            end_line=c["end_line"],
            chunk_type=c["chunk_type"],
            name=c["name"],
            signature=c.get("signature"),
            language=c["language"],
            semantic_summary=c.get("semantic_summary"),
            similarity_score=c.get("final_score", c.get("similarity", 0)),
            branch=c.get("branch"),
            branch_diverged=c.get("branch_diverged", False),
        )
        for c in ranked
    ]

    top_ids = [c.id for c in ranked_chunks[:5]]
    related_raw = get_related_chunks(top_ids, project_id)
    related_chunks = [
        RetrievedChunk(
            id=r["id"],
            file_path=r["file_path"],
            start_line=r["start_line"],
            end_line=r["end_line"],
            chunk_type=r["chunk_type"],
            name=r["name"],
            signature=r.get("signature"),
            language=r["language"],
            semantic_summary=r.get("semantic_summary"),
            similarity_score=0.0,
            branch=r.get("branch"),
            branch_diverged=r.get("branch_diverged", False),
        )
        for r in related_raw
    ]

    branch_ctx = get_branch_context(project_id, branch)

    return RetrieveResponse(
        ranked_chunks=ranked_chunks,
        related_chunks=related_chunks,
        branch_context=branch_ctx,
    )
