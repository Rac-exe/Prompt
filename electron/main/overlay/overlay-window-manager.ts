import { BrowserWindow, screen, app } from 'electron';
import * as path from 'path';
import { forceFocusWindow } from '../utils/native-bridge';

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
  private isLoaded = false;
  private shouldShowOnReady = false;

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
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(app.getAppPath(), 'dist', 'preload.js'),
        // Keep renderer active when hidden so the GPU framebuffer stays current.
        // Without this, Chromium throttles the renderer when the window is hidden,
        // causing a stale frame to be presented on the next window.show() call —
        // visible as a brief flicker on transparent frameless windows on Windows.
        backgroundThrottling: false,
      },
    });

    // Keep overlay above screenshot tools and screen-capture UIs.
    // 'screen-saver' is the highest z-order level available on Windows/macOS.
    this.window.setAlwaysOnTop(true, 'screen-saver');

    // After the React/Vite refactor the overlay is built alongside the main
    // app-ui bundle.  Vite multi-page build places it at:
    //   electron/renderer/app-ui/overlay.html

    // Renderer-driven readiness: the React app sends 'overlay:ready' after it
    // has mounted and painted its first frame.  This is more reliable than
    // Electron's 'ready-to-show' which fires before CSS/React are fully applied
    // on transparent windows.
    this.isLoaded = false;
    this.shouldShowOnReady = false;

    // Listen for renderer signal (registered once per window via webContents.ipc
    // so it auto-cleans on destroy and can't leak across window instances).
    this.window.webContents.ipc.once('overlay:ready', () => {
      this.isLoaded = true;
      if (this.shouldShowOnReady) {
        this.shouldShowOnReady = false;
        this.showAndFocus();
      }
    });

    // Safety fallback: if the renderer signal fails (e.g. preload error),
    // show after did-finish-load + a short delay so we never get stuck hidden.
    this.window.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        if (!this.isLoaded && this.window && !this.window.isDestroyed() && !this.window.isVisible()) {
          console.warn('[OverlayWindowManager] Renderer did not send overlay:ready — fallback show');
          this.isLoaded = true;
          if (this.shouldShowOnReady) {
            this.shouldShowOnReady = false;
            this.showAndFocus();
          }
        }
      }, 200);
    });

    const htmlPath = path.join(app.getAppPath(), 'electron', 'renderer', 'app-ui', 'overlay.html');
    this.window.loadFile(htmlPath);

    this.window.on('closed', () => {
      this.window = null;
      this.isLoaded = false;
      this.shouldShowOnReady = false;
    });

    return this.window;
  }

  /**
   * Open the overlay and send current auth state.
   *
   * @param isAuthenticated - Current auth state to send to renderer.
   * @param anchorHwnd      - Optional: HWND of the window that triggered the open.
   * @param prefill         - Optional: pre-fill the input with text + attach a chat context.
   */
  open(isAuthenticated: boolean, anchorHwnd?: number, prefill?: { text?: string; chatId?: string; chatName?: string }) {
    const openedPayload = { isAuthenticated, prefill: prefill || null };

    if (!this.window || this.window.isDestroyed()) {
      this.createWindow();

      // First load: send state after HTML finishes loading
      this.window!.webContents.once('did-finish-load', () => {
        this.send('overlay:opened', openedPayload);
      });
    } else {
      // Guard: already visible — just re-focus, don't re-show (prevents flicker / focus jump)
      if (this.window.isVisible()) {
        this.send('overlay:opened', openedPayload);
        this.focusWindow();
        return;
      }

      // Subsequent opens: send immediately since content is already loaded
      this.send('overlay:opened', openedPayload);
    }

    // Position near cursor (like Raycast / Cursor inline assistant)
    this.positionNearCursor();

    if (this.isLoaded) {
      // Content is ready — show immediately
      this.showAndFocus();
    } else {
      // Window still loading from createWindow() — defer to overlay:ready callback
      this.shouldShowOnReady = true;
    }
  }

  /**
   * Show the window and steal focus via Win32 APIs.
   * This is the ONLY place show() is called.
   *
   * By the time this runs, the renderer has already confirmed that React is
   * mounted and the first frame is painted (via the overlay:ready IPC signal),
   * so the window can be shown immediately without flicker.
   */
  private showAndFocus() {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.show();
    this.focusWindow();
  }

  /**
   * Win32-level focus steal.
   * forceFocusWindow() calls AllowSetForegroundWindow + AttachThreadInput +
   * SetForegroundWindow synchronously in the Rust thread — this works even when
   * the target app currently holds the foreground lock (which Electron's
   * async focus() call often cannot break during fast typing).
   */
  private focusWindow() {
    if (!this.window || this.window.isDestroyed()) return;
    const overlayHwnd = this.window.getNativeWindowHandle().readBigInt64LE(0);
    const focused = forceFocusWindow(Number(overlayHwnd));
    if (!focused) {
      // AttachThreadInput fallback failed — try Electron's own focus as last resort.
      this.window.focus();
    }
  }

  /**
   * Position the overlay near the current cursor position.
   * Clamps to screen bounds so it never goes off-screen.
   * Appears slightly below and to the right of the cursor
   * to avoid covering the text being typed.
   */
  private positionNearCursor() {
    if (!this.window || this.window.isDestroyed()) return;

    const cursor = screen.getCursorScreenPoint();
    const currentDisplay = screen.getDisplayNearestPoint(cursor);
    const workArea = currentDisplay.workArea;
    const [overlayWidth, overlayHeight] = this.window.getSize();

    // Offset: slightly below and right of cursor
    const offsetX = 10;
    const offsetY = 24;

    let x = cursor.x + offsetX;
    let y = cursor.y + offsetY;

    // Clamp right edge: if overlay goes past the right side, flip to left of cursor
    if (x + overlayWidth > workArea.x + workArea.width) {
      x = cursor.x - overlayWidth - offsetX;
    }

    // Clamp bottom edge: if overlay goes below, position above cursor
    if (y + overlayHeight > workArea.y + workArea.height) {
      y = cursor.y - overlayHeight - offsetY;
    }

    // Clamp left/top edges (safety)
    x = Math.max(workArea.x, x);
    y = Math.max(workArea.y, y);

    this.window.setPosition(Math.round(x), Math.round(y));
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
