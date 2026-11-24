/// replacement.rs — Platform-dispatched text replacement engine.
///
/// Windows: Hybrid 3-path system (EM_REPLACESEL / UIA TextPattern / guarded SendInput).
/// macOS: CGEventPost backspace + Cmd+V clipboard paste.
///
/// Detection (hook.rs / buffer.rs) and injection (this file) are decoupled.
/// They share only the anchor — a one-shot mutex slot.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

// ─── Anchor (cross-platform) ──────────────────────────────────────────────────

#[derive(Clone)]
pub struct AnchorData {
    /// HWND on Windows (as isize), PID on macOS (as isize).
    pub handle: isize,
    pub trigger_len: u32,
    #[allow(dead_code)]
    pub timestamp_ms: u64,
}

static LAST_ANCHOR: Mutex<Option<AnchorData>> = Mutex::new(None);

/// Marker put in dwExtraInfo of every key Prmpt injects on Windows, so the
/// keyboard hook can ignore its own Ctrl+V / Backspace but still see keys
/// injected by other tools (dictation, AutoHotkey, on-screen keyboards).
#[allow(dead_code)]
pub const INJECT_MARKER: usize = 0x5052_4D50; // "PRMP"

pub fn store_anchor(handle: isize, trigger_len: u32) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    if let Ok(mut g) = LAST_ANCHOR.lock() {
        *g = Some(AnchorData { handle, trigger_len, timestamp_ms: ts });
        println!("[Replacement] Anchor stored: handle={handle:#x}, trigger_len={trigger_len}");
    }

    #[cfg(target_os = "windows")]
    win32::capture_focus_child();
}

/// Forget the stored @prompt anchor (and, on Windows, the focused child).
/// Called when the overlay is opened some other way (Ctrl+5) so a later
/// insert can never act on a stale trigger in a different window.
pub fn clear_anchor() {
    if let Ok(mut g) = LAST_ANCHOR.lock() {
        *g = None;
    }
    #[cfg(target_os = "windows")]
    win32::clear_focus_child();
}

/// Remember the focused child of the current foreground window without
/// storing a trigger anchor (used for Ctrl+5).
pub fn capture_focus_only() {
    #[cfg(target_os = "windows")]
    win32::capture_focus_child();
}

