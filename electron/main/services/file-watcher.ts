/**
 * Chokidar-based file watcher for project directories.
 * Watches for file changes and triggers incremental re-indexing.
 * Debounces rapid changes and checks content hashes before re-sending.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as Sentry from '@sentry/electron/main';
import type { FSWatcher } from 'chokidar';
import { getLanguageForFile, parseFile } from './code-parser';
import { getCachedHash, setCachedHash, clearFileCache } from '../database/local-project-cache';
import type { CodeIntelClient, ChunkData, CallGraphEdge, ChunkKey } from '../api/code-intel-client';

let chokidar: typeof import('chokidar') | null = null;

try {
  chokidar = require('chokidar');
} catch (err) {
  console.warn('[FileWatcher] chokidar not available');
  Sentry.captureException(err, { level: 'warning', tags: { component: 'file-watcher', op: 'load-chokidar' } });
}

interface WatcherState {
  watcher: FSWatcher;
  projectId: string;
  projectPath: string;
  debounceTimers: Map<string, NodeJS.Timeout>;
  onChunksIngested?: (projectId: string) => void;
}

const activeWatchers: Map<string, WatcherState> = new Map();

const DEBOUNCE_MS = 1500;

function ts(): string {
  // Compact human + epoch combo so log lines from chokidar are easy to diff
  // against renderer / backend events when measuring "edit → indexed" latency.
  const d = new Date();
  return `${d.toISOString()} (+${Date.now()})`;
}

/**
 * OneDrive / Dropbox / iCloud / Google Drive folders sit behind NTFS reparse
 * points and cloud-sync drivers that frequently swallow `ReadDirectoryChangesW`
 * notifications — meaning chokidar's default `fs.watch` backend never sees the
 * `add`/`change` events. We detect those paths and force chokidar onto its
 * polling backend (slower but 100% reliable) so user edits never go unnoticed.
 */
function shouldUsePolling(projectPath: string): boolean {
  const normalized = projectPath.replace(/\\/g, '/');
  const cloudMarkers = [
    '/onedrive', '/dropbox', '/icloud drive', '/icloud', '/googledrive',
    '/google drive', '/box sync', '/pcloud', '/sync.com',
  ];
  const lower = normalized.toLowerCase();
  return cloudMarkers.some((marker) => lower.includes(marker));
}

// chokidar v4 dropped glob support in `ignored` (see release notes: globs were
// removed to drop the picomatch dep). Pre-v4 we passed `**/node_modules/**`
// strings, but in v4 those are interpreted as literal paths and silently match
// nothing — meaning the watcher actually traversed node_modules/.git on every
// project, which exploded watcher memory and produced a flood of irrelevant
// file events. The function-matcher below works in both v3 and v4.
const IGNORED_DIR_NAMES = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__',
  '.venv', 'venv', '.next', 'target', '.cache', '.turbo',
  '.parcel-cache', 'out', 'coverage', '.nuxt', '.svelte-kit',
]);

const IGNORED_FILE_SUFFIXES = ['.min.js', '.map', '.lock'];
const IGNORED_FILE_EXACT = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb']);

function shouldIgnorePath(absPath: string): boolean {
  // Normalize so the same matcher works on Windows + POSIX path separators.
  const segments = absPath.replace(/\\/g, '/').split('/');
  for (const seg of segments) {
    if (!seg) continue;
    if (IGNORED_DIR_NAMES.has(seg)) return true;
  }
  const last = segments[segments.length - 1] || '';
  if (IGNORED_FILE_EXACT.has(last)) return true;
  for (const suffix of IGNORED_FILE_SUFFIXES) {
    if (last.endsWith(suffix)) return true;
  }
  return false;
}

function computeFileHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

