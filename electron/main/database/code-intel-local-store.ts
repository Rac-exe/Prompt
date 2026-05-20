/**
 * Local code-intelligence SQLite storage.
 *
 * Phase 1 keeps source text out of SQLite. The DB stores index metadata,
 * embeddings, summaries, relationships, graph scores, and the file hash cache.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import * as Sentry from '@sentry/electron/main';

let Database: any;
const openDbs: Map<string, any> = new Map();

export const CODE_INTEL_SCHEMA_VERSION = 1;

function loadDatabase(): any | null {
  if (Database) return Database;
  try {
    Database = require('better-sqlite3');
    return Database;
  } catch (err) {
    console.warn('[CodeIntelStore] better-sqlite3 not available — local index disabled');
    Sentry.captureException(err, {
      level: 'warning',
      tags: { component: 'code-intel-store', op: 'load-sqlite' },
    });
    return null;
  }
}

export function getCodeIntelRoot(): string {
  return path.join(app.getPath('userData'), 'code-intel');
}

export function getProjectIndexDir(projectId: string): string {
  return path.join(getCodeIntelRoot(), 'projects', projectId);
}

export function getProjectIndexPath(projectId: string): string {
  return path.join(getProjectIndexDir(projectId), 'index.db');
}

export function getProjectIndexDb(projectId: string): any | null {
  const existing = openDbs.get(projectId);
  if (existing) return existing;

  const Db = loadDatabase();
  if (!Db) return null;

  try {
    const dbDir = getProjectIndexDir(projectId);
    fs.mkdirSync(dbDir, { recursive: true });

    const db = new Db(getProjectIndexPath(projectId));
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -8000');
    db.pragma('temp_store = MEMORY');
    db.pragma('busy_timeout = 5000');
    db.pragma('mmap_size = 268435456');
    ensureSchema(db);
    openDbs.set(projectId, db);
    return db;
  } catch (err) {
    console.warn(`[CodeIntelStore] Failed to open local index for ${projectId}:`, err);
    Sentry.captureException(err, {
      level: 'warning',
      tags: { component: 'code-intel-store', op: 'open-project-db' },
      extra: { projectId },
    });
    return null;
  }
}

export function closeProjectIndexDb(projectId: string): void {
  const db = openDbs.get(projectId);
  if (!db) return;
  try {
    db.close();
  } catch (err) {
    Sentry.captureException(err, {
      level: 'warning',
      tags: { component: 'code-intel-store', op: 'close-project-db' },
      extra: { projectId },
    });
  } finally {
    openDbs.delete(projectId);
  }
}

export function deleteProjectIndex(projectId: string): void {
  closeProjectIndexDb(projectId);
  const dir = getProjectIndexDir(projectId);
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

export function clearProjectIndexData(projectId: string): void {
  const db = getProjectIndexDb(projectId);
  if (!db) return;
  const clear = db.transaction(() => {
    db.prepare('DELETE FROM chunks_fts').run();
    db.prepare('DELETE FROM code_relationships').run();
    db.prepare('DELETE FROM communities').run();
    db.prepare('DELETE FROM retrieval_searches').run();
    db.prepare('DELETE FROM retrieval_feedback').run();
    db.prepare('DELETE FROM code_chunks').run();
    db.prepare('DELETE FROM file_cache WHERE project_id = ?').run(projectId);
  });
  clear();
}

function ensureSchema(db: any): void {
  db.exec(`
    PRAGMA user_version = ${CODE_INTEL_SCHEMA_VERSION};

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

    CREATE INDEX IF NOT EXISTS idx_file_cache_project_file
      ON file_cache(project_id, file_path);
    CREATE INDEX IF NOT EXISTS idx_chunks_project
      ON code_chunks(project_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_project_file
      ON code_chunks(project_id, file_path);
    CREATE INDEX IF NOT EXISTS idx_chunks_project_type
      ON code_chunks(project_id, chunk_type);
    CREATE INDEX IF NOT EXISTS idx_chunks_content_hash
      ON code_chunks(project_id, file_path, name, chunk_type, content_hash);
    CREATE INDEX IF NOT EXISTS idx_chunks_community
      ON code_chunks(community_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_pagerank
      ON code_chunks(project_id, pagerank_score DESC);
    CREATE INDEX IF NOT EXISTS idx_relationships_project
      ON code_relationships(project_id);
    CREATE INDEX IF NOT EXISTS idx_relationships_from
      ON code_relationships(from_chunk_id, relationship_type);
    CREATE INDEX IF NOT EXISTS idx_relationships_to
      ON code_relationships(to_chunk_id, relationship_type);
    CREATE INDEX IF NOT EXISTS idx_communities_project
      ON communities(project_id);
  `);
}
