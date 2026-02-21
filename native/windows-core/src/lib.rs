#![deny(clippy::all)]

mod buffer;
mod hook;
mod keymap;
#[cfg(target_os = "windows")]
mod replacement;

use napi::threadsafe_function::{
    ErrorStrategy, ThreadSafeCallContext, ThreadsafeFunction,
};
use napi::JsFunction;
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
pub fn start_hook(callback: JsFunction) -> napi::Result<()> {
    #[cfg(not(target_os = "windows"))]
    {
        eprintln!("[NativeHook] start_hook: Windows only. No-op.");
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        // Build the ThreadsafeFunction that converts TriggerData → JS object.
        let tsfn: ThreadsafeFunction<hook::TriggerData, ErrorStrategy::Fatal> =
            callback.create_threadsafe_function(
                0, // queue depth 0 = unlimited
                |ctx: ThreadSafeCallContext<hook::TriggerData>| {
                    let mut obj = ctx.env.create_object()?;
                    obj.set_named_property("hwnd", ctx.env.create_int64(ctx.value.hwnd)?)?;
                    obj.set_named_property(
                        "triggerLen",
                        ctx.env.create_uint32(ctx.value.trigger_len)?,
                    )?;
                    Ok(vec![obj.into_unknown()])
                },
            )?;

        hook::start(tsfn)
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
