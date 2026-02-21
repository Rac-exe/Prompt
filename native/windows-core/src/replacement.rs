/// replacement.rs — Anchor storage + Win32 SendInput text replacement engine.
///
/// Flow:
///   1. hook.rs calls store_anchor() when @prompt is detected.
///   2. Electron main calls replaceAtLastAnchor() after AI generates the text.
///   3. We: SetForegroundWindow → Shift+Left×N (select trigger) → SendInput unicode text.

use std::mem::size_of;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, VIRTUAL_KEY,
    VK_LEFT, VK_SHIFT,
};
use windows::Win32::UI::WindowsAndMessaging::{IsWindow, SetForegroundWindow};

// ─── Anchor ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct AnchorData {
    /// Raw HWND as isize — safe to store across threads as an integer.
    pub hwnd: isize,
    /// Number of characters comprising the trigger phrase ("@prompt" → 7).
    pub trigger_len: u32,
    /// Unix timestamp (ms) when the trigger fired. Reserved for staleness checks.
    #[allow(dead_code)]
    pub timestamp_ms: u64,
}

static LAST_ANCHOR: Mutex<Option<AnchorData>> = Mutex::new(None);

/// Store the foreground window and trigger length captured at trigger time.
/// Called from hook.rs inside fire_trigger(), before anything else.
pub fn store_anchor(hwnd: isize, trigger_len: u32) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    if let Ok(mut g) = LAST_ANCHOR.lock() {
        *g = Some(AnchorData { hwnd, trigger_len, timestamp_ms: ts });
        println!("[Replacement] Anchor stored: hwnd={hwnd:#x}, trigger_len={trigger_len}");
    }
}

// ─── Replacement ──────────────────────────────────────────────────────────────

/// Select the trigger text and replace it with `text` in the original window.
///
/// Strategy:
///   SetForegroundWindow(anchor.hwnd)   → refocus original app
///   brief sleep                         → let OS complete focus transfer
///   SendInput: Shift+Left × trigger_len → select the @prompt text
///   SendInput: KEYEVENTF_UNICODE × chars → type replacement text over selection
///
/// Returns true on success, false on any failure (window gone, UIPI block, etc.).
pub fn replace_at_last_anchor(text: &str) -> bool {
    // Take the anchor out of storage. Cleared immediately so repeated calls fail fast.
    let anchor = {
        match LAST_ANCHOR.lock() {
            Ok(mut g) => g.take(),
            Err(_) => None,
        }
    };

    let anchor = match anchor {
        Some(a) => a,
        None => {
            eprintln!("[Replacement] No anchor stored — nothing to replace");
            return false;
        }
    };

    unsafe { execute_replacement(anchor, text) }
}

unsafe fn execute_replacement(anchor: AnchorData, text: &str) -> bool {
    let hwnd = HWND(anchor.hwnd as *mut _);

    // ── Validate window still exists ─────────────────────────────────────────
    if !IsWindow(hwnd).as_bool() {
        eprintln!("[Replacement] Target window is gone (hwnd={:#x})", anchor.hwnd);
        return false;
    }

    // ── Refocus original window ───────────────────────────────────────────────
    // SetForegroundWindow fails silently if called outside the foreground access
    // rules. We attempt it and continue regardless — SendInput still sends to
    // the focused window, so a failed refocus just means the app might have lost
    // focus naturally (user switched away).
    let focused = SetForegroundWindow(hwnd).as_bool();
    if !focused {
        eprintln!("[Replacement] SetForegroundWindow failed — window may have lost focus");
    }

    // Give the OS ~30 ms to complete the focus transfer before injecting input.
    // This is acceptable: Electron main thread blocking briefly does NOT freeze
    // the renderer (separate process/thread), and the user already sees the overlay closing.
    std::thread::sleep(std::time::Duration::from_millis(30));

    // ── Phase 1: select trigger text with Shift+Left ──────────────────────────
    let select = build_shift_select(anchor.trigger_len);
    let sent = send_inputs(&select);
    if sent == 0 && !select.is_empty() {
        eprintln!("[Replacement] SendInput (select) blocked — UIPI elevation mismatch?");
        return false;
    }

    // ── Phase 2: type replacement text via Unicode injection ──────────────────
    if !text.is_empty() {
        let type_inputs = build_unicode_type(text);
        let sent = send_inputs(&type_inputs);
        if sent == 0 && !type_inputs.is_empty() {
            eprintln!("[Replacement] SendInput (type) blocked");
            return false;
        }
    }

    println!("[Replacement] Injected {} chars into hwnd={:#x}", text.chars().count(), anchor.hwnd);
    true
}

// ─── Input builders ───────────────────────────────────────────────────────────

/// Shift+Left × n — selects n characters to the left of the caret.
/// Arrow keys require KEYEVENTF_EXTENDEDKEY to distinguish from numpad.
fn build_shift_select(trigger_len: u32) -> Vec<INPUT> {
    let n = trigger_len as usize;
    let mut v = Vec::with_capacity(2 + n * 2);

    v.push(key_vk(VK_SHIFT, KEYBD_EVENT_FLAGS(0)));
    for _ in 0..n {
        v.push(key_vk(VK_LEFT, KEYEVENTF_EXTENDEDKEY));
        v.push(key_vk(VK_LEFT, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP));
    }
    v.push(key_vk(VK_SHIFT, KEYEVENTF_KEYUP));
    v
}

/// One keydown + keyup pair per UTF-16 code unit using KEYEVENTF_UNICODE.
/// Handles all Unicode, including chars outside BMP (surrogate pairs).
fn build_unicode_type(text: &str) -> Vec<INPUT> {
    let mut v = Vec::new();
    for ch in text.chars() {
        let cp = ch as u32;
        if cp <= 0xFFFF {
            // Basic Multilingual Plane: single code unit
            v.push(key_unicode(cp as u16, KEYBD_EVENT_FLAGS(0)));
            v.push(key_unicode(cp as u16, KEYEVENTF_KEYUP));
        } else {
            // Supplementary plane: encode as UTF-16 surrogate pair
            let code = cp - 0x10000;
            let high = (0xD800 + (code >> 10)) as u16;
            let low = (0xDC00 + (code & 0x3FF)) as u16;
            v.push(key_unicode(high, KEYBD_EVENT_FLAGS(0)));
            v.push(key_unicode(high, KEYEVENTF_KEYUP));
            v.push(key_unicode(low, KEYBD_EVENT_FLAGS(0)));
            v.push(key_unicode(low, KEYEVENTF_KEYUP));
        }
    }
    v
}

// ─── INPUT helpers ────────────────────────────────────────────────────────────

#[inline]
fn key_vk(vk: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

#[inline]
fn key_unicode(scan: u16, extra_flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(0),
                wScan: scan,
                dwFlags: KEYEVENTF_UNICODE | extra_flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

/// Send a slice of INPUT events in one atomic batch.
/// Returns the count of events successfully sent (0 = entirely blocked by UIPI).
#[inline]
unsafe fn send_inputs(inputs: &[INPUT]) -> u32 {
    if inputs.is_empty() {
        return 0;
    }
    SendInput(inputs, size_of::<INPUT>() as i32)
}
