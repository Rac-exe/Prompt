/**
 * native-bridge.ts
 *
 * Centralized loader for the Rust .node native module.
 * Import ONLY in Electron Main process code — never in renderer or preload.
 */

import * as path from 'path';
import { app } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { logger } from '@sentry/core';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TriggerAnchor {
    /** Raw HWND of the foreground window at the moment @prompt was detected. */
    hwnd: number;
    /** Always 7 for "@prompt". Used by the replacement engine to delete N chars. */
    triggerLen: number;
}

interface NativeBridge {
    getActiveWindowTitle(): string;
    startHook(callback: (err: Error | null, anchor: TriggerAnchor) => void): void;
    stopHook(): void;
    replaceAtLastAnchor(text: string): boolean;
    forceFocusWindow(hwnd: number): boolean;
    pasteTextToWindow(hwnd: number, text: string): boolean;
    sendEnterToWindow(hwnd: number): boolean;
    checkAccessibilityPermission(): boolean;
}

// ─── Stub (used when .node binary is absent) ─────────────────────────────────

const STUB: NativeBridge = {
    getActiveWindowTitle: () => '',
    startHook: () => { console.warn('[NativeBridge] startHook called but native module not loaded'); },
    stopHook: () => { },
    replaceAtLastAnchor: () => {
        console.warn('[NativeBridge] replaceAtLastAnchor called but native module not loaded');
        return false;
    },
    forceFocusWindow: () => {
        console.warn('[NativeBridge] forceFocusWindow called but native module not loaded');
        return false;
    },
    pasteTextToWindow: () => {
        console.warn('[NativeBridge] pasteTextToWindow called but native module not loaded');
        return false;
    },
    sendEnterToWindow: () => {
        console.warn('[NativeBridge] sendEnterToWindow called but native module not loaded');
        return false;
    },
    checkAccessibilityPermission: () => {
        return process.platform !== 'darwin';
    },
};

// ─── Lazy loader ──────────────────────────────────────────────────────────────

let _bridge: NativeBridge = STUB;
let _loaded = false;

