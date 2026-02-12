import { BrowserWindow, screen, app } from 'electron';
import * as path from 'path';

/**
 * OverlayWindowManager
 *
 * Manages a single overlay BrowserWindow for quick prompt optimization.
 *
 * Lifecycle:
 *   - Pre-created (hidden) at app startup for instant first open
 *   - Shown/hidden via toggle (Ctrl+5, tray, @prompt trigger)
 *   - Independent of main app window
 *   - Persists while app runs in background
 *
 * Auth Guard Flow:
 *   1. User presses Ctrl+5
 *   2. Main process checks authState.isAuthenticated
 *   3. Sends overlay:opened with { isAuthenticated }
 *   4. If NOT authenticated → renderer shows "Login Required" screen
 *   5. If authenticated → renderer shows optimization input
 *
 * Save Flow:
 *   1. User clicks Save in overlay
 *   2. Renderer invokes overlay:save via IPC
 *   3. Main verifies auth → PromptLibraryService.savePrompt → returns result
 *   4. Renderer shows success/error feedback
 */
export class OverlayWindowManager {
  private window: BrowserWindow | null = null;

  /**
   * Pre-create the window (hidden) so the first open is instant.
   * Call this during app initialization.
   */
  preload() {
    if (!this.window || this.window.isDestroyed()) {
      this.createWindow();
    }
  }

  /**
   * Create the overlay BrowserWindow (hidden).
   */
  private createWindow(): BrowserWindow {
    const display = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = display.workAreaSize;

    const overlayWidth = 520;
    const overlayHeight = 600;

    this.window = new BrowserWindow({
      width: overlayWidth,
      height: overlayHeight,
      x: Math.floor((screenWidth - overlayWidth) / 2),
      y: Math.floor((screenHeight - overlayHeight) / 2),
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      movable: true,
      show: false,
      focusable: true,
      hasShadow: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(app.getAppPath(), 'dist', 'preload.js'),
      },
    });

    const htmlPath = path.join(app.getAppPath(), 'electron', 'renderer', 'overlay.html');
    this.window.loadFile(htmlPath);

    this.window.on('closed', () => {
      this.window = null;
    });

    return this.window;
  }

  /**
   * Open the overlay and send current auth state.
   */
  open(isAuthenticated: boolean) {
    if (!this.window || this.window.isDestroyed()) {
      this.createWindow();

      // First load: send state after HTML finishes loading
      this.window!.webContents.once('did-finish-load', () => {
        this.send('overlay:opened', { isAuthenticated });
      });
    } else {
      // Subsequent opens: send immediately since content is already loaded
      this.send('overlay:opened', { isAuthenticated });
    }

    this.window!.show();
    this.window!.focus();
  }

  /**
   * Hide the overlay (keep window alive for fast re-open).
   */
  close() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }
  }

  /**
   * Toggle overlay visibility.
   */
  toggle(isAuthenticated: boolean) {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
      this.close();
    } else {
      this.open(isAuthenticated);
    }
  }

  /**
   * Send auth state update to the renderer.
   */
  sendAuthState(isAuthenticated: boolean) {
    this.send('overlay:auth-state', { isAuthenticated });
  }

  /**
   * Send an IPC message to the overlay renderer.
   */
  send(channel: string, data?: any) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, data);
    }
  }

  /**
   * Get the BrowserWindow instance.
   */
  getWindow(): BrowserWindow | null {
    return this.window;
  }

  /**
   * Check if overlay is currently visible.
   */
  isVisible(): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.window.isVisible();
  }

  /**
   * Destroy the overlay completely.
   */
  destroy() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
  }
}
