/// replacement.rs — Hybrid atomic text replacement engine.
///
/// WHY A HYBRID APPROACH IS REQUIRED
/// ====================================
/// Different Windows applications process text input through fundamentally
/// different mechanisms. No single strategy is correct for all of them.
///
///   • Classic Win32 EDIT / RichEdit (Notepad, legacy apps)
///     → EM_GETSEL + EM_SETSEL + EM_REPLACESEL (synchronous, no input queue)
///     SendInput drops chars in long strings because Win32 EDIT's message
///     queue overflows. EM_REPLACESEL is the only safe path.
///
///   • Modern rich editors: VS Code (Monaco), Discord (Electron/Chromium),
///     UWP, WinUI3, browser textareas etc.
///     → TextPattern + Select() + guarded SendInput
///
///     WHY NOT ValuePattern.SetValue for these:
///     ValuePattern.SetValue replaces the ENTIRE control value as a raw string.
///     Rich editors (Monaco, Quill, CodeMirror) maintain an internal model
///     separate from the DOM/Win32 value. SetValue writes the raw string but
///     bypasses the model — this:
///       - Destroys the undo/redo stack (model diff tracking is lost)
///       - Corrupts caret state (position is reset to 0 or end)
///       - Breaks backspace (model and displayed text desync)
///       - Fails on second replacement (UIA reference goes stale after the
///         first SetValue because the element is recreated in the model)
///
///     CORRECT APPROACH:
///     1. Use TextPattern only to POSITION the selection atomically.
///        - ElementFromHandle(hwnd) — fresh element, no cached refs
///        - GetSelection()[0] — get current caret range
///        - MoveEndpointByUnit(Start, Character, -trigger_len) — expand back
///        - Select() — tell the app to select that exact range
///     2. SendInput: KEYEVENTF_UNICODE injection to TYPE over the selection.
///        The app's own input handler processes the keystrokes, updating its
///        internal model, undo stack, and caret — just like a real user typing.
///     Foreground guard: verify anchor.hwnd == GetForegroundWindow() before
///     each SendInput chunk to abort on window switch (no cross-app leakage).
///
///   • Legacy apps with no TextPattern provider
///     → Guarded SendInput only (Shift+Left to select, then unicode type).
///     Same foreground guard applies.
///
/// WHY TRIGGER / BUFFER / ANCHOR LOGIC IS NOT TOUCHED
/// =====================================================
/// Detection (hook.rs / buffer.rs) and injection (this file) are decoupled.
/// They share only LAST_ANCHOR — a one-shot mutex slot. Touching detection
/// risks double-fires or timing breaks; they are intentionally isolated.
///
/// DECISION TREE
/// ==============
///   GetClassNameW(anchor_hwnd)
///   ├── "Edit" / "RichEdit*"  →  PATH A: EM_REPLACESEL
///   └── other
///       └── COM init
///           └── ElementFromHandle(anchor_hwnd)   ← always fresh
///               ├── TextPattern supported         →  PATH B: Select + SendInput
///               └── not supported                 →  PATH C: Guarded SendInput

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
    GetClassNameW, GetForegroundWindow, GetGUIThreadInfo, GetWindow, IsWindow,
    SendMessageW, SetForegroundWindow, GUITHREADINFO, GW_CHILD, GW_HWNDNEXT,
};

// ─── Anchor ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct AnchorData {
    /// Raw HWND as isize — safe to store across threads as an integer.
    pub hwnd: isize,
    /// Number of characters comprising the trigger phrase ("@prompt" → 7).
    pub trigger_len: u32,
    /// Unix timestamp (ms) when the trigger fired — reserved for staleness checks.
    #[allow(dead_code)]
    pub timestamp_ms: u64,
}

static LAST_ANCHOR: Mutex<Option<AnchorData>> = Mutex::new(None);

/// Store the foreground window and trigger length captured at trigger time.
/// Called from hook.rs → fire_trigger(). Not modified.
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

// ─── Entry point ─────────────────────────────────────────────────────────────

