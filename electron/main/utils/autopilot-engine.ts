/**
 * autopilot-engine.ts
 *
 * State machine that auto-pastes multi-section prompts into a target window.
 *
 * Chat mode:  paste section → Enter → wait N seconds → repeat
 * Document mode: join all sections → single paste
 */

import { pasteTextToWindow, sendEnterToWindow, forceFocusWindow } from './native-bridge';
import { OverlayWindowManager } from '../overlay/overlay-window-manager';

export type AutopilotStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error' | 'cancelled';

export interface AutopilotConfig {
  mode: 'chat' | 'document';
  sections: string[];
  sourceHwnd: number;
  waitSeconds: number;
  overlayManager: OverlayWindowManager;
}

export interface AutopilotProgress {
  status: AutopilotStatus;
  currentSection: number;
  totalSections: number;
  waitRemaining: number;
  error?: string;
}

type ProgressCallback = (progress: AutopilotProgress) => void;

export class AutopilotEngine {
  private config: AutopilotConfig | null = null;
  private status: AutopilotStatus = 'idle';
  private currentSection = 0;
  private waitRemaining = 0;
  private aborted = false;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private onProgress: ProgressCallback | null = null;

  start(config: AutopilotConfig, onProgress: ProgressCallback): void {
    this.config = config;
    this.onProgress = onProgress;
    this.aborted = false;
    this.currentSection = 0;
    this.status = 'running';

    if (config.mode === 'document') {
      this.runDocumentMode();
    } else {
      this.runChatMode();
    }
  }

  stop(): void {
    this.aborted = true;
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.status = 'cancelled';
    this.emitProgress();
  }

  getStatus(): AutopilotStatus {
    return this.status;
  }

  private emitProgress(): void {
    if (!this.onProgress || !this.config) return;
    this.onProgress({
      status: this.status,
      currentSection: this.currentSection,
      totalSections: this.config.sections.length,
      waitRemaining: this.waitRemaining,
    });
  }

  private async runDocumentMode(): Promise<void> {
    if (!this.config) return;

    const fullText = this.config.sections.join('\n\n---\n\n');
    this.currentSection = this.config.sections.length;
    this.emitProgress();

    // Temporarily hide overlay so it doesn't block the paste target
    const overlayWin = this.config.overlayManager.getWindow();
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.setOpacity(0);
    }

    await this.sleep(100);

    const ok = pasteTextToWindow(this.config.sourceHwnd, fullText);

    await this.sleep(200);

    // Restore overlay
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.setOpacity(1);
      this.refocusOverlay();
    }

    if (!ok) {
      this.status = 'error';
      this.emitProgress();
      return;
    }

    this.status = 'completed';
    this.emitProgress();
  }

  private async runChatMode(): Promise<void> {
    if (!this.config) return;
    const { sections, sourceHwnd, waitSeconds } = this.config;

    for (let i = 0; i < sections.length; i++) {
      if (this.aborted) return;

      this.currentSection = i;
      this.status = 'running';
      this.emitProgress();

      // Hide overlay momentarily for paste
      const overlayWin = this.config.overlayManager.getWindow();
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.setOpacity(0);
      }

      await this.sleep(100);

      const pasteOk = pasteTextToWindow(sourceHwnd, sections[i]);
      if (!pasteOk) {
        this.status = 'error';
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.setOpacity(1);
          this.refocusOverlay();
        }
        this.emitProgress();
        return;
      }

      // Brief settle before Enter
      await this.sleep(200);

      if (this.aborted) {
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.setOpacity(1);
          this.refocusOverlay();
        }
        return;
      }

      sendEnterToWindow(sourceHwnd);

      await this.sleep(300);

      // Restore overlay visibility
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.setOpacity(1);
        this.refocusOverlay();
      }

      // Wait between sections (skip wait after the last section)
      if (i < sections.length - 1) {
        await this.waitWithCountdown(waitSeconds);
        if (this.aborted) return;
      }
    }

    this.currentSection = sections.length;
    this.status = 'completed';
    this.emitProgress();
  }

  private waitWithCountdown(seconds: number): Promise<void> {
    return new Promise((resolve) => {
      this.waitRemaining = seconds;
      this.status = 'paused';
      this.emitProgress();

      this.countdownTimer = setInterval(() => {
        if (this.aborted) {
          if (this.countdownTimer) {
            clearInterval(this.countdownTimer);
            this.countdownTimer = null;
          }
          resolve();
          return;
        }

        this.waitRemaining--;
        this.emitProgress();

        if (this.waitRemaining <= 0) {
          if (this.countdownTimer) {
            clearInterval(this.countdownTimer);
            this.countdownTimer = null;
          }
          resolve();
        }
      }, 1000);
    });
  }

  private refocusOverlay(): void {
    if (!this.config) return;
    const win = this.config.overlayManager.getWindow();
    if (win && !win.isDestroyed()) {
      const hwnd = win.getNativeWindowHandle().readBigInt64LE(0);
      forceFocusWindow(Number(hwnd));
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
