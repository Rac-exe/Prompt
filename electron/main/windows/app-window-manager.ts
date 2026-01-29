import { BrowserWindow, app } from 'electron';
import * as path from 'path';

/**
 * Manages the main application window (ChatGPT-like interface)
 * Lifecycle: Independent of overlay, can be opened/closed freely
 */
export class AppWindowManager {
  private window: BrowserWindow | null = null;

  /**
   * Create the main application window
   */
  create() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      return;
    }

    this.window = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1200,
      minHeight: 700,
      show: false,
      backgroundColor: '#000000',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(app.getAppPath(), 'dist', 'preload.js'),
      },
    });

    const htmlPath = path.join(app.getAppPath(), 'electron', 'renderer', 'app-ui', 'index.html');
    this.window.loadFile(htmlPath);

    this.window.once('ready-to-show', () => {
      if (this.window) {
        this.window.show();
        this.window.focus();
      }
    });

    // CRITICAL: Don't quit app when window closes
    this.window.on('close', (event) => {
      console.log('[AppWindowManager] Window closing - hiding instead of quitting');
      // Just hide the window, don't quit the app
      if (this.window) {
        this.window.hide();
      }
    });

    this.window.on('closed', () => {
      this.window = null;
    });

    console.log('[AppWindowManager] Main app window created');
  }

  /**
   * Show the window (create if needed)
   */
  show() {
    if (!this.window || this.window.isDestroyed()) {
      this.create();
    } else {
      this.window.show();
      this.window.focus();
    }
  }

  /**
   * Hide the window
   */
  hide() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }
  }

  /**
   * Get the window instance
   */
  getWindow(): BrowserWindow | null {
    return this.window;
  }

  /**
   * Send IPC message to window
   */
  send(channel: string, ...args: any[]) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, ...args);
    }
  }

  /**
   * Check if window is visible
   */
  isVisible(): boolean {
    return this.window ? this.window.isVisible() : false;
  }

  /**
   * Destroy the window completely
   */
  destroy() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
  }
}
