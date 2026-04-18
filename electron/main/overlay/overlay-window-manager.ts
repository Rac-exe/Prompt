import { BrowserWindow, screen, app } from 'electron';
import * as Sentry from '@sentry/electron/main';
import * as path from 'path';
import { forceFocusWindow } from '../utils/native-bridge';
import { analyticsService } from '../analytics/analytics-service';

/**
 * OverlayWindowManager
 *
 * Manages a single overlay BrowserWindow for quick prompt optimization.
 *
 * Lifecycle:
 *   - Pre-created at app startup
 *   - One-time compositor pre-heat: shown off-screen (invisible to user)
 *     so the DWM alpha surface is fully initialized before first open
 *   - Open  = move on-screen + focus  (NO window.show() call)
 *   - Close = park off-screen + blur  (NO window.hide() call)
 *   - This eliminates the DWM hide/show animation artifact that causes
 *     a faded "ghost" first-frame on transparent frameless windows
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

/** Off-screen coordinates used to "park" the window invisibly. */
const OFFSCREEN_X = -9999;
const OFFSCREEN_Y = -9999;

export class OverlayWindowManager {
  private window: BrowserWindow | null = null;

  /** true after the renderer has confirmed readiness AND the compositor
   *  pre-heat is complete.  Only then may the overlay be opened. */
  private isLoaded = false;

  /** true while preheatCompositor() is mid-flight (async).
   *  Prevents the fallback timer and the overlay:ready IPC from both
   *  entering preheatCompositor() concurrently before isLoaded is set. */
  private isPreheating = false;

  /** true when the user triggered open() before isLoaded became true.
   *  showAndFocus() will be called automatically once loading completes. */
  private shouldShowOnReady = false;

  /** true when the overlay is logically "open" (visible on-screen to the user).
   *  We track this ourselves because the window is never actually hidden — it
   *  is always "shown" (parked off-screen) after the one-time pre-heat. */
  private isOpen = false;

  /**
   * Pre-create the window so the first open is instant.
   * Call this during app initialization.
   */
  preload() {
    if (!this.window || this.window.isDestroyed()) {
      this.createWindow();
    }
  }

