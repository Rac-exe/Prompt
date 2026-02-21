/// replacement.rs — Anchor storage + Win32 SendInput text replacement engine.
///
/// Flow:
///   1. hook.rs calls store_anchor() when @prompt is detected.
///   2. Electron main calls replaceAtLastAnchor() after AI generates the text.
///   3. We: SetForegroundWindow → Shift+Left×N (select trigger) → inject replacement text.
///
/// Injection strategy (chosen after Shift+Left selection):
///   A. Classic Win32 EDIT control (Notepad etc.)
///      → SendMessageW(hwnd, EM_REPLACESEL, TRUE, wide_ptr)
///      Classic EDIT controls are synchronous message-queue readers. Long strings sent
///      via SendInput have keystrokes dropped because the message queue fills or the
///      EDIT control does not drain fast enough. EM_REPLACESEL is an atomic, in-process
///      call that the control handles in one message — no drops regardless of length.
///
///   B. Everything else (Electron/Chromium, modern Win32, WinUI3, etc.)
///      → SendInput with KEYEVENTF_UNICODE per code unit (existing path)
///      Modern apps use their own input pipelines and handle the async key stream fine.

use std::mem::size_of;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, VIRTUAL_KEY,
    VK_LEFT, VK_SHIFT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetGUIThreadInfo, GetWindow, IsWindow, SendMessageW, SetForegroundWindow,
    GUITHREADINFO, GW_CHILD, GW_HWNDNEXT,
};

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
    let focused = SetForegroundWindow(hwnd).as_bool();
    if !focused {
        eprintln!("[Replacement] SetForegroundWindow failed — window may have lost focus");
    }

    // Give the OS ~30 ms to complete the focus transfer before injecting input.
    std::thread::sleep(std::time::Duration::from_millis(30));

    // ── Choose injection strategy BEFORE sending any input ────────────────────
    //
    // CRITICAL: We detect the focused control class HERE, before Phase 1.
    //
    // Why: Shift+Left via SendInput is ASYNCHRONOUS — events are posted to the
    // global input queue. If we sent them first and then called EM_REPLACESEL,
    // EM_REPLACESEL would fire before the queued Shift+Left events were processed,
    // replacing the wrong selection, and then the queued events would corrupt
    // the newly injected text. This was the root cause of garbled output.
    //
    // Fix: for classic EDIT controls we skip SendInput entirely and use three
    // synchronous messages dispatched directly into the control's message queue.

    if let Some(edit_hwnd) = find_edit_hwnd(hwnd) {
        // ── EDIT control path (Notepad, classic Win32) ────────────────────────
        // All three calls are synchronous — no race with any queued input.
        println!(
            "[Replacement] Detected Edit control (hwnd={:#x}) — using EM_GETSEL + EM_SETSEL + EM_REPLACESEL",
            edit_hwnd.0 as usize
        );
        return inject_via_edit_messages(edit_hwnd, anchor.trigger_len, text);
    }

    // ── Standard path (Electron, Chrome, modern Win32, WinUI3, etc.) ──────────
    // Phase 1: select @prompt with Shift+Left
    let select = build_shift_select(anchor.trigger_len);
    let sent = send_inputs(&select);
    if sent == 0 && !select.is_empty() {
        eprintln!("[Replacement] SendInput (select) blocked — UIPI elevation mismatch?");
        return false;
    }

    // Phase 2: type replacement via KEYEVENTF_UNICODE
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

/// Check whether a given HWND is a classic Win32 EDIT or RichEdit control.
/// EM_REPLACESEL and EM_SETSEL work on both.
#[inline]
unsafe fn is_edit_class(hwnd: HWND) -> bool {
    if hwnd.0.is_null() {
        return false;
    }
    let mut buf = vec![0u16; 64];
    let len = GetClassNameW(hwnd, &mut buf);
    if len <= 0 {
        return false;
    }
    let class = String::from_utf16_lossy(&buf[..len as usize]);
    // Match plain Edit and all RichEdit variants (RichEdit20W, RichEdit50W …)
    class == "Edit" || class.starts_with("RichEdit")
}