pub fn replace_at_last_anchor(text: &str) -> bool {
    let anchor = match LAST_ANCHOR.lock() {
        Ok(mut g) => g.take(),
        Err(_) => None,
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

// ─── Core dispatch ────────────────────────────────────────────────────────────

unsafe fn execute_replacement(anchor: AnchorData, text: &str) -> bool {
    let hwnd = HWND(anchor.hwnd as *mut _);

    if !IsWindow(hwnd).as_bool() {
        eprintln!("[Replacement] Target window gone (hwnd={:#x})", anchor.hwnd);
        return false;
    }

    // Refocus original window so SendInput in paths B and C lands correctly.
    if !SetForegroundWindow(hwnd).as_bool() {
        eprintln!("[Replacement] SetForegroundWindow failed — proceeding anyway");
    }
    std::thread::sleep(std::time::Duration::from_millis(30));

    // ── Step 1: read window class ─────────────────────────────────────────────
    // Class detection happens BEFORE any SendInput so that path A (Edit) never
    // mixes synchronous EM_* messages with queued keyboard events.
    let class_name = get_class_name(hwnd);
    println!("[Replacement] hwnd={:#x} class={:?}", anchor.hwnd, class_name);

    // ── PATH A — Classic Win32 Edit / RichEdit ────────────────────────────────
    if class_name == "Edit" || class_name.starts_with("RichEdit") {
        // Also check children — classic Notepad: top-level "Notepad" hosts a
        // child "Edit" control. find_edit_hwnd covers both cases.
        if let Some(edit_hwnd) = find_edit_hwnd(hwnd) {
            println!(
                "[Replacement] Path A — EM_REPLACESEL on hwnd={:#x}",
                edit_hwnd.0 as usize
            );
            return inject_via_edit_messages(edit_hwnd, anchor.trigger_len, text);
        }
    }
    // Also try the child-scan regardless of top-level class (handles wrapped Notepad).
    if let Some(edit_hwnd) = find_edit_hwnd(hwnd) {
        println!(
            "[Replacement] Path A (child found) — EM_REPLACESEL on hwnd={:#x}",
            edit_hwnd.0 as usize
        );
        return inject_via_edit_messages(edit_hwnd, anchor.trigger_len, text);
    }

    // ── PATH B — UIA TextPattern: Select() + guarded SendInput ───────────────
    // WHY THIS ORDER:
    // TextPattern.Select() tells the TARGET APP to select the trigger range
    // through its own selection model (VS Code / Monaco / Chromium all handle
    // the UIA selection event and update their internal model correctly).
    // Then we SendInput the replacement characters — the app's own key handler
    // processes each char, preserving undo history, caret semantics, and model
    // consistency. This is equivalent to a user Shift+clicking to select, then
    // typing — but selection is set precisely via UIA instead of Shift+Left
    // (which can miscount in compositing editors like Monaco).
    //
    // WHY NOT ValuePattern.SetValue:
    // See module doc at top of file. Summary: ValuePattern.SetValue bypasses the
    // editor's internal model — breaks undo, caret, backspace, and silently
    // fails on second replacement because the element ref goes stale.
    if try_textpattern_select_then_send(hwnd, anchor.trigger_len, text) {
        return true;
    }

    // ── PATH C — Guarded SendInput (fallback) ─────────────────────────────────
    // Used when neither Edit class nor TextPattern are available.
    // Foreground guard aborts injection if the user switches windows mid-chunk,
    // preventing cross-app character leakage.
    inject_via_guarded_sendinput(hwnd, &anchor, text)
}

// ─── PATH A helpers ───────────────────────────────────────────────────────────

/// Get the Win32 class name of a window as a Rust String.
unsafe fn get_class_name(hwnd: HWND) -> String {
    let mut buf = vec![0u16; 256];
    let len = GetClassNameW(hwnd, &mut buf);
    if len <= 0 { return String::new(); }
    String::from_utf16_lossy(&buf[..len as usize])
}

/// Check whether `hwnd` is a classic EDIT or RichEdit control.
#[inline]
unsafe fn is_edit_class(hwnd: HWND) -> bool {
    if hwnd.0.is_null() { return false; }
    let c = get_class_name(hwnd);
    c == "Edit" || c.starts_with("RichEdit")
}

/// Find the deepest Edit/RichEdit HWND associated with `anchor_hwnd`.
/// Three strategies in order:
///   1. GetGUIThreadInfo — most accurate focused control.
///   2. anchor_hwnd itself.
///   3. Direct children of anchor_hwnd (classic Notepad layout).
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

/// Synchronous EM_GETSEL + EM_SETSEL + EM_REPLACESEL — no input queue involved.
unsafe fn inject_via_edit_messages(hwnd: HWND, trigger_len: u32, text: &str) -> bool {
    const EM_GETSEL: u32 = 0x00B0;
    const EM_SETSEL: u32 = 0x00B1;
    const EM_REPLACESEL: u32 = 0x00C2;

    let mut sel_start: u32 = 0;
    let mut sel_end: u32 = 0;
    SendMessageW(
        hwnd, EM_GETSEL,
        WPARAM(&mut sel_start as *mut u32 as usize),
        LPARAM(&mut sel_end as *mut u32 as isize),
    );

    let caret = sel_end;
    let start = caret.saturating_sub(trigger_len);
    SendMessageW(hwnd, EM_SETSEL, WPARAM(start as usize), LPARAM(caret as isize));

    let mut utf16: Vec<u16> = text.encode_utf16().collect();
    utf16.push(0);
    SendMessageW(
        hwnd, EM_REPLACESEL,
        WPARAM(1),                        // TRUE → undoable via Ctrl+Z
        LPARAM(utf16.as_ptr() as isize),
    );
    true
}

// ─── PATH B helpers ───────────────────────────────────────────────────────────

/// Try UIA TextPattern-based selection + guarded SendInput for replacement.
///
/// Flow:
///   1. CoInitializeEx(STA) — required for UIA on a worker thread.
///   2. ElementFromHandle(anchor_hwnd) — fresh element; NEVER reuse cached refs.
///      Reusing refs causes "works once then fails" because rich editors
///      recreate their UIA element tree after each model update.
///   3. GetCurrentPattern(UIA_TextPatternId) — check TextPattern support.
///   4. GetSelection()[0] — caret range (degenerate = caret point).
///   5. MoveEndpointByUnit(Start, Character, -trigger_len) — expand back.
///   6. Select() — atomically tell the target app to select that range.
///      The app's own selection model updates (not just Win32 focus).
///   7. GuardedSendInput: type replacement chars over the selection.
///      App handles keystrokes → undo preserved, caret correct, model intact.
///
/// Returns true if TextPattern was supported and replacement was attempted.
/// Returns false to signal fallback to Path C.
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
        eprintln!("[Replacement:UIA] CoInitializeEx failed: {:?}", com_hr);
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

    // ── Fresh element from HWND ───────────────────────────────────────────────
    // We call ElementFromHandle every time — not GetFocusedElement.
    // WHY: GetFocusedElement returns whatever the OS focus system reports,
    // which can be stale (e.g. the Electron shell window) instead of the
    // Monaco editor element. ElementFromHandle gives us the exact window we
    // anchored. We then rely on the TEXT PATTERN (not focus) to find the caret.
    // Additionally, rich editors rebuild their UIA element tree after every
    // model mutation — a reference captured during trigger detection would be
    // a dangling COM pointer by the time we use it here.
    let uia: IUIAutomation = match CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) {
        Ok(u) => u,
        Err(e) => {
            eprintln!("[Replacement:UIA] CoCreateInstance failed: {e}");
            return false;
        }
    };

    let element = match uia.ElementFromHandle(anchor_hwnd) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("[Replacement:UIA] ElementFromHandle({anchor_hwnd:?}) failed: {e}");
            return false;
        }
    };

    // ── TextPattern support check ─────────────────────────────────────────────
    let pattern_base = match element.GetCurrentPattern(UIA_TextPatternId) {
        Ok(p) => p,
        Err(_) => {
            println!("[Replacement:UIA] TextPattern not supported on hwnd={anchor_hwnd:?} — falling back");
            return false;
        }
    };

    let text_pattern: IUIAutomationTextPattern = match pattern_base.cast() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[Replacement:UIA] TextPattern cast failed: {e}");
            return false;
        }
    };

    // ── Get caret range ──────────────────────────────────────────────────────
    // GetSelection returns the current selection or caret position in the
    // element. For a collapsed caret the returned range is degenerate
    // (start == end), pointing to exactly where @prompt ends.
    let sel_array = match text_pattern.GetSelection() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("[Replacement:UIA] GetSelection failed: {e}");
            return false;
        }
    };

    let count = match sel_array.Length() {
        Ok(c) => c,
        Err(_) => {
            eprintln!("[Replacement:UIA] SelectionArray.Length failed");
            return false;
        }
    };
    if count == 0 {
        eprintln!("[Replacement:UIA] No selection range — falling back");
        return false;
    }

    let caret_range = match sel_array.GetElement(0) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[Replacement:UIA] GetElement(0) failed: {e}");
            return false;
        }
    };

    // ── Extend range leftward to cover the trigger phrase ────────────────────
    // At this point caret_range.start == caret_range.end == caret position.
    // We move the START endpoint back by trigger_len character units.
    // TextUnit_Character counts individual Unicode characters (not UTF-16 units)
    // so this is equivalent to Shift+Left × trigger_len, but model-aware.
    let moved = match caret_range.MoveEndpointByUnit(
        TextPatternRangeEndpoint_Start,
        TextUnit_Character,
        -(trigger_len as i32),
    ) {
        Ok(n) => n,
        Err(e) => {
            eprintln!("[Replacement:UIA] MoveEndpointByUnit failed: {e}");
            return false;
        }
    };

    if moved != -(trigger_len as i32) {
        eprintln!(
            "[Replacement:UIA] MoveEndpointByUnit moved={moved}, expected={}. Proceeding cautiously.",
            -(trigger_len as i32)
        );
        // Don't abort — best-effort selection is still better than no selection.
    }

    // ── Commit the selection to the target app ────────────────────────────────
    // Select() fires a UIA SelectionChanged event that the target app processes
    // on its own thread, setting its internal selection model. For Monaco / VS
    // Code, this updates the editor model's selection (not just Win32 focus),
    // so when we subsequently inject characters, they replace exactly the
    // selected text through the app's own key-handler pipeline.
    if let Err(e) = caret_range.Select() {
        eprintln!("[Replacement:UIA] TextRange.Select() failed: {e} — falling back");
        return false;
    }

    println!(
        "[Replacement:UIA] Path B — TextPattern.Select() OK. hwnd={:#x}. \
         Now injecting {} replacement chars via SendInput.",
        anchor_hwnd.0 as usize,
        text.chars().count()
    );

    // ── Small settle delay before injection ──────────────────────────────────
    // UIA Select() is asynchronous with respect to the target app's message
    // pump. A brief yield gives the target app time to process the selection
    // event before our SendInput characters arrive at the input queue.
    // This avoids a race where the first character arrives before the editor
    // has updated its selection state.
    std::thread::sleep(std::time::Duration::from_millis(20));

    // ── Type replacement over the selection via guarded SendInput ─────────────
    // At this point the app has the trigger phrase selected. Injecting unicode
    // keystrokes is equivalent to the user typing — the app's key handler:
    //   - Deletes the selected text (trigger)
    //   - Inserts each character
    //   - Advances the caret correctly
    //   - Records each operation in the undo stack
    // This is why undo works: the app sees N individual key events, not a
    // single opaque string replacement.
    inject_unicode_with_fg_guard(anchor_hwnd, anchor_hwnd.0 as isize, text)
}

