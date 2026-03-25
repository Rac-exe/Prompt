import { BrowserWindow, app, nativeImage } from 'electron';
import * as path from 'path';

/**
 * Manages the main application window (ChatGPT-like interface)
 * Lifecycle: Independent of overlay, can be opened/closed freely
 */
export class AppWindowManager {
  private window: BrowserWindow | null = null;
  private isLoaded = false;

  /**
   * Pre-create the window (hidden) so the first open is instant.
   * Call this during app initialization, before the user opens the app.
   */
  preload() {
    if (this.window && !this.window.isDestroyed()) return;
    this.createWindowHidden();
    console.log('[AppWindowManager] App window preloaded (hidden)');
  }

  /**
   * Create the window hidden and load the HTML.
   * Used by both preload() and create() when no window exists.
   */
  private createWindowHidden() {
    this.isLoaded = false;

    const iconPath = path.join(app.getAppPath(), 'electron', 'resources', 'icon.png');
    const icon = nativeImage.createFromPath(iconPath);

    this.window = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1200,
      minHeight: 700,
      show: false,
      frame: false,          // removes native title bar + menu bar entirely
      autoHideMenuBar: true, // belt-and-suspenders: also hides the menu bar
      backgroundColor: '#0d1117',
      icon,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        plugins: true, // Enable Chromium PDF viewer for inline PDF preview
        preload: path.join(app.getAppPath(), 'dist', 'preload.js'),
      },
    });

    const htmlPath = path.join(app.getAppPath(), 'electron', 'renderer', 'app-ui', 'index.html');
    this.window.loadFile(htmlPath);

    // Track when the window is fully loaded
    this.window.once('ready-to-show', () => {
      this.isLoaded = true;
    });

    // Disable Ctrl+R / Ctrl+Shift+R (hard reload) so the user can't
    // accidentally wipe in-memory state by pressing the browser refresh shortcut.
    this.window.webContents.on('before-input-event', (_event, input) => {
      if (
        input.control &&
        (input.key === 'r' || input.key === 'R')
      ) {
        _event.preventDefault();
      }
    });

    // CRITICAL: Don't quit app when window closes
    this.window.on('close', () => {
      console.log('[AppWindowManager] Window closing - hiding instead of quitting');
      if (this.window) {
        this.window.hide();
      }
    });

    this.window.on('closed', () => {
      this.window = null;
      this.isLoaded = false;
    });

    console.log('[AppWindowManager] Main app window created');
  }

  /**
   * Create the main application window and show it immediately.
   * If already preloaded, shows instantly. Otherwise creates and waits for ready-to-show.
   */
  create() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      return;
    }

    this.createWindowHidden();

    // Not preloaded — wait for ready-to-show
    this.window!.once('ready-to-show', () => {
      if (this.window) {
        this.window.show();
        this.window.focus();
      }
    });
  }

  /**
   * Show the window (create if needed).
   * If preloaded and loaded, shows instantly.
   */
  show() {
    if (!this.window || this.window.isDestroyed()) {
      this.create();
    } else if (this.isLoaded) {
      // Already fully loaded — show instantly
      this.window.show();
      this.window.focus();
    } else {
      // Window exists but still loading — wait for ready-to-show
      this.window.once('ready-to-show', () => {
        if (this.window) {
          this.window.show();
          this.window.focus();
        }
      });
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
