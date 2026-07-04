/**
 * IPC handlers for project context management.
 * Handles project CRUD, indexing triggers, and status queries.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ipcMain, dialog, app } from 'electron';
import * as Sentry from '@sentry/electron/main';
import type { CodeIntelClient, ProjectInfo } from '../api/code-intel-client';
import type { OverlayWindowManager } from '../overlay/overlay-window-manager';
import type { AppWindowManager } from '../windows/app-window-manager';
import { isGitRepo, getBranchInfo, getGitRemoteUrl, parseGitHubUrl } from '../services/git-service';
import { startWatching, stopWatching, performFullScan, stopAllWatchers, isWatching, type ScanSignal } from '../services/file-watcher';
import { clearProjectIndexData, deleteProjectIndex } from '../database/code-intel-local-store';

let _client: CodeIntelClient | null = null;
let _overlayManager: OverlayWindowManager | null = null;
let _appWindowManager: AppWindowManager | null = null;

let activeProjectId: string | null = null;
let activeProjectBranch: string | null = null;

const activeScans = new Map<string, ScanSignal>();
// requestId -> abort() for in-flight streaming Ask requests.
const activeContextStreams = new Map<string, () => void>();

function cancelActiveScan(projectId: string): void {
  const signal = activeScans.get(projectId);
  if (signal) {
    signal.cancelled = true;
    activeScans.delete(projectId);
    console.log(`[ProjectHandlers] Cancelled active scan for ${projectId}`);
  }
}

const STATE_FILE = path.join(app.getPath('userData'), 'active-project.json');

/**
 * Per-project status poll loop. The backend processes ingest async — the HTTP
 * `ingestSkeleton` call returns 202 immediately and the actual indexing
 * (summarize → embed → upsert) can take many seconds. We must poll the
 * service until it reports a terminal status (`ready` / `partial` / `error`)
 * before telling the renderer the project is ready, otherwise the UI shows
 * "Ready" while the worker is still processing.
 */
const activePolls = new Map<string, NodeJS.Timeout>();
const POLL_INTERVAL_MS = 2_500;
const POLL_MAX_DURATION_MS = 15 * 60_000; // 15 min hard cap

function clearStatusPoll(projectId: string): void {
  const timer = activePolls.get(projectId);
  if (timer) {
    clearTimeout(timer);
    activePolls.delete(projectId);
  }
}

function isTerminalStatus(status: string | undefined): boolean {
  return status === 'ready' || status === 'partial' || status === 'error' || status === 'stale';
}

/**
 * Begin polling backend status for a project. Broadcasts every change.
 * Returns a promise that resolves with the final terminal status.
 */
function startStatusPoll(projectId: string): Promise<string> {
  clearStatusPoll(projectId);

  return new Promise((resolve) => {
    const startedAt = Date.now();
    let lastStatus: string | null = null;

    const tick = async () => {
      if (!_client) {
        resolve('stale');
        return;
      }
      try {
        const project = await _client.getProject(projectId);
        const status = project?.index_status || 'stale';

        if (status !== lastStatus) {
          lastStatus = status;
          broadcastProjectStatus({
            projectId,
            status,
            name: project?.name,
            last_indexed_at: project?.last_indexed_at,
          });
        }

        if (isTerminalStatus(status)) {
          activePolls.delete(projectId);
          resolve(status);
          return;
        }
      } catch (e) {
        // Service might be transiently down — keep polling
        Sentry.addBreadcrumb({ category: 'project-handlers', message: 'Status poll failed (transient)', level: 'warning' });
      }

      if (Date.now() - startedAt > POLL_MAX_DURATION_MS) {
        activePolls.delete(projectId);
        broadcastProjectStatus({ projectId, status: 'stale' });
        resolve('stale');
        return;
      }

      activePolls.set(projectId, setTimeout(tick, POLL_INTERVAL_MS));
    };

    activePolls.set(projectId, setTimeout(tick, POLL_INTERVAL_MS));
  });
}

