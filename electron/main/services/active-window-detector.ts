/**
 * Phase 2: Active window detection for auto-project switching.
 * Polls the OS active window title every 2 seconds and matches
 * against known project names to auto-switch the overlay context.
 */

import type { ProjectInfo } from '../api/code-intel-client';
import * as Sentry from '@sentry/electron/main';

let activeWin: any = null;
let pollInterval: NodeJS.Timeout | null = null;
let knownProjects: ProjectInfo[] = [];
let currentMatchedProjectId: string | null = null;
let onProjectDetected: ((project: ProjectInfo) => void) | null = null;
let onProjectLost: (() => void) | null = null;

const POLL_INTERVAL_MS = 2000;

try {
  activeWin = require('active-win');
} catch (err) {
  console.warn('[ActiveWindowDetector] active-win not available — auto-detect disabled');
  Sentry.captureException(err, { level: 'warning', tags: { component: 'active-window-detector', op: 'load-module' } });
}

export function setKnownProjects(projects: ProjectInfo[]): void {
  knownProjects = projects;
}

export function startDetection(
  callbacks: {
    onDetected: (project: ProjectInfo) => void;
    onLost: () => void;
  },
): void {
  if (!activeWin) {
    console.warn('[ActiveWindowDetector] Cannot start — active-win not available');
    return;
  }

  stopDetection();

  onProjectDetected = callbacks.onDetected;
  onProjectLost = callbacks.onLost;

  pollInterval = setInterval(async () => {
    try {
      const win = await activeWin();
      if (!win?.title) {
        if (currentMatchedProjectId) {
          currentMatchedProjectId = null;
          onProjectLost?.();
        }
        return;
      }

      const title = win.title.toLowerCase();

      const matched = knownProjects.find((p) => {
        const name = p.name.toLowerCase();
        return title.includes(name);
      });

      if (matched) {
        if (matched.id !== currentMatchedProjectId) {
          currentMatchedProjectId = matched.id;
          onProjectDetected?.(matched);
        }
      } else {
        if (currentMatchedProjectId) {
          currentMatchedProjectId = null;
          onProjectLost?.();
        }
      }
    } catch (e) {
      console.error('[ActiveWindowDetector] Poll error:', e);
      Sentry.captureException(e, { level: 'warning', tags: { component: 'active-window-detector', op: 'poll' } });
    }
  }, POLL_INTERVAL_MS);

  Sentry.addBreadcrumb({ category: 'active-window-detector', message: 'Detection started', level: 'info' });
  console.log('[ActiveWindowDetector] Started polling');
}

export function stopDetection(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    Sentry.addBreadcrumb({ category: 'active-window-detector', message: 'Detection stopped', level: 'info' });
    console.log('[ActiveWindowDetector] Stopped polling');
  }
  currentMatchedProjectId = null;
}

export function getCurrentDetectedProjectId(): string | null {
  return currentMatchedProjectId;
}
