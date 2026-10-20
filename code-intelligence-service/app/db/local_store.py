from __future__ import annotations

import fnmatch
import hashlib
import json
import logging
import os
import platform
import shutil
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Iterable, Optional

import numpy as np

from app.config import EMBEDDING_DIMENSIONS

logger = logging.getLogger("code-intel.local-store")

SCHEMA_VERSION = 1
_runtime_db_root: str | None = None


def set_runtime_db_root(root: str | None) -> None:
    """Set the DB root announced by Electron via request header."""
    global _runtime_db_root
    if root and root.strip():
        _runtime_db_root = root.strip()


def get_db_root() -> Path:
    root = os.environ.get("CODE_INTEL_DB_ROOT") or _runtime_db_root
    if root:
        path = Path(root).expanduser()
    else:
        system = platform.system().lower()
        if system == "windows":
            base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
            path = Path(base) / "Prmpt" / "code-intel"
        elif system == "darwin":
            path = Path.home() / "Library" / "Application Support" / "Prmpt" / "code-intel"
        else:
            path = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "Prmpt" / "code-intel"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _validated_project_id(project_id: str) -> str:
    """Project ids are UUIDs; anything else could escape the projects folder."""
    raw = str(project_id)
    try:
        canonical = str(uuid.UUID(raw))
    except (ValueError, AttributeError, TypeError):
        canonical = ""
    if not canonical or canonical != raw.lower():
        raise ValueError(f"Invalid project id: {project_id!r}")
    return raw


