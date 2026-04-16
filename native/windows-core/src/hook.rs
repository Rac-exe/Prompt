/// hook.rs — Global keyboard hook for @prompt detection.
///
/// Platform-dispatched:
///   Windows: WH_KEYBOARD_LL via SetWindowsHookExW
///   macOS:   CGEventTap via Core Graphics

use std::cell::RefCell;
use std::sync::{mpsc, Mutex};
use std::thread::JoinHandle;

use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

use crate::buffer::RollingBuffer;

// ── Public data sent to JS on trigger ────────────────────────────────────────

/// Sent to the JS callback when @prompt is detected.
/// On Windows, `hwnd` is a raw HWND. On macOS, `hwnd` is a PID.
#[napi(object)]
pub struct TriggerData {
    pub hwnd: i64,
    pub trigger_len: u32,
}

// ── Global hook lifecycle state ───────────────────────────────────────────────

type Tsfn = ThreadsafeFunction<TriggerData>;

struct HookState {
    #[cfg(target_os = "windows")]
    hook_thread_id: u32,
    hook_thread: JoinHandle<()>,
}

static HOOK_STATE: Mutex<Option<HookState>> = Mutex::new(None);

// ── Per-hook-thread state ─────────────────────────────────────────────────────

thread_local! {
    static BUFFER:        RefCell<RollingBuffer> = RefCell::new(RollingBuffer::new());
    static SHIFT_PRESSED: RefCell<bool>          = const { RefCell::new(false) };
    static CALLBACK:      RefCell<Option<Tsfn>>  = const { RefCell::new(None) };
}

// ══════════════════════════════════════════════════════════════════════════════
// SHARED: keydown processing (used by both Windows and macOS)
// ══════════════════════════════════════════════════════════════════════════════

fn on_char_keydown(ch: char) {
    let triggered = BUFFER.with(|b| {
        let mut buf = b.borrow_mut();
        buf.push(ch);
        buf.ends_with_trigger()
    });

    if triggered {
        BUFFER.with(|b| b.borrow_mut().clear());
        fire_trigger();
    }
}

fn on_backspace() {
    BUFFER.with(|b| b.borrow_mut().pop());
}

fn on_buffer_clear() {
    BUFFER.with(|b| b.borrow_mut().clear());
}

fn fire_trigger() {
    let (hwnd_raw, trigger_len) = get_foreground_and_store_anchor();

    let data = TriggerData { hwnd: hwnd_raw, trigger_len };

    CALLBACK.with(|cb| {
        if let Some(ref tsfn) = *cb.borrow() {
            tsfn.call(Ok(data), ThreadsafeFunctionCallMode::NonBlocking);
        }
    });
}

#[cfg(target_os = "windows")]
fn get_foreground_and_store_anchor() -> (i64, u32) {
    let hwnd_raw = unsafe {
        windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow().0 as isize
    };
    let trigger_len = crate::buffer::TRIGGER.len() as u32;
    crate::replacement::store_anchor(hwnd_raw, trigger_len);
    (hwnd_raw as i64, trigger_len)
}