function loadBridge(): NativeBridge {
    if (_loaded) return _bridge;
    _loaded = true;

    try {
        // In dev: __dirname = dist/main/utils/ → 3 levels up = project root.
        // In packaged: native module is in extraResources → process.resourcesPath.
        const nativeRoot = app.isPackaged
            ? process.resourcesPath
            : path.resolve(__dirname, '..', '..', '..');
        const nativeIndexPath = path.join(nativeRoot, 'native', 'platform-core', 'index.js');

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        _bridge = require(nativeIndexPath) as NativeBridge;
        console.log('[NativeBridge] Loaded from:', nativeIndexPath);
        Sentry.setTag('native_module_loaded', 'true');
        Sentry.setTag('native_module_platform', process.platform);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[NativeBridge] Not loaded — stub mode.\n  Fix: npm run native:build\n  Reason:', msg);
        Sentry.captureException(err instanceof Error ? err : new Error(msg), {
            tags: { component: 'native-bridge', platform: process.platform },
            extra: { reason: msg },
        });
        Sentry.setTag('native_module_loaded', 'false');
    }

    return _bridge;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns the title of the currently focused window. Returns "" on failure. */
export function getActiveWindowTitle(): string {
    return loadBridge().getActiveWindowTitle();
}

/**
 * Install the global WH_KEYBOARD_LL keyboard hook.
 * Fires `callback` on the Node.js event loop when @prompt is detected.
 */
export function startHook(callback: (anchor: TriggerAnchor) => void): void {
    // napi v3 ThreadsafeFunction wraps the value in Result<T, Error> and calls
    // back with the error-first Node.js convention: (err, value).
    // Adapt here so all callers keep the simpler (anchor) => void signature.
    loadBridge().startHook((err: Error | null, anchor: TriggerAnchor) => {
        if (err) {
            console.error('[NativeBridge] startHook callback error:', err);
            Sentry.captureException(err, { tags: { component: 'native-hook', platform: process.platform } });
            return;
        }
        callback(anchor);
    });
}

/** Remove the keyboard hook and shut down the hook thread. */
export function stopHook(): void {
    _bridge.stopHook(); // use _bridge directly — avoid re-loading on shutdown
}

/** True when the .node binary was loaded successfully. */
export function isNativeBridgeAvailable(): boolean {
    loadBridge();
    return _bridge !== STUB;
}

/**
 * Select the @prompt trigger text and replace it with `text` in the original window.
 * Uses SetForegroundWindow + Shift+Left×N + KEYEVENTF_UNICODE injection.
 * Returns false if the native module is not loaded or the target window is gone.
 */
export function replaceAtLastAnchor(text: string): boolean {
    return Sentry.startSpan({ name: 'native.replaceAtLastAnchor', op: 'native.replace' }, (span) => {
        try {
            const result = loadBridge().replaceAtLastAnchor(text);
            span.setAttribute('result', result);
            span.setAttribute('text.length', text.length);
            if (!result) logger.warn('native.replaceAtLastAnchor returned false');
            return result;
        } catch (err) {
            Sentry.captureException(err, { tags: { component: 'native-bridge', op: 'replaceAtLastAnchor' } });
            span.setStatus({ code: 2, message: 'exception' });
            return false;
        }
    });
}

/**
 * Force-focus a native window by HWND using the Win32 foreground-steal sequence.
 * AttachThreadInput + AllowSetForegroundWindow + SetForegroundWindow.
 * Call this BEFORE or alongside Electron's window.show() for reliable focus.
 */
export function forceFocusWindow(hwnd: number): boolean {
    try {
        return loadBridge().forceFocusWindow(hwnd);
    } catch (err) {
        Sentry.captureException(err, { tags: { component: 'native-bridge', op: 'forceFocusWindow' }, extra: { hwnd } });
        return false;
    }
}

/**
 * Paste text into a specific window via clipboard (Ctrl+V) without consuming
 * any stored anchor. Designed for multi-section insert where the overlay
 * pastes sections one at a time.
 */
export function pasteTextToWindow(hwnd: number, text: string): boolean {
    return Sentry.startSpan({ name: 'native.pasteTextToWindow', op: 'native.paste' }, (span) => {
        try {
            const result = loadBridge().pasteTextToWindow(hwnd, text);
            span.setAttribute('result', result);
            span.setAttribute('hwnd', hwnd);
            span.setAttribute('text.length', text.length);
            if (!result) logger.warn(logger.fmt`native.pasteTextToWindow failed hwnd=${hwnd}`);
            return result;
        } catch (err) {
            Sentry.captureException(err, { tags: { component: 'native-bridge', op: 'pasteTextToWindow' }, extra: { hwnd } });
            span.setStatus({ code: 2, message: 'exception' });
            return false;
        }
    });
}

/**
 * Check if the app has Accessibility permission (macOS only).
 * Returns true on Windows and other platforms.
 */
export function checkAccessibilityPermission(): boolean {
    try {
        return loadBridge().checkAccessibilityPermission();
    } catch (err) {
        Sentry.captureException(err, { tags: { component: 'native-bridge', op: 'checkAccessibilityPermission' } });
        return process.platform !== 'darwin';
    }
}

/**
 * Send Enter key to a specific window. Used by auto-pilot chat mode
 * to submit a pasted section in chat interfaces.
 */
export function sendEnterToWindow(hwnd: number): boolean {
    return Sentry.startSpan({ name: 'native.sendEnterToWindow', op: 'native.enter' }, (span) => {
        try {
            const result = loadBridge().sendEnterToWindow(hwnd);
            span.setAttribute('result', result);
            span.setAttribute('hwnd', hwnd);
            if (!result) logger.warn(logger.fmt`native.sendEnterToWindow failed hwnd=${hwnd}`);
            return result;
        } catch (err) {
            Sentry.captureException(err, { tags: { component: 'native-bridge', op: 'sendEnterToWindow' }, extra: { hwnd } });
            span.setStatus({ code: 2, message: 'exception' });
            return false;
        }
    });
}
