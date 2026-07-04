/**
 * Local SQLite cache for project file metadata.
 * Stores content hashes inside each project's code-intel index.db so the
 * filesystem freshness cache and local retrieval index share one lifecycle.
 */

import * as Sentry from '@sentry/electron/main';
import { getProjectIndexDb } from './code-intel-local-store';

export function getCachedHash(projectId: string, filePath: string): string | null {
  const database = getProjectIndexDb(projectId);
  if (!database) return null;

  try {
    const row = database
      .prepare('SELECT content_hash FROM file_cache WHERE project_id = ? AND file_path = ?')
      .get(projectId, filePath);

    return row?.content_hash ?? null;
  } catch (err) {
    Sentry.captureException(err, {
      level: 'warning',
      tags: { component: 'project-cache', op: 'getCachedHash' },
      extra: { projectId, filePath },
    });
    return null;
  }
}

export function setCachedHash(
  projectId: string,
  filePath: string,
  contentHash: string,
  chunkCount: number,
): void {
  const database = getProjectIndexDb(projectId);
  if (!database) return;

  try {
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
  } catch (err) {
    Sentry.captureException(err, {
      level: 'warning',
      tags: { component: 'project-cache', op: 'setCachedHash' },
      extra: { projectId, filePath },
    });
  }
}

export function clearProjectCache(projectId: string): void {
  const database = getProjectIndexDb(projectId);
  if (!database) return;

  try {
    database.prepare('DELETE FROM file_cache WHERE project_id = ?').run(projectId);
  } catch (err) {
    Sentry.captureException(err, {
      level: 'warning',
      tags: { component: 'project-cache', op: 'clearProjectCache' },
      extra: { projectId },
    });
  }
}

export function clearFileCache(projectId: string, filePath: string): void {
  const database = getProjectIndexDb(projectId);
  if (!database) return;

  try {
    database
      .prepare('DELETE FROM file_cache WHERE project_id = ? AND file_path = ?')
      .run(projectId, filePath);
  } catch (err) {
    Sentry.captureException(err, {
      level: 'warning',
      tags: { component: 'project-cache', op: 'clearFileCache' },
      extra: { projectId, filePath },
    });
  }
}

export function getProjectFileCount(projectId: string): number {
  const database = getProjectIndexDb(projectId);
  if (!database) return 0;

  try {
    const row = database
      .prepare('SELECT COUNT(*) as count FROM file_cache WHERE project_id = ?')
      .get(projectId);

    return row?.count ?? 0;
  } catch (err) {
    Sentry.captureException(err, {
      level: 'warning',
      tags: { component: 'project-cache', op: 'getProjectFileCount' },
      extra: { projectId },
    });
    return 0;
  }
}
