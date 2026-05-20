"""
Knowledge-graph pipeline: dense import graph, PageRank, Leiden community
detection, LLM community reports, LLM relationship summaries, and
concept-phrase embeddings.

This module is called by index_worker.py after upsert_chunks_batch() when
GRAPH_BUILDER_ENABLED=true.  It operates entirely on data already stored in
the database so it can be run (or re-run) independently of the ingest path.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Optional

import igraph as ig
import leidenalg
import litellm
import sentry_sdk

from app.config import (
    COMMUNITY_MODEL,
    CONCEPT_PHRASE_PER_CHUNK,
    OPENROUTER_API_KEY,
    RELATIONSHIP_EMBED_TOP_N,
    SUMMARIZER_MODEL,
    SUMMARY_MAX_TOKENS,
)
from app.services import prmpt_ai_client

logger = logging.getLogger("code-intel.graph_builder")


# ── Result types ─────────────────────────────────────────────────────────────

@dataclass
class CommunityResult:
    """One Leiden community cluster with its LLM-generated report."""
    label: str                        # e.g. "auth-cluster-0"
    summary: str                      # LLM community report
    summary_embedding: list[float]    # embedded report
    member_chunk_ids: list[str]       # chunk UUIDs belonging to this cluster
    level: int = 0


@dataclass
class ChunkGraphData:
    """Graph-derived data to write back to code_chunks."""
    chunk_id: str
    pagerank_score: float
    centrality_score: float
    community_label: str              # temporary label; resolved to UUID by caller
    concept_phrases: list[str] = field(default_factory=list)  # 3 free-form phrases
    concept_embedding_1: Optional[list[float]] = None
    concept_embedding_2: Optional[list[float]] = None
    concept_embedding_3: Optional[list[float]] = None


@dataclass
class RelationshipGraphData:
    """LLM-generated description + embedding for a relationship edge."""
    from_chunk_id: str
    to_chunk_id: str
    relationship_type: str
    summary: str
    embedding: list[float]


@dataclass
class GraphPipelineResult:
    communities: list[CommunityResult]
    chunk_graph_data: list[ChunkGraphData]       # pagerank + community + concept embeddings
    relationship_data: list[RelationshipGraphData]


# ── Graph construction ───────────────────────────────────────────────────────

def _build_igraph(
    chunk_rows: list[dict],
    relationship_rows: list[dict],
) -> tuple[ig.Graph, dict[str, int], dict[int, str]]:
    """
    Build a directed igraph from chunk rows and relationship rows.

    Returns:
        graph       — igraph.Graph (directed)
        id_to_idx   — chunk UUID → igraph vertex index
        idx_to_id   — igraph vertex index → chunk UUID
    """
    id_to_idx: dict[str, int] = {}
    idx_to_id: dict[int, str] = {}

    for i, row in enumerate(chunk_rows):
        cid = str(row["id"])
        id_to_idx[cid] = i
        idx_to_id[i] = cid

    n = len(chunk_rows)
    graph = ig.Graph(n=n, directed=True)

    # Attach metadata
    graph.vs["chunk_id"] = [str(r["id"]) for r in chunk_rows]
    graph.vs["name"] = [r.get("name", "") for r in chunk_rows]
    graph.vs["file_path"] = [r.get("file_path", "") for r in chunk_rows]

    edges_to_add: list[tuple[int, int]] = []
    edge_weights: list[float] = []

    _WEIGHT = {"calls": 3.0, "imports": 2.0, "parent_of": 2.0, "child_of": 2.0,
               "inherits": 1.5, "implements": 1.5, "sibling_next": 1.0}

    for rel in relationship_rows:
        from_id = str(rel.get("from_chunk_id", ""))
        to_id = str(rel.get("to_chunk_id", ""))
        rtype = rel.get("relationship_type", "imports")
        if from_id in id_to_idx and to_id in id_to_idx:
            edges_to_add.append((id_to_idx[from_id], id_to_idx[to_id]))
            edge_weights.append(_WEIGHT.get(rtype, 1.0))

    if edges_to_add:
        graph.add_edges(edges_to_add)
        graph.es["weight"] = edge_weights

    logger.info(
        "[GRAPH_BUILDER] igraph built: nodes=%d edges=%d",
        graph.vcount(), graph.ecount(),
    )
    return graph, id_to_idx, idx_to_id


def _compute_pagerank(graph: ig.Graph) -> list[float]:
    """Compute PageRank scores; returns a list aligned with graph.vs."""
    if graph.ecount() == 0:
        logger.info("[PAGERANK] No edges — all scores = 0.0")
        return [0.0] * graph.vcount()
    t0 = time.perf_counter()
    weights = graph.es["weight"] if graph.es.attributes() and "weight" in graph.es.attributes() else None
    scores = graph.pagerank(weights=weights, damping=0.85)
    elapsed = time.perf_counter() - t0

    # Log the top-10 nodes by PageRank for visibility
    top_pairs = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)[:10]
    top_names = graph.vs["name"] if "name" in graph.vs.attributes() else [""] * graph.vcount()
    top_summary = ", ".join(
        f"{top_names[i]!r}={v:.4f}" for i, v in top_pairs
    )
    logger.info(
        "[PAGERANK] Computed %d scores in %.2fms | top-10: %s",
        len(scores), elapsed * 1000, top_summary,
    )
    return scores


def _compute_centrality(graph: ig.Graph) -> list[float]:
    """Compute betweenness centrality, normalised to [0, 1]."""
    if graph.vcount() < 3 or graph.ecount() == 0:
        return [0.0] * graph.vcount()
    t0 = time.perf_counter()
    raw = graph.betweenness(directed=True)
    max_val = max(raw) if raw else 1.0
    if max_val == 0:
        return [0.0] * len(raw)
    normalised = [v / max_val for v in raw]
    logger.info(
        "[CENTRALITY] Betweenness computed in %.2fms | max_raw=%.2f non_zero=%d",
        (time.perf_counter() - t0) * 1000,
        max_val,
        sum(1 for v in normalised if v > 0),
    )
    return normalised


def _run_leiden(graph: ig.Graph) -> list[int]:
    """
    Run Leiden community detection on an undirected view of the graph.
    Returns a partition list: partition[vertex_index] = community_id (int).
    """
    if graph.vcount() < 2 or graph.ecount() == 0:
        return list(range(graph.vcount()))
    undirected = graph.as_undirected(combine_edges="max")
    weights = undirected.es["weight"] if "weight" in undirected.es.attributes() else None
    partition = leidenalg.find_partition(
        undirected,
        leidenalg.ModularityVertexPartition,
        weights=weights,
        seed=42,
    )
    community_map = [0] * graph.vcount()
    for community_idx, member_indices in enumerate(partition):
        for vertex_idx in member_indices:
            community_map[vertex_idx] = community_idx
    logger.info(
        "[GRAPH_BUILDER] Leiden: %d vertices → %d communities",
        graph.vcount(), len(partition),
    )
    return community_map


# ── LLM helpers ──────────────────────────────────────────────────────────────

def _llm_kwargs(model: str) -> dict:
    kwargs: dict = {"model": model, "temperature": 0.1}
    if OPENROUTER_API_KEY and "openrouter" in model.lower():
        kwargs["api_key"] = OPENROUTER_API_KEY
    return kwargs


def _strip_fence(raw: str) -> str:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1] if "\n" in cleaned else cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
    return cleaned.strip()


async def _generate_community_reports(
    communities_raw: dict[int, list[dict]],
) -> dict[int, str]:
    """
    For each community cluster, call the LLM to generate a plain-English
    architecture report.  Returns a dict mapping community_id → report text.
    """
    if not communities_raw:
        return {}

    BATCH_SIZE = 5
    community_ids = list(communities_raw.keys())
    reports: dict[int, str] = {}

    async def _one_batch(batch_ids: list[int]) -> None:
        items = []
        for cid in batch_ids:
            members = communities_raw[cid]
            member_lines = []
            for m in members[:20]:
                name = m.get("name", "?")
                fp = m.get("file_path", "?")
                summary = (m.get("summary_code") or m.get("semantic_summary") or "")[:120]
                member_lines.append(f"  - {name} ({fp}): {summary}")
            items.append(
                f"CLUSTER {cid} ({len(members)} members):\n" + "\n".join(member_lines)
            )

        kwargs = _llm_kwargs(COMMUNITY_MODEL)
        kwargs["messages"] = [
            {
                "role": "system",
                "content": (
                    "You are a code architecture analyst. For each cluster of code chunks, "
                    "write a 2-4 sentence community report describing: what this subsystem does, "
                    "its primary entry points, key dependencies, and architectural role. "
                    "Be specific and technical. Return strict JSON: "
                    "[{\"cluster_id\": N, \"label\": \"short-name\", \"report\": \"...\"}, ...]"
                ),
            },
            {"role": "user", "content": "\n\n".join(items)},
        ]
        kwargs["max_tokens"] = min(300 * len(batch_ids), 3000)

        try:
            if prmpt_ai_client.is_configured():
                raw = (await prmpt_ai_client.completion_async(**kwargs)).strip()
            else:
                response = await asyncio.to_thread(litellm.completion, **kwargs)
                raw = (response.choices[0].message.content or "").strip()
            data = json.loads(_strip_fence(raw))
            if isinstance(data, list):
                for entry in data:
                    cid = int(entry.get("cluster_id", -1))
                    report = str(entry.get("report") or "").strip()
                    label = str(entry.get("label") or f"cluster-{cid}").strip()
                    if cid in communities_raw and report:
                        reports[cid] = report
                        reports[f"label_{cid}"] = label  # type: ignore[index]
        except Exception as e:
            logger.warning("[GRAPH_BUILDER] Community report batch failed: %s", e)
            sentry_sdk.capture_exception(e)
            for cid in batch_ids:
                if cid not in reports:
                    members = communities_raw[cid]
                    names = ", ".join(m.get("name", "") for m in members[:5])
                    reports[cid] = f"Cluster of {len(members)} chunks including: {names}"

    batches = [community_ids[i:i + BATCH_SIZE] for i in range(0, len(community_ids), BATCH_SIZE)]
    await asyncio.gather(*[_one_batch(b) for b in batches])
    return reports


async def _generate_relationship_summaries(
    top_edges: list[dict],
    chunk_lookup: dict[str, dict],
) -> list[tuple[str, str, str, str]]:
    """
    Generate LLM descriptions for the most important edges.
    Returns list of (from_id, to_id, rel_type, summary) tuples.
    """
    if not top_edges:
        return []

    BATCH_SIZE = 10
    results: list[tuple[str, str, str, str]] = []

    async def _one_batch(edges: list[dict]) -> None:
        lines = []
        for i, edge in enumerate(edges, 1):
            from_chunk = chunk_lookup.get(str(edge["from_chunk_id"]), {})
            to_chunk = chunk_lookup.get(str(edge["to_chunk_id"]), {})
            from_name = from_chunk.get("name", edge["from_chunk_id"])
            to_name = to_chunk.get("name", edge["to_chunk_id"])
            rel = edge.get("relationship_type", "calls")
            lines.append(f"{i}. {from_name} --[{rel}]--> {to_name}")

        kwargs = _llm_kwargs(SUMMARIZER_MODEL)
        kwargs["messages"] = [
            {
                "role": "system",
                "content": (
                    "For each code relationship, write a single concise sentence describing "
                    "what the caller/importer uses the callee/imported for. Be specific. "
                    "Return strict JSON array: [{\"idx\": 1, \"summary\": \"...\"}, ...]"
                ),
            },
            {"role": "user", "content": "\n".join(lines)},
        ]
        kwargs["max_tokens"] = min(80 * len(edges), 2000)

        try:
            if prmpt_ai_client.is_configured():
                raw = (await prmpt_ai_client.completion_async(**kwargs)).strip()
            else:
                response = await asyncio.to_thread(litellm.completion, **kwargs)
                raw = (response.choices[0].message.content or "").strip()
            data = json.loads(_strip_fence(raw))
            summaries_by_idx: dict[int, str] = {}
            if isinstance(data, list):
                for entry in data:
                    idx = int(entry.get("idx", -1))
                    s = str(entry.get("summary") or "").strip()
                    if 1 <= idx <= len(edges) and s:
                        summaries_by_idx[idx] = s
            for i, edge in enumerate(edges, 1):
                summary = summaries_by_idx.get(i, "")
                if summary:
                    results.append((
                        str(edge["from_chunk_id"]),
                        str(edge["to_chunk_id"]),
                        edge.get("relationship_type", "calls"),
                        summary,
                    ))
        except Exception as e:
            logger.warning("[GRAPH_BUILDER] Relationship summary batch failed: %s", e)
            sentry_sdk.capture_exception(e)

    batches = [top_edges[i:i + BATCH_SIZE] for i in range(0, len(top_edges), BATCH_SIZE)]
    await asyncio.gather(*[_one_batch(b) for b in batches])
    return results


# ── Main pipeline entry point ────────────────────────────────────────────────

async def run_graph_pipeline(
    project_id: str,
    chunk_rows: list[dict],
    relationship_rows: list[dict],
) -> GraphPipelineResult:
    """
    Full graph pipeline:
      1. Build igraph from chunks + relationships
      2. Compute PageRank + betweenness centrality
      3. Run Leiden community detection
      4. Generate LLM community reports (batched)
      5. Summarize top-N relationships (batched)
      6. Return GraphPipelineResult for writeback

    Concept phrase generation and embedding happens in index_worker.py
    (alongside the main summarizer output) to avoid duplicating LLM calls.
    """
    t_total = time.perf_counter()

    if not chunk_rows:
        logger.info("[GRAPH_BUILDER] No chunks provided — skipping graph pipeline")
        return GraphPipelineResult(communities=[], chunk_graph_data=[], relationship_data=[])

    logger.info(
        "[GRAPH_BUILDER] ═══ Starting graph pipeline: project=%s chunks=%d relationships=%d ═══",
        project_id, len(chunk_rows), len(relationship_rows),
    )

    # Step 1: Build igraph
    t_step = time.perf_counter()
    graph, id_to_idx, idx_to_id = _build_igraph(chunk_rows, relationship_rows)
    logger.info(
        "[GRAPH_BUILDER] Step 1/5 — igraph built: nodes=%d edges=%d elapsed=%.2fms",
        graph.vcount(), graph.ecount(), (time.perf_counter() - t_step) * 1000,
    )

    # Step 2: PageRank + centrality
    t_step = time.perf_counter()
    pagerank = _compute_pagerank(graph)
    centrality = _compute_centrality(graph)
    logger.info(
        "[GRAPH_BUILDER] Step 2/5 — PageRank + centrality: elapsed=%.2fms",
        (time.perf_counter() - t_step) * 1000,
    )

    # Step 3: Leiden community detection
    t_step = time.perf_counter()
    community_map = _run_leiden(graph)
    logger.info(
        "[GRAPH_BUILDER] Step 3/5 — Leiden done: elapsed=%.2fms",
        (time.perf_counter() - t_step) * 1000,
    )

    # Group chunk rows by community and log sizes
    chunk_lookup: dict[str, dict] = {str(r["id"]): r for r in chunk_rows}
    communities_raw: dict[int, list[dict]] = {}
    for vertex_idx, comm_id in enumerate(community_map):
        chunk_id = idx_to_id[vertex_idx]
        chunk = chunk_lookup.get(chunk_id, {"id": chunk_id})
        communities_raw.setdefault(comm_id, []).append(chunk)

    community_sizes = sorted(
        [(cid, len(members)) for cid, members in communities_raw.items()],
        key=lambda x: x[1], reverse=True,
    )
    logger.info(
        "[GRAPH_BUILDER] Communities found: %d | sizes: %s",
        len(communities_raw),
        ", ".join(f"C{cid}={sz}" for cid, sz in community_sizes[:8]),
    )

    # Step 4: Generate community reports
    t_step = time.perf_counter()
    reports = await _generate_community_reports(communities_raw)
    logger.info(
        "[GRAPH_BUILDER] Step 4/5 — Community reports generated: %d reports in %.2fs",
        len([v for k, v in reports.items() if not str(k).startswith("label_")]),
        time.perf_counter() - t_step,
    )
    # Log each community label + first 120 chars of its report
    for comm_id in sorted(communities_raw.keys()):
        label = reports.get(f"label_{comm_id}", f"cluster-{comm_id}")
        report_text = reports.get(comm_id, "")
        logger.info(
            "[GRAPH_BUILDER] Community C%d (%d members) label=%r report_preview=%r",
            comm_id, len(communities_raw[comm_id]), label, report_text[:120],
        )

    # Build CommunityResult list
    community_results: list[CommunityResult] = []
    community_label_map: dict[int, str] = {}
    for comm_id, members in communities_raw.items():
        report_text = reports.get(comm_id, f"Cluster of {len(members)} chunks.")
        raw_label = reports.get(f"label_{comm_id}", f"cluster-{comm_id}")
        label = f"{raw_label}-{comm_id}"
        community_label_map[comm_id] = label
        community_results.append(CommunityResult(
            label=label,
            summary=report_text,
            summary_embedding=[],   # filled by caller after embed
            member_chunk_ids=[str(m["id"]) for m in members],
            level=0,
        ))

    # Build per-chunk graph data
    chunk_graph_data: list[ChunkGraphData] = []
    for vertex_idx, chunk_id in idx_to_id.items():
        comm_int = community_map[vertex_idx]
        chunk_graph_data.append(ChunkGraphData(
            chunk_id=chunk_id,
            pagerank_score=float(pagerank[vertex_idx]),
            centrality_score=float(centrality[vertex_idx]),
            community_label=community_label_map.get(comm_int, f"cluster-{comm_int}"),
        ))

    # Step 5: Relationship summaries
    t_step = time.perf_counter()
    if relationship_rows:
        in_degree: dict[str, int] = {}
        for rel in relationship_rows:
            to_id = str(rel.get("to_chunk_id", ""))
            in_degree[to_id] = in_degree.get(to_id, 0) + 1

        sorted_edges = sorted(
            relationship_rows,
            key=lambda r: in_degree.get(str(r.get("to_chunk_id", "")), 0),
            reverse=True,
        )
        top_edges = sorted_edges[:RELATIONSHIP_EMBED_TOP_N]
        logger.info(
            "[GRAPH_BUILDER] Step 5/5 — Summarising top %d/%d edges by in-degree...",
            len(top_edges), len(relationship_rows),
        )
        rel_summaries_raw = await _generate_relationship_summaries(top_edges, chunk_lookup)
    else:
        rel_summaries_raw = []
        logger.info("[GRAPH_BUILDER] Step 5/5 — No relationships to summarise")

    logger.info(
        "[GRAPH_BUILDER] Step 5/5 — Relationship summaries: %d generated in %.2fs",
        len(rel_summaries_raw), time.perf_counter() - t_step,
    )

    relationship_data = [
        RelationshipGraphData(
            from_chunk_id=from_id,
            to_chunk_id=to_id,
            relationship_type=rtype,
            summary=summary,
            embedding=[],  # caller fills this after embed_texts()
        )
        for from_id, to_id, rtype, summary in rel_summaries_raw
    ]

    logger.info(
        "[GRAPH_BUILDER] ═══ Pipeline complete: communities=%d chunk_data=%d "
        "rel_summaries=%d total_elapsed=%.2fs ═══",
        len(community_results), len(chunk_graph_data), len(relationship_data),
        time.perf_counter() - t_total,
    )

    return GraphPipelineResult(
        communities=community_results,
        chunk_graph_data=chunk_graph_data,
        relationship_data=relationship_data,
    )
