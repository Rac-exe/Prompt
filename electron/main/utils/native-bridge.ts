/**
 * native-bridge.ts
 *
 * Centralized loader for the Rust .node native module.
 * Import ONLY in Electron Main process code — never in renderer or preload.
 */

import * as path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TriggerAnchor {
    /** Raw HWND of the foreground window at the moment @prompt was detected. */
    hwnd: number;
    /** Always 7 for "@prompt". Used by the replacement engine to delete N chars. */
    triggerLen: number;
}

interface NativeBridge {
    getActiveWindowTitle(): string;
    // napi v3 ThreadsafeFunction uses error-first callbacks: (err, value)
    startHook(callback: (err: Error | null, anchor: TriggerAnchor) => void): void;
    stopHook(): void;
    replaceAtLastAnchor(text: string): boolean;
    forceFocusWindow(hwnd: number): boolean;
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
};

// ─── Lazy loader ──────────────────────────────────────────────────────────────

let _bridge: NativeBridge = STUB;
let _loaded = false;

function loadBridge(): NativeBridge {
    if (_loaded) return _bridge;
    _loaded = true;

    try {
        // __dirname in compiled output: <project>/dist/main/utils/
        // Project root:                 <project>/
        const projectRoot = path.resolve(__dirname, '..', '..', '..');
        const nativeIndexPath = path.join(projectRoot, 'native', 'windows-core', 'index.js');

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        _bridge = require(nativeIndexPath) as NativeBridge;
        console.log('[NativeBridge] Loaded from:', nativeIndexPath);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[NativeBridge] Not loaded — stub mode.\n  Fix: npm run native:build\n  Reason:', msg);
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
    return loadBridge().replaceAtLastAnchor(text);
}

/**
 * Force-focus a native window by HWND using the Win32 foreground-steal sequence.
 * AttachThreadInput + AllowSetForegroundWindow + SetForegroundWindow.
 * Call this BEFORE or alongside Electron's window.show() for reliable focus.
 */
export function forceFocusWindow(hwnd: number): boolean {
    return loadBridge().forceFocusWindow(hwnd);
}
