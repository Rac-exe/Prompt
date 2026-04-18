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
    use std::sync::atomic::{AtomicBool, Ordering};

    use windows::Win32::Foundation::{HANDLE, HGLOBAL, HWND, LPARAM, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_KEYUP, VIRTUAL_KEY,
        VK_BACK, VK_CONTROL, VK_RETURN, VK_V,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetGUIThreadInfo, GetWindow, IsWindow,
        SendMessageW, SetForegroundWindow, GUITHREADINFO, GW_CHILD, GW_HWNDNEXT,
    };
    use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;

    static STORED_FOCUS_HWND: Mutex<Option<isize>> = Mutex::new(None);
    static RESTORE_CANCELLED: AtomicBool = AtomicBool::new(false);

    pub fn capture_focus_child() {
        unsafe {
            let mut gti: GUITHREADINFO = std::mem::zeroed();
            gti.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
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

        if class_name == "Edit" || class_name.starts_with("RichEdit") {
            if let Some(edit_hwnd) = find_edit_hwnd(hwnd) {
                return inject_via_edit_messages(edit_hwnd, anchor.trigger_len, text);
            }
        }
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
        c == "Edit" || c.starts_with("RichEdit")
    }

    unsafe fn find_edit_hwnd(anchor_hwnd: HWND) -> Option<HWND> {
        let mut gti: GUITHREADINFO = std::mem::zeroed();
        gti.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
        if GetGUIThreadInfo(0, &mut gti).is_ok() && is_edit_class(gti.hwndFocus) {
            return Some(gti.hwndFocus);
        }
        if is_edit_class(anchor_hwnd) {
            return Some(anchor_hwnd);
        }
        let mut child = GetWindow(anchor_hwnd, GW_CHILD).ok();
        while let Some(c) = child {
            if is_edit_class(c) { return Some(c); }
            child = GetWindow(c, GW_HWNDNEXT).ok();
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

        let _ = caret_range.MoveEndpointByUnit(
            TextPatternRangeEndpoint_Start,
            TextUnit_Character,
            -(trigger_len as i32),
        );

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

    unsafe fn inject_via_clipboard_paste(hwnd: HWND, text: &str) -> bool {
        use windows::Win32::System::DataExchange::{
            CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard,
            SetClipboardData,
        };
        use windows::Win32::System::Memory::{
            GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock,
            GMEM_MOVEABLE,
        };

        const CF_UNICODETEXT: u32 = 13;

        RESTORE_CANCELLED.store(true, Ordering::SeqCst);

        let fg_now = GetForegroundWindow();
        if fg_now.0 != hwnd.0 {
            return false;
        }

        let mut saved_clipboard: Option<Vec<u16>> = None;
        let seq_before = GetClipboardSequenceNumber();

        if OpenClipboard(None).is_err() {
            return false;
        }

        let h = GetClipboardData(CF_UNICODETEXT);
        if let Ok(handle) = h {
            if !handle.0.is_null() {
                let hglob = HGLOBAL(handle.0);
                let ptr = GlobalLock(hglob);
                if !ptr.is_null() {
                    let size = GlobalSize(hglob);
                    let len_u16 = size / 2;
                    let slice = std::slice::from_raw_parts(ptr as *const u16, len_u16);
                    saved_clipboard = Some(slice.to_vec());
                    let _ = GlobalUnlock(hglob);
                }
            }
        }

        let _ = EmptyClipboard();
        let utf16: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        let byte_len = utf16.len() * 2;

        let hmem = match GlobalAlloc(GMEM_MOVEABLE, byte_len) {
            Ok(h) => h,
            Err(_) => { let _ = CloseClipboard(); return false; }
        };

        let ptr = GlobalLock(hmem);
        if ptr.is_null() {
            let _ = CloseClipboard();
            return false;
        }
        std::ptr::copy_nonoverlapping(utf16.as_ptr() as *const u8, ptr as *mut u8, byte_len);
        let _ = GlobalUnlock(hmem);

        let set_result = SetClipboardData(CF_UNICODETEXT, Some(HANDLE(hmem.0)));
        let _ = CloseClipboard();

        if set_result.is_err() { return false; }

        let seq_after = GetClipboardSequenceNumber();
        if seq_after == seq_before {
            if OpenClipboard(None).is_ok() {
                let _ = EmptyClipboard();
                if let Ok(hmem2) = GlobalAlloc(GMEM_MOVEABLE, byte_len) {
                    let ptr2 = GlobalLock(hmem2);
                    if !ptr2.is_null() {
                        std::ptr::copy_nonoverlapping(utf16.as_ptr() as *const u8, ptr2 as *mut u8, byte_len);
                        let _ = GlobalUnlock(hmem2);
                        let _ = SetClipboardData(CF_UNICODETEXT, Some(HANDLE(hmem2.0)));
                    }
                }
                let _ = CloseClipboard();
            }
        }

        std::thread::sleep(std::time::Duration::from_millis(150));

        let paste_inputs = [
            key_vk(VK_CONTROL, KEYBD_EVENT_FLAGS(0)),
            key_vk(VK_V, KEYBD_EVENT_FLAGS(0)),
            key_vk(VK_V, KEYEVENTF_KEYUP),
            key_vk(VK_CONTROL, KEYEVENTF_KEYUP),
        ];

        let sent = send_inputs(&paste_inputs);
        if sent == 0 { return false; }

        if let Some(saved) = saved_clipboard {
            RESTORE_CANCELLED.store(false, Ordering::SeqCst);
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(500));
                if RESTORE_CANCELLED.load(Ordering::SeqCst) { return; }
                unsafe {
                    if OpenClipboard(None).is_ok() {
                        let _ = EmptyClipboard();
                        let byte_len = saved.len() * 2;
                        if let Ok(hmem) = GlobalAlloc(GMEM_MOVEABLE, byte_len) {
                            let ptr = GlobalLock(hmem);
                            if !ptr.is_null() {
                                std::ptr::copy_nonoverlapping(saved.as_ptr() as *const u8, ptr as *mut u8, byte_len);
                                let _ = GlobalUnlock(hmem);
                                let _ = SetClipboardData(CF_UNICODETEXT, Some(HANDLE(hmem.0)));
                            }
                        }
                        let _ = CloseClipboard();
                    }
                }
            });
        }

        true
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
                ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 },
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
                if IsWindow(Some(child)).as_bool() {
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

    const KVK_DELETE: u16 = 0x33;
    const KVK_RETURN: u16 = 0x24;
    const KVK_V: u16 = 0x09;

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

    fn set_clipboard(text: &str) -> Option<String> {
        let saved = Command::new("pbpaste")
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string());

        let mut child = Command::new("pbcopy")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .ok()?;
        if let Some(stdin) = child.stdin.as_mut() {
            use std::io::Write;
            let _ = stdin.write_all(text.as_bytes());
        }
        let _ = child.wait();

        saved
    }

    fn restore_clipboard(saved: String) {
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(500));
            let mut child = match Command::new("pbcopy")
                .stdin(std::process::Stdio::piped())
                .spawn()
            {
                Ok(c) => c,
                Err(_) => return,
            };
            if let Some(stdin) = child.stdin.as_mut() {
                use std::io::Write;
                let _ = stdin.write_all(saved.as_bytes());
            }
            let _ = child.wait();
        });
    }

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

    pub fn execute_replacement(anchor: AnchorData, text: &str) -> bool {
        let pid = anchor.handle as i32;
        if pid == 0 {
            eprintln!("[Replacement:macOS] Invalid PID");
            return false;
        }

        if !activate_pid(pid) {
            eprintln!("[Replacement:macOS] Failed to activate PID {pid}");
        }
        std::thread::sleep(std::time::Duration::from_millis(60));

        post_backspaces(anchor.trigger_len);
        std::thread::sleep(std::time::Duration::from_millis(40));

        if text.is_empty() { return true; }

        let saved = set_clipboard(text);
        std::thread::sleep(std::time::Duration::from_millis(50));

        post_cmd_v();

        println!("[Replacement:macOS] Pasted {} chars into PID {pid}", text.chars().count());

        if let Some(saved) = saved {
            restore_clipboard(saved);
        }

        true
    }

    pub fn paste_text_to_window_impl(pid: i32, text: &str) -> bool {
        if pid == 0 { return false; }
        activate_pid(pid);
        std::thread::sleep(std::time::Duration::from_millis(60));

        let saved = set_clipboard(text);
        std::thread::sleep(std::time::Duration::from_millis(50));
        post_cmd_v();

        if let Some(saved) = saved {
            restore_clipboard(saved);
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
