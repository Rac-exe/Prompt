/**
 * Chokidar-based file watcher for project directories.
 * Watches for file changes and triggers incremental re-indexing.
 * Debounces rapid changes and checks content hashes before re-sending.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { FSWatcher } from 'chokidar';
import { getLanguageForFile, parseFile } from './code-parser';
import { getCachedHash, setCachedHash } from '../database/local-project-cache';
import type { CodeIntelClient, ChunkData, CallGraphEdge } from '../api/code-intel-client';

let chokidar: typeof import('chokidar') | null = null;

try {
  chokidar = require('chokidar');
} catch {
  console.warn('[FileWatcher] chokidar not available');
}

interface WatcherState {
  watcher: FSWatcher;
  projectId: string;
  projectPath: string;
  debounceTimers: Map<string, NodeJS.Timeout>;
}

const activeWatchers: Map<string, WatcherState> = new Map();

const DEBOUNCE_MS = 300;

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
      call_graph: [],
      language_map: { [language]: chunks.length },
      branch,
    });

    console.log(`[FileWatcher] Indexed ${relativePath}: ${chunks.length} chunks`);
  } catch (e) {
    console.error(`[FileWatcher] Failed to process ${relativePath}:`, e);
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
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
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
        });
      }, DEBOUNCE_MS),
    );
  };

  watcher.on('change', debouncedHandle);
  watcher.on('add', debouncedHandle);
  watcher.on('unlink', (filePath: string) => {
    const relativePath = path.relative(projectPath, filePath).replace(/\\/g, '/');
    console.log(`[FileWatcher] File deleted: ${relativePath}`);
  });

  activeWatchers.set(projectId, state);
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
    console.log(`[FileWatcher] Stopped watching project ${projectId}`);
  }
}

export function stopAllWatchers(): void {
  for (const projectId of activeWatchers.keys()) {
    stopWatching(projectId);
  }
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
    }

    if (onProgress && i % 50 === 0) {
      onProgress(i, total);
    }
  }

  if (allChunks.length > 0) {
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