/**
 * Called by the file watcher every time a user edit results in a successful
 * `ingestSkeleton` (or a `delete-chunks`). The backend flips its own
 * `index_status` to `indexing` while the worker drains the queue, so we
 * mirror that on the renderer immediately and start a poll until the worker
 * settles back to `ready`. Without this the UI would stay on "Ready" while
 * the index is silently catching up — exactly the bug reported.
 */
function onWatcherIngest(projectId: string): void {
  console.log(`[ProjectHandlers] onWatcherIngest(${projectId}) → broadcasting indexing + starting poll`);
  broadcastProjectStatus({ projectId, status: 'indexing' });
  // If a poll is already in flight (e.g. user saved twice in <2.5s) we just
  // restart it; startStatusPoll cancels any prior timer for the same id.
  startStatusPoll(projectId)
    .then((finalStatus) => {
      console.log(`[ProjectHandlers] post-edit poll settled for ${projectId}: ${finalStatus}`);
    })
    .catch(() => {});
}

function persistActiveProject(): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      projectId: activeProjectId,
      branch: activeProjectBranch,
    }));
  } catch (e) {
    console.warn('[ProjectHandlers] Failed to persist active project:', e);
    Sentry.captureException(e, { level: 'warning', tags: { component: 'project-handlers', op: 'persist-state' } });
  }
}

function loadPersistedProject(): { projectId: string | null; branch: string | null } {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.warn('[ProjectHandlers] Failed to load persisted project:', e);
    Sentry.captureException(e, { level: 'warning', tags: { component: 'project-handlers', op: 'load-state' } });
  }
  return { projectId: null, branch: null };
}