fn take_anchor() -> Option<AnchorData> {
    match LAST_ANCHOR.lock() {
        Ok(mut g) => g.take(),
        Err(_) => None,
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

pub fn replace_at_last_anchor(text: &str) -> bool {
    let anchor = match take_anchor() {
        Some(a) => a,
        None => {
            eprintln!("[Replacement] No anchor stored — nothing to replace");
            return false;
        }
    };

    #[cfg(target_os = "windows")]
    { unsafe { win32::execute_replacement(anchor, text) } }

    #[cfg(target_os = "macos")]
    { macos::execute_replacement(anchor, text) }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    { let _ = (anchor, text); false }
}

pub fn paste_text_to_window(handle: isize, text: &str) -> bool {
    #[cfg(target_os = "windows")]
    { win32::paste_text_to_window_impl(handle, text) }

    #[cfg(target_os = "macos")]
    { macos::paste_text_to_window_impl(handle as i32, text) }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    { let _ = (handle, text); false }
}

pub fn send_enter_to_window(handle: isize) -> bool {
    #[cfg(target_os = "windows")]
    { win32::send_enter_to_window_impl(handle) }

    #[cfg(target_os = "macos")]
    { macos::send_enter_to_window_impl(handle as i32) }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    { let _ = handle; false }
}

// ══════════════════════════════════════════════════════════════════════════════
// WINDOWS implementation
// ══════════════════════════════════════════════════════════════════════════════

#[cfg(target_os = "windows")]
mod win32 {
    use super::*;
    use std::mem::size_of;
    use std::sync::atomic::{AtomicU64, Ordering};

    use windows::Win32::Foundation::{HANDLE, HGLOBAL, HWND, LPARAM, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_KEYUP, VIRTUAL_KEY,
        VK_BACK, VK_CONTROL, VK_RETURN, VK_V,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetAncestor, GetClassNameW, GetForegroundWindow, GetGUIThreadInfo, IsWindow,
        IsWindowVisible, SendMessageW, SetForegroundWindow, GA_ROOT, GUITHREADINFO,
    };
    use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;

    static STORED_FOCUS_HWND: Mutex<Option<isize>> = Mutex::new(None);

    pub fn clear_focus_child() {
        if let Ok(mut g) = STORED_FOCUS_HWND.lock() {
            *g = None;
        }
    }

    pub fn capture_focus_child() {
        unsafe {
            let mut gti: GUITHREADINFO = std::mem::zeroed();
            gti.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
            clear_focus_child();
            if GetGUIThreadInfo(0, &mut gti).is_ok() && !gti.hwndFocus.0.is_null() {
                let focus = gti.hwndFocus.0 as isize;
                if let Ok(mut g) = STORED_FOCUS_HWND.lock() {
                    *g = Some(focus);
                }
                println!("[Replacement] Focus child stored: hwnd={focus:#x}");
            }
        }
    }

    pub unsafe fn execute_replacement(anchor: AnchorData, text: &str) -> bool {
        let hwnd = HWND(anchor.handle as *mut _);

        if !IsWindow(Some(hwnd)).as_bool() {
            eprintln!("[Replacement] Target window gone (hwnd={:#x})", anchor.handle);
            return false;
        }

        if !SetForegroundWindow(hwnd).as_bool() {
            eprintln!("[Replacement] SetForegroundWindow failed — proceeding anyway");
        }
        std::thread::sleep(std::time::Duration::from_millis(60));

        let class_name = get_class_name(hwnd);
        println!("[Replacement] hwnd={:#x} class={:?}", anchor.handle, class_name);

        if let Some(edit_hwnd) = find_edit_hwnd(hwnd) {
            return inject_via_edit_messages(edit_hwnd, anchor.trigger_len, text);
        }

        if try_textpattern_select_then_send(hwnd, anchor.trigger_len, text) {
            return true;
        }

        inject_via_guarded_sendinput(hwnd, &anchor, text)
    }

    unsafe fn get_class_name(hwnd: HWND) -> String {
        let mut buf = vec![0u16; 256];
        let len = GetClassNameW(hwnd, &mut buf);
        if len <= 0 { return String::new(); }
        String::from_utf16_lossy(&buf[..len as usize])
    }

    #[inline]
    unsafe fn is_edit_class(hwnd: HWND) -> bool {
        if hwnd.0.is_null() { return false; }
        let c = get_class_name(hwnd);
        c == "Edit" || c.to_ascii_lowercase().starts_with("richedit")
    }

    /// The edit control the user was typing in. Only ever the control that
    /// had keyboard focus: guessing "the first Edit child" put text into
    /// hidden fields (seen in Character Map's dialog).
    unsafe fn find_edit_hwnd(anchor_hwnd: HWND) -> Option<HWND> {
        let belongs = |h: HWND| {
            !h.0.is_null()
                && IsWindow(Some(h)).as_bool()
                && IsWindowVisible(h).as_bool()
                && GetAncestor(h, GA_ROOT).0 == anchor_hwnd.0
        };
        // 1. The control focused when @prompt was typed.
        if let Some(fh) = STORED_FOCUS_HWND.lock().ok().and_then(|g| *g) {
            let h = HWND(fh as *mut _);
            if belongs(h) && is_edit_class(h) {
                return Some(h);
            }
        }
        // 2. The control focused now (focus is restored with the window).
        let mut gti: GUITHREADINFO = std::mem::zeroed();
        gti.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
        if GetGUIThreadInfo(0, &mut gti).is_ok() && belongs(gti.hwndFocus) && is_edit_class(gti.hwndFocus) {
            return Some(gti.hwndFocus);
        }
        if is_edit_class(anchor_hwnd) {
            return Some(anchor_hwnd);
        }
        None
    }

    unsafe fn inject_via_edit_messages(hwnd: HWND, trigger_len: u32, text: &str) -> bool {
        const EM_GETSEL: u32 = 0x00B0;
        const EM_SETSEL: u32 = 0x00B1;
        const EM_REPLACESEL: u32 = 0x00C2;

        let mut sel_start: u32 = 0;
        let mut sel_end: u32 = 0;
        SendMessageW(
            hwnd, EM_GETSEL,
            Some(WPARAM(&mut sel_start as *mut u32 as usize)),
            Some(LPARAM(&mut sel_end as *mut u32 as isize)),
        );

        let caret = sel_end;
        let start = caret.saturating_sub(trigger_len);
        SendMessageW(hwnd, EM_SETSEL, Some(WPARAM(start as usize)), Some(LPARAM(caret as isize)));

        let mut utf16: Vec<u16> = text.encode_utf16().collect();
        utf16.push(0);
        SendMessageW(
            hwnd, EM_REPLACESEL,
            Some(WPARAM(1)),
            Some(LPARAM(utf16.as_ptr() as isize)),
        );
        true
    }

    unsafe fn try_textpattern_select_then_send(
        anchor_hwnd: HWND,
        trigger_len: u32,
        text: &str,
    ) -> bool {
        use windows::Win32::System::Com::{
            CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED,
        };
        use windows::Win32::Foundation::S_FALSE;

        let com_hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if !com_hr.is_ok() && com_hr != S_FALSE {
            return false;
        }

        let result = textpattern_select_inner(anchor_hwnd, trigger_len, text);
        CoUninitialize();
        result
    }

    unsafe fn textpattern_select_inner(
        anchor_hwnd: HWND,
        trigger_len: u32,
        text: &str,
    ) -> bool {
        use windows::core::Interface;
        use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
        use windows::Win32::UI::Accessibility::{
            CUIAutomation, IUIAutomation, IUIAutomationTextPattern,
            TextPatternRangeEndpoint_Start, TextUnit_Character, UIA_TextPatternId,
        };

        let uia: IUIAutomation = match CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) {
            Ok(u) => u,
            Err(_) => return false,
        };

        let element = match uia.ElementFromHandle(anchor_hwnd) {
            Ok(e) => e,
            Err(_) => return false,
        };

        let pattern_base = match element.GetCurrentPattern(UIA_TextPatternId) {
            Ok(p) => p,
            Err(_) => return false,
        };

        let text_pattern: IUIAutomationTextPattern = match pattern_base.cast() {
            Ok(p) => p,
            Err(_) => return false,
        };

        let sel_array = match text_pattern.GetSelection() {
            Ok(a) => a,
            Err(_) => return false,
        };

        let count = sel_array.Length().unwrap_or(0);
        if count == 0 { return false; }

        let caret_range = match sel_array.GetElement(0) {
            Ok(r) => r,
            Err(_) => return false,
        };

        // If the range can't be widened back over the whole trigger, give up
        // on this path rather than paste without removing "@prompt".
        match caret_range.MoveEndpointByUnit(
            TextPatternRangeEndpoint_Start,
            TextUnit_Character,
            -(trigger_len as i32),
        ) {
            Ok(moved) if moved == -(trigger_len as i32) => {}
            _ => return false,
        }

        if caret_range.Select().is_err() {
            return false;
        }

        std::thread::sleep(std::time::Duration::from_millis(30));
        inject_via_clipboard_paste(anchor_hwnd, text)
    }

    unsafe fn inject_via_guarded_sendinput(hwnd: HWND, anchor: &AnchorData, text: &str) -> bool {
        let backspaces = build_backspace_delete(anchor.trigger_len);
        let sent = send_inputs(&backspaces);
        if sent == 0 && !backspaces.is_empty() {
            return false;
        }
        if text.is_empty() { return true; }
        std::thread::sleep(std::time::Duration::from_millis(40));
        inject_via_clipboard_paste(hwnd, text)
    }

    // ── Clipboard paste with full snapshot/restore ───────────────────────────
    //
    // 1. Snapshot every global-memory clipboard format (text, HTML, RTF,
    //    images as CF_DIB/CF_DIBV5, file lists...) so nothing the user copied
    //    is lost. GDI-handle formats are skipped; Windows re-synthesises them
    //    (for example CF_BITMAP from CF_DIB) on restore.
    // 2. Put our text on the clipboard, marked so Win+V history and the cloud
    //    clipboard ignore it.
    // 3. Send Ctrl+V.
    // 4. After RESTORE_DELAY_MS, restore the snapshot, but only if the
    //    clipboard still holds our text (sequence number unchanged). If the
    //    user or an app copied something meanwhile, leave it alone.
    //
    // Consecutive pastes (multi-section insert) reuse the first snapshot so
    // the user's original clipboard is what finally comes back.

    const RESTORE_DELAY_MS: u64 = 700;
    const MAX_SNAPSHOT_BYTES: usize = 64 * 1024 * 1024;

    struct ClipSnapshot {
        formats: Vec<(u32, Vec<u8>)>,
    }

    struct PendingRestore {
        snapshot: ClipSnapshot,
        generation: u64,
        our_seq: u32,
    }

    static PENDING_RESTORE: Mutex<Option<PendingRestore>> = Mutex::new(None);
    static RESTORE_GENERATION: AtomicU64 = AtomicU64::new(0);

    unsafe fn open_clipboard_retry() -> bool {
        use windows::Win32::System::DataExchange::OpenClipboard;
        for attempt in 0..15u64 {
            if OpenClipboard(None).is_ok() {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(10 + attempt * 5));
        }
        eprintln!("[Clipboard] OpenClipboard failed after retries (another app holds it)");
        false
    }

    fn is_snapshot_format(fmt: u32) -> bool {
        // GDI and owner-display handles can't be copied as bytes.
        const CF_BITMAP: u32 = 2;
        const CF_METAFILEPICT: u32 = 3;
        const CF_PALETTE: u32 = 9;
        const CF_ENHMETAFILE: u32 = 14;
        const CF_OWNERDISPLAY: u32 = 0x80;
        const CF_DSPBITMAP: u32 = 0x82;
        const CF_DSPMETAFILEPICT: u32 = 0x83;
        const CF_DSPENHMETAFILE: u32 = 0x8E;
        !matches!(
            fmt,
            CF_BITMAP | CF_METAFILEPICT | CF_PALETTE | CF_ENHMETAFILE | CF_OWNERDISPLAY
                | CF_DSPBITMAP | CF_DSPMETAFILEPICT | CF_DSPENHMETAFILE
        ) && !(0x0200..=0x03FF).contains(&fmt) // CF_PRIVATE* and CF_GDIOBJ* ranges
    }

    /// Caller must hold the clipboard open.
    unsafe fn snapshot_open_clipboard() -> ClipSnapshot {
        use windows::Win32::System::DataExchange::{EnumClipboardFormats, GetClipboardData};
        use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

        let mut formats = Vec::new();
        let mut total = 0usize;
        let mut fmt = EnumClipboardFormats(0);
        while fmt != 0 {
            if is_snapshot_format(fmt) {
                if let Ok(h) = GetClipboardData(fmt) {
                    if !h.0.is_null() {
                        let hglob = HGLOBAL(h.0);
                        let size = GlobalSize(hglob);
                        let ptr = GlobalLock(hglob);
                        if !ptr.is_null() {
                            if size > 0 && total + size <= MAX_SNAPSHOT_BYTES {
                                let bytes = std::slice::from_raw_parts(ptr as *const u8, size).to_vec();
                                total += size;
                                formats.push((fmt, bytes));
                            }
                            let _ = GlobalUnlock(hglob);
                        }
                    }
                }
            }
            fmt = EnumClipboardFormats(fmt);
        }
        ClipSnapshot { formats }
    }

    /// Caller must hold the clipboard open (and have emptied it).
    unsafe fn set_clipboard_bytes(fmt: u32, bytes: &[u8]) -> bool {
        use windows::Win32::System::DataExchange::SetClipboardData;
        use windows::Win32::Foundation::GlobalFree;
        use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

        if fmt == 0 {
            return false;
        }
        let len = bytes.len().max(1);
        let hmem = match GlobalAlloc(GMEM_MOVEABLE, len) {
            Ok(h) => h,
            Err(_) => return false,
        };
        let ptr = GlobalLock(hmem);
        if ptr.is_null() {
            let _ = GlobalFree(Some(hmem));
            return false;
        }
        if bytes.is_empty() {
            *(ptr as *mut u8) = 0;
        } else {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr as *mut u8, bytes.len());
        }
        let _ = GlobalUnlock(hmem);
        if SetClipboardData(fmt, Some(HANDLE(hmem.0))).is_err() {
            let _ = GlobalFree(Some(hmem));
            return false;
        }
        true
    }

    unsafe fn register_format(name: &str) -> u32 {
        use windows::core::PCWSTR;
        use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        RegisterClipboardFormatW(PCWSTR(wide.as_ptr()))
    }

    fn restore_snapshot(snapshot: &ClipSnapshot) {
        use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard};
        unsafe {
            if !open_clipboard_retry() {
                return;
            }
            let _ = EmptyClipboard();
            for (fmt, bytes) in &snapshot.formats {
                let _ = set_clipboard_bytes(*fmt, bytes);
            }
            let _ = CloseClipboard();
        }
        println!("[Clipboard] Restored {} clipboard format(s)", snapshot.formats.len());
    }

    unsafe fn inject_via_clipboard_paste(hwnd: HWND, text: &str) -> bool {
        use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard};

        const CF_UNICODETEXT: u32 = 13;

        let fg_now = GetForegroundWindow();
        if fg_now.0 != hwnd.0 {
            eprintln!("[Clipboard] Target is not the foreground window; not pasting");
            return false;
        }

        if !open_clipboard_retry() {
            return false;
        }

        // Reuse the original snapshot if a restore from a previous paste is
        // still pending (multi-section insert); otherwise snapshot now.
        let generation = RESTORE_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        let pending = PENDING_RESTORE.lock().ok().and_then(|mut g| g.take());
        let snapshot = match pending {
            Some(p) if GetClipboardSequenceNumber() == p.our_seq => p.snapshot,
            _ => snapshot_open_clipboard(),
        };

        let _ = EmptyClipboard();
        let utf16: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        let utf16_bytes = std::slice::from_raw_parts(utf16.as_ptr() as *const u8, utf16.len() * 2);
        let ok = set_clipboard_bytes(CF_UNICODETEXT, utf16_bytes);
        if ok {
            // Keep the transient prompt out of Win+V history and the cloud clipboard.
            let zero = 0u32.to_le_bytes();
            let _ = set_clipboard_bytes(register_format("ExcludeClipboardContentFromMonitorProcessing"), &[]);
            let _ = set_clipboard_bytes(register_format("CanIncludeInClipboardHistory"), &zero);
            let _ = set_clipboard_bytes(register_format("CanUploadToCloudClipboard"), &zero);
        }
        let _ = CloseClipboard();
        if !ok {
            restore_snapshot(&snapshot);
            return false;
        }
        let our_seq = GetClipboardSequenceNumber();

        std::thread::sleep(std::time::Duration::from_millis(60));

        let paste_inputs = [
            key_vk(VK_CONTROL, KEYBD_EVENT_FLAGS(0)),
            key_vk(VK_V, KEYBD_EVENT_FLAGS(0)),
            key_vk(VK_V, KEYEVENTF_KEYUP),
            key_vk(VK_CONTROL, KEYEVENTF_KEYUP),
        ];
        let sent = send_inputs(&paste_inputs);

        if let Ok(mut g) = PENDING_RESTORE.lock() {
            *g = Some(PendingRestore { snapshot, generation, our_seq });
        }
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(RESTORE_DELAY_MS));
            let pending = match PENDING_RESTORE.lock() {
                Ok(mut g) => {
                    if g.as_ref().map(|p| p.generation == generation).unwrap_or(false) {
                        g.take()
                    } else {
                        None // a newer paste owns the restore
                    }
                }
                Err(_) => None,
            };
            if let Some(p) = pending {
                if unsafe { GetClipboardSequenceNumber() } == p.our_seq {
                    restore_snapshot(&p.snapshot);
                } else {
                    println!("[Clipboard] Clipboard changed since paste; keeping the new content");
                }
            }
        });

        sent != 0
    }

    fn build_backspace_delete(trigger_len: u32) -> Vec<INPUT> {
        let n = trigger_len as usize;
        let mut v = Vec::with_capacity(n * 2);
        for _ in 0..n {
            v.push(key_vk(VK_BACK, KEYBD_EVENT_FLAGS(0)));
            v.push(key_vk(VK_BACK, KEYEVENTF_KEYUP));
        }
        v
    }

    #[inline]
    fn key_vk(vk: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: super::INJECT_MARKER },
            },
        }
    }

    #[inline]
    unsafe fn send_inputs(inputs: &[INPUT]) -> u32 {
        if inputs.is_empty() { return 0; }
        SendInput(inputs, size_of::<INPUT>() as i32)
    }

    pub fn paste_text_to_window_impl(hwnd: isize, text: &str) -> bool {
        let target = HWND(hwnd as *mut _);
        if unsafe { !IsWindow(Some(target)).as_bool() } {
            return false;
        }
        unsafe {
            use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
            use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
            use windows::Win32::UI::Input::KeyboardAndMouse::SetFocus;

            if !SetForegroundWindow(target).as_bool() {
                eprintln!("[PasteToWindow] SetForegroundWindow failed");
            }
            std::thread::sleep(std::time::Duration::from_millis(60));

            let focus_hwnd = STORED_FOCUS_HWND.lock().ok().and_then(|g| *g);
            if let Some(fh) = focus_hwnd {
                let child = HWND(fh as *mut _);
                let same_root = GetAncestor(child, GA_ROOT).0 == target.0;
                if IsWindow(Some(child)).as_bool() && same_root {
                    let target_thread = GetWindowThreadProcessId(target, None);
                    let our_thread = GetCurrentThreadId();
                    let attached = target_thread != 0
                        && target_thread != our_thread
                        && AttachThreadInput(our_thread, target_thread, true).as_bool();
                    let _ = SetFocus(Some(child));
                    if attached {
                        let _ = AttachThreadInput(our_thread, target_thread, false);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(30));
                }
            }

            inject_via_clipboard_paste(target, text)
        }
    }

    pub fn send_enter_to_window_impl(hwnd: isize) -> bool {
        let target = HWND(hwnd as *mut _);
        if unsafe { !IsWindow(Some(target)).as_bool() } {
            return false;
        }
        unsafe {
            let fg = GetForegroundWindow();
            if fg.0 != target.0 {
                if !SetForegroundWindow(target).as_bool() {
                    return false;
                }
                std::thread::sleep(std::time::Duration::from_millis(40));
            }
            let enter_inputs = [
                key_vk(VK_RETURN, KEYBD_EVENT_FLAGS(0)),
                key_vk(VK_RETURN, KEYEVENTF_KEYUP),
            ];
            send_inputs(&enter_inputs) > 0
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// macOS implementation
// ══════════════════════════════════════════════════════════════════════════════

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use std::process::Command;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use objc::{msg_send, sel, sel_impl, class};
    use cocoa::base::{id, nil};
    use cocoa::foundation::NSString;

    const KVK_DELETE: u16 = 0x33;
    const KVK_RETURN: u16 = 0x24;
    const KVK_V: u16 = 0x09;

    static RESTORE_CANCELLED: AtomicBool = AtomicBool::new(false);
    static REPLACEMENT_GENERATION: AtomicU64 = AtomicU64::new(0);

    fn activate_pid(pid: i32) -> bool {
        let script = format!(
            "tell application \"System Events\" to set frontmost of (first process whose unix id is {}) to true",
            pid
        );
        Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    // ── NSPasteboard direct API ──────────────────────────────────────────────

    unsafe fn get_general_pasteboard() -> id {
        msg_send![class!(NSPasteboard), generalPasteboard]
    }

    fn clipboard_read() -> Option<String> {
        unsafe {
            let pb: id = get_general_pasteboard();
            let ns_string_type: id = NSString::alloc(nil).init_str("public.utf8-plain-text");
            let content: id = msg_send![pb, stringForType: ns_string_type];
            if content == nil {
                return None;
            }
            let bytes: *const i8 = msg_send![content, UTF8String];
            if bytes.is_null() {
                return None;
            }
            Some(std::ffi::CStr::from_ptr(bytes).to_string_lossy().into_owned())
        }
    }

    fn clipboard_write(text: &str) -> bool {
        unsafe {
            let pb: id = get_general_pasteboard();
            let count_before: i64 = msg_send![pb, changeCount];
            let _: i64 = msg_send![pb, clearContents];
            let ns_string: id = NSString::alloc(nil).init_str(text);
            let ns_string_type: id = NSString::alloc(nil).init_str("public.utf8-plain-text");
            let success: bool = msg_send![pb, setString: ns_string forType: ns_string_type];
            if !success {
                eprintln!("[Replacement:macOS] NSPasteboard setString failed");
                return false;
            }
            let count_after: i64 = msg_send![pb, changeCount];
            if count_after == count_before {
                eprintln!("[Replacement:macOS] NSPasteboard changeCount did not advance");
                return false;
            }
            true
        }
    }

    fn restore_clipboard(saved: String, generation: u64) {
        RESTORE_CANCELLED.store(false, Ordering::SeqCst);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(600));
            if RESTORE_CANCELLED.load(Ordering::SeqCst) {
                return;
            }
            if REPLACEMENT_GENERATION.load(Ordering::SeqCst) != generation {
                return;
            }
            clipboard_write(&saved);
        });
    }

    // ── Key posting ──────────────────────────────────────────────────────────

    fn post_key(keycode: u16, key_down: bool, flags: CGEventFlags) {
        let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState).unwrap();
        let event = CGEvent::new_keyboard_event(source, keycode, key_down).unwrap();
        event.set_flags(flags);
        event.post(CGEventTapLocation::HID);
    }

    fn post_backspaces(count: u32) {
        for _ in 0..count {
            post_key(KVK_DELETE, true, CGEventFlags::empty());
            post_key(KVK_DELETE, false, CGEventFlags::empty());
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }

    fn post_cmd_v() {
        post_key(KVK_V, true, CGEventFlags::CGEventFlagCommand);
        post_key(KVK_V, false, CGEventFlags::CGEventFlagCommand);
    }

    // ── Public replacement API ───────────────────────────────────────────────

    pub fn execute_replacement(anchor: AnchorData, text: &str) -> bool {
        let pid = anchor.handle as i32;
        if pid == 0 {
            eprintln!("[Replacement:macOS] Invalid PID");
            return false;
        }

        let gen = REPLACEMENT_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        RESTORE_CANCELLED.store(true, Ordering::SeqCst);

        if !activate_pid(pid) {
            eprintln!("[Replacement:macOS] Failed to activate PID {pid}");
        }
        std::thread::sleep(std::time::Duration::from_millis(60));

        post_backspaces(anchor.trigger_len);
        std::thread::sleep(std::time::Duration::from_millis(40));

        if text.is_empty() { return true; }

        let saved = clipboard_read();

        if !clipboard_write(text) {
            eprintln!("[Replacement:macOS] Failed to write to pasteboard — aborting paste");
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(150));

        post_cmd_v();

        println!("[Replacement:macOS] Pasted {} chars into PID {pid}", text.chars().count());

        if let Some(saved) = saved {
            restore_clipboard(saved, gen);
        }

        true
    }

    pub fn paste_text_to_window_impl(pid: i32, text: &str) -> bool {
        if pid == 0 { return false; }

        let gen = REPLACEMENT_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        RESTORE_CANCELLED.store(true, Ordering::SeqCst);

        activate_pid(pid);
        std::thread::sleep(std::time::Duration::from_millis(60));

        let saved = clipboard_read();

        if !clipboard_write(text) {
            eprintln!("[Replacement:macOS] Failed to write to pasteboard — aborting paste");
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(150));

        post_cmd_v();

        if let Some(saved) = saved {
            restore_clipboard(saved, gen);
        }
        true
    }

    pub fn send_enter_to_window_impl(pid: i32) -> bool {
        if pid == 0 { return false; }
        activate_pid(pid);
        std::thread::sleep(std::time::Duration::from_millis(40));
        post_key(KVK_RETURN, true, CGEventFlags::empty());
        post_key(KVK_RETURN, false, CGEventFlags::empty());
        true
    }
}
