"""
Context enrichment for indexed chunks.

Electron sends symbol-level chunks. This module adds lightweight file and
hierarchy context so summarization and embeddings are not based on isolated
function bodies alone.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from app.db.models import ChunkInput


@dataclass
class EnrichedChunk:
    chunk: ChunkInput
    context_header: str | None = None
    context_before: str | None = None
    context_after: str | None = None
    parent_summary: str | None = None
    sibling_names: list[str] = field(default_factory=list)


def build_enriched_chunks(chunks: list[ChunkInput]) -> list[EnrichedChunk]:
    by_file: dict[str, list[ChunkInput]] = {}
    for chunk in chunks:
        by_file.setdefault(chunk.file_path, []).append(chunk)

    enriched: list[EnrichedChunk] = []
    for file_chunks in by_file.values():
        ordered = sorted(
            file_chunks,
            key=lambda c: (
                c.start_line,
                c.chunk_index if c.chunk_index is not None else 10_000,
                c.name,
            ),
        )
        header = _build_context_header(ordered)
        names = [c.name for c in ordered]
        summaries_by_name: dict[str, str] = {}

        for idx, chunk in enumerate(ordered):
            parent_summary = None
            if chunk.parent_scope_name:
                parent_summary = summaries_by_name.get(chunk.parent_scope_name)
            elif "." in chunk.name:
                parent_summary = summaries_by_name.get(chunk.name.rsplit(".", 1)[0])

            prev_chunk = ordered[idx - 1] if idx > 0 else None
            next_chunk = ordered[idx + 1] if idx + 1 < len(ordered) else None
            enriched_item = EnrichedChunk(
                chunk=chunk,
                context_header=header,
                context_before=(prev_chunk.code_body[:800] if prev_chunk and prev_chunk.code_body else None),
                context_after=(next_chunk.code_body[:800] if next_chunk and next_chunk.code_body else None),
                parent_summary=parent_summary,
                sibling_names=[n for n in names if n != chunk.name][:20],
            )
            enriched.append(enriched_item)
            if chunk.chunk_type.value in ("class", "file"):
                summaries_by_name[chunk.name] = chunk.docstring or chunk.signature or chunk.name

    return enriched


def _build_context_header(chunks: list[ChunkInput]) -> str | None:
    imports: list[str] = []
    for chunk in chunks:
        imports.extend(chunk.imports or [])
    unique_imports = list(dict.fromkeys(imports))[:40]
    if not unique_imports:
        return None
    return "\n".join(unique_imports)[:4000]