export function registerProjectHandlers(
  client: CodeIntelClient,
  overlayManager: OverlayWindowManager,
  appWindowManager: AppWindowManager,
): void {
  _client = client;
  _overlayManager = overlayManager;
  _appWindowManager = appWindowManager;

  ipcMain.handle('project:add', async (_event, options?: { folderPath?: string }) => {
    if (!_client) throw new Error('Code intelligence client not initialized');

    let projectPath = options?.folderPath;
    if (!projectPath) {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select Project Folder',
      });
      if (result.canceled || !result.filePaths[0]) {
        return null;
      }
      projectPath = result.filePaths[0];
    }

    const pathParts = projectPath.replace(/\\/g, '/').split('/');
    const projectName = pathParts[pathParts.length - 1] || 'Untitled';

    let githubOwner: string | undefined;
    let githubRepo: string | undefined;
    let repoUrl: string | undefined;
    let defaultBranch = 'main';

    const isGit = await isGitRepo(projectPath);
    if (isGit) {
      try {
        const branchInfo = await getBranchInfo(projectPath);
        defaultBranch = branchInfo.defaultBranch;

        const remoteUrl = await getGitRemoteUrl(projectPath);
        if (remoteUrl) {
          repoUrl = remoteUrl;
          const parsed = parseGitHubUrl(remoteUrl);
          if (parsed) {
            githubOwner = parsed.owner;
            githubRepo = parsed.repo;
          }
        }
      } catch (e) {
        console.warn('[ProjectHandlers] Failed to read git info:', e);
        Sentry.captureException(e, { level: 'warning', tags: { component: 'project-handlers', op: 'git-metadata' } });
      }
    }

    Sentry.addBreadcrumb({ category: 'project', message: 'Creating project', level: 'info', data: { name: projectName } });
    const project = await _client.createProject({
      name: projectName,
      local_path: projectPath,
      repo_url: repoUrl,
      default_branch: defaultBranch,
      github_repo_owner: githubOwner,
      github_repo_name: githubRepo,
    });

    await setActiveProject(project.id, projectPath);

    broadcastProjectStatus({ projectId: project.id, status: 'indexing' });
    const signal: ScanSignal = { cancelled: false };
    activeScans.set(project.id, signal);
    performFullScan(project.id, projectPath, _client!, defaultBranch, undefined, signal)
      .then(async (result) => {
        activeScans.delete(project.id);
        if (signal.cancelled) return;
        console.log(`[ProjectHandlers] Initial scan queued: ${result.totalFiles} files, ${result.totalChunks} chunks`);
        const finalStatus = await startStatusPoll(project.id);
        console.log(`[ProjectHandlers] Initial index settled: ${finalStatus}`);
      })
      .catch((e) => {
        activeScans.delete(project.id);
        if (signal.cancelled) return;
        console.error('[ProjectHandlers] Initial index failed:', e);
        Sentry.captureException(e, { tags: { component: 'project-handlers', op: 'initial-index' }, extra: { projectId: project.id } });
        broadcastProjectStatus({ projectId: project.id, status: 'stale' });
      });

    console.log(`[ProjectHandlers] Project added: ${projectName} (${project.id})`);
    return project;
  });

  ipcMain.handle('project:remove', async (_event, projectId: string) => {
    if (!_client) throw new Error('Code intelligence client not initialized');

    cancelActiveScan(projectId);
    stopWatching(projectId);
    clearStatusPoll(projectId);
    try {
      await _client.deleteProject(projectId);
    } catch (e: any) {
      // 404 = already gone (different machine, race); treat as success so the
      // user can still purge stale references from their space.
      const status = e?.response?.status;
      if (status !== 404) {
        Sentry.captureException(e, { tags: { component: 'project-handlers', op: 'remove' }, extra: { projectId } });
        throw e;
      }
      console.warn(`[ProjectHandlers] Project ${projectId} already removed on backend (404) — purging local state`);
    }
    deleteProjectIndex(projectId);

    if (activeProjectId === projectId) {
      activeProjectId = null;
      activeProjectBranch = null;
      persistActiveProject();
      broadcastProjectStatus(null);
    }

    console.log(`[ProjectHandlers] Project removed: ${projectId}`);
  });

  ipcMain.handle('project:list', async () => {
    if (!_client) return [];
    return _client.listProjects();
  });

  ipcMain.handle('project:status', async (_event, projectId: string) => {
    if (!_client) return null;
    return _client.getProject(projectId);
  });

  ipcMain.handle('project:set-active', async (_event, projectId: string, localPath?: string) => {
    await setActiveProject(projectId, localPath);
  });

  ipcMain.handle('project:get-active', () => {
    return { projectId: activeProjectId, branch: activeProjectBranch };
  });

  ipcMain.handle('project:reindex', async (_event, projectId: string, localPath: string) => {
    if (!_client) throw new Error('Code intelligence client not initialized');

    if (activeScans.has(projectId)) {
      console.log(`[ProjectHandlers] Scan already active for ${projectId}, skipping duplicate reindex`);
      broadcastProjectStatus({ projectId, status: 'indexing' });
      const finalStatus = await startStatusPoll(projectId);
      return { totalFiles: 0, totalChunks: 0, finalStatus };
    }

    cancelActiveScan(projectId);
    clearProjectIndexData(projectId);
    clearStatusPoll(projectId);
    broadcastProjectStatus({ projectId, status: 'indexing' });

    const signal: ScanSignal = { cancelled: false };
    activeScans.set(projectId, signal);

    try {
      const isGit = await isGitRepo(localPath);
      let branch: string | undefined;
      if (isGit) {
        const branchInfo = await getBranchInfo(localPath);
        branch = branchInfo.currentBranch;
      }

      const result = await performFullScan(
        projectId,
        localPath,
        _client,
        branch,
        (current, total) => {
          broadcastProjectStatus({
            projectId,
            status: 'indexing',
            progress: { current, total },
          });
        },
        signal,
      );

      activeScans.delete(projectId);
      if (signal.cancelled) return { totalFiles: 0, totalChunks: 0, finalStatus: 'cancelled' };

      console.log(`[ProjectHandlers] Reindex queued: ${result.totalFiles} files, ${result.totalChunks} chunks`);

      const finalStatus = await startStatusPoll(projectId);
      console.log(`[ProjectHandlers] Reindex settled: ${finalStatus}`);
      return { ...result, finalStatus };
    } catch (e) {
      activeScans.delete(projectId);
      if (signal.cancelled) return { totalFiles: 0, totalChunks: 0, finalStatus: 'cancelled' };
      console.error('[ProjectHandlers] Reindex failed:', e);
      Sentry.captureException(e, { tags: { component: 'project-handlers', op: 'reindex' }, extra: { projectId } });
      broadcastProjectStatus({ projectId, status: 'stale' });
      throw e;
    }
  });

  ipcMain.handle('project:sync', async (_event, projectId?: string) => {
    if (!_client) throw new Error('Code intelligence client not initialized');
    await _client.syncProject(projectId);
  });

  ipcMain.handle('project:toggle-watching', async (_event, projectId: string, localPath: string, enable: boolean) => {
    if (enable) {
      let branch: string | undefined;
      const isGit = await isGitRepo(localPath);
      if (isGit) {
        const branchInfo = await getBranchInfo(localPath);
        branch = branchInfo.currentBranch;
      }
      startWatching(projectId, localPath, _client!, branch, onWatcherIngest);
    } else {
      stopWatching(projectId);
    }
    return { watching: isWatching(projectId) };
  });

  ipcMain.handle('project:is-watching', (_event, projectId: string) => {
    return isWatching(projectId);
  });

  ipcMain.handle('project:is-scanning', (_event, projectId: string) => {
    return activeScans.has(projectId);
  });

  ipcMain.handle('project:retrieve', async (_event, params: { project_id: string; query: string; branch?: string; limit?: number; mode?: 'find' | 'ask' | 'bug' | 'optimize' }) => {
    if (!_client) throw new Error('Code intelligence client not initialized');
    if (params.mode === 'find') {
      await ensureFreshBeforeFind(params.project_id);
    }
    return await _client.retrieve(params);
  });

  ipcMain.handle('project:context', async (_event, params: { project_id: string; query: string; branch?: string; limit?: number; mode?: 'find' | 'ask' | 'bug' | 'optimize' }) => {
    if (!_client) throw new Error('Code intelligence client not initialized');
    return await _client.context(params);
  });

  // Streaming Ask: SSE-backed. The renderer subscribes via a requestId and we
  // forward locations + answer tokens as they arrive on the code-intel stream.
  ipcMain.on('project:context-stream', (event, params: { requestId: string; project_id: string; query: string; branch?: string; limit?: number; mode?: 'find' | 'ask' | 'bug' | 'optimize' }) => {
    const send = (payload: Record<string, unknown>) => {
      if (event.sender.isDestroyed()) return;
      event.sender.send('project:context-stream:event', { requestId: params.requestId, ...payload });
    };
    if (!_client) {
      send({ type: 'error', message: 'Code intelligence client not initialized' });
      return;
    }
    const abort = _client.contextStream(params, {
      onLocations: (data) => send({ type: 'locations', data }),
      onToken: (delta) => send({ type: 'token', delta }),
      onDone: (data) => { send({ type: 'done', data }); activeContextStreams.delete(params.requestId); },
      onError: (message) => { send({ type: 'error', message }); activeContextStreams.delete(params.requestId); },
    });
    activeContextStreams.set(params.requestId, abort);
  });

  ipcMain.on('project:context-stream:abort', (_event, requestId: string) => {
    const abort = activeContextStreams.get(requestId);
    if (abort) {
      abort();
      activeContextStreams.delete(requestId);
    }
  });

  /**
   * Renderer calls this on app launch with every project that lives in a
   * Space. We do TWO things per project:
   *
   *   1. Restart the chokidar watcher (handles are process-bound and were
   *      torn down when the user quit from the tray).
   *   2. Run a hash-diff scan via `performFullScan`. The scan walks every
   *      parseable file, hashes its contents, and compares against the
   *      local SHA cache (`getCachedHash`). Files whose hashes match are
   *      skipped at zero cost; only files that were edited / added while
   *      the app was off get re-parsed and ingested.
   *
   * This guarantees the index reflects the on-disk state regardless of the
   * project's last-known backend status — even a "ready" project gets
   * verified, so external edits (git pull, IDE rename, etc.) are caught.
   *
   * Returns immediately — actual work happens in the background and the
   * status-update IPC channel reflects progress.
   */
  ipcMain.handle('project:ensure-fresh', async (_event, projects: Array<{ projectId: string; localPath: string }>) => {
    if (!_client || !Array.isArray(projects) || projects.length === 0) return { triggered: 0 };

    let triggered = 0;
    for (const { projectId, localPath } of projects) {
      if (!projectId || !localPath) continue;
      try {
        const project = await _client.getProject(projectId);
        const status = project?.index_status || 'stale';

        let branch: string | undefined;
        try {
          if (await isGitRepo(localPath)) {
            const branchInfo = await getBranchInfo(localPath);
            branch = branchInfo.currentBranch;
          }
        } catch {}

        if (!isWatching(projectId)) {
          startWatching(projectId, localPath, _client, branch, onWatcherIngest);
        }

        // Decide whether the renderer should see an "Indexing" pill while
        // the diff scan runs.
        //   - If the backend is in a non-terminal/zombie state we MUST
        //     surface "Indexing" — we don't trust the cached SHAs and the
        //     local cache is purged so the scan re-uploads everything.
        //   - For a healthy "ready" project we kick off a quiet hash-diff
        //     scan; only flip the pill if the scan actually finds drift
        //     (handled inside the .then() below).
        const isUnhealthy = status === 'stale' || status === 'indexing' || status === 'error';

        if (isUnhealthy) {
          clearProjectIndexData(projectId);
          broadcastProjectStatus({ projectId, status: 'indexing' });
        }

        if (activeScans.has(projectId)) {
          console.log(`[ProjectHandlers] ensure-fresh: scan already active for ${projectId}, skipping`);
          triggered++;
          continue;
        }

        const tStart = Date.now();
        console.log(
          `[ProjectHandlers] ensure-fresh: scanning ${projectId} ` +
            `(backend=${status}, mode=${isUnhealthy ? 'force-full' : 'hash-diff'})`,
        );

        const efSignal: ScanSignal = { cancelled: false };
        activeScans.set(projectId, efSignal);

        performFullScan(projectId, localPath, _client, branch, undefined, efSignal)
          .then(async (result) => {
            activeScans.delete(projectId);
            if (efSignal.cancelled) return;

            const elapsed = Date.now() - tStart;
            console.log(
              `[ProjectHandlers] ensure-fresh: ${projectId} scan done in ${elapsed}ms — ` +
                `${result.totalFiles} changed file(s), ${result.totalChunks} chunk(s)`,
            );

            if (!isUnhealthy && result.totalChunks === 0) {
              return;
            }

            broadcastProjectStatus({ projectId, status: 'indexing' });
            const finalStatus = await startStatusPoll(projectId);
            console.log(`[ProjectHandlers] ensure-fresh: ${projectId} settled to ${finalStatus}`);
          })
          .catch((err) => {
            activeScans.delete(projectId);
            if (efSignal.cancelled) return;
            console.error(`[ProjectHandlers] ensure-fresh scan failed for ${projectId}:`, err);
            Sentry.captureException(err, { level: 'warning', tags: { component: 'project-handlers', op: 'ensure-fresh' }, extra: { projectId } });
            if (isUnhealthy) broadcastProjectStatus({ projectId, status: 'stale' });
          });

        triggered++;
      } catch (e: any) {
        // 404 means the project was deleted somewhere else; the renderer will
        // notice via its next status() call and prune from the space.
        const httpStatus = e?.response?.status;
        if (httpStatus !== 404) {
          Sentry.captureException(e, { level: 'warning', tags: { component: 'project-handlers', op: 'ensure-fresh' }, extra: { projectId } });
        }
      }
    }

    console.log(`[ProjectHandlers] ensure-fresh: scheduled ${triggered}/${projects.length} hash-diff scans`);
    return { triggered, total: projects.length };
  });
}

