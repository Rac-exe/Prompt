/**
 * Git CLI wrapper — reads branch info, ahead/behind counts,
 * recent commits, and file-level diffs from a local git repo.
 */

import { execFile } from 'child_process';
import * as path from 'path';

export interface GitBranchInfo {
  currentBranch: string;
  defaultBranch: string;
  aheadCount: number;
  behindCount: number;
  recentCommits: GitCommitInfo[];
}

export interface GitCommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string;
}

function gitExec(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 10_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`git ${args[0]} failed: ${stderr || err.message}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

export async function isGitRepo(projectPath: string): Promise<boolean> {
  try {
    await gitExec(['rev-parse', '--is-inside-work-tree'], projectPath);
    return true;
  } catch {
    return false;
  }
}

export async function getCurrentBranch(projectPath: string): Promise<string> {
  return gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath);
}

export async function getDefaultBranch(projectPath: string): Promise<string> {
  try {
    const ref = await gitExec(['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], projectPath);
    return ref.replace('origin/', '');
  } catch {
    try {
      await gitExec(['rev-parse', '--verify', 'main'], projectPath);
      return 'main';
    } catch {
      return 'master';
    }
  }
}

export async function getAheadBehind(projectPath: string, branch: string, defaultBranch: string): Promise<{ ahead: number; behind: number }> {
  try {
    const output = await gitExec(
      ['rev-list', '--left-right', '--count', `origin/${defaultBranch}...${branch}`],
      projectPath,
    );
    const parts = output.split('\t');
    return {
      behind: parseInt(parts[0], 10) || 0,
      ahead: parseInt(parts[1], 10) || 0,
    };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

export async function getRecentCommits(projectPath: string, count: number = 10): Promise<GitCommitInfo[]> {
  try {
    const output = await gitExec(
      ['log', `--max-count=${count}`, '--format=%H|%s|%an|%aI'],
      projectPath,
    );
    if (!output) return [];

    return output.split('\n').map((line) => {
      const [sha, message, author, date] = line.split('|');
      return { sha, message, author, date };
    });
  } catch {
    return [];
  }
}

export async function getChangedFiles(projectPath: string, defaultBranch: string): Promise<string[]> {
  try {
    const output = await gitExec(
      ['diff', '--name-only', `origin/${defaultBranch}...HEAD`],
      projectPath,
    );
    if (!output) return [];
    return output.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export async function getGitRemoteUrl(projectPath: string): Promise<string | null> {
  try {
    return await gitExec(['config', '--get', 'remote.origin.url'], projectPath);
  } catch {
    return null;
  }
}

export function parseGitHubUrl(remoteUrl: string): { owner: string; repo: string } | null {
  const httpsMatch = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  return null;
}

export async function getBranchInfo(projectPath: string): Promise<GitBranchInfo> {
  const currentBranch = await getCurrentBranch(projectPath);
  const defaultBranch = await getDefaultBranch(projectPath);
  const { ahead, behind } = await getAheadBehind(projectPath, currentBranch, defaultBranch);
  const recentCommits = await getRecentCommits(projectPath, 5);

  return {
    currentBranch,
    defaultBranch,
    aheadCount: ahead,
    behindCount: behind,
    recentCommits,
  };
}