async function handleFileChange(
  filePath: string,
  state: WatcherState,
  client: CodeIntelClient,
  branch?: string,
): Promise<void> {
  const tHandleStart = Date.now();
  const language = getLanguageForFile(filePath);
  if (!language) {
    console.log(`[FileWatcher] [${ts()}] skip (no language): ${filePath}`);
    return;
  }

  const relativePath = path.relative(state.projectPath, filePath).replace(/\\/g, '/');

  let content: string;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 500_000) {
      console.log(`[FileWatcher] [${ts()}] skip (size>500k): ${relativePath}`);
      return;
    }
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    console.log(`[FileWatcher] [${ts()}] skip (read error): ${relativePath} →`, (e as Error)?.message);
    return;
  }

  const fileHash = computeFileHash(content);
  const cachedHash = getCachedHash(state.projectId, relativePath);
  if (cachedHash === fileHash) {
    console.log(`[FileWatcher] [${ts()}] skip (unchanged hash): ${relativePath}`);
    return;
  }

  try {
    const chunks = await parseFile(relativePath, content);
    if (chunks.length === 0) {
      console.log(`[FileWatcher] [${ts()}] skip (no chunks parsed): ${relativePath}`);
      return;
    }

    setCachedHash(state.projectId, relativePath, fileHash, chunks.length);

    const tIngestStart = Date.now();
    console.log(`[FileWatcher] [${ts()}] → ingestSkeleton(${relativePath}, ${chunks.length} chunks) starting`);
    await client.ingestSkeleton({
      project_id: state.projectId,
      chunks,
      call_graph: buildCallGraph(chunks),
      language_map: { [language]: chunks.length },
      branch,
      cleanup_scope: 'file',
      cleanup_keys: chunkKeys(chunks),
    });
    const tIngestDone = Date.now();

    console.log(
      `[FileWatcher] [${ts()}] ✓ Indexed ${relativePath}: ${chunks.length} chunks ` +
        `(parse+ingest ${tIngestDone - tHandleStart}ms, ingest ${tIngestDone - tIngestStart}ms)`,
    );

    // Notify the project-handlers layer so it can flip the UI from "ready" to
    // "indexing" and start a status poll until the backend worker drains.
    state.onChunksIngested?.(state.projectId);
  } catch (e) {
    console.error(`[FileWatcher] Failed to process ${relativePath}:`, e);
    Sentry.captureException(e, { tags: { component: 'file-watcher', op: 'handleFileChange' }, extra: { filePath: relativePath } });
  }
}

export function startWatching(
  projectId: string,
  projectPath: string,
  client: CodeIntelClient,
  branch?: string,
  onChunksIngested?: (projectId: string) => void,
): void {
  if (!chokidar) {
    console.warn('[FileWatcher] Cannot start — chokidar not available');
    return;
  }

  stopWatching(projectId);

  const usePolling = shouldUsePolling(projectPath);

  const watcher = chokidar.watch(projectPath, {
    ignored: (filePath: string) => shouldIgnorePath(filePath),
    persistent: true,
    ignoreInitial: true,
    // For OneDrive / cloud-synced folders fs.watch is unreliable — fall back
    // to active polling so user edits never get missed. interval=750ms keeps
    // CPU reasonable on a 64-file project (~85 stats/sec) while still feeling
    // snappy ("ready → indexing" within 0.75–1.5s of save).
    usePolling,
    interval: 750,
    binaryInterval: 1500,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 150 },
  });

  watcher.on('error', (err: unknown) => {
    console.error(`[FileWatcher] Watcher error for ${projectId}:`, err);
    Sentry.captureException(err, { level: 'warning', tags: { component: 'file-watcher', op: 'watcher-error' }, extra: { projectId, projectPath } });
  });

  watcher.on('ready', () => {
    console.log(`[FileWatcher] [${ts()}] watcher READY for ${projectId} (polling=${usePolling})`);
  });

  const state: WatcherState = {
    watcher,
    projectId,
    projectPath,
    debounceTimers: new Map(),
    onChunksIngested,
  };

  const debouncedHandle = (filePath: string, evt: 'add' | 'change') => {
    const rel = path.relative(projectPath, filePath).replace(/\\/g, '/');
    console.log(`[FileWatcher] [${ts()}] raw ${evt} → ${rel} (debouncing ${DEBOUNCE_MS}ms)`);

    const existing = state.debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);

    state.debounceTimers.set(
      filePath,
      setTimeout(() => {
        state.debounceTimers.delete(filePath);
        console.log(`[FileWatcher] [${ts()}] debounce fired for ${rel}`);
        handleFileChange(filePath, state, client, branch).catch((e) => {
          console.error(`[FileWatcher] Error handling change for ${filePath}:`, e);
          Sentry.captureException(e, { tags: { component: 'file-watcher', op: 'debounced-change' } });
        });
      }, DEBOUNCE_MS),
    );
  };

  watcher.on('change', (filePath: string) => debouncedHandle(filePath, 'change'));
  watcher.on('add', (filePath: string) => debouncedHandle(filePath, 'add'));
  watcher.on('unlink', (filePath: string) => {
    const relativePath = path.relative(projectPath, filePath).replace(/\\/g, '/');
    console.log(`[FileWatcher] [${ts()}] raw unlink → ${relativePath}`);
    clearFileCache(state.projectId, relativePath);
    client.deleteChunksForFile(state.projectId, relativePath).catch((e) => {
      console.error(`[FileWatcher] Failed to delete chunks for ${relativePath}:`, e);
      Sentry.captureException(e, { tags: { component: 'file-watcher', op: 'delete-chunks' }, extra: { filePath: relativePath } });
    });
    state.onChunksIngested?.(state.projectId);
  });

  activeWatchers.set(projectId, state);
  Sentry.addBreadcrumb({ category: 'file-watcher', message: 'Watch started', level: 'info', data: { projectId, usePolling } });
  console.log(`[FileWatcher] [${ts()}] Watching ${projectPath} for project ${projectId} (polling=${usePolling})`);
}

