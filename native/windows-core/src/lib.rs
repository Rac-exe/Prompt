#![deny(clippy::all)]

mod buffer;
mod hook;
mod keymap;
#[cfg(target_os = "windows")]
mod replacement;

use napi::threadsafe_function::ThreadsafeFunction;
use napi_derive::napi;

// ─────────────────────────────────────────────────────────────────────────────
// Windows-only helpers (getActiveWindowTitle stays from Phase 0)
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
mod win32 {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};

    pub fn get_active_window_title() -> String {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.0.is_null() {
            return String::new();
        }
        let mut buf = vec![0u16; 512];
        let len = unsafe { GetWindowTextW(hwnd, &mut buf) };
        if len <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..len as usize])
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported N-API functions
// ─────────────────────────────────────────────────────────────────────────────

/// Returns the title bar text of the currently focused window.
/// Returns "" on failure or non-Windows platforms.
#[napi]
pub fn get_active_window_title() -> String {
    #[cfg(target_os = "windows")]
    { win32::get_active_window_title() }
    #[cfg(not(target_os = "windows"))]
    { String::new() }
}

/// Install the global WH_KEYBOARD_LL keyboard hook.
///
/// `callback` is called on the Node.js event loop (non-blocking) whenever
/// `@prompt` is detected anywhere in the system.
///
/// Callback signature: `(anchor: TriggerAnchor) => void`
/// where TriggerAnchor = `{ hwnd: number, triggerLen: number }`
///
/// Idempotent — calling twice has no effect.
#[napi]
pub fn start_hook(callback: ThreadsafeFunction<hook::TriggerData>) -> napi::Result<()> {
    #[cfg(not(target_os = "windows"))]
    {
        eprintln!("[NativeHook] start_hook: Windows only. No-op.");
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        hook::start(callback)
    }
}

/// Remove the global keyboard hook and shut down the hook thread cleanly.
/// Blocks until the hook thread exits. Safe to call when not running.
#[napi]
pub fn stop_hook() -> napi::Result<()> {
    #[cfg(not(target_os = "windows"))]
    { return Ok(()); }

    #[cfg(target_os = "windows")]
    { hook::stop() }
}

/// Select the @prompt trigger text and replace it with `text` in the original window.
///
/// Must be called AFTER the overlay closes and AI text is ready.
/// The anchor (HWND + trigger_len) was captured the moment @prompt was typed.
///
/// Returns true on success, false if:
///   - No anchor is stored (startHook was not called yet)
///   - The target window no longer exists
///   - SendInput is blocked by UIPI (elevated target process)
///
/// NOTE: blocks the caller thread for ~30ms (OS focus transfer delay).
/// Electron main thread blocking briefly is acceptable — the renderer is unaffected.
#[napi]
pub fn replace_at_last_anchor(text: String) -> bool {
    #[cfg(not(target_os = "windows"))]
    { return false; }

    #[cfg(target_os = "windows")]
    { replacement::replace_at_last_anchor(&text) }
}

/// Force-focus an Electron window by its native HWND.
///
/// Electron's BrowserWindow.focus() is asynchronous and works through the
/// Chromium message pump — it may be ignored if another app currently holds
/// foreground, because Windows only allows the foreground process to grant
/// foreground status (SetForegroundWindow from a non-foreground process fails).
///
/// This function runs the canonical Win32 foreground-steal sequence:
///   1. AllowSetForegroundWindow(ASFW_ANY)   — relax the foreground lock
///   2. AttachThreadInput(foreground→ours)   — bridge input queues
///   3. SetForegroundWindow(target)          — claim foreground
///   4. BringWindowToTop(target)             — ensure Z-order
///   5. ShowWindow(target, SW_SHOW)          — make visible
///   6. DetachThreadInput                    — clean up bridge
///
/// Returns true if SetForegroundWindow reported success; false otherwise.
/// Call this immediately before or after Electron's window.show() for best results.
#[napi]
pub fn force_focus_window(hwnd: i64) -> bool {
    #[cfg(not(target_os = "windows"))]
    { let _ = hwnd; return false; }

    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            AllowSetForegroundWindow, BringWindowToTop, GetForegroundWindow,
            GetWindowThreadProcessId, SetForegroundWindow, ShowWindow, SW_SHOW, ASFW_ANY,
        };
        use windows::Win32::System::Threading::{
            AttachThreadInput, GetCurrentThreadId,
        };

        let target = HWND(hwnd as *mut _);
        if target.0.is_null() {
            return false;
        }

        // Relax the foreground lock so any process can call SetForegroundWindow.
        let _ = AllowSetForegroundWindow(ASFW_ANY);

        // Get the thread that currently owns the foreground window.
        let fg_hwnd = GetForegroundWindow();
        let fg_thread = GetWindowThreadProcessId(fg_hwnd, None);
        let our_thread = GetCurrentThreadId();

        // Attach our input queue to the foreground thread's queue.
        // This is necessary because SetForegroundWindow only works when
        // the calling thread is attached to the foreground thread's input.
        let attached = fg_thread != 0
            && fg_thread != our_thread
            && AttachThreadInput(fg_thread, our_thread, true).as_bool();

        let ok = SetForegroundWindow(target).as_bool();
        let _ = BringWindowToTop(target);
        let _ = ShowWindow(target, SW_SHOW);

        // Always detach — leaving threads attached causes input routing bugs.
        if attached {
            let _ = AttachThreadInput(fg_thread, our_thread, false);
        }

        ok
    }
}
