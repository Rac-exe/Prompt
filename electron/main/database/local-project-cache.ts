/**
 * Local SQLite cache for project file metadata.
 * Stores content hashes to avoid re-parsing and re-sending unchanged files.
 * Uses better-sqlite3 for synchronous, fast local storage.
 */

import * as path from 'path';
import { app } from 'electron';

let Database: any;
let db: any = null;

function getDb(): any {
  if (db) return db;

  try {
    Database = require('better-sqlite3');
  } catch {
    console.warn('[ProjectCache] better-sqlite3 not available — cache disabled');
    return null;
  }

  const dbPath = path.join(app.getPath('userData'), 'project-cache.db');
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_cache (
      project_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      last_parsed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project_id, file_path)
    )
  `);

  return db;
}

export function getCachedHash(projectId: string, filePath: string): string | null {
  const database = getDb();
  if (!database) return null;

  const row = database
    .prepare('SELECT content_hash FROM file_cache WHERE project_id = ? AND file_path = ?')
    .get(projectId, filePath);

  return row?.content_hash ?? null;
}

export function setCachedHash(
  projectId: string,
  filePath: string,
  contentHash: string,
  chunkCount: number,
): void {
  const database = getDb();
  if (!database) return;

  database
    .prepare(
      `INSERT INTO file_cache (project_id, file_path, content_hash, chunk_count, last_parsed_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(project_id, file_path) DO UPDATE SET
         content_hash = excluded.content_hash,
         chunk_count = excluded.chunk_count,
         last_parsed_at = datetime('now')`,
    )
    .run(projectId, filePath, contentHash, chunkCount);
}

export function clearProjectCache(projectId: string): void {
  const database = getDb();
  if (!database) return;

  database.prepare('DELETE FROM file_cache WHERE project_id = ?').run(projectId);
}

export function clearFileCache(projectId: string, filePath: string): void {
  const database = getDb();
  if (!database) return;

  database
    .prepare('DELETE FROM file_cache WHERE project_id = ? AND file_path = ?')
    .run(projectId, filePath);
}

export function getProjectFileCount(projectId: string): number {
  const database = getDb();
  if (!database) return 0;

  const row = database
    .prepare('SELECT COUNT(*) as count FROM file_cache WHERE project_id = ?')
    .get(projectId);

  return row?.count ?? 0;
}