// ─── PATH C helper ────────────────────────────────────────────────────────────

/// Fallback: Shift+Left×N to select trigger, then guarded unicode injection.
unsafe fn inject_via_guarded_sendinput(hwnd: HWND, anchor: &AnchorData, text: &str) -> bool {
    // Phase 1: select trigger phrase with Shift+Left×trigger_len.
    let select = build_shift_select(anchor.trigger_len);
    let sent = send_inputs(&select);
    if sent == 0 && !select.is_empty() {
        eprintln!("[Replacement:SendInput] Shift+Left blocked — UIPI elevation mismatch?");
        return false;
    }
    if text.is_empty() { return true; }

    // Phase 2: inject with foreground guard.
    inject_unicode_with_fg_guard(hwnd, anchor.hwnd, text)
}

/// Inject `text` as KEYEVENTF_UNICODE events in chunks, aborting if the original
/// window loses foreground between chunks (prevents cross-app character leakage).
///
/// CHUNK_SIZE controls the granularity of the foreground check.
/// 64 chars → check roughly every 64 * 2 key events.
unsafe fn inject_unicode_with_fg_guard(hwnd: HWND, expected_hwnd: isize, text: &str) -> bool {
    const CHUNK_SIZE: usize = 64;

    let chars: Vec<char> = text.chars().collect();
    let mut injected = 0usize;

    for chunk in chars.chunks(CHUNK_SIZE) {
        // Foreground guard — abort if user switched windows.
        // SendInput routes to the CURRENT foreground, so if the window changed
        // the remaining characters would land in the wrong app.
        let fg_now = GetForegroundWindow();
        if fg_now.0 != hwnd.0 {
            eprintln!(
                "[Replacement:SendInput] Foreground changed at char {injected}/{} — \
                 aborting. expected={:#x} got={:#x}",
                text.chars().count(),
                expected_hwnd,
                fg_now.0 as usize,
            );
            return false;
        }

        let chunk_str: String = chunk.iter().collect();
        let inputs = build_unicode_type(&chunk_str);
        let sent = send_inputs(&inputs);
        if sent == 0 && !inputs.is_empty() {
            eprintln!("[Replacement:SendInput] Type blocked at char {injected}");
            return false;
        }
        injected += chunk.len();
    }

    println!(
        "[Replacement:SendInput] Injected {} chars into hwnd={:#x}",
        text.chars().count(),
        expected_hwnd
    );
    true
}

// ─── Input builders ───────────────────────────────────────────────────────────

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

fn build_unicode_type(text: &str) -> Vec<INPUT> {
    let mut v = Vec::new();
    for ch in text.chars() {
        let cp = ch as u32;
        if cp <= 0xFFFF {
            v.push(key_unicode(cp as u16, KEYBD_EVENT_FLAGS(0)));
            v.push(key_unicode(cp as u16, KEYEVENTF_KEYUP));
        } else {
            let code = cp - 0x10000;
            let high = (0xD800 + (code >> 10)) as u16;
            let low  = (0xDC00 + (code & 0x3FF)) as u16;
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
            ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 },
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

#[inline]
unsafe fn send_inputs(inputs: &[INPUT]) -> u32 {
    if inputs.is_empty() { return 0; }
    SendInput(inputs, size_of::<INPUT>() as i32)
}
