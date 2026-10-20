import { BrowserWindow, app, nativeImage, ipcMain } from 'electron';
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

    const isMac = process.platform === 'darwin';
    const iconExt = isMac ? 'icon.icns' : 'icon.ico';
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, iconExt)
      : path.join(app.getAppPath(), 'build', iconExt);
    const icon = nativeImage.createFromPath(iconPath);

    // In dev, Electron may not render .icns correctly — use PNG for dock
    const dockIconPath = app.isPackaged
      ? path.join(process.resourcesPath, iconExt)
      : path.join(app.getAppPath(), 'build', 'dock-icon.png');
    const dockIcon = nativeImage.createFromPath(dockIconPath);

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
    }

    if (isMac) {
      const iconForDock = dockIcon.isEmpty() ? icon : dockIcon;
      if (!iconForDock.isEmpty()) {
        try {
          app.dock?.setIcon(iconForDock);
        } catch (err) {
          console.error('[AppWindowManager] dock.setIcon failed:', err);
        }
      }
    } else if (icon && !icon.isEmpty()) {
      this.window.setIcon(icon);
    }

    const htmlPath = path.join(app.getAppPath(), 'electron', 'renderer', 'app-ui', 'index.html');
    this.window.loadFile(htmlPath);

    this.window.once('ready-to-show', () => {
      this.isLoaded = true;
    });

    // Lock pinch / gesture zoom to 1x — defence in depth alongside the
    // before-input-event handler below.
    this.window.webContents.setVisualZoomLevelLimits(1, 1);

    // Swallow zoom (Ctrl/Cmd + = / + / - / _ / 0) and reload (Ctrl/Cmd + R,
    // Ctrl/Cmd + Shift + R, F5) shortcuts on both platforms. Zoom in/out/reset
    // are intentionally disabled across the entire app.
    this.window.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown') return;

      if (input.key === 'F5') {
        _event.preventDefault();
        return;
      }

      const isAccel = input.control || input.meta;
      if (!isAccel) return;

      const k = input.key.toLowerCase();
      if (
        k === '=' || k === '+' ||
        k === '-' || k === '_' ||
        k === '0' ||
        k === 'r'
      ) {
        _event.preventDefault();
      }
    });

    this.registerZoomIpc();

    // CRITICAL: Don't quit app when window closes — hide instead, stay alive in tray
    this.window.on('close', (e) => {
      e.preventDefault();
      console.log('[AppWindowManager] Window close intercepted — hiding to tray');
      if (this.window) {
        this.window.hide();
      }
      if (process.platform === 'darwin') {
        app.dock?.hide();
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
    if (process.platform === 'darwin') {
      app.dock?.show();
    }

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
    if (process.platform === 'darwin') {
      app.dock?.show();
    }

    if (!this.window || this.window.isDestroyed()) {
      this.create();
    } else if (this.isLoaded) {
      if (!this.window.isVisible()) {
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
    if (process.platform === 'darwin') {
      app.dock?.hide();
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
      console.error('[AppWindowManager] send failed:', err);
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

  // Zoom is intentionally disabled app-wide. The IPC handlers stay registered
  // so the renderer's existing zoom calls don't error out — they just always
  // report 100 % and silently no-op on set. The ZoomIndicator UI never
  // becomes visible because it only renders on a `zoom:changed` event.
  private registerZoomIpc() {
    ipcMain.removeHandler('zoom:get');
    ipcMain.removeHandler('zoom:set');

    ipcMain.handle('zoom:get', () => ({ percent: 100 }));
    ipcMain.handle('zoom:set', () => ({ percent: 100 }));
  }
}