export function stopWatching(projectId: string): void {
  const state = activeWatchers.get(projectId);
  if (state) {
    for (const timer of state.debounceTimers.values()) {
      clearTimeout(timer);
    }
    state.watcher.close();
    activeWatchers.delete(projectId);
    Sentry.addBreadcrumb({ category: 'file-watcher', message: 'Watch stopped', level: 'info', data: { projectId } });
    console.log(`[FileWatcher] Stopped watching project ${projectId}`);
  }
}

export function stopAllWatchers(): void {
  for (const projectId of activeWatchers.keys()) {
    stopWatching(projectId);
  }
}

export function isWatching(projectId: string): boolean {
  return activeWatchers.has(projectId);
}

const MAX_CALL_GRAPH_EDGES = 2000;

function buildCallGraph(chunks: ChunkData[]): CallGraphEdge[] {
  const edges: CallGraphEdge[] = [];

  const chunkByName = new Map<string, ChunkData>();
  const chunksByFile = new Map<string, ChunkData[]>();

  for (const chunk of chunks) {
    const shortName = chunk.name.includes('.') ? chunk.name.split('.').pop()! : chunk.name;
    if (!chunkByName.has(shortName)) {
      chunkByName.set(shortName, chunk);
    }
    const fileChunks = chunksByFile.get(chunk.file_path) ?? [];
    fileChunks.push(chunk);
    chunksByFile.set(chunk.file_path, fileChunks);
  }

  for (const chunk of chunks) {
    if (edges.length >= MAX_CALL_GRAPH_EDGES) break;

    for (const callee of chunk.callees) {
      if (edges.length >= MAX_CALL_GRAPH_EDGES) break;
      const target = chunkByName.get(callee);
      if (target && target.name !== chunk.name) {
        edges.push({
          from_name: chunk.name,
          from_file: chunk.file_path,
          to_name: target.name,
          to_file: target.file_path,
          relationship_type: 'calls',
        });
      }
    }

    for (const imp of chunk.imports) {
      if (edges.length >= MAX_CALL_GRAPH_EDGES) break;
      const match = imp.match(/from\s+['"]([^'"]+)['"]/);
      if (!match) continue;
      const modulePath = match[1];
      if (!modulePath.startsWith('.')) continue;

      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(chunk.file_path), modulePath),
      );

      for (const [filePath, fileChunks] of chunksByFile) {
        const withoutExt = filePath.replace(/\.\w+$/, '');
        if (withoutExt === resolved || filePath === resolved) {
          const fileChunk = fileChunks.find((c) => c.chunk_type === 'file') ?? fileChunks[0];
          if (fileChunk) {
            edges.push({
              from_name: chunk.name,
              from_file: chunk.file_path,
              to_name: fileChunk.name,
              to_file: fileChunk.file_path,
              relationship_type: 'imports',
            });
          }
          break;
        }
      }
    }
  }

  return edges;
}

export interface ScanSignal { cancelled: boolean; }