async function ensureFreshBeforeFind(projectId: string): Promise<void> {
  if (!_client || activeScans.has(projectId)) {
    return;
  }

  try {
    const project = await _client.getProject(projectId);
    const localPath = project?.local_path;
    if (!localPath) return;

    let branch: string | undefined;
    try {
      if (await isGitRepo(localPath)) {
        const branchInfo = await getBranchInfo(localPath);
        branch = branchInfo.currentBranch;
      }
    } catch {}

    const signal: ScanSignal = { cancelled: false };
    activeScans.set(projectId, signal);
    const result = await performFullScan(projectId, localPath, _client, branch, undefined, signal);
    activeScans.delete(projectId);
    if (signal.cancelled || result.totalChunks === 0) return;

    broadcastProjectStatus({ projectId, status: 'indexing' });
    await startStatusPoll(projectId);
  } catch (e) {
    activeScans.delete(projectId);
    Sentry.captureException(e, {
      level: 'warning',
      tags: { component: 'project-handlers', op: 'ensure-fresh-before-find' },
      extra: { projectId },
    });
  }
}

async function setActiveProject(projectId: string, localPath?: string): Promise<void> {
  if (!_client) return;

  activeProjectId = projectId;
  Sentry.setTag('active_project', projectId);

  if (localPath) {
    const isGit = await isGitRepo(localPath);
    if (isGit) {
      const branchInfo = await getBranchInfo(localPath);
      activeProjectBranch = branchInfo.currentBranch;
    } else {
      activeProjectBranch = null;
    }

    startWatching(projectId, localPath, _client, activeProjectBranch || undefined, onWatcherIngest);
  }

  const project = await _client.getProject(projectId);
  broadcastProjectStatus({
    projectId,
    status: project?.index_status || 'stale',
    name: project?.name,
    branch: activeProjectBranch,
  });

  persistActiveProject();
}

