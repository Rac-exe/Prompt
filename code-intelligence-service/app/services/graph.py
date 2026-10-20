"""
Call graph and import graph operations — resolving relationships between chunks.

process_call_graph()  — resolves explicit call/import edges sent by the Electron
                        parser as CallGraphEdge payloads.
process_import_edges() — builds function-level import edges from the `imports`
                         list stored on each ChunkInput.  This is denser than
                         file-level imports because it creates a directed edge
                         from every imported symbol back to the chunk that
                         declares it, giving PageRank the connectivity it needs
                         to distinguish implementers from callers.
"""

import logging
import posixpath
import re
from app.db.queries import find_chunks_by_names, find_chunks_by_file_paths, upsert_relationships_batch
from app.db.models import CallGraphEdge, ChunkInput

logger = logging.getLogger("code-intel.graph")


def process_call_graph(project_id: str, edges: list[CallGraphEdge]):
    """
    Resolve call graph edges to chunk IDs and create relationships.

    Uses two DB round-trips regardless of edge count:
      1. Batch-fetch all referenced chunk names in one query.
      2. Batch-upsert all resolved relationships in one query.
    """
    if not edges:
        return

    all_names = []
    for edge in edges:
        all_names.append(edge.from_name)
        all_names.append(edge.to_name)

    name_map = find_chunks_by_names(project_id, all_names)

    def _resolve(name: str, file_path: str | None) -> str | None:
        candidates = name_map.get(name, [])
        if not candidates:
            return None
        if file_path:
            for c in candidates:
                if c["file_path"] == file_path:
                    return c["id"]
        return candidates[0]["id"]

    relationship_rows: list[dict] = []
    resolved = 0
    skipped = 0

    for edge in edges:
        from_id = _resolve(edge.from_name, edge.from_file)
        to_id = _resolve(edge.to_name, edge.to_file)
        if from_id and to_id:
            relationship_rows.append({
                "project_id": project_id,
                "from_chunk_id": from_id,
                "to_chunk_id": to_id,
                "relationship_type": edge.relationship_type.value,
            })
            resolved += 1
        else:
            skipped += 1

    # Deduplicate by constraint key before batch upsert.
    seen_keys: set[tuple] = set()
    unique_rows: list[dict] = []
    for row in relationship_rows:
        key = (row["from_chunk_id"], row["to_chunk_id"], row["relationship_type"])
        if key not in seen_keys:
            seen_keys.add(key)
            unique_rows.append(row)

    duplicates = len(relationship_rows) - len(unique_rows)
    if duplicates:
        logger.info(
            "Call graph: deduplicated %d duplicate edges before batch upsert", duplicates
        )

    upsert_relationships_batch(unique_rows)
    logger.info("Call graph: %d resolved, %d skipped (unresolvable)", resolved, skipped)


_JS_EXTENSIONS = (".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs")
_PY_EXTENSIONS = (".py",)


def _resolve_import_to_file_path(
    importer_file: str,
    import_spec: str,
    all_file_paths: set[str],
) -> str | None:
    """
    Resolve a relative import specifier (e.g. "../controllers/user.controller")
    to an actual project file path by trying common extensions.

    Returns the matching file path from all_file_paths, or None if not found.
    """
    # Normalise the import spec using posixpath (handles ../ correctly on all OSes)
    importer_dir = posixpath.dirname(importer_file.replace("\\", "/"))
    raw = import_spec.replace("\\", "/")
    base = posixpath.normpath(posixpath.join(importer_dir, raw))

    # Try exact match first (import already has extension)
    if base in all_file_paths:
        return base

    # Try appending common extensions
    for ext in (*_JS_EXTENSIONS, *_PY_EXTENSIONS):
        candidate = base + ext
        if candidate in all_file_paths:
            return candidate

    # Try index file (e.g. "./components" → "./components/index.js")
    for ext in _JS_EXTENSIONS:
        candidate = base + "/index" + ext
        if candidate in all_file_paths:
            return candidate

    return None