#[cfg(target_os = "macos")]
fn get_foreground_and_store_anchor() -> (i64, u32) {
    let pid = macos::get_frontmost_pid();
    let trigger_len = crate::buffer::TRIGGER.len() as u32;
    crate::replacement::store_anchor(pid as isize, trigger_len);
    (pid as i64, trigger_len)
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn get_foreground_and_store_anchor() -> (i64, u32) {
    (0, crate::buffer::TRIGGER.len() as u32)
}

// ══════════════════════════════════════════════════════════════════════════════
// WINDOWS implementation
// ══════════════════════════════════════════════════════════════════════════════

#[cfg(target_os = "windows")]
mod win32 {
    use super::*;
    use crate::keymap::vk_to_char;

    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        VK_BACK, VK_ESCAPE, VK_LSHIFT, VK_RETURN, VK_RSHIFT, VK_SHIFT, VK_TAB,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, PostThreadMessageW,
        SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, HC_ACTION, HHOOK,
        KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_QUIT, WM_SYSKEYDOWN,
    };

    const LLKHF_INJECTED: u32 = 0x10;

    unsafe extern "system" fn ll_keyboard_proc(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if code == HC_ACTION as i32 {
            let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
            let vk = info.vkCode;
            let flags = info.flags.0;

            if flags & LLKHF_INJECTED != 0 {
                return CallNextHookEx(Some(HHOOK::default()), code, wparam, lparam);
            }

            let is_keydown =
                wparam.0 as u32 == WM_KEYDOWN || wparam.0 as u32 == WM_SYSKEYDOWN;

            if is_keydown {
                handle_keydown(vk);
            } else {
                let vk16 = vk as u16;
                if vk16 == VK_SHIFT.0 || vk16 == VK_LSHIFT.0 || vk16 == VK_RSHIFT.0 {
                    SHIFT_PRESSED.with(|s| *s.borrow_mut() = false);
                }
            }
        }

        CallNextHookEx(Some(HHOOK::default()), code, wparam, lparam)
    }

    fn handle_keydown(vk: u32) {
        let vk16 = vk as u16;

        if vk16 == VK_SHIFT.0 || vk16 == VK_LSHIFT.0 || vk16 == VK_RSHIFT.0 {
            SHIFT_PRESSED.with(|s| *s.borrow_mut() = true);
            return;
        }

        if vk16 == VK_BACK.0 {
            on_backspace();
            return;
        }

        if vk16 == VK_RETURN.0 || vk16 == VK_ESCAPE.0 || vk16 == VK_TAB.0 {
            on_buffer_clear();
            return;
        }

        let shift = SHIFT_PRESSED.with(|s| *s.borrow());
        if let Some(ch) = vk_to_char(vk, shift) {
            on_char_keydown(ch);
        }
    }

    pub fn hook_thread_main(
        id_tx: mpsc::SyncSender<u32>,
        callback_rx: mpsc::Receiver<Tsfn>,
    ) {
        let thread_id = unsafe { GetCurrentThreadId() };
        let _ = id_tx.send(thread_id);

        match callback_rx.recv() {
            Ok(tsfn) => CALLBACK.with(|cb| *cb.borrow_mut() = Some(tsfn)),
            Err(_) => return,
        }

        unsafe {
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

            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            let _ = UnhookWindowsHookEx(hhook);
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// macOS implementation
// ══════════════════════════════════════════════════════════════════════════════

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use core_graphics::event::{
        CGEventTap, CGEventTapLocation, CGEventTapPlacement, CGEventTapOptions,
        CGEventType, CGEventFlags,
    };
    use core_foundation::runloop::{CFRunLoop, kCFRunLoopCommonModes, kCFRunLoopDefaultMode};
    use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};

    static STOP_FLAG: AtomicBool = AtomicBool::new(false);
    static CACHED_PID: AtomicI32 = AtomicI32::new(0);

    const KVK_DELETE: u16 = 0x33;
    const KVK_RETURN: u16 = 0x24;
    const KVK_ESCAPE: u16 = 0x35;
    const KVK_TAB: u16 = 0x30;

    fn get_frontmost_pid_fast() -> i32 {
        use objc::{msg_send, sel, sel_impl, class};
        use cocoa::base::{id, nil};
        unsafe {
            let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
            let app: id = msg_send![workspace, frontmostApplication];
            if app == nil { return 0; }
            let pid: i32 = msg_send![app, processIdentifier];
            pid
        }
    }

    pub fn get_frontmost_pid() -> i32 {
        CACHED_PID.load(Ordering::Relaxed)
    }

    fn keycode_to_char(keycode: u16, flags: CGEventFlags) -> Option<char> {
        let shift = flags.contains(CGEventFlags::CGEventFlagShift);

        match keycode {
            0x00 => Some(if shift { 'A' } else { 'a' }),
            0x0B => Some(if shift { 'B' } else { 'b' }),
            0x08 => Some(if shift { 'C' } else { 'c' }),
            0x02 => Some(if shift { 'D' } else { 'd' }),
            0x0E => Some(if shift { 'E' } else { 'e' }),
            0x03 => Some(if shift { 'F' } else { 'f' }),
            0x05 => Some(if shift { 'G' } else { 'g' }),
            0x04 => Some(if shift { 'H' } else { 'h' }),
            0x22 => Some(if shift { 'I' } else { 'i' }),
            0x26 => Some(if shift { 'J' } else { 'j' }),
            0x28 => Some(if shift { 'K' } else { 'k' }),
            0x25 => Some(if shift { 'L' } else { 'l' }),
            0x2E => Some(if shift { 'M' } else { 'm' }),
            0x2D => Some(if shift { 'N' } else { 'n' }),
            0x1F => Some(if shift { 'O' } else { 'o' }),
            0x23 => Some(if shift { 'P' } else { 'p' }),
            0x0C => Some(if shift { 'Q' } else { 'q' }),
            0x0F => Some(if shift { 'R' } else { 'r' }),
            0x01 => Some(if shift { 'S' } else { 's' }),
            0x11 => Some(if shift { 'T' } else { 't' }),
            0x20 => Some(if shift { 'U' } else { 'u' }),
            0x09 => Some(if shift { 'V' } else { 'v' }),
            0x0D => Some(if shift { 'W' } else { 'w' }),
            0x07 => Some(if shift { 'X' } else { 'x' }),
            0x10 => Some(if shift { 'Y' } else { 'y' }),
            0x06 => Some(if shift { 'Z' } else { 'z' }),
            // Digits
            0x1D => Some(if shift { ')' } else { '0' }),
            0x12 => Some(if shift { '!' } else { '1' }),
            0x13 => Some(if shift { '@' } else { '2' }),
            0x14 => Some(if shift { '#' } else { '3' }),
            0x15 => Some(if shift { '$' } else { '4' }),
            0x17 => Some(if shift { '%' } else { '5' }),
            0x16 => Some(if shift { '^' } else { '6' }),
            0x1A => Some(if shift { '&' } else { '7' }),
            0x1C => Some(if shift { '*' } else { '8' }),
            0x19 => Some(if shift { '(' } else { '9' }),
            // Punctuation
            0x1B => Some(if shift { '_' } else { '-' }),
            0x18 => Some(if shift { '+' } else { '=' }),
            0x21 => Some(if shift { '{' } else { '[' }),
            0x1E => Some(if shift { '}' } else { ']' }),
            0x2A => Some(if shift { '|' } else { '\\' }),
            0x29 => Some(if shift { ':' } else { ';' }),
            0x27 => Some(if shift { '"' } else { '\'' }),
            0x2B => Some(if shift { '<' } else { ',' }),
            0x2F => Some(if shift { '>' } else { '.' }),
            0x2C => Some(if shift { '?' } else { '/' }),
            0x32 => Some(if shift { '~' } else { '`' }),
            // Space
            0x31 => Some(' '),
            _ => None,
        }
    }

    pub fn hook_thread_main(
        ready_tx: mpsc::SyncSender<()>,
        callback_rx: mpsc::Receiver<Tsfn>,
    ) {
        match callback_rx.recv() {
            Ok(tsfn) => CALLBACK.with(|cb| *cb.borrow_mut() = Some(tsfn)),
            Err(_) => return,
        }

        STOP_FLAG.store(false, Ordering::SeqCst);

        let tap = CGEventTap::new(
            CGEventTapLocation::HID,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![CGEventType::KeyDown, CGEventType::FlagsChanged],
            |_proxy, event_type, event| {
                match event_type {
                    CGEventType::KeyDown => {
                        CACHED_PID.store(get_frontmost_pid_fast(), Ordering::Relaxed);

                        let keycode = event.get_integer_value_field(
                            core_graphics::event::EventField::KEYBOARD_EVENT_KEYCODE,
                        ) as u16;
                        let flags = event.get_flags();

                        if keycode == KVK_DELETE {
                            on_backspace();
                        } else if keycode == KVK_RETURN || keycode == KVK_ESCAPE || keycode == KVK_TAB {
                            on_buffer_clear();
                        } else if let Some(ch) = keycode_to_char(keycode, flags) {
                            on_char_keydown(ch);
                        }
                    }
                    _ => {}
                }
                None
            },
        );

        match tap {
            Ok(tap) => {
                let loop_source = tap.mach_port.create_runloop_source(0).expect("create runloop source");
                let run_loop = CFRunLoop::get_current();
                unsafe {
                    run_loop.add_source(&loop_source, kCFRunLoopCommonModes);
                }
                tap.enable();
                let _ = ready_tx.send(());
                println!("[NativeHook:macOS] CGEventTap installed, running CFRunLoop");

                while !STOP_FLAG.load(Ordering::SeqCst) {
                    CFRunLoop::run_in_mode(
                        unsafe { kCFRunLoopDefaultMode },
                        std::time::Duration::from_millis(500),
                        false,
                    );
                }

                println!("[NativeHook:macOS] CFRunLoop stopped");
            }
            Err(_) => {
                eprintln!("[NativeHook:macOS] CGEventTap creation failed — Accessibility permission likely not granted");
                let _ = ready_tx.send(());
            }
        }
    }

    pub fn stop() {
        STOP_FLAG.store(true, Ordering::SeqCst);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Public API called from lib.rs
// ══════════════════════════════════════════════════════════════════════════════

pub fn start(tsfn: Tsfn) -> napi::Result<()> {
    let mut state = HOOK_STATE
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;

    if state.is_some() {
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let (id_tx, id_rx) = mpsc::sync_channel::<u32>(1);
        let (cb_tx, cb_rx) = mpsc::channel::<Tsfn>();

        let hook_thread = std::thread::Builder::new()
            .name("prompt-hook".into())
            .spawn(move || win32::hook_thread_main(id_tx, cb_rx))
            .map_err(|e| napi::Error::from_reason(format!("thread spawn failed: {e}")))?;

        let hook_thread_id = id_rx
            .recv()
            .map_err(|_| napi::Error::from_reason("hook thread exited before sending id"))?;

        cb_tx
            .send(tsfn)
            .map_err(|_| napi::Error::from_reason("hook thread exited before receiving callback"))?;

        *state = Some(HookState { hook_thread_id, hook_thread });
        println!("[NativeHook] Keyboard hook installed (thread {hook_thread_id})");
    }

    #[cfg(target_os = "macos")]
    {
        let (ready_tx, ready_rx) = mpsc::sync_channel::<()>(1);
        let (cb_tx, cb_rx) = mpsc::channel::<Tsfn>();

        let hook_thread = std::thread::Builder::new()
            .name("prompt-hook".into())
            .spawn(move || macos::hook_thread_main(ready_tx, cb_rx))
            .map_err(|e| napi::Error::from_reason(format!("thread spawn failed: {e}")))?;

        cb_tx
            .send(tsfn)
            .map_err(|_| napi::Error::from_reason("hook thread exited before receiving callback"))?;

        let _ = ready_rx.recv();

        *state = Some(HookState { hook_thread });
        println!("[NativeHook] macOS keyboard hook installed");
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = tsfn;
        eprintln!("[NativeHook] Unsupported platform — hook not installed");
    }

    Ok(())
}

pub fn stop() -> napi::Result<()> {
    let mut state = HOOK_STATE
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;

    if let Some(s) = state.take() {
        #[cfg(target_os = "windows")]
        {
            unsafe {
                use windows::Win32::Foundation::{LPARAM, WPARAM};
                use windows::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_QUIT};
                let _ = PostThreadMessageW(s.hook_thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
            }
        }

        #[cfg(target_os = "macos")]
        {
            macos::stop();
        }

        let _ = s.hook_thread.join();
        println!("[NativeHook] Keyboard hook removed");
    }

    Ok(())
}