export async function performFullScan(
  projectId: string,
  projectPath: string,
  client: CodeIntelClient,
  branch?: string,
  onProgress?: (current: number, total: number) => void,
  signal?: ScanSignal,
): Promise<{ totalFiles: number; totalChunks: number }> {
  const allChunks: ChunkData[] = [];
  const callGraph: CallGraphEdge[] = [];
  const languageMap: Record<string, number> = {};
  const pendingHashes = new Map<string, { hash: string; chunkCount: number }>();
  let totalFiles = 0;

  function collectFiles(dir: string): string[] {
    const files: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (
          entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.name === '__pycache__' ||
          entry.name === 'dist' ||
          entry.name === 'build' ||
          entry.name === 'target' ||
          entry.name === 'venv' ||
          entry.name === '.venv'
        ) {
          continue;
        }

        if (entry.isDirectory()) {
          files.push(...collectFiles(fullPath));
        } else if (entry.isFile() && getLanguageForFile(entry.name)) {
          files.push(fullPath);
        }
      }
    } catch {
      // permission errors, etc.
    }
    return files;
  }

  const files = collectFiles(projectPath);
  const total = files.length;
  console.log(`[FileWatcher] Full scan: found ${total} parseable files in ${projectPath}`);

  for (let i = 0; i < files.length; i++) {
    if (signal?.cancelled) {
      console.log(`[FileWatcher] Scan cancelled for ${projectId} at file ${i}/${total}`);
      return { totalFiles, totalChunks: allChunks.length };
    }

    const filePath = files[i];
    const relativePath = path.relative(projectPath, filePath).replace(/\\/g, '/');

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.length > 500_000) continue;

      const fileHash = computeFileHash(content);
      const cachedHash = getCachedHash(projectId, relativePath);
      if (cachedHash === fileHash) {
        continue;
      }

      const chunks = await parseFile(relativePath, content);
      if (chunks.length > 0) {
        allChunks.push(...chunks);
        const lang = chunks[0].language;
        languageMap[lang] = (languageMap[lang] || 0) + chunks.length;
        pendingHashes.set(relativePath, { hash: fileHash, chunkCount: chunks.length });
        totalFiles++;
      }
    } catch (e) {
      console.warn(`[FileWatcher] Error processing ${relativePath}:`, e);
      Sentry.captureException(e, { level: 'warning', tags: { component: 'file-watcher', op: 'scan-file' }, extra: { filePath: relativePath } });
    }

    if (onProgress && i % 50 === 0) {
      onProgress(i, total);
    }
  }

  if (allChunks.length > 0) {
    if (signal?.cancelled) {
      console.log(`[FileWatcher] Scan cancelled for ${projectId} before ingest (${allChunks.length} chunks discarded)`);
      return { totalFiles, totalChunks: allChunks.length };
    }

    callGraph.push(...buildCallGraph(allChunks));
    console.log(`[FileWatcher] Built call graph: ${callGraph.length} edges from ${allChunks.length} chunks`);

    const batchSize = 500;
    const allChunkKeys = chunkKeys(allChunks);
    for (let i = 0; i < allChunks.length; i += batchSize) {
      if (signal?.cancelled) {
        console.log(`[FileWatcher] Scan cancelled for ${projectId} at ingest batch ${i}/${allChunks.length}`);
        return { totalFiles, totalChunks: allChunks.length };
      }

      const batch = allChunks.slice(i, i + batchSize);
      const isLastBatch = i + batchSize >= allChunks.length;
      await client.ingestSkeleton({
        project_id: projectId,
        chunks: batch,
        call_graph: i === 0 ? callGraph : [],
        language_map: i === 0 ? languageMap : {},
        branch,
        cleanup_scope: isLastBatch ? 'project' : 'none',
        cleanup_keys: isLastBatch ? allChunkKeys : [],
      });

      const committedFiles = new Set<string>();
      for (const chunk of batch) {
        committedFiles.add(chunk.file_path);
      }
      for (const filePath of committedFiles) {
        const pending = pendingHashes.get(filePath);
        if (pending) {
          setCachedHash(projectId, filePath, pending.hash, pending.chunkCount);
          pendingHashes.delete(filePath);
        }
      }
    }
  }

  return { totalFiles, totalChunks: allChunks.length };
}

function chunkKeys(chunks: ChunkData[]): ChunkKey[] {
  return chunks.map((chunk) => ({
    file_path: chunk.file_path,
    name: chunk.name,
    chunk_type: chunk.chunk_type,
  }));
}