  /**
   * Create the overlay BrowserWindow (initially hidden, will be pre-heated
   * off-screen once the renderer signals readiness).
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
      ...(process.platform === 'darwin' ? { visibleOnAllWorkspaces: true } : {}),
      backgroundColor: '#00000000',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        devTools: !app.isPackaged,
        preload: path.join(app.getAppPath(), 'dist', 'preload.js'),
        // Keep renderer active when parked off-screen so the GPU framebuffer
        // stays current.  Without this, Chromium throttles the renderer and
        // the next on-screen move would show a stale frame.
        backgroundThrottling: false,
      },
    });

    // Keep overlay above screenshot tools and screen-capture UIs.
    // 'screen-saver' is the highest z-order level available on Windows/macOS.
    this.window.setAlwaysOnTop(true, 'screen-saver');

    if (process.platform === 'darwin') {
      this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      Sentry.setTag('overlay.visible_all_workspaces', 'true');
    }

    // ── Disable zoom completely ────────────────────────────────────────────
    // Clamp Chromium's pinch/gesture zoom to 1x so it cannot drift.
    this.window.webContents.setVisualZoomLevelLimits(1, 1);

    // Block Ctrl+=/+, Ctrl+-, Ctrl+0 — Chromium handles these natively and
    // they fire even without any JS handler, so we must swallow them here.
    this.window.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown' || !input.control) return;
      if (
        input.key === '=' || input.key === '+' ||
        input.key === '-' || input.key === '_' ||
        input.key === '0'
      ) {
        _event.preventDefault();
      }
    });

    // ── Renderer-driven readiness ──────────────────────────────────────────
    // The React app sends 'overlay:ready' after it has mounted and painted
    // its first frame.  We then pre-heat the DWM compositor by showing the
    // window off-screen (invisible to the user).  After that, open/close is
    // purely positional — no show()/hide() calls — eliminating the DWM
    // transition animation that causes a faded first-frame on transparent
    // windows.
    this.isLoaded = false;
    this.shouldShowOnReady = false;
    this.isOpen = false;

    if (process.platform === 'win32') {
      this.window.webContents.ipc.once('overlay:ready', () => {
        this.preheatCompositor();
      });

      this.window.webContents.once('did-finish-load', () => {
        setTimeout(() => {
          if (!this.isLoaded && this.window && !this.window.isDestroyed()) {
            console.warn('[OverlayWindowManager] Renderer did not send overlay:ready — fallback pre-heat');
            this.preheatCompositor();
          }
        }, 200);
      });
    } else {
      // macOS: no DWM pre-heat needed, mark as loaded once content is ready
      this.window.webContents.once('did-finish-load', () => {
        this.isLoaded = true;
        console.log('[OverlayWindowManager] Overlay ready (no pre-heat needed on macOS)');
        if (this.shouldShowOnReady) {
          this.shouldShowOnReady = false;
          this.showAndFocus();
        }
      });
    }

    const htmlPath = path.join(app.getAppPath(), 'electron', 'renderer', 'app-ui', 'overlay.html');
    this.window.loadFile(htmlPath);

    this.window.on('closed', () => {
      this.window = null;
      this.isLoaded = false;
      this.shouldShowOnReady = false;
      this.isOpen = false;
    });

    return this.window;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // COMPOSITOR PRE-HEAT
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * One-time DWM compositor initialization.
   *
   * Shows the window off-screen via `showInactive()` so that Windows DWM
   * creates and stabilizes the alpha compositor surface.  After this point
   * the window is never hidden again — open/close is purely positional,
   * which eliminates the DWM show/hide transition animation that causes
   * a faded "ghost" first-frame on transparent frameless windows.
   *
   * Flow:
   *   1. Force a fresh render (`invalidate`)
   *   2. Park the window off-screen
   *   3. `showInactive()` — DWM starts compositing (user cannot see it)
   *   4. Wait two full animation frames for the alpha surface to stabilize
   *   5. Mark as loaded — future opens just move the window on-screen
   */
  private async preheatCompositor() {
    if (this.isLoaded || this.isPreheating) return; // Already done or in-flight
    this.isPreheating = true; // Set synchronously before first await to block concurrent calls
    if (!this.window || this.window.isDestroyed()) { this.isPreheating = false; return; }

    // Force a fresh render so the framebuffer is up-to-date
    this.window.webContents.invalidate();

    // Park off-screen and show without stealing focus
    this.window.setPosition(OFFSCREEN_X, OFFSCREEN_Y);
    this.window.showInactive();

    // Wait two full compositor frames for the alpha surface to stabilize
    try {
      await this.window.webContents.executeJavaScript(
        'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))',
      );
    } catch (err) {
      Sentry.captureException(err, { tags: { component: 'overlay-window-manager', op: 'preheatCompositor' } });
    }

    // Guard: window may have been destroyed during the await
    if (!this.window || this.window.isDestroyed()) return;

    this.isLoaded = true;
    this.isPreheating = false;
    console.log('[OverlayWindowManager] Compositor pre-heated — overlay ready');

    // If the user already triggered open() before we finished, show now
    if (this.shouldShowOnReady) {
      this.shouldShowOnReady = false;
      this.showAndFocus();
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // OPEN / CLOSE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Open the overlay and send current auth state.
   *
   * @param isAuthenticated  - Current auth state to send to renderer.
   * @param anchorHwnd       - Optional: HWND of the window that triggered the open.
   * @param prefill          - Optional: pre-fill the input with text + attach a chat context.
   * @param triggeredByHook  - True when opened via @prompt keyboard hook (enables Replace button).
   */
  open(isAuthenticated: boolean, anchorHwnd?: number, prefill?: { text?: string; chatId?: string; chatName?: string }, triggeredByHook?: boolean, sentryUser?: { id: string; email: string } | null) {
    const openedPayload = { isAuthenticated, prefill: prefill || null, triggeredByHook: !!triggeredByHook, sentryUser: sentryUser ?? null };

    if (!this.window || this.window.isDestroyed()) {
      this.createWindow();

      // First load: send state after HTML finishes loading
      this.window!.webContents.once('did-finish-load', () => {
        this.send('overlay:opened', openedPayload);
      });
    } else {
      // Guard: already open — just re-focus, don't re-show
      if (this.isOpen) {
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
      // Compositor pre-heated — just focus (window is already "shown")
      this.showAndFocus();
    } else {
      // Window still loading / pre-heating — defer to preheatCompositor callback
      this.shouldShowOnReady = true;
    }
  }

  /**
   * Make the overlay visible to the user and steal focus.
   *
   * After the one-time compositor pre-heat, the window is permanently
   * "shown" (parked off-screen when closed).  `positionNearCursor()` has
   * already moved it to the correct screen position, so all we need to
   * do here is set the open flag and focus.
   *
   * No `window.show()` call — the window is already shown.
   * This is the key to eliminating the DWM transition flicker.
   */
  private showAndFocus() {
    if (!this.window || this.window.isDestroyed()) return;
    this.isOpen = true;
    if (process.platform === 'darwin') {
      // macOS: when @prompt is typed, the source app (Cursor, browser, etc.)
      // is the frontmost app and owns keyboard focus. To redirect keystrokes
      // into the overlay's input we must:
      //   1. Make Electron the frontmost app  -> app.focus({ steal: true })
      //   2. Show + activate the overlay window itself -> show() (NOT showInactive)
      //   3. Move it above any other Prmpt windows -> moveTop()
      // showInactive() + moveTop() alone bring the window on top visually
      // but leave keyboard focus on the source app, so typing keeps going
      // there instead of the overlay input.
      app.focus({ steal: true });
      this.window.show();
      this.window.moveTop();
      Sentry.addBreadcrumb({ category: 'overlay', message: 'macOS app.focus + show + moveTop', level: 'info' });
    }
    Sentry.addBreadcrumb({ category: 'overlay', message: 'Overlay opened', level: 'info' });
    analyticsService.logEvent('overlay_open');
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
    if (process.platform === 'darwin') {
      // Re-focus path (e.g. when @prompt is typed while overlay is already
      // open). Same reasoning as in showAndFocus(): we have to make Electron
      // the frontmost app and then activate this BrowserWindow, otherwise
      // keyboard focus stays on whatever the user just typed into.
      app.focus({ steal: true });
      this.window.show();
      this.window.focus();
      this.window.moveTop();
      Sentry.addBreadcrumb({ category: 'overlay', message: 'macOS app.focus + show + focus + moveTop', level: 'info' });
    } else {
      const overlayHwnd = this.window.getNativeWindowHandle().readBigInt64LE(0);
      const focused = forceFocusWindow(Number(overlayHwnd));
      if (!focused) {
        this.window.focus();
      }
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
   * Close the overlay (park off-screen, keep window alive and composited).
   *
   * Instead of `window.hide()` (which would remove the window from the DWM
   * compositor pipeline and cause a flicker on the next show), we park the
   * window off-screen and blur it so the previous app regains focus.
   */
  close() {
    if (this.window && !this.window.isDestroyed()) {
      this.isOpen = false;
      Sentry.addBreadcrumb({ category: 'overlay', message: 'Overlay closed', level: 'info' });
      if (process.platform === 'darwin') {
        this.window.hide();
        Sentry.addBreadcrumb({ category: 'overlay', message: 'macOS overlay hidden', level: 'info' });
      } else {
        this.window.setPosition(OFFSCREEN_X, OFFSCREEN_Y);
        this.window.blur();
      }
    }
  }

  /**
   * Toggle overlay visibility.
   */
  toggle(isAuthenticated: boolean, sentryUser?: { id: string; email: string } | null) {
    if (this.isOpen) {
      this.close();
    } else {
      this.open(isAuthenticated, undefined, undefined, undefined, sentryUser);
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
    try {
      if (this.window && !this.window.isDestroyed() && this.window.webContents && !this.window.webContents.isDestroyed()) {
        this.window.webContents.send(channel, data);
      }
    } catch (err) {
      Sentry.captureException(err, { tags: { component: 'overlay-window-manager', op: 'send' }, extra: { channel } });
    }
  }

  /**
   * Get the BrowserWindow instance.
   */
  getWindow(): BrowserWindow | null {
    return this.window;
  }

  /**
   * Check if overlay is currently visible to the user.
   */
  isVisible(): boolean {
    return this.isOpen && this.window !== null && !this.window.isDestroyed();
  }

  /**
   * Destroy the overlay completely.
   */
  destroy() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
    this.isOpen = false;
  }
}
