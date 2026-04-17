import { BrowserWindow, app, nativeImage, ipcMain } from 'electron';
import * as Sentry from '@sentry/electron/main';
import * as path from 'path';

const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];
const DEFAULT_ZOOM = 1.0;
const MIN_ZOOM = ZOOM_STEPS[0];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

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

    const isMac = process.platform === 'darwin';
    const iconExt = isMac ? 'icon.icns' : 'icon.ico';
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, iconExt)
      : path.join(app.getAppPath(), 'build', iconExt);
    const icon = nativeImage.createFromPath(iconPath);

    this.window = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1200,
      minHeight: 700,
      show: false,
      ...(isMac
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 12 } }
        : { frame: false }),
      autoHideMenuBar: true,
      backgroundColor: '#0d1117',
      ...(icon && !icon.isEmpty() ? { icon } : {}),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        plugins: true,
        devTools: !app.isPackaged,
        preload: path.join(app.getAppPath(), 'dist', 'preload.js'),
      },
    });

    if (isMac) {
      Sentry.addBreadcrumb({ category: 'window', message: 'macOS titleBarStyle: hiddenInset applied', level: 'info' });
    }

    if (icon && !icon.isEmpty()) {
      if (isMac) {
        try {
          app.dock?.setIcon(icon);
          Sentry.addBreadcrumb({ category: 'window', message: 'macOS dock icon set', level: 'info' });
        } catch (err) {
          Sentry.captureException(err, { tags: { component: 'app-window', op: 'dock-set-icon', platform: 'darwin' } });
        }
      } else {
        this.window.setIcon(icon);
      }
    }

    const htmlPath = path.join(app.getAppPath(), 'electron', 'renderer', 'app-ui', 'index.html');
    this.window.loadFile(htmlPath);

    this.window.once('ready-to-show', () => {
      this.isLoaded = true;
    });

    this.window.webContents.on('before-input-event', (_event, input) => {
      if (!this.window) return;
      const wc = this.window.webContents;

      // Block Ctrl+R / Ctrl+Shift+R hard reload
      if (input.control && (input.key === 'r' || input.key === 'R')) {
        _event.preventDefault();
        return;
      }

      if (input.type !== 'keyDown' || !input.control) return;

      // Zoom in: Ctrl+=, Ctrl+Shift+=, Ctrl+numpad+
      if (input.key === '=' || input.key === '+') {
        _event.preventDefault();
        const current = wc.getZoomFactor();
        const next = ZOOM_STEPS.find(s => s > current + 0.001);
        if (next) {
          wc.setZoomFactor(next);
          this.broadcastZoom(next);
        }
        return;
      }

      // Zoom out: Ctrl+-, Ctrl+numpad-
      if (input.key === '-') {
        _event.preventDefault();
        const current = wc.getZoomFactor();
        const prev = [...ZOOM_STEPS].reverse().find(s => s < current - 0.001);
        if (prev) {
          wc.setZoomFactor(prev);
          this.broadcastZoom(prev);
        }
        return;
      }

      // Reset zoom: Ctrl+0
      if (input.key === '0') {
        _event.preventDefault();
        wc.setZoomFactor(DEFAULT_ZOOM);
        this.broadcastZoom(DEFAULT_ZOOM);
        return;
      }
    });

    this.registerZoomIpc();

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

    Sentry.addBreadcrumb({ category: 'window', message: 'Main app window created', level: 'info' });
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
      if (!this.window.isVisible()) {
        Sentry.addBreadcrumb({ category: 'window', message: 'App window show (opacity fade-in)', level: 'info' });
        const win = this.window;
        win.setOpacity(0);
        win.show();
        setTimeout(() => {
          if (win && !win.isDestroyed()) {
            win.setOpacity(1);
            win.focus();
          }
        }, 50);
      } else {
        this.window.show();
        this.window.focus();
      }
    } else {
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
    try {
      if (this.window && !this.window.isDestroyed() && this.window.webContents && !this.window.webContents.isDestroyed()) {
        this.window.webContents.send(channel, ...args);
      }
    } catch (err) {
      Sentry.captureException(err, { tags: { component: 'app-window-manager', op: 'send' }, extra: { channel } });
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

  private broadcastZoom(factor: number) {
    Sentry.addBreadcrumb({ category: 'zoom', message: 'Zoom level changed', level: 'info', data: { percent: Math.round(factor * 100) } });
    this.send('zoom:changed', { percent: Math.round(factor * 100) });
  }

  private registerZoomIpc() {
    ipcMain.removeHandler('zoom:get');
    ipcMain.removeHandler('zoom:set');

    ipcMain.handle('zoom:get', (event) => {
      const wc = event.sender;
      if (wc.isDestroyed()) return { percent: 100 };
      return { percent: Math.round(wc.getZoomFactor() * 100) };
    });

    ipcMain.handle('zoom:set', (event, percent: number) => {
      const wc = event.sender;
      if (wc.isDestroyed()) return;
      const clamped = Math.max(MIN_ZOOM * 100, Math.min(MAX_ZOOM * 100, percent));
      const factor = clamped / 100;
      wc.setZoomFactor(factor);
      wc.send('zoom:changed', { percent: Math.round(factor * 100) });
    });
  }
}
