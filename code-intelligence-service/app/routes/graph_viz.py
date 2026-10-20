"""
GET /api/graph/data/{project_id}  — returns graph nodes, edges, and community
data in a format ready for force-directed visualization.

Designed for consumption by scripts/graph_visualizer.html.
"""

import logging
from fastapi import APIRouter, Depends, HTTPException
from app.auth import require_auth
from app.db import queries
from app.db import local_store
from app.config import CACHE_TTL_SECONDS
from app.services import cache as _cache

logger = logging.getLogger("code-intel.routes.graph_viz")
router = APIRouter(tags=["graph"])


def _get_graph_data(project_id: str) -> dict:
    """Fetch nodes, edges, and communities for a project from local SQLite."""
    cache_key = f"graph_viz:{project_id}"
    cached = _cache.get(cache_key, CACHE_TTL_SECONDS * 2)  # longer TTL — graph rarely changes
    if cached is not None:
        return cached

    with local_store.connect(project_id) as conn:
        all_chunks = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, name, file_path, chunk_type, language, pagerank_score,
                       centrality_score, community_id, summary_code, is_exported
                FROM code_chunks
                WHERE project_id = ?
                """,
                (project_id,),
            ).fetchall()
        ]
        all_rels = [
            dict(row)
            for row in conn.execute(
                """
                SELECT from_chunk_id, to_chunk_id, relationship_type, relationship_summary
                FROM code_relationships
                WHERE project_id = ?
                """,
                (project_id,),
            ).fetchall()
        ]
        communities = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, label, summary, member_count, level
                FROM communities
                WHERE project_id = ?
                """,
                (project_id,),
            ).fetchall()
        ]

    # Build community ID → label/color index map
    comm_label_map: dict[str, str] = {
        str(c["id"]): c.get("label", f"cluster-{i}")
        for i, c in enumerate(communities)
    }
    comm_idx_map: dict[str, int] = {
        str(c["id"]): i for i, c in enumerate(communities)
    }

    # Normalise pagerank to [0,1] for node sizing
    pageranks = [float(c.get("pagerank_score") or 0) for c in all_chunks]
    max_pr = max(pageranks) if pageranks else 1.0
    if max_pr == 0:
        max_pr = 1.0

    # Build node list
    nodes = []
    for chunk in all_chunks:
        comm_id = str(chunk.get("community_id") or "")
        pr = float(chunk.get("pagerank_score") or 0)
        nodes.append({
            "id": str(chunk["id"]),
            "name": chunk.get("name", ""),
            "file_path": chunk.get("file_path", ""),
            "chunk_type": chunk.get("chunk_type", ""),
            "language": chunk.get("language", ""),
            "pagerank": pr,
            "pagerank_norm": pr / max_pr,  # 0–1 for sizing
            "centrality": float(chunk.get("centrality_score") or 0),
            "community_id": comm_id,
            "community_label": comm_label_map.get(comm_id, "unassigned"),
            "community_idx": comm_idx_map.get(comm_id, -1),
            "summary": (chunk.get("summary_code") or "")[:150],
            "is_exported": bool(chunk.get("is_exported")),
        })

    # Build edge list — only include edges where both endpoints exist in the node set
    valid_ids = {n["id"] for n in nodes}
    edges = []
    for rel in all_rels:
        src = str(rel.get("from_chunk_id", ""))
        tgt = str(rel.get("to_chunk_id", ""))
        if src in valid_ids and tgt in valid_ids:
            edges.append({
                "source": src,
                "target": tgt,
                "type": rel.get("relationship_type", "calls"),
                "summary": rel.get("relationship_summary", ""),
            })

    graph_data = {
        "nodes": nodes,
        "edges": edges,
        "communities": [
            {
                "id": str(c["id"]),
                "label": c.get("label", ""),
                "summary": (c.get("summary") or "")[:300],
                "member_count": c.get("member_count", 0),
                "level": c.get("level", 0),
            }
            for c in communities
        ],
        "stats": {
            "total_nodes": len(nodes),
            "total_edges": len(edges),
            "total_communities": len(communities),
            "nodes_with_community": sum(1 for n in nodes if n["community_id"]),
            "nodes_with_pagerank": sum(1 for n in nodes if n["pagerank"] > 0),
            "max_pagerank": max_pr,
            "edge_types": _count_edge_types(edges),
        },
    }

    _cache.set(cache_key, graph_data)
    logger.info(
        "[GRAPH_VIZ] Loaded graph for project %s: nodes=%d edges=%d communities=%d",
        project_id, len(nodes), len(edges), len(communities),
    )
    return graph_data


def _count_edge_types(edges: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for e in edges:
        t = e.get("type", "unknown")
        counts[t] = counts.get(t, 0) + 1
    return counts


@router.get("/graph/data/{project_id}")
async def get_graph_data(project_id: str, auth: dict = Depends(require_auth)):
    """
    Return graph nodes, edges, and community data for visualization.
    Consumed by scripts/graph_visualizer.html.
    """
    project = queries.get_project(project_id, auth.get("sub"))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.get("index_status") not in ("ready", "partial"):
        raise HTTPException(
            status_code=409,
            detail=f"Project not ready for visualization (status={project.get('index_status')}). "
                   "Run an index first.",
        )

    try:
        data = _get_graph_data(project_id)
        return data
    except Exception as e:
        logger.error("[GRAPH_VIZ] Failed to load graph for project %s: %s", project_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load graph data")


@router.delete("/graph/data/{project_id}/cache")
async def invalidate_graph_cache(project_id: str, auth: dict = Depends(require_auth)):
    """Force-refresh the graph visualization cache after a re-index."""
    if not queries.get_project(project_id, auth.get("sub")):
        raise HTTPException(status_code=404, detail="Project not found")
    _cache.invalidate(f"graph_viz:{project_id}")
    return {"status": "cache_cleared", "project_id": project_id}
