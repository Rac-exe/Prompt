"""
Call graph operations — resolving relationships between code chunks.
"""

import logging
from typing import Optional
from app.db.queries import find_chunk_by_name, upsert_relationship
from app.db.models import CallGraphEdge

logger = logging.getLogger("code-intel.graph")


def process_call_graph(project_id: str, edges: list[CallGraphEdge]):
    """
    Resolve call graph edges to chunk IDs and create relationships.
    Edges reference chunks by name+file; we look up the actual chunk IDs.
    """
    resolved = 0
    skipped = 0

    for edge in edges:
        from_chunk = find_chunk_by_name(project_id, edge.from_name, edge.from_file)
        to_chunk = find_chunk_by_name(project_id, edge.to_name, edge.to_file)

        if from_chunk and to_chunk:
            upsert_relationship(
                project_id=project_id,
                from_chunk_id=from_chunk["id"],
                to_chunk_id=to_chunk["id"],
                relationship_type=edge.relationship_type.value,
            )
            resolved += 1
        else:
            skipped += 1

    logger.info(f"Call graph: {resolved} resolved, {skipped} skipped (unresolvable)")
