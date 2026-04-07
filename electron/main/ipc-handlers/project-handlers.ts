/**
 * IPC handlers for project context management.
 * Handles project CRUD, indexing triggers, and status queries.
 */

import { ipcMain, dialog } from 'electron';
import type { CodeIntelClient, ProjectInfo } from '../api/code-intel-client';
import type { OverlayWindowManager } from '../overlay/overlay-window-manager';
import type { AppWindowManager } from '../windows/app-window-manager';
import { isGitRepo, getBranchInfo, getGitRemoteUrl, parseGitHubUrl } from '../services/git-service';
import { startWatching, stopWatching, performFullScan, stopAllWatchers } from '../services/file-watcher';
import { clearProjectCache } from '../database/local-project-cache';

let _client: CodeIntelClient | null = null;
let _overlayManager: OverlayWindowManager | null = null;
let _appWindowManager: AppWindowManager | null = null;

let activeProjectId: string | null = null;
let activeProjectBranch: string | null = null;

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
      }
    }

    const project = await _client.createProject({
      name: projectName,
      local_path: projectPath,
      repo_url: repoUrl,
      default_branch: defaultBranch,
      github_repo_owner: githubOwner,
      github_repo_name: githubRepo,
    });

    await setActiveProject(project.id, projectPath);

    console.log(`[ProjectHandlers] Project added: ${projectName} (${project.id})`);
    return project;
  });

  ipcMain.handle('project:remove', async (_event, projectId: string) => {
    if (!_client) throw new Error('Code intelligence client not initialized');

    stopWatching(projectId);
    clearProjectCache(projectId);
    await _client.deleteProject(projectId);

    if (activeProjectId === projectId) {
      activeProjectId = null;
      activeProjectBranch = null;
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

    clearProjectCache(projectId);
    broadcastProjectStatus({ projectId, status: 'indexing' });

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
      );

      console.log(`[ProjectHandlers] Reindex complete: ${result.totalFiles} files, ${result.totalChunks} chunks`);
      broadcastProjectStatus({ projectId, status: 'ready' });
      return result;
    } catch (e) {
      console.error('[ProjectHandlers] Reindex failed:', e);
      broadcastProjectStatus({ projectId, status: 'stale' });
      throw e;
    }
  });

  ipcMain.handle('project:sync', async (_event, projectId?: string) => {
    if (!_client) throw new Error('Code intelligence client not initialized');
    await _client.syncProject(projectId);
  });
}

async function setActiveProject(projectId: string, localPath?: string): Promise<void> {
  if (!_client) return;

  activeProjectId = projectId;

  if (localPath) {
    const isGit = await isGitRepo(localPath);
    if (isGit) {
      const branchInfo = await getBranchInfo(localPath);
      activeProjectBranch = branchInfo.currentBranch;
    }

    startWatching(projectId, localPath, _client, activeProjectBranch || undefined);
  }

  const project = await _client.getProject(projectId);
  broadcastProjectStatus({
    projectId,
    status: project?.index_status || 'stale',
    name: project?.name,
    branch: activeProjectBranch,
  });
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

export function cleanupProjectHandlers(): void {
  stopAllWatchers();
}