/// Locate an EDIT (or RichEdit) control associated with `anchor_hwnd`.
///
/// Three strategies are tried in order, so detection works reliably even
/// when focus state is in flux right after SetForegroundWindow:
///
///   1. GetGUIThreadInfo(0) → hwndFocus — the truly focused window in the
///      foreground thread. Most accurate, but can fail if the OS hasn't
///      finished transferring focus from Electron yet.
///
///   2. Check anchor_hwnd itself — handles apps where the anchor IS the
///      EDIT control (e.g., a standalone Edit window).
///
///   3. Scan direct children of anchor_hwnd — handles classic Notepad whose
///      window hierarchy is: "Notepad" (top-level) → "Edit" (child).
///      GetGUIThreadInfo often misses this because Electron's thread is still
///      briefly in the foreground at detection time.
unsafe fn find_edit_hwnd(anchor_hwnd: HWND) -> Option<HWND> {
    // Strategy 1: GetGUIThreadInfo — focus-based, most accurate
    let mut gti: GUITHREADINFO = std::mem::zeroed();
    gti.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
    if GetGUIThreadInfo(0, &mut gti).is_ok() && is_edit_class(gti.hwndFocus) {
        return Some(gti.hwndFocus);
    }

    // Strategy 2: anchor window itself might be an EDIT control
    if is_edit_class(anchor_hwnd) {
        return Some(anchor_hwnd);
    }

    // Strategy 3: scan first-level children of anchor window.
    // Classic Notepad structure: "Notepad" → child("Edit")
    // We walk the sibling chain to handle windows with multiple children.
    // GetWindow returns Result<HWND> in windows 0.58 — use .ok() to unwrap.
    let mut child_opt = GetWindow(anchor_hwnd, GW_CHILD).ok();
    while let Some(child) = child_opt {
        if is_edit_class(child) {
            return Some(child);
        }
        child_opt = GetWindow(child, GW_HWNDNEXT).ok();
    }

    None
}

/// Replace the current selection in a classic Win32 EDIT control atomically.
///
/// `SendMessageW(hwnd, EM_REPLACESEL, TRUE, lp)` replaces whatever text is
/// currently selected with the wide string pointed to by `lp`. Because this
/// is a synchronous message (dispatched in the target process), the EDIT
/// control processes the entire string in one shot — no character dropping,
/// no race with the message queue, and no length limit.
///
/// wParam = 1 (TRUE) → the operation can be undone by Ctrl+Z.
unsafe fn inject_via_em_replacesel(hwnd: HWND, text: &str) -> bool {
    // EM_REPLACESEL = 0x00C2 (defined in <CommCtrl.h> / windowsx.h)
    const EM_REPLACESEL: u32 = 0x00C2;

    // Encode as null-terminated UTF-16.
    let mut utf16: Vec<u16> = text.encode_utf16().collect();
    utf16.push(0); // null terminator required

    let result = SendMessageW(
        hwnd,
        EM_REPLACESEL,
        WPARAM(1),                         // wParam = TRUE → undoable
        LPARAM(utf16.as_ptr() as isize),   // lParam = wide string pointer
    );

    // EM_REPLACESEL has no meaningful return value — treat any call as success.
    let _ = result;
    true
}

/// Full Edit-control replacement using only synchronous Win32 messages.
///
/// Steps (all synchronous, no input queue involved):
///   1. EM_GETSEL  — read caret position (end of trigger phrase)
///   2. EM_SETSEL  — select trigger_len chars ending at the caret
///   3. EM_REPLACESEL — replace the selection with `text` atomically
///
/// This completely avoids SendInput, eliminating the async-queue race that
/// caused garbled output when the previous attempt used EM_REPLACESEL after
/// SendInput'd Shift+Left events that had not yet been processed.
unsafe fn inject_via_edit_messages(hwnd: HWND, trigger_len: u32, text: &str) -> bool {
    // EM_GETSEL  = 0x00B0
    // EM_SETSEL  = 0x00B1
    // EM_REPLACESEL = 0x00C2
    const EM_GETSEL: u32 = 0x00B0;
    const EM_SETSEL: u32 = 0x00B1;
    const EM_REPLACESEL: u32 = 0x00C2;

    // Step 1: read the current caret / selection end position.
    // EM_GETSEL wParam/lParam are pointers to DWORD for start and end.
    // The return value low-word/high-word works for positions < 64K;
    // using pointer form is safe for any document size.
    let mut sel_start: u32 = 0;
    let mut sel_end: u32 = 0;
    SendMessageW(
        hwnd,
        EM_GETSEL,
        WPARAM(&mut sel_start as *mut u32 as usize),
        LPARAM(&mut sel_end as *mut u32 as isize),
    );

    // sel_end is the character index immediately after the last char that
    // was typed (@prompt), i.e. the current caret position.
    let caret = sel_end;
    let start = caret.saturating_sub(trigger_len);

    // Step 2: select the trigger phrase (@prompt = trigger_len chars).
    SendMessageW(
        hwnd,
        EM_SETSEL,
        WPARAM(start as usize),  // selection start (inclusive)
        LPARAM(caret as isize),  // selection end   (exclusive)
    );

    // Step 3: replace the selected text atomically.
    inject_via_em_replacesel(hwnd, text)
}
