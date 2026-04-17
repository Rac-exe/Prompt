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
import type { CodeIntelClient, ChunkData, CallGraphEdge } from '../api/code-intel-client';

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
}

const activeWatchers: Map<string, WatcherState> = new Map();

const DEBOUNCE_MS = 2000;

const DEFAULT_IGNORES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/__pycache__/**',
  '**/.venv/**',
  '**/venv/**',
  '**/.next/**',
  '**/target/**',
  '**/*.min.js',
  '**/*.map',
  '**/*.lock',
  '**/package-lock.json',
  '**/yarn.lock',
];

function computeFileHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

async function handleFileChange(
  filePath: string,
  state: WatcherState,
  client: CodeIntelClient,
  branch?: string,
): Promise<void> {
  const language = getLanguageForFile(filePath);
  if (!language) return;

  const relativePath = path.relative(state.projectPath, filePath).replace(/\\/g, '/');

  let content: string;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 500_000) return;
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return;
  }

  const fileHash = computeFileHash(content);
  const cachedHash = getCachedHash(state.projectId, relativePath);
  if (cachedHash === fileHash) {
    return;
  }

  try {
    const chunks = await parseFile(relativePath, content);
    if (chunks.length === 0) return;

    setCachedHash(state.projectId, relativePath, fileHash, chunks.length);

    await client.ingestSkeleton({
      project_id: state.projectId,
      chunks,
      call_graph: buildCallGraph(chunks),
      language_map: { [language]: chunks.length },
      branch,
    });

    console.log(`[FileWatcher] Indexed ${relativePath}: ${chunks.length} chunks`);
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
): void {
  if (!chokidar) {
    console.warn('[FileWatcher] Cannot start — chokidar not available');
    return;
  }

  stopWatching(projectId);

  const watcher = chokidar.watch(projectPath, {
    ignored: DEFAULT_IGNORES,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
  });

  const state: WatcherState = {
    watcher,
    projectId,
    projectPath,
    debounceTimers: new Map(),
  };

  const debouncedHandle = (filePath: string) => {
    const existing = state.debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);

    state.debounceTimers.set(
      filePath,
      setTimeout(() => {
        state.debounceTimers.delete(filePath);
        handleFileChange(filePath, state, client, branch).catch((e) => {
          console.error(`[FileWatcher] Error handling change for ${filePath}:`, e);
          Sentry.captureException(e, { tags: { component: 'file-watcher', op: 'debounced-change' } });
        });
      }, DEBOUNCE_MS),
    );
  };

  watcher.on('change', debouncedHandle);
  watcher.on('add', debouncedHandle);
  watcher.on('unlink', (filePath: string) => {
    const relativePath = path.relative(projectPath, filePath).replace(/\\/g, '/');
    console.log(`[FileWatcher] File deleted: ${relativePath}`);
    clearFileCache(state.projectId, relativePath);
    client.deleteChunksForFile(state.projectId, relativePath).catch((e) => {
      console.error(`[FileWatcher] Failed to delete chunks for ${relativePath}:`, e);
      Sentry.captureException(e, { tags: { component: 'file-watcher', op: 'delete-chunks' }, extra: { filePath: relativePath } });
    });
  });

  activeWatchers.set(projectId, state);
  Sentry.addBreadcrumb({ category: 'file-watcher', message: 'Watch started', level: 'info', data: { projectId } });
  console.log(`[FileWatcher] Watching ${projectPath} for project ${projectId}`);
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

export async function performFullScan(
  projectId: string,
  projectPath: string,
  client: CodeIntelClient,
  branch?: string,
  onProgress?: (current: number, total: number) => void,
): Promise<{ totalFiles: number; totalChunks: number }> {
  const allChunks: ChunkData[] = [];
  const callGraph: CallGraphEdge[] = [];
  const languageMap: Record<string, number> = {};
  let totalFiles = 0;

  function collectFiles(dir: string): string[] {
    const files: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(projectPath, fullPath);

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
        setCachedHash(projectId, relativePath, fileHash, chunks.length);
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
    callGraph.push(...buildCallGraph(allChunks));
    console.log(`[FileWatcher] Built call graph: ${callGraph.length} edges from ${allChunks.length} chunks`);

    const batchSize = 500;
    for (let i = 0; i < allChunks.length; i += batchSize) {
      const batch = allChunks.slice(i, i + batchSize);
      await client.ingestSkeleton({
        project_id: projectId,
        chunks: batch,
        call_graph: i === 0 ? callGraph : [],
        language_map: i === 0 ? languageMap : {},
        branch,
      });
    }
  }

  return { totalFiles, totalChunks: allChunks.length };
}