function broadcastProjectStatus(data: any): void {
  try {
    _overlayManager?.send('overlay:project-status', data);
  } catch {}
  try {
    _appWindowManager?.send('project:status-update', data);
  } catch {}
}

export function getActiveProjectId(): string | null {
  return activeProjectId;
}

export function getActiveProjectBranch(): string | null {
  return activeProjectBranch;
}

export async function restoreActiveProject(): Promise<void> {
  const { projectId, branch } = loadPersistedProject();
  if (!projectId || !_client) return;

  activeProjectId = projectId;
  activeProjectBranch = branch;
  console.log(`[ProjectHandlers] Active project set from persisted state: ${projectId} (branch=${branch})`);

  try {
    const project = await _client.getProject(projectId);
    if (project) {
      const badStatus = project.index_status === 'error' || project.index_status === 'stale';
      if (badStatus) {
        console.warn(`[ProjectHandlers] Persisted project ${projectId} has status '${project.index_status}' — skipping restore`);
        activeProjectId = null;
        activeProjectBranch = null;
        return;
      }
      if (project.local_path) {
        startWatching(project.id, project.local_path, _client!, branch || undefined, onWatcherIngest);
      }
      broadcastProjectStatus({
        projectId: project.id,
        status: project.index_status || 'stale',
        name: project.name,
        branch,
      });
      console.log(`[ProjectHandlers] Validated active project with service: ${project.name}`);
    } else {
      console.warn(`[ProjectHandlers] Project ${projectId} not found on service — keeping persisted ID for retry`);
    }
  } catch (e) {
    console.warn('[ProjectHandlers] Service unavailable during restore — persisted project ID retained:', e);
    Sentry.captureException(e, { level: 'warning', tags: { component: 'project-handlers', op: 'restore-project' } });
  }
}

export function cleanupProjectHandlers(): void {
  for (const signal of activeScans.values()) {
    signal.cancelled = true;
  }
  activeScans.clear();
  for (const id of Array.from(activePolls.keys())) {
    clearStatusPoll(id);
  }
  stopAllWatchers();
}