def process_import_edges(project_id: str, chunks: list[ChunkInput]):
    """
    Build file-level import edges from ChunkInput.imports.

    The Electron parser stores module specifiers in chunk.imports
    (e.g. ``["../controllers/user.controller", "express", "./models/User"]``).
    Relative specifiers (starting with ``.`` or ``/``) are resolved against the
    importer's file path and matched to actual project files.  Bare specifiers
    (third-party packages like ``express``) won't match any project file and are
    silently skipped — we only care about in-project connectivity for PageRank.

    For every resolved target file we create one directed edge from the importing
    chunk to every chunk in that file, giving PageRank the cross-file connectivity
    it needs to surface highly-imported modules.

        importing_chunk  --[imports]-->  chunk_in_target_file
    """
    if not chunks:
        return

    # ── Log a sample to confirm the format of chunk.imports ────────────────
    sample_chunks = [c for c in chunks[:5] if c.imports]
    for sc in sample_chunks:
        logger.debug(
            "[IMPORT_EDGES] sample chunk=%r file=%r imports=%s",
            sc.name, sc.file_path, sc.imports[:5],
        )

    # Split imports into relative (file-path) vs bare (symbol / package name)
    all_relative_specs: list[str] = []
    all_bare_names: list[str] = []

    for chunk in chunks:
        for imp in (chunk.imports or []):
            if not imp:
                continue
            if imp.startswith(".") or imp.startswith("/"):
                all_relative_specs.append(imp)
            else:
                all_bare_names.append(imp)

    logger.info(
        "[IMPORT_EDGES] Import spec breakdown: relative=%d bare=%d total_chunks=%d",
        len(all_relative_specs), len(all_bare_names), len(chunks),
    )

    if not all_relative_specs and not all_bare_names:
        logger.info("[IMPORT_EDGES] No import specifiers found — skipping")
        return

    # ── Build lookup maps ───────────────────────────────────────────────────
    # For relative imports: collect all project file paths for resolution
    all_chunk_file_paths: set[str] = {c.file_path.replace("\\", "/") for c in chunks if c.file_path}

    # For bare-name imports: try name-based lookup (covers re-exported symbols etc.)
    name_map = find_chunks_by_names(project_id, list(dict.fromkeys(all_bare_names))) if all_bare_names else {}

    # Resolve all relative specs to actual file paths and batch-fetch those files' chunks
    resolved_file_paths: set[str] = set()
    for chunk in chunks:
        for imp in (chunk.imports or []):
            if not imp or not (imp.startswith(".") or imp.startswith("/")):
                continue
            fp = _resolve_import_to_file_path(
                chunk.file_path.replace("\\", "/"),
                imp,
                all_chunk_file_paths,
            )
            if fp:
                resolved_file_paths.add(fp)

    logger.info(
        "[IMPORT_EDGES] Resolved %d unique target file paths from %d relative specifiers",
        len(resolved_file_paths), len(all_relative_specs),
    )

    file_chunks_map = find_chunks_by_file_paths(project_id, list(resolved_file_paths)) if resolved_file_paths else {}

    # Also need the importer chunk IDs — fetch from name_map or file-path map
    importer_names = [c.name for c in chunks]
    importer_name_map = find_chunks_by_names(project_id, importer_names)

    # ── Build relationship rows ─────────────────────────────────────────────
    relationship_rows: list[dict] = []
    resolved_relative = 0
    resolved_bare = 0
    importer_not_found = 0

    for chunk in chunks:
        imported_specs = chunk.imports or []
        if not imported_specs:
            continue

        # Resolve importer chunk ID
        importer_candidates = importer_name_map.get(chunk.name, [])
        importer_id: str | None = None
        importer_fp = chunk.file_path.replace("\\", "/")
        for c in importer_candidates:
            if c.get("file_path", "").replace("\\", "/") == importer_fp:
                importer_id = c["id"]
                break
        if not importer_id and importer_candidates:
            importer_id = importer_candidates[0]["id"]

        if not importer_id:
            importer_not_found += 1
            continue

        for imp in imported_specs:
            if not imp or len(imp) < 2:
                continue

            if imp.startswith(".") or imp.startswith("/"):
                # File-path based: create edge to every chunk in target file
                target_fp = _resolve_import_to_file_path(importer_fp, imp, all_chunk_file_paths)
                if not target_fp:
                    continue
                target_chunks = file_chunks_map.get(target_fp, [])
                for tc in target_chunks:
                    if tc["id"] == importer_id:
                        continue  # skip self-loops
                    relationship_rows.append({
                        "project_id": project_id,
                        "from_chunk_id": importer_id,
                        "to_chunk_id": tc["id"],
                        "relationship_type": "imports",
                    })
                    resolved_relative += 1
            else:
                # Bare name: symbol-level lookup
                for tc in name_map.get(imp, []):
                    if tc["id"] == importer_id:
                        continue
                    relationship_rows.append({
                        "project_id": project_id,
                        "from_chunk_id": importer_id,
                        "to_chunk_id": tc["id"],
                        "relationship_type": "imports",
                    })
                    resolved_bare += 1

    # Deduplicate before batch upsert
    seen_keys: set[tuple] = set()
    unique_rows: list[dict] = []
    for row in relationship_rows:
        key = (row["from_chunk_id"], row["to_chunk_id"])
        if key not in seen_keys:
            seen_keys.add(key)
            unique_rows.append(row)

    duplicates = len(relationship_rows) - len(unique_rows)

    if unique_rows:
        upsert_relationships_batch(unique_rows)

    logger.info(
        "[IMPORT_EDGES] Import edges: file_path_resolved=%d bare_name_resolved=%d "
        "importer_not_found=%d duplicates_dropped=%d total_unique_edges=%d",
        resolved_relative, resolved_bare, importer_not_found, duplicates, len(unique_rows),
    )
