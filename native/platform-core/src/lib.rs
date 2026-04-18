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
/// Always returns true on Windows and other platforms.
#[napi]
pub fn check_accessibility_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        // Use osascript to check AXIsProcessTrusted equivalent
        let output = Command::new("osascript")
            .args([
                "-e",
                "tell application \"System Events\" to get UI elements enabled",
            ])
            .output();
        match output {
            Ok(o) => {
                let s = String::from_utf8_lossy(&o.stdout).trim().to_lowercase();
                s == "true"
            }
            Err(_) => false,
        }
    }

    #[cfg(not(target_os = "macos"))]
    { true }
}
