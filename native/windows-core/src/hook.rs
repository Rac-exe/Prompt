/// hook.rs — Global WH_KEYBOARD_LL keyboard hook.
///
/// Architecture:
///   start_hook(tsfn)
///     → spawns hook_thread
///     → hook_thread receives tsfn via channel, stores in thread_local
///     → hook_thread installs SetWindowsHookExW(WH_KEYBOARD_LL)
///     → hook_thread runs GetMessage loop (blocks, pumps hook callbacks)
///     → ll_keyboard_proc fires in hook_thread context for every key event
///     → ll_keyboard_proc updates thread_local BUFFER / SHIFT state
///     → on @prompt match: GetForegroundWindow → tsfn.call(TriggerData)
///
///   stop_hook()
///     → PostThreadMessageW(WM_QUIT) to hook_thread
///     → hook_thread exits loop, UnhookWindowsHookEx, thread ends
///     → tsfn dropped → TSFN unregistered from Node event loop

use std::cell::RefCell;
use std::sync::{mpsc, Mutex};
use std::thread::JoinHandle;

use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    VK_BACK, VK_ESCAPE, VK_LSHIFT, VK_RETURN, VK_RSHIFT, VK_SHIFT, VK_TAB,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetForegroundWindow, GetMessageW, PostThreadMessageW,
    SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, HC_ACTION, HHOOK,
    KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_QUIT, WM_SYSKEYDOWN,
};

// KBDLLHOOKSTRUCT.flags bit masks (not exported as named constants in windows-0.58)
// LLKHF_EXTENDED  = 0x01 — extended key (not needed here)
// LLKHF_INJECTED  = 0x10 — event was synthetically injected (e.g. our SendInput)
// LLKHF_ALTDOWN   = 0x20 — Alt held (not needed here)
// LLKHF_UP        = 0x80 — key-up (vs key-down)
const LLKHF_INJECTED: u32 = 0x10;
// KBDLLHOOKSTRUCT does not expose a separate "repeat" field.
// Win32 LL keyboard hooks do NOT deduplicate key-repeats at the LL level—
// each auto-repeat generates a fresh WM_KEYDOWN with the same vkCode.
// We detect repeats ourselves via the KBDLLHOOKSTRUCT.flags bit:
//   when the key is still down during the event, dwExtraInfo is unchanged.
// Per MSDN, auto-repeat LL events are indistinguishable from first-presses
// at the WH_KEYBOARD_LL level — the "repeat count" in WM_KEYDOWN lparam is
// NOT available here. We rely on LLKHF_INJECTED suppression only here;
// the buffer's rolling-window design naturally handles the rest.

use crate::buffer::RollingBuffer;
use crate::keymap::vk_to_char;

// ── Public data sent to JS on trigger ────────────────────────────────────────

/// Sent to the JS callback when @prompt is detected.
#[napi(object)]
pub struct TriggerData {
    /// Raw HWND of the foreground window at the moment of trigger.
    /// Stored as i64 so it crosses the FFI boundary safely.
    pub hwnd: i64,
    /// Number of characters in the trigger phrase (always 7 for "@prompt").
    pub trigger_len: u32,
}

// ── Global hook lifecycle state ───────────────────────────────────────────────

struct HookState {
    hook_thread_id: u32,
    hook_thread: JoinHandle<()>,
}

static HOOK_STATE: Mutex<Option<HookState>> = Mutex::new(None);

// ── Per-hook-thread state (thread_local is zero-cost and lock-free) ──────────

type Tsfn = ThreadsafeFunction<TriggerData>;

thread_local! {
    static BUFFER:        RefCell<RollingBuffer> = RefCell::new(RollingBuffer::new());
    static SHIFT_PRESSED: RefCell<bool>          = const { RefCell::new(false) };
    static CALLBACK:      RefCell<Option<Tsfn>>  = const { RefCell::new(None) };
}

// ── Low-level hook procedure ──────────────────────────────────────────────────
//
// This is called synchronously in the hook thread's message loop for every
// key event system-wide. Must return quickly (< 300 ms Windows timeout).
// CallNextHookEx MUST be called; for WH_KEYBOARD_LL the hhk arg is ignored.

unsafe extern "system" fn ll_keyboard_proc(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code == HC_ACTION as i32 {
        let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        let vk = info.vkCode;
        let flags = info.flags.0; // KBDLLHOOKSTRUCT.flags is a u32 bitfield

        // Ignore events injected by SendInput (our own replacement keystrokes).
        // Without this guard, the KEYEVENTF_UNICODE events we inject during
        // replacement would feed back into the detection buffer and could
        // corrupt it or re-trigger detection on replayed characters.
        if flags & LLKHF_INJECTED != 0 {
            return CallNextHookEx(Some(HHOOK::default()), code, wparam, lparam);
        }

        let is_keydown =
            wparam.0 as u32 == WM_KEYDOWN || wparam.0 as u32 == WM_SYSKEYDOWN;

        if is_keydown {
            on_keydown(vk);
        } else {
            // Track shift-up
            let vk16 = vk as u16;
            if vk16 == VK_SHIFT.0 || vk16 == VK_LSHIFT.0 || vk16 == VK_RSHIFT.0 {
                SHIFT_PRESSED.with(|s| *s.borrow_mut() = false);
            }
        }
    }

    // CRITICAL: always forward the event — we are an observer, not a consumer.
    CallNextHookEx(Some(HHOOK::default()), code, wparam, lparam)
}

