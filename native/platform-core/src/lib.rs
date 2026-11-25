#![deny(clippy::all)]

mod buffer;
mod hook;
#[cfg(target_os = "windows")]
mod keymap;
mod replacement;

use napi::threadsafe_function::ThreadsafeFunction;
use napi_derive::napi;

// ─────────────────────────────────────────────────────────────────────────────
// Windows-only: active window title via GetWindowTextW
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
// macOS-only: active window title via osascript
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod macos_util {
    use std::process::Command;

    pub fn get_active_window_title() -> String {
        let output = Command::new("osascript")
            .args([
                "-e",
                "tell application \"System Events\" to get name of first window of (first process whose frontmost is true)",
            ])
            .output();
        match output {
            Ok(o) if o.status.success() => {
                String::from_utf8_lossy(&o.stdout).trim().to_string()
            }
            _ => {
                get_frontmost_app_name()
            }
        }
    }

    fn get_frontmost_app_name() -> String {
        let output = Command::new("osascript")
            .args([
                "-e",
                "tell application \"System Events\" to get name of first process whose frontmost is true",
            ])
            .output();
        match output {
            Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
            Err(_) => String::new(),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported N-API functions
// ─────────────────────────────────────────────────────────────────────────────

#[napi]
pub fn get_active_window_title() -> String {
    #[cfg(target_os = "windows")]
    { win32::get_active_window_title() }
    #[cfg(target_os = "macos")]
    { macos_util::get_active_window_title() }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    { String::new() }
}

#[napi]
pub fn start_hook(callback: ThreadsafeFunction<hook::TriggerData>) -> napi::Result<()> {
    hook::start(callback)
}

#[napi]
pub fn stop_hook() -> napi::Result<()> {
    hook::stop()
}

#[napi]
pub fn replace_at_last_anchor(text: String) -> bool {
    replacement::replace_at_last_anchor(&text)
}

#[napi]
pub fn paste_text_to_window(hwnd: i64, text: String) -> bool {
    replacement::paste_text_to_window(hwnd as isize, &text)
}

#[napi]
pub fn send_enter_to_window(hwnd: i64) -> bool {
    replacement::send_enter_to_window(hwnd as isize)
}

/// Record the current foreground window as the overlay's source (used when
/// the overlay is opened with Ctrl+5 instead of the @prompt trigger).
/// Clears any stale @prompt anchor so a later insert can't act on a trigger
/// typed earlier in a different window. Returns the window handle (Windows)
/// or 0 where unsupported.
#[napi]
pub fn capture_source_window() -> i64 {
    replacement::clear_anchor();
    #[cfg(target_os = "windows")]
    {
        replacement::capture_focus_only();
        unsafe { windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow().0 as isize as i64 }
    }
    #[cfg(not(target_os = "windows"))]
    { 0 }
}

/// Forget the stored @prompt anchor.
#[napi]
pub fn clear_anchor() {
    replacement::clear_anchor();
}

#[napi(object)]
pub struct CaretPosition {
    /// Screen coordinates in physical pixels.
    pub x: i32,
    pub y: i32,
    pub height: i32,
}

/// Screen position of the text caret in the foreground window, if the app
/// exposes one (Win32 caret, or the accessibility caret object that
/// Chromium/Electron apps provide). None means "unknown": fall back to the
/// mouse position.
#[napi]
pub fn get_caret_position() -> Option<CaretPosition> {
    #[cfg(target_os = "windows")]
    unsafe {
        caret::get_caret_position()
    }
    #[cfg(not(target_os = "windows"))]
    { None }
}

#[cfg(target_os = "windows")]
mod caret {
    use super::CaretPosition;
    use windows::core::Interface;
    use windows::Win32::Foundation::{HWND, POINT};
    use windows::Win32::Graphics::Gdi::ClientToScreen;
    use windows::Win32::UI::Accessibility::{AccessibleObjectFromWindow, IAccessible};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetGUIThreadInfo, GetWindowThreadProcessId, GUITHREADINFO, OBJID_CARET,
    };

    pub unsafe fn get_caret_position() -> Option<CaretPosition> {
        let fg = GetForegroundWindow();
        if fg.0.is_null() {
            return None;
        }
        let thread = GetWindowThreadProcessId(fg, None);
        let mut gti: GUITHREADINFO = std::mem::zeroed();
        gti.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
        if GetGUIThreadInfo(thread, &mut gti).is_err() {
            return None;
        }

        // 1. Classic Win32 caret.
        let r = gti.rcCaret;
        if !gti.hwndCaret.0.is_null() && (r.bottom - r.top) > 0 {
            let mut pt = POINT { x: r.left, y: r.top };
            if ClientToScreen(gti.hwndCaret, &mut pt).as_bool() && !(pt.x == 0 && pt.y == 0) {
                return Some(CaretPosition { x: pt.x, y: pt.y, height: r.bottom - r.top });
            }
        }

        // 2. Accessibility caret (Chromium, Electron, many modern apps).
        let target: HWND = if !gti.hwndFocus.0.is_null() { gti.hwndFocus } else { fg };
        let mut raw: *mut core::ffi::c_void = std::ptr::null_mut();
        if AccessibleObjectFromWindow(target, OBJID_CARET.0 as u32, &IAccessible::IID, &mut raw).is_err()
            || raw.is_null()
        {
            return None;
        }
        let acc = IAccessible::from_raw(raw);
        let (mut x, mut y, mut w, mut h) = (0i32, 0i32, 0i32, 0i32);
        let child = windows::Win32::System::Variant::VARIANT::from(0i32); // CHILDID_SELF
        if acc.accLocation(&mut x, &mut y, &mut w, &mut h, &child).is_ok() && h > 0 && !(x == 0 && y == 0) {
            let _ = w;
            return Some(CaretPosition { x, y, height: h });
        }
        None
    }
}

/// Force-focus an Electron window by its native handle.
/// On Windows: HWND-based foreground steal sequence.
/// On macOS: NSRunningApplication.activate via osascript.
#[napi]
pub fn force_focus_window(hwnd: i64) -> bool {
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

        let _ = AllowSetForegroundWindow(ASFW_ANY);
        let fg_hwnd = GetForegroundWindow();
        let fg_thread = GetWindowThreadProcessId(fg_hwnd, None);
        let our_thread = GetCurrentThreadId();

        let attached = fg_thread != 0
            && fg_thread != our_thread
            && AttachThreadInput(fg_thread, our_thread, true).as_bool();

        let ok = SetForegroundWindow(target).as_bool();
        let _ = BringWindowToTop(target);
        let _ = ShowWindow(target, SW_SHOW);

        if attached {
            let _ = AttachThreadInput(fg_thread, our_thread, false);
        }

        ok
    }

    #[cfg(target_os = "macos")]
    {
        let pid = hwnd as i32;
        let script = format!(
            "tell application \"System Events\" to set frontmost of (first process whose unix id is {}) to true",
            pid
        );
        std::process::Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    { let _ = hwnd; false }
}

/// Check if the app has Accessibility permission (macOS).
/// Uses the real AXIsProcessTrusted() API from ApplicationServices.
/// Always returns true on Windows and other platforms.
#[napi]
pub fn check_accessibility_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        extern "C" {
            fn AXIsProcessTrusted() -> bool;
        }
        unsafe { AXIsProcessTrusted() }
    }

    #[cfg(not(target_os = "macos"))]
    { true }
}