def get_project_dir(project_id: str) -> Path:
    path = get_db_root() / "projects" / _validated_project_id(project_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def project_exists(project_id: str) -> bool:
    """True if a project index exists. Never creates folders or databases."""
    try:
        pid = _validated_project_id(project_id)
    except ValueError:
        return False
    return (get_db_root() / "projects" / pid / "index.db").exists()


def create_project(
    user_id: str,
    name: str,
    local_path: Optional[str] = None,
    default_branch: str = "main",
) -> dict:
    """Register a new project and return its row."""
    project_id = str(uuid.uuid4())
    sync_project({
        "id": project_id,
        "user_id": user_id,
        "name": name,
        "local_path": local_path,
        "default_branch": default_branch or "main",
        "index_status": "stale",
    })
    project = get_local_project(project_id)
    if project is None:
        raise RuntimeError(f"Project {project_id} was not persisted")
    return project


def list_projects() -> list[dict]:
    """All registered projects, newest first."""
    projects_dir = get_db_root() / "projects"
    if not projects_dir.exists():
        return []
    projects: list[dict] = []
    for db_path in projects_dir.glob("*/index.db"):
        if not project_exists(db_path.parent.name):
            continue
        project = get_local_project(db_path.parent.name)
        if project and project.get("name"):
            projects.append(project)
    projects.sort(key=lambda p: p.get("created_at") or "", reverse=True)
    return projects


def get_project_db_path(project_id: str) -> Path:
    return get_project_dir(project_id) / "index.db"


def warmup_local_store() -> bool:
    """
    Verify local DB root is writable and pragmas can be applied on startup.
    This runs once during service boot before ingest is accepted.
    """
    probe_path = get_db_root() / ".startup_probe.db"
    conn: sqlite3.Connection | None = None
    try:
        conn = sqlite3.connect(str(probe_path), timeout=5.0)
        conn.row_factory = sqlite3.Row
        _configure(conn)
        _ensure_schema(conn)
        conn.commit()
        return True
    except Exception:
        logger.exception("Local store warmup failed")
        return False
    finally:
        if conn is not None:
            conn.close()
        for suffix in ("", "-wal", "-shm"):
            try:
                (Path(str(probe_path) + suffix)).unlink(missing_ok=True)
            except OSError:
                logger.debug("Warmup probe cleanup failed for %s", str(probe_path) + suffix)


def delete_project_index(project_id: str) -> None:
    shutil.rmtree(get_project_dir(project_id), ignore_errors=True)


@contextmanager
def connect(project_id: str):
    db_path = get_project_db_path(project_id)
    conn = sqlite3.connect(str(db_path), timeout=5.0)
    conn.row_factory = sqlite3.Row
    try:
        _configure(conn)
        _ensure_schema(conn)
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _configure(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA cache_size = -8000")
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA mmap_size = 268435456")


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        f"""
        PRAGMA user_version = {SCHEMA_VERSION};

        CREATE TABLE IF NOT EXISTS projects_local (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          name TEXT,
          local_path TEXT,
          default_branch TEXT DEFAULT 'main',
          current_branch TEXT,
          index_status TEXT NOT NULL DEFAULT 'stale',
          last_indexed_at TEXT,
          project_summary TEXT,
          tech_stack_json TEXT,
          embedding_model TEXT,
          embedding_dimensions INTEGER,
          structure_embedding_dimensions INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS file_cache (
          project_id TEXT NOT NULL,
          file_path TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          chunk_count INTEGER NOT NULL DEFAULT 0,
          last_parsed_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (project_id, file_path)
        );

        CREATE TABLE IF NOT EXISTS code_chunks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          user_id TEXT,
          file_path TEXT NOT NULL,
          start_line INTEGER NOT NULL,
          end_line INTEGER NOT NULL,
          chunk_type TEXT NOT NULL,
          scope_type TEXT,
          chunk_index INTEGER,
          parent_scope_name TEXT,
          name TEXT NOT NULL,
          signature TEXT,
          language TEXT NOT NULL,
          semantic_summary TEXT,
          summary_code TEXT,
          summary_purpose TEXT,
          embedding TEXT,
          embedding_summary TEXT,
          embedding_structure TEXT,
          concept_embedding_1 TEXT,
          concept_embedding_2 TEXT,
          concept_embedding_3 TEXT,
          content_hash TEXT NOT NULL,
          branch TEXT,
          branch_diverged INTEGER NOT NULL DEFAULT 0,
          concepts_json TEXT NOT NULL DEFAULT '[]',
          is_exported INTEGER NOT NULL DEFAULT 0,
          observation_count INTEGER NOT NULL DEFAULT 0,
          pagerank_score REAL NOT NULL DEFAULT 0,
          centrality_score REAL NOT NULL DEFAULT 0,
          community_id TEXT,
          relevance_reasoning TEXT,
          probable_issue TEXT,
          sparse_embedding TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(project_id, file_path, name, chunk_type)
        );

        CREATE TABLE IF NOT EXISTS code_relationships (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          from_chunk_id TEXT NOT NULL,
          to_chunk_id TEXT NOT NULL,
          relationship_type TEXT NOT NULL,
          relationship_summary TEXT,
          relationship_embedding TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(from_chunk_id, to_chunk_id, relationship_type)
        );

        CREATE TABLE IF NOT EXISTS communities (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          label TEXT NOT NULL,
          summary TEXT,
          summary_embedding TEXT,
          member_count INTEGER NOT NULL DEFAULT 0,
          level INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(project_id, label)
        );

        CREATE TABLE IF NOT EXISTS retrieval_searches (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          user_id TEXT,
          query_text TEXT NOT NULL,
          mode TEXT NOT NULL,
          retrieved_chunk_ids_json TEXT NOT NULL DEFAULT '[]',
          query_embedding TEXT,
          variant TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS retrieval_feedback (
          id TEXT PRIMARY KEY,
          search_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          user_id TEXT,
          mode TEXT NOT NULL,
          selected_chunk_ids_json TEXT NOT NULL DEFAULT '[]',
          was_useful INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
          chunk_id UNINDEXED,
          file_path,
          name,
          signature,
          semantic_summary,
          summary_code,
          summary_purpose,
          concepts_text,
          tokenize='porter unicode61'
        );

        CREATE INDEX IF NOT EXISTS idx_file_cache_project_file ON file_cache(project_id, file_path);
        CREATE INDEX IF NOT EXISTS idx_chunks_project ON code_chunks(project_id);
        CREATE INDEX IF NOT EXISTS idx_chunks_project_file ON code_chunks(project_id, file_path);
        CREATE INDEX IF NOT EXISTS idx_chunks_project_type ON code_chunks(project_id, chunk_type);
        CREATE INDEX IF NOT EXISTS idx_chunks_content_hash
          ON code_chunks(project_id, file_path, name, chunk_type, content_hash);
        CREATE INDEX IF NOT EXISTS idx_chunks_community ON code_chunks(community_id);
        CREATE INDEX IF NOT EXISTS idx_chunks_pagerank ON code_chunks(project_id, pagerank_score DESC);
        CREATE INDEX IF NOT EXISTS idx_relationships_project ON code_relationships(project_id);
        CREATE INDEX IF NOT EXISTS idx_relationships_from ON code_relationships(from_chunk_id, relationship_type);
        CREATE INDEX IF NOT EXISTS idx_relationships_to ON code_relationships(to_chunk_id, relationship_type);
        CREATE INDEX IF NOT EXISTS idx_communities_project ON communities(project_id);
        """
    )
    _ensure_projects_local_columns(conn)


def _ensure_projects_local_columns(conn: sqlite3.Connection) -> None:
    # Keep this resilient for callers that may not set row_factory.
    existing = {
        str(row["name"] if isinstance(row, sqlite3.Row) else row[1])
        for row in conn.execute("PRAGMA table_info(projects_local)").fetchall()
    }
    if "embedding_model" not in existing:
        conn.execute("ALTER TABLE projects_local ADD COLUMN embedding_model TEXT")
    if "embedding_dimensions" not in existing:
        conn.execute("ALTER TABLE projects_local ADD COLUMN embedding_dimensions INTEGER")
    if "structure_embedding_dimensions" not in existing:
        conn.execute("ALTER TABLE projects_local ADD COLUMN structure_embedding_dimensions INTEGER")
    _ensure_code_chunks_columns(conn)


def _ensure_code_chunks_columns(conn: sqlite3.Connection) -> None:
    """Additive migrations for code_chunks — safe to call on every open."""
    existing = {
        str(row["name"] if isinstance(row, sqlite3.Row) else row[1])
        for row in conn.execute("PRAGMA table_info(code_chunks)").fetchall()
    }
    if "sparse_embedding" not in existing:
        conn.execute("ALTER TABLE code_chunks ADD COLUMN sparse_embedding TEXT")


def sync_project(project: dict | None) -> None:
    if not project or not project.get("id"):
        return
    project_id = str(project["id"])
    with connect(project_id) as conn:
        conn.execute(
            """
            INSERT INTO projects_local (
              id, user_id, name, local_path, default_branch, current_branch,
              index_status, last_indexed_at, project_summary, tech_stack_json, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
              user_id = excluded.user_id,
              name = excluded.name,
              local_path = excluded.local_path,
              default_branch = excluded.default_branch,
              current_branch = excluded.current_branch,
              index_status = excluded.index_status,
              last_indexed_at = excluded.last_indexed_at,
              project_summary = COALESCE(excluded.project_summary, projects_local.project_summary),
              tech_stack_json = COALESCE(excluded.tech_stack_json, projects_local.tech_stack_json),
              updated_at = datetime('now')
            """,
            (
                project_id,
                project.get("user_id"),
                project.get("name"),
                project.get("local_path"),
                project.get("default_branch") or "main",
                project.get("current_branch"),
                project.get("index_status") or "stale",
                project.get("last_indexed_at"),
                project.get("project_summary"),
                _json_dumps(project.get("tech_stack")) if project.get("tech_stack") is not None else None,
            ),
        )


def get_local_project(project_id: str) -> dict | None:
    with connect(project_id) as conn:
        row = conn.execute("SELECT * FROM projects_local WHERE id = ?", (project_id,)).fetchone()
    if not row:
        return None
    data = dict(row)
    data["tech_stack"] = _json_loads(data.pop("tech_stack_json", None), {})
    return data


def update_project_status(project_id: str, status: str, last_indexed_at: Optional[str] = None) -> None:
    with connect(project_id) as conn:
        conn.execute(
            """
            INSERT INTO projects_local (id, index_status, last_indexed_at, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
              index_status = excluded.index_status,
              last_indexed_at = COALESCE(excluded.last_indexed_at, projects_local.last_indexed_at),
              updated_at = datetime('now')
            """,
            (project_id, status, last_indexed_at),
        )


def update_project_summary(project_id: str, summary: str, tech_stack: dict | None = None) -> None:
    with connect(project_id) as conn:
        conn.execute(
            """
            INSERT INTO projects_local (id, project_summary, tech_stack_json, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
              project_summary = excluded.project_summary,
              tech_stack_json = COALESCE(excluded.tech_stack_json, projects_local.tech_stack_json),
              updated_at = datetime('now')
            """,
            (project_id, summary, _json_dumps(tech_stack) if tech_stack is not None else None),
        )


def update_project_embedding_config(
    project_id: str,
    embedding_model: str,
    embedding_dimensions: int,
    structure_embedding_dimensions: int,
) -> None:
    with connect(project_id) as conn:
        conn.execute(
            """
            INSERT INTO projects_local (
              id,
              embedding_model,
              embedding_dimensions,
              structure_embedding_dimensions,
              updated_at
            )
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
              embedding_model = excluded.embedding_model,
              embedding_dimensions = excluded.embedding_dimensions,
              structure_embedding_dimensions = excluded.structure_embedding_dimensions,
              updated_at = datetime('now')
            """,
            (
                project_id,
                embedding_model,
                int(embedding_dimensions),
                int(structure_embedding_dimensions),
            ),
        )


def get_project_embedding_config(project_id: str) -> dict | None:
    with connect(project_id) as conn:
        row = conn.execute(
            """
            SELECT embedding_model, embedding_dimensions, structure_embedding_dimensions
            FROM projects_local
            WHERE id = ?
            LIMIT 1
            """,
            (project_id,),
        ).fetchone()
    if not row:
        return None
    if row["embedding_model"] is None:
        return None
    return {
        "embedding_model": row["embedding_model"],
        "embedding_dimensions": int(row["embedding_dimensions"] or 0),
        "structure_embedding_dimensions": int(row["structure_embedding_dimensions"] or 0),
    }


def get_project_summary(project_id: str) -> Optional[str]:
    with connect(project_id) as conn:
        row = conn.execute("SELECT project_summary FROM projects_local WHERE id = ?", (project_id,)).fetchone()
    return row["project_summary"] if row and row["project_summary"] else None


def get_existing_chunk_hashes(project_id: str) -> dict[tuple[str, str, str], dict]:
    with connect(project_id) as conn:
        rows = conn.execute(
            "SELECT file_path, name, chunk_type, content_hash FROM code_chunks WHERE project_id = ?",
            (project_id,),
        ).fetchall()
    return {
        (row["file_path"], row["name"], row["chunk_type"]): dict(row)
        for row in rows
    }


def upsert_chunks_batch(chunks_data: list[dict], batch_size: int = 500) -> int:
    if not chunks_data:
        return 0
    project_id = str(chunks_data[0]["project_id"])
    processed = 0
    with connect(project_id) as conn:
        for row in chunks_data:
            chunk_id = str(row.get("id") or _chunk_id(row))
            concepts = row.get("concepts") or []
            conn.execute(
                """
                INSERT INTO code_chunks (
                  id, project_id, user_id, file_path, start_line, end_line, chunk_type,
                  scope_type, chunk_index, parent_scope_name, name, signature, language,
                  semantic_summary, summary_code, summary_purpose, embedding, embedding_summary,
                  embedding_structure, content_hash, branch, branch_diverged, concepts_json,
                  is_exported, sparse_embedding, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(project_id, file_path, name, chunk_type) DO UPDATE SET
                  user_id = excluded.user_id,
                  start_line = excluded.start_line,
                  end_line = excluded.end_line,
                  scope_type = excluded.scope_type,
                  chunk_index = excluded.chunk_index,
                  parent_scope_name = excluded.parent_scope_name,
                  signature = excluded.signature,
                  language = excluded.language,
                  semantic_summary = excluded.semantic_summary,
                  summary_code = excluded.summary_code,
                  summary_purpose = excluded.summary_purpose,
                  embedding = excluded.embedding,
                  embedding_summary = excluded.embedding_summary,
                  embedding_structure = excluded.embedding_structure,
                  content_hash = excluded.content_hash,
                  branch = excluded.branch,
                  branch_diverged = excluded.branch_diverged,
                  concepts_json = excluded.concepts_json,
                  is_exported = excluded.is_exported,
                  sparse_embedding = COALESCE(excluded.sparse_embedding, sparse_embedding),
                  updated_at = datetime('now')
                """,
                (
                    chunk_id,
                    row.get("project_id"),
                    row.get("user_id"),
                    row.get("file_path"),
                    int(row.get("start_line") or 1),
                    int(row.get("end_line") or row.get("start_line") or 1),
                    row.get("chunk_type"),
                    row.get("scope_type"),
                    row.get("chunk_index"),
                    row.get("parent_scope_name"),
                    row.get("name"),
                    row.get("signature"),
                    row.get("language"),
                    row.get("semantic_summary"),
                    row.get("summary_code"),
                    row.get("summary_purpose"),
                    _vec_dumps(row.get("embedding")),
                    _vec_dumps(row.get("embedding_summary")),
                    _vec_dumps(row.get("embedding_structure")),
                    row.get("content_hash"),
                    row.get("branch"),
                    1 if row.get("branch_diverged") else 0,
                    _json_dumps(concepts),
                    1 if row.get("is_exported") else 0,
                    row.get("sparse_embedding"),
                ),
            )
            _upsert_fts(conn, chunk_id, row, concepts)
            processed += 1
    logger.info("[LOCAL_STORE] Upserted %d chunks for project %s", processed, project_id)
    return processed


def cleanup_stale_chunks(project_id: str, valid_keys: set[tuple[str, str, str]]) -> int:
    with connect(project_id) as conn:
        rows = conn.execute(
            "SELECT id, file_path, name, chunk_type FROM code_chunks WHERE project_id = ?",
            (project_id,),
        ).fetchall()
        stale_ids = [
            row["id"] for row in rows
            if (row["file_path"], row["name"], row["chunk_type"]) not in valid_keys
        ]
        _delete_chunk_ids(conn, stale_ids)
    return len(stale_ids)


def cleanup_stale_chunks_for_files(
    project_id: str,
    file_paths: set[str],
    valid_keys: set[tuple[str, str, str]],
) -> int:
    if not file_paths:
        return 0
    placeholders = ",".join("?" for _ in file_paths)
    with connect(project_id) as conn:
        rows = conn.execute(
            f"""
            SELECT id, file_path, name, chunk_type
            FROM code_chunks
            WHERE project_id = ? AND file_path IN ({placeholders})
            """,
            (project_id, *list(file_paths)),
        ).fetchall()
        stale_ids = [
            row["id"] for row in rows
            if (row["file_path"], row["name"], row["chunk_type"]) not in valid_keys
        ]
        _delete_chunk_ids(conn, stale_ids)
    return len(stale_ids)


def delete_chunks_for_file(project_id: str, file_path: str) -> None:
    with connect(project_id) as conn:
        rows = conn.execute(
            "SELECT id FROM code_chunks WHERE project_id = ? AND file_path = ?",
            (project_id, file_path),
        ).fetchall()
        _delete_chunk_ids(conn, [row["id"] for row in rows])


def upsert_relationship(project_id: str, from_chunk_id: str, to_chunk_id: str, relationship_type: str):
    upsert_relationships_batch([{
        "project_id": project_id,
        "from_chunk_id": from_chunk_id,
        "to_chunk_id": to_chunk_id,
        "relationship_type": relationship_type,
    }])


def upsert_relationships_batch(rows: list[dict]) -> None:
    if not rows:
        return
    project_id = str(rows[0]["project_id"])
    with connect(project_id) as conn:
        for row in rows:
            rel_id = str(row.get("id") or _relationship_id(row))
            conn.execute(
                """
                INSERT INTO code_relationships (
                  id, project_id, from_chunk_id, to_chunk_id, relationship_type,
                  relationship_summary, relationship_embedding
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(from_chunk_id, to_chunk_id, relationship_type) DO UPDATE SET
                  relationship_summary = COALESCE(excluded.relationship_summary, code_relationships.relationship_summary),
                  relationship_embedding = COALESCE(excluded.relationship_embedding, code_relationships.relationship_embedding)
                """,
                (
                    rel_id,
                    row.get("project_id"),
                    row.get("from_chunk_id"),
                    row.get("to_chunk_id"),
                    row.get("relationship_type"),
                    row.get("relationship_summary"),
                    _vec_dumps(row.get("relationship_embedding")),
                ),
            )


def find_chunk_by_name(project_id: str, name: str, file_path: Optional[str] = None) -> Optional[dict]:
    with connect(project_id) as conn:
        if file_path:
            row = conn.execute(
                "SELECT id, name, file_path FROM code_chunks WHERE project_id = ? AND name = ? AND file_path = ? LIMIT 1",
                (project_id, name, file_path),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT id, name, file_path FROM code_chunks WHERE project_id = ? AND name = ? LIMIT 1",
                (project_id, name),
            ).fetchone()
    return dict(row) if row else None


def find_chunks_by_names(project_id: str, names: list[str]) -> dict[str, list[dict]]:
    if not names:
        return {}
    unique_names = list(dict.fromkeys(names))
    placeholders = ",".join("?" for _ in unique_names)
    with connect(project_id) as conn:
        rows = conn.execute(
            f"SELECT id, name, file_path FROM code_chunks WHERE project_id = ? AND name IN ({placeholders})",
            (project_id, *unique_names),
        ).fetchall()
    lookup: dict[str, list[dict]] = {}
    for row in rows:
        lookup.setdefault(row["name"], []).append(dict(row))
    return lookup


def find_chunks_by_file_paths(project_id: str, file_paths: list[str]) -> dict[str, list[dict]]:
    if not file_paths:
        return {}
    unique_paths = list(dict.fromkeys(file_paths))
    placeholders = ",".join("?" for _ in unique_paths)
    with connect(project_id) as conn:
        rows = conn.execute(
            f"""
            SELECT id, name, file_path, is_exported
            FROM code_chunks
            WHERE project_id = ? AND file_path IN ({placeholders})
            """,
            (project_id, *unique_paths),
        ).fetchall()
    lookup: dict[str, list[dict]] = {}
    for row in rows:
        item = dict(row)
        item["is_exported"] = bool(item.get("is_exported"))
        lookup.setdefault(item["file_path"], []).append(item)
    return lookup


def hydrate_chunks_by_ids(chunk_ids: list[str], project_id: str, user_id: Optional[str] = None) -> list[dict]:
    if not chunk_ids:
        return []
    placeholders = ",".join("?" for _ in chunk_ids)
    with connect(project_id) as conn:
        rows = conn.execute(
            f"SELECT * FROM code_chunks WHERE project_id = ? AND id IN ({placeholders})",
            (project_id, *chunk_ids),
        ).fetchall()
    by_id = {str(row["id"]): _row_to_chunk(dict(row), include_code=True) for row in rows}
    return [by_id[cid] for cid in chunk_ids if cid in by_id]


def get_chunk_structure_embeddings(
    chunk_ids: list[str],
    project_id: str,
    user_id: Optional[str] = None,
) -> dict[str, object]:
    if not chunk_ids:
        return {}
    placeholders = ",".join("?" for _ in chunk_ids)
    with connect(project_id) as conn:
        rows = conn.execute(
            f"SELECT id, embedding_structure FROM code_chunks WHERE project_id = ? AND id IN ({placeholders})",
            (project_id, *chunk_ids),
        ).fetchall()
    return {
        str(row["id"]): _vec_loads(row["embedding_structure"])
        for row in rows
        if row["embedding_structure"]
    }


def vector_search(
    project_id: str,
    user_id: str,
    query_embedding: list[float],
    limit: int = 10,
    branch: Optional[str] = None,
) -> list[dict]:
    rows = _all_searchable_chunks(project_id, branch, vector_columns=("embedding_summary", "embedding"))
    scored: list[dict] = []
    for row in rows:
        vec = _vec_loads(row.get("embedding_summary")) or _vec_loads(row.get("embedding"))
        if not vec:
            continue
        item = _row_to_chunk(row)
        sim = _cosine(query_embedding, vec)
        item["similarity"] = sim
        item["similarity_score"] = sim
        item["final_score"] = sim
        scored.append(item)
    scored.sort(key=lambda r: r.get("similarity", 0.0), reverse=True)
    return scored[:limit]


def concept_search(project_id: str, user_id: str, concepts: list[str], limit: int = 10) -> list[dict]:
    if not concepts:
        return []
    wanted = {c.lower() for c in concepts}
    rows = _all_searchable_chunks(project_id)
    scored: list[dict] = []
    for row in rows:
        row_concepts = _json_loads(row.get("concepts_json"), [])
        overlap = wanted.intersection({str(c).lower() for c in row_concepts})
        if not overlap:
            continue
        item = _row_to_chunk(row)
        score = len(overlap) / max(len(wanted), 1)
        item["similarity"] = score
        item["final_score"] = score
        scored.append(item)
    scored.sort(key=lambda r: (r.get("final_score", 0.0), r.get("pagerank_score", 0.0)), reverse=True)
    return scored[:limit]


def text_search(project_id: str, user_id: str, query: str, limit: int = 10) -> list[dict]:
    tokens = _fts_tokens(query)
    if not tokens:
        return []
    fts_query = " OR ".join(tokens[:12])
    with connect(project_id) as conn:
        try:
            rows = conn.execute(
                """
                SELECT c.*, bm25(chunks_fts) AS rank
                FROM chunks_fts
                JOIN code_chunks c ON c.id = chunks_fts.chunk_id
                WHERE c.project_id = ? AND chunks_fts MATCH ?
                ORDER BY rank
                LIMIT ?
                """,
                (project_id, fts_query, limit),
            ).fetchall()
        except sqlite3.OperationalError:
            like = f"%{query[:80]}%"
            rows = conn.execute(
                """
                SELECT *
                FROM code_chunks
                WHERE project_id = ?
                  AND (name LIKE ? OR signature LIKE ? OR semantic_summary LIKE ? OR summary_code LIKE ? OR file_path LIKE ?)
                LIMIT ?
                """,
                (project_id, like, like, like, like, like, limit),
            ).fetchall()
    results = []
    for row in rows:
        item = _row_to_chunk(dict(row))
        rank = abs(float(row["rank"])) if "rank" in row.keys() and row["rank"] is not None else 1.0
        item["similarity"] = 1.0 / (1.0 + rank)
        item["final_score"] = item["similarity"]
        results.append(item)
    return results


def sparse_search(
    project_id: str,
    user_id: str,
    query_sparse_vec: dict[str, float],
    limit: int = 10,
) -> list[dict]:
    """
    SPLADE sparse-vector search: dot-product of query and document sparse vectors.

    Loads all rows with a non-null sparse_embedding for the project, deserializes
    each JSON sparse vector, computes the dot product with the query vector, and
    returns the top-k by score.

    Returns an empty list when no rows have sparse embeddings populated yet
    (allows callers to fall back to FTS5 text_search transparently).
    """
    if not query_sparse_vec:
        return []
    with connect(project_id) as conn:
        rows = conn.execute(
            "SELECT * FROM code_chunks WHERE project_id = ? AND sparse_embedding IS NOT NULL",
            (project_id,),
        ).fetchall()
    if not rows:
        return []

    scored: list[dict] = []
    for row in rows:
        raw = row["sparse_embedding"] if isinstance(row, sqlite3.Row) else dict(row).get("sparse_embedding")
        doc_vec = _json_loads(raw, {})
        if not doc_vec:
            continue
        score = 0.0
        for token, q_w in query_sparse_vec.items():
            d_w = doc_vec.get(token)
            if d_w:
                score += q_w * d_w
        if score <= 0.0:
            continue
        item = _row_to_chunk(dict(row))
        item["similarity"] = score
        item["final_score"] = score
        scored.append(item)

    scored.sort(key=lambda r: r.get("final_score", 0.0), reverse=True)
    return scored[:limit]


def get_chunks_source(project_id: str, chunk_ids: list[str]) -> list[dict]:
    """
    Fetch full source columns for a list of chunk IDs within a project.
    Used by the /api/chunks/expand endpoint to return code bodies on demand
    without sending them by default in every retrieval response.
    """
    if not chunk_ids:
        return []
    placeholders = ",".join("?" for _ in chunk_ids)
    with connect(project_id) as conn:
        rows = conn.execute(
            f"""
            SELECT id, file_path, start_line, end_line, name,
                   code_body, context_header
            FROM code_chunks
            WHERE id IN ({placeholders}) AND project_id = ?
            """,
            (*chunk_ids, project_id),
        ).fetchall()
    return [dict(row) for row in rows]


def file_path_search(project_id: str, user_id: str, file_patterns: list[str], limit: int = 20) -> list[dict]:
    if not file_patterns:
        return []
    rows = _all_searchable_chunks(project_id)
    normalized_patterns = [_normalize_pattern(p) for p in file_patterns if p]
    results: list[dict] = []
    seen: set[str] = set()
    for row in rows:
        path = str(row.get("file_path") or "")
        path_lower = path.lower()
        for pattern in normalized_patterns:
            if fnmatch.fnmatch(path_lower, pattern) or pattern.strip("*") in path_lower:
                if row["id"] not in seen:
                    item = _row_to_chunk(row)
                    item["similarity"] = 1.0
                    item["final_score"] = 1.0
                    results.append(item)
                    seen.add(row["id"])
                break
        if len(results) >= limit:
            break
    return results


def get_related_chunks(chunk_ids: list[str], project_id: str) -> list[dict]:
    if not chunk_ids:
        return []
    placeholders = ",".join("?" for _ in chunk_ids)
    with connect(project_id) as conn:
        edges = conn.execute(
            f"""
            SELECT to_chunk_id AS id, relationship_type
            FROM code_relationships
            WHERE project_id = ? AND from_chunk_id IN ({placeholders})
            UNION ALL
            SELECT from_chunk_id AS id, relationship_type
            FROM code_relationships
            WHERE project_id = ? AND to_chunk_id IN ({placeholders})
            """,
            (project_id, *chunk_ids, project_id, *chunk_ids),
        ).fetchall()
        best_edge: dict[str, str] = {}
        for edge in edges:
            cid = edge["id"]
            rtype = edge["relationship_type"]
            if cid not in chunk_ids and cid not in best_edge:
                best_edge[cid] = rtype
        if not best_edge:
            return []
        ids = list(best_edge.keys())
        id_placeholders = ",".join("?" for _ in ids)
        rows = conn.execute(
            f"SELECT * FROM code_chunks WHERE id IN ({id_placeholders})",
            ids,
        ).fetchall()
    chunks = [_row_to_chunk(dict(row), include_code=True) for row in rows]
    for chunk in chunks:
        chunk["_edge_type"] = best_edge.get(chunk["id"], "imports")
    return chunks


EDGE_WEIGHTS = {
    "calls": 3,
    "imports": 2,
    "parent_of": 2,
    "child_of": 2,
    "sibling_next": 1,
    "inherits": 1,
    "implements": 1,
}


def get_related_chunks_multihop(
    chunk_ids: list[str],
    project_id: str,
    max_depth: int = 2,
    max_total: int = 20,
) -> list[dict]:
    visited: set[str] = set(chunk_ids)
    frontier: list[str] = list(chunk_ids)
    related: list[dict] = []
    for depth in range(1, max_depth + 1):
        if not frontier or len(related) >= max_total:
            break
        neighbors = get_related_chunks(frontier, project_id)
        neighbors.sort(key=lambda n: EDGE_WEIGHTS.get(n.get("_edge_type", ""), 0), reverse=True)
        new_frontier: list[str] = []
        for neighbor in neighbors:
            if neighbor["id"] in visited:
                continue
            visited.add(neighbor["id"])
            neighbor["graph_depth"] = depth
            related.append(neighbor)
            new_frontier.append(neighbor["id"])
            if len(related) >= max_total:
                break
        frontier = new_frontier
    return related


def increment_observation_counts(chunk_ids: list[str]) -> None:
    if not chunk_ids:
        return
    # Chunk IDs are deterministic per project but this function receives IDs only.
    # Update by scanning project DBs is intentionally avoided; callers don't need
    # observation tracking for correctness.


def get_branch_context(project_id: str, branch: Optional[str] = None) -> Optional[dict]:
    project = get_local_project(project_id)
    if not project:
        return None
    return {
        "current_branch": project.get("current_branch") or branch,
        "default_branch": project.get("default_branch") or "main",
    }


def upsert_branch(project_id: str, branch: str, commit_sha: Optional[str] = None) -> None:
    with connect(project_id) as conn:
        conn.execute(
            """
            INSERT INTO projects_local (id, current_branch, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET current_branch = excluded.current_branch, updated_at = datetime('now')
            """,
            (project_id, branch),
        )


def flag_diverged_chunks(project_id: str, file_paths: list[str]):
    if not file_paths:
        return
    placeholders = ",".join("?" for _ in file_paths)
    with connect(project_id) as conn:
        conn.execute(
            f"UPDATE code_chunks SET branch_diverged = 1 WHERE project_id = ? AND file_path IN ({placeholders})",
            (project_id, *file_paths),
        )


def upsert_communities(project_id: str, community_rows: list[dict]) -> dict[str, str]:
    if not community_rows:
        return {}
    label_to_id: dict[str, str] = {}
    with connect(project_id) as conn:
        for row in community_rows:
            label = row.get("label")
            if not label:
                continue
            community_id = str(row.get("id") or uuid.uuid5(uuid.NAMESPACE_URL, f"prmpt-community:{project_id}:{label}"))
            conn.execute(
                """
                INSERT INTO communities (id, project_id, label, summary, summary_embedding, member_count, level, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(project_id, label) DO UPDATE SET
                  id = excluded.id,
                  summary = excluded.summary,
                  summary_embedding = excluded.summary_embedding,
                  member_count = excluded.member_count,
                  level = excluded.level,
                  updated_at = datetime('now')
                """,
                (
                    community_id,
                    project_id,
                    label,
                    row.get("summary"),
                    _vec_dumps(row.get("summary_embedding")),
                    int(row.get("member_count") or 0),
                    int(row.get("level") or 0),
                ),
            )
            label_to_id[label] = community_id
    return label_to_id


def get_all_project_chunk_ids(project_id: str) -> list[dict]:
    with connect(project_id) as conn:
        rows = conn.execute(
            "SELECT id, name, file_path, chunk_type, summary_code, semantic_summary FROM code_chunks WHERE project_id = ?",
            (project_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def get_all_project_relationships(project_id: str) -> list[dict]:
    with connect(project_id) as conn:
        rows = conn.execute(
            "SELECT id, from_chunk_id, to_chunk_id, relationship_type FROM code_relationships WHERE project_id = ?",
            (project_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def list_community_reports(project_id: str, limit: int = 20) -> list[dict]:
    with connect(project_id) as conn:
        rows = conn.execute(
            """
            SELECT id, label, summary, member_count, level
            FROM communities
            WHERE project_id = ?
            ORDER BY member_count DESC, updated_at DESC
            LIMIT ?
            """,
            (project_id, limit),
        ).fetchall()
    reports = [dict(row) for row in rows]
    for report in reports:
        report["similarity"] = 0.0
    return reports


def list_top_pagerank_chunks(project_id: str, limit: int = 50) -> list[dict]:
    with connect(project_id) as conn:
        rows = conn.execute(
            """
            SELECT id, file_path, name, chunk_type, pagerank_score, centrality_score, community_id
            FROM code_chunks
            WHERE project_id = ?
            ORDER BY pagerank_score DESC
            LIMIT ?
            """,
            (project_id, limit),
        ).fetchall()
    return [dict(row) for row in rows]


def get_graph_health(project_id: str) -> dict:
    """Lightweight graph-health snapshot for diagnostics / project status.

    Surfaces the signals Find ranking depends on: edge population, PageRank
    spread, centrality, and community count.
    """
    with connect(project_id) as conn:
        def _scalar(sql: str, default=0):
            try:
                row = conn.execute(sql, (project_id,)).fetchone()
                val = row[0] if row else None
                return val if val is not None else default
            except Exception:
                return default

        chunks = _scalar("SELECT COUNT(*) FROM code_chunks WHERE project_id = ?")
        edges = _scalar("SELECT COUNT(*) FROM code_relationships WHERE project_id = ?")
        pr_nonzero = _scalar(
            "SELECT COUNT(*) FROM code_chunks WHERE project_id = ? AND pagerank_score > 0"
        )
        pr_max = _scalar(
            "SELECT MAX(pagerank_score) FROM code_chunks WHERE project_id = ?", 0.0
        )
        cen_nonzero = _scalar(
            "SELECT COUNT(*) FROM code_chunks WHERE project_id = ? AND centrality_score > 0"
        )
        communities = _scalar(
            "SELECT COUNT(DISTINCT community_id) FROM code_chunks "
            "WHERE project_id = ? AND community_id IS NOT NULL"
        )
        rel_types: dict[str, int] = {}
        try:
            for r in conn.execute(
                "SELECT relationship_type, COUNT(*) FROM code_relationships "
                "WHERE project_id = ? GROUP BY relationship_type",
                (project_id,),
            ).fetchall():
                rel_types[str(r[0])] = int(r[1])
        except Exception:
            pass

    return {
        "project_id": project_id,
        "chunks": int(chunks),
        "edges": int(edges),
        "edge_types": rel_types,
        "edges_per_node": round(int(edges) / max(int(chunks), 1), 3),
        "pagerank_nonzero": int(pr_nonzero),
        "pagerank_max": float(pr_max or 0.0),
        "centrality_nonzero": int(cen_nonzero),
        "communities": int(communities),
        "healthy": int(edges) > 0 and float(pr_max or 0.0) > 0.0,
    }


_AGENT_CHUNK_COLS = (
    "id, file_path, name, chunk_type, signature, start_line, end_line, "
    "pagerank_score, summary_code"
)
_AGENT_CHUNK_COLS_C = (
    "c.id, c.file_path, c.name, c.chunk_type, c.signature, c.start_line, "
    "c.end_line, c.pagerank_score, c.summary_code"
)


def find_definitions(project_id: str, symbol: str, limit: int = 5) -> list[dict]:
    """Chunks whose own name defines `symbol` (exact, then suffix on dotted)."""
    sym = (symbol or "").strip()
    if not sym:
        return []
    short = sym.split(".")[-1]
    with connect(project_id) as conn:
        rows = conn.execute(
            f"""
            SELECT {_AGENT_CHUNK_COLS} FROM code_chunks
            WHERE project_id = ? AND (name = ? OR name = ?)
            ORDER BY pagerank_score DESC
            LIMIT ?
            """,
            (project_id, sym, short, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def get_callers(project_id: str, chunk_id: str, limit: int = 15) -> list[dict]:
    """Chunks with an incoming edge into `chunk_id` (who calls/imports it)."""
    with connect(project_id) as conn:
        rows = conn.execute(
            f"""
            SELECT {_AGENT_CHUNK_COLS_C}, r.relationship_type AS edge
            FROM code_relationships r
            JOIN code_chunks c ON c.id = r.from_chunk_id
            WHERE r.project_id = ? AND r.to_chunk_id = ?
            ORDER BY c.pagerank_score DESC
            LIMIT ?
            """,
            (project_id, chunk_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def get_callees(project_id: str, chunk_id: str, limit: int = 15) -> list[dict]:
    """Chunks `chunk_id` points to (what it calls/imports)."""
    with connect(project_id) as conn:
        rows = conn.execute(
            f"""
            SELECT {_AGENT_CHUNK_COLS_C}, r.relationship_type AS edge
            FROM code_relationships r
            JOIN code_chunks c ON c.id = r.to_chunk_id
            WHERE r.project_id = ? AND r.from_chunk_id = ?
            ORDER BY c.pagerank_score DESC
            LIMIT ?
            """,
            (project_id, chunk_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def update_chunks_graph_data(chunk_graph_rows: list[dict], batch_size: int = 50) -> int:
    if not chunk_graph_rows:
        return 0
    processed = 0
    # Rows belong to one project but may not include project_id in older graph code.
    project_ids = {row.get("project_id") for row in chunk_graph_rows if row.get("project_id")}
    if not project_ids:
        project_ids = _project_ids_containing_chunks([str(row.get("id")) for row in chunk_graph_rows if row.get("id")])
    for project_id in project_ids:
        if not project_id:
            continue
        with connect(str(project_id)) as conn:
            for row in chunk_graph_rows:
                chunk_id = str(row.get("id") or "")
                if not chunk_id:
                    continue
                cur = conn.execute(
                    """
                    UPDATE code_chunks
                    SET pagerank_score = ?,
                        centrality_score = ?,
                        community_id = COALESCE(?, community_id),
                        concept_embedding_1 = COALESCE(?, concept_embedding_1),
                        concept_embedding_2 = COALESCE(?, concept_embedding_2),
                        concept_embedding_3 = COALESCE(?, concept_embedding_3),
                        updated_at = datetime('now')
                    WHERE id = ?
                    """,
                    (
                        float(row.get("pagerank_score") or 0.0),
                        float(row.get("centrality_score") or 0.0),
                        row.get("community_id"),
                        _vec_dumps(row.get("concept_embedding_1")),
                        _vec_dumps(row.get("concept_embedding_2")),
                        _vec_dumps(row.get("concept_embedding_3")),
                        chunk_id,
                    ),
                )
                processed += cur.rowcount
    return processed


def update_relationship_embeddings(rel_rows: list[dict], batch_size: int = 50) -> int:
    if not rel_rows:
        return 0
    processed = 0
    project_id = str(rel_rows[0].get("project_id") or "")
    if not project_id:
        return 0
    with connect(project_id) as conn:
        for row in rel_rows:
            cur = conn.execute(
                """
                UPDATE code_relationships
                SET relationship_summary = ?, relationship_embedding = ?
                WHERE from_chunk_id = ? AND to_chunk_id = ? AND relationship_type = ?
                """,
                (
                    row.get("relationship_summary"),
                    _vec_dumps(row.get("relationship_embedding")),
                    row.get("from_chunk_id"),
                    row.get("to_chunk_id"),
                    row.get("relationship_type"),
                ),
            )
            processed += cur.rowcount
    return processed


def match_community_reports(project_id: str, query_embedding: list[float], match_count: int = 5) -> list[dict]:
    with connect(project_id) as conn:
        rows = conn.execute("SELECT * FROM communities WHERE project_id = ?", (project_id,)).fetchall()
    scored = []
    for row in rows:
        vec = _vec_loads(row["summary_embedding"])
        if not vec:
            continue
        item = dict(row)
        item["similarity"] = _cosine(query_embedding, vec)
        scored.append(item)
    scored.sort(key=lambda r: r.get("similarity", 0.0), reverse=True)
    return scored[:match_count]


def match_concept_embeddings(project_id: str, query_embedding: list[float], match_count: int = 20) -> list[dict]:
    rows = _all_searchable_chunks(project_id, vector_columns=("concept_embedding_1", "concept_embedding_2", "concept_embedding_3"))
    scored = []
    for row in rows:
        best = 0.0
        for col in ("concept_embedding_1", "concept_embedding_2", "concept_embedding_3"):
            vec = _vec_loads(row.get(col))
            if vec:
                best = max(best, _cosine(query_embedding, vec))
        if best > 0:
            item = _row_to_chunk(row)
            item["concept_similarity"] = best
            item["final_score"] = best
            scored.append(item)
    scored.sort(key=lambda r: r.get("concept_similarity", 0.0), reverse=True)
    return scored[:match_count]


def get_community_members_ranked(community_id: str, limit: int = 20) -> list[dict]:
    # Community ID is globally deterministic enough to search across local project DBs.
    results: list[dict] = []
    for db_path in (get_db_root() / "projects").glob("*/index.db"):
        project_id = db_path.parent.name
        with connect(project_id) as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM code_chunks
                WHERE community_id = ?
                ORDER BY pagerank_score DESC
                LIMIT ?
                """,
                (community_id, limit),
            ).fetchall()
        results.extend(_row_to_chunk(dict(row), include_code=True) for row in rows)
    results.sort(key=lambda r: r.get("pagerank_score", 0.0), reverse=True)
    return results[:limit]


def record_search(
    project_id: str,
    user_id: str,
    query_text: str,
    mode: str,
    retrieved_chunk_ids: list[str],
    query_embedding: list[float] | None = None,
    variant: str | None = None,
) -> str:
    search_id = str(uuid.uuid4())
    with connect(project_id) as conn:
        conn.execute(
            """
            INSERT INTO retrieval_searches (
              id, project_id, user_id, query_text, mode, retrieved_chunk_ids_json,
              query_embedding, variant
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                search_id,
                project_id,
                user_id,
                query_text,
                mode,
                _json_dumps(retrieved_chunk_ids),
                _vec_dumps(query_embedding),
                variant,
            ),
        )
    return search_id


def record_feedback(
    search_id: str,
    project_id: str,
    user_id: str,
    mode: str,
    selected_chunk_ids: list[str],
    was_useful: bool | None,
) -> None:
    with connect(project_id) as conn:
        conn.execute(
            """
            INSERT INTO retrieval_feedback (
              id, search_id, project_id, user_id, mode, selected_chunk_ids_json, was_useful
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid.uuid4()),
                search_id,
                project_id,
                user_id,
                mode,
                _json_dumps(selected_chunk_ids),
                None if was_useful is None else int(bool(was_useful)),
            ),
        )


def get_searches_by_variant(project_id: str, user_id: str, variant: str, limit: int) -> list[dict]:
    with connect(project_id) as conn:
        rows = conn.execute(
            """
            SELECT id, query_text, mode, retrieved_chunk_ids_json, created_at
            FROM retrieval_searches
            WHERE project_id = ? AND user_id = ? AND variant = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (project_id, user_id, variant, limit),
        ).fetchall()
    results = []
    for row in rows:
        item = dict(row)
        item["retrieved_chunk_ids"] = _json_loads(item.pop("retrieved_chunk_ids_json", None), [])
        return_item = {
            "id": item["id"],
            "query_text": item["query_text"],
            "mode": item["mode"],
            "retrieved_chunk_ids": item["retrieved_chunk_ids"],
            "created_at": item["created_at"],
        }
        results.append(return_item)
    return results


def _all_searchable_chunks(
    project_id: str,
    branch: Optional[str] = None,
    vector_columns: tuple[str, ...] = (),
) -> list[dict]:
    with connect(project_id) as conn:
        if branch:
            rows = conn.execute(
                "SELECT * FROM code_chunks WHERE project_id = ? AND (branch = ? OR branch IS NULL)",
                (project_id, branch),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM code_chunks WHERE project_id = ?", (project_id,)).fetchall()
    return [dict(row) for row in rows]


def _upsert_fts(conn: sqlite3.Connection, chunk_id: str, row: dict, concepts: list[str]) -> None:
    conn.execute("DELETE FROM chunks_fts WHERE chunk_id = ?", (chunk_id,))
    conn.execute(
        """
        INSERT INTO chunks_fts (
          chunk_id, file_path, name, signature, semantic_summary,
          summary_code, summary_purpose, concepts_text
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            chunk_id,
            row.get("file_path") or "",
            row.get("name") or "",
            row.get("signature") or "",
            row.get("semantic_summary") or "",
            row.get("summary_code") or "",
            row.get("summary_purpose") or "",
            " ".join(concepts or []),
        ),
    )


def _delete_chunk_ids(conn: sqlite3.Connection, chunk_ids: Iterable[str]) -> None:
    ids = [str(cid) for cid in chunk_ids if cid]
    if not ids:
        return
    placeholders = ",".join("?" for _ in ids)
    conn.execute(f"DELETE FROM chunks_fts WHERE chunk_id IN ({placeholders})", ids)
    conn.execute(f"DELETE FROM code_relationships WHERE from_chunk_id IN ({placeholders})", ids)
    conn.execute(f"DELETE FROM code_relationships WHERE to_chunk_id IN ({placeholders})", ids)
    conn.execute(f"DELETE FROM code_chunks WHERE id IN ({placeholders})", ids)


def _row_to_chunk(row: dict, include_code: bool = False) -> dict:
    item = {
        **row,
        "concepts": _json_loads(row.get("concepts_json"), []),
        "branch_diverged": bool(row.get("branch_diverged")),
        "is_exported": bool(row.get("is_exported")),
    }
    item.pop("concepts_json", None)
    for key in (
        "embedding",
        "embedding_summary",
        "embedding_structure",
        "concept_embedding_1",
        "concept_embedding_2",
        "concept_embedding_3",
    ):
        if key in item:
            item.pop(key, None)
    if include_code:
        item["code_body"] = _read_code_slice(
            str(row.get("project_id")),
            str(row.get("file_path")),
            int(row.get("start_line") or 1),
            int(row.get("end_line") or row.get("start_line") or 1),
        )
    return item


def _read_code_slice(project_id: str, file_path: str, start_line: int, end_line: int) -> str | None:
    project = get_local_project(project_id)
    root = project.get("local_path") if project else None
    if not root:
        return None
    abs_path = Path(root) / file_path
    try:
        text = abs_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    lines = text.splitlines()
    start = max(start_line - 1, 0)
    end = min(max(end_line, start_line), len(lines))
    return "\n".join(lines[start:end])[:5000]


def _chunk_id(row: dict) -> uuid.UUID:
    key = f"{row.get('project_id')}:{row.get('file_path')}:{row.get('name')}:{row.get('chunk_type')}"
    return uuid.uuid5(uuid.NAMESPACE_URL, f"prmpt-chunk:{key}")


def _relationship_id(row: dict) -> uuid.UUID:
    key = f"{row.get('project_id')}:{row.get('from_chunk_id')}:{row.get('to_chunk_id')}:{row.get('relationship_type')}"
    return uuid.uuid5(uuid.NAMESPACE_URL, f"prmpt-relationship:{key}")


def _json_dumps(value) -> str:
    return json.dumps(value if value is not None else [], separators=(",", ":"))


def _json_loads(value, default):
    if value is None:
        return default
    if isinstance(value, (list, dict)):
        return value
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default


def _vec_dumps(value) -> str | None:
    if value is None:
        return None
    try:
        return json.dumps([float(x) for x in value], separators=(",", ":"))
    except (TypeError, ValueError):
        return None


def _vec_loads(value) -> list[float] | None:
    if not value:
        return None
    if isinstance(value, list):
        return value
    try:
        data = json.loads(value)
        return [float(x) for x in data]
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    try:
        av = np.asarray(a, dtype=np.float32)
        bv = np.asarray(b, dtype=np.float32)
        if av.shape[0] != bv.shape[0]:
            size = min(av.shape[0], bv.shape[0], EMBEDDING_DIMENSIONS)
            av = av[:size]
            bv = bv[:size]
        denom = float(np.linalg.norm(av) * np.linalg.norm(bv))
        if denom == 0:
            return 0.0
        return float(np.dot(av, bv) / denom)
    except Exception:
        return 0.0


def _fts_tokens(query: str) -> list[str]:
    return [token for token in (t.lower() for t in _TOKEN_RE.findall(query)) if len(token) > 1]


def _normalize_pattern(pattern: str) -> str:
    p = pattern.replace("\\", "/").replace("%", "*").lower()
    if "*" not in p:
        p = f"*{p}*"
    return p


def _project_ids_containing_chunks(chunk_ids: list[str]) -> set[str]:
    ids = set(chunk_ids)
    found: set[str] = set()
    if not ids:
        return found
    root = get_db_root() / "projects"
    if not root.exists():
        return found
    for db_path in root.glob("*/index.db"):
        project_id = db_path.parent.name
        with connect(project_id) as conn:
            placeholders = ",".join("?" for _ in ids)
            rows = conn.execute(
                f"SELECT project_id FROM code_chunks WHERE id IN ({placeholders}) LIMIT 1",
                tuple(ids),
            ).fetchall()
        for row in rows:
            found.add(str(row["project_id"]))
    return found


_TOKEN_RE = __import__("re").compile(r"[A-Za-z0-9_./-]+")