fn on_keydown(vk: u32) {
    let vk16 = vk as u16;

    // Shift down
    if vk16 == VK_SHIFT.0 || vk16 == VK_LSHIFT.0 || vk16 == VK_RSHIFT.0 {
        SHIFT_PRESSED.with(|s| *s.borrow_mut() = true);
        return;
    }

    // Backspace — pop last char
    if vk16 == VK_BACK.0 {
        BUFFER.with(|b| b.borrow_mut().pop());
        return;
    }

    // Clear-buffer keys
    if vk16 == VK_RETURN.0 || vk16 == VK_ESCAPE.0 || vk16 == VK_TAB.0 {
        BUFFER.with(|b| b.borrow_mut().clear());
        return;
    }

    // Printable key — translate and push
    let shift = SHIFT_PRESSED.with(|s| *s.borrow());
    if let Some(ch) = vk_to_char(vk, shift) {
        let triggered = BUFFER.with(|b| {
            let mut buf = b.borrow_mut();
            buf.push(ch);
            buf.ends_with_trigger()
        });

        if triggered {
            // Clear buffer immediately — prevents double-fire on rapid typing.
            BUFFER.with(|b| b.borrow_mut().clear());
            fire_trigger();
        }
    }
}

fn fire_trigger() {
    // GetForegroundWindow is always safe. Returns null HWND if no window focused.
    let hwnd_raw = unsafe { GetForegroundWindow().0 as isize };
    let trigger_len = crate::buffer::TRIGGER.len() as u32;

    // Store anchor FIRST — replacement.rs reads this when replaceAtLastAnchor() fires.
    crate::replacement::store_anchor(hwnd_raw, trigger_len);

    let data = TriggerData { hwnd: hwnd_raw as i64, trigger_len };

    CALLBACK.with(|cb| {
        if let Some(ref tsfn) = *cb.borrow() {
            // NonBlocking: enqueues onto Node event loop, returns immediately.
            // Safe to call from any thread including OS hook callbacks.
            tsfn.call(Ok(data), ThreadsafeFunctionCallMode::NonBlocking);
        }
    });
}

// ── Hook thread entrypoint ────────────────────────────────────────────────────

fn hook_thread_main(
    id_tx: mpsc::SyncSender<u32>,
    callback_rx: mpsc::Receiver<Tsfn>,
) {
    // 1. Send our thread ID back so stop_hook can post WM_QUIT to us.
    let thread_id = unsafe { GetCurrentThreadId() };
    let _ = id_tx.send(thread_id);

    // 2. Block until the caller hands us the ThreadsafeFunction.
    //    This ensures the callback is ready before the hook fires.
    match callback_rx.recv() {
        Ok(tsfn) => CALLBACK.with(|cb| *cb.borrow_mut() = Some(tsfn)),
        Err(_) => return, // Caller dropped sender — nothing to do.
    }

    unsafe {
        // 3. Install the low-level keyboard hook.
        //    hmod = NULL is valid for WH_KEYBOARD_LL with dwThreadId = 0.
        //    dwThreadId = 0 means global (all threads on this desktop).
        let hhook = match SetWindowsHookExW(
            WH_KEYBOARD_LL,
            Some(ll_keyboard_proc),
            Some(HINSTANCE::default()),
            0,
        ) {
            Ok(h) => h,
            Err(e) => {
                eprintln!("[NativeHook] SetWindowsHookExW failed: {e}");
                return;
            }
        };

        // 4. Pump the message loop. WH_KEYBOARD_LL callbacks are delivered
        //    here. Block until WM_QUIT is posted by stop_hook().
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        // 5. Uninstall the hook cleanly.
        let _ = UnhookWindowsHookEx(hhook);
    }

    // 6. thread_local CALLBACK is dropped here → ThreadsafeFunction dropped
    //    → napi unregisters the TSFN → Node GC can collect the JS function.
}

// ── Public API called from lib.rs ─────────────────────────────────────────────

pub fn start(tsfn: Tsfn) -> napi::Result<()> {
    let mut state = HOOK_STATE
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;

    if state.is_some() {
        // Already running — idempotent.
        return Ok(());
    }

    // Bounded sync channel so the hook thread can't block even if sender drops.
    let (id_tx, id_rx) = mpsc::sync_channel::<u32>(1);
    let (cb_tx, cb_rx) = mpsc::channel::<Tsfn>();

    let hook_thread = std::thread::Builder::new()
        .name("prompt-hook".into())
        .spawn(move || hook_thread_main(id_tx, cb_rx))
        .map_err(|e| napi::Error::from_reason(format!("thread spawn failed: {e}")))?;

    // Block until hook thread sends its Win32 thread ID.
    let hook_thread_id = id_rx
        .recv()
        .map_err(|_| napi::Error::from_reason("hook thread exited before sending id"))?;

    // Hand the ThreadsafeFunction to the hook thread.
    cb_tx
        .send(tsfn)
        .map_err(|_| napi::Error::from_reason("hook thread exited before receiving callback"))?;

    *state = Some(HookState { hook_thread_id, hook_thread });

    println!("[NativeHook] Keyboard hook installed (thread {hook_thread_id})");
    Ok(())
}

pub fn stop() -> napi::Result<()> {
    let mut state = HOOK_STATE
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;

    if let Some(s) = state.take() {
        unsafe {
            // Post WM_QUIT to the hook thread's message loop.
            let _ = PostThreadMessageW(s.hook_thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
        // Wait for the hook thread to finish (UnhookWindowsHookEx + cleanup).
        let _ = s.hook_thread.join();
        println!("[NativeHook] Keyboard hook removed");
    }

    Ok(())
}
