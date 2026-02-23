/// Rolling character buffer for trigger phrase detection.
///
/// Keeps only the last MAX_BUFFER characters. On trigger match the caller
/// must call `clear()` immediately to prevent double-fires.

pub const TRIGGER: &str = "@prompt";
const MAX_BUFFER: usize = 64;

pub struct RollingBuffer {
    buf: Vec<char>,
}

impl RollingBuffer {
    pub fn new() -> Self {
        Self { buf: Vec::with_capacity(MAX_BUFFER) }
    }

    /// Append a printable character, capping at MAX_BUFFER.
    pub fn push(&mut self, c: char) {
        if self.buf.len() >= MAX_BUFFER {
            self.buf.remove(0);
        }
        self.buf.push(c);
    }

    /// Remove the last character (Backspace handling).
    pub fn pop(&mut self) {
        self.buf.pop();
    }

    /// Clear the entire buffer (Enter / Escape / Trigger fired).
    pub fn clear(&mut self) {
        self.buf.clear();
    }

    /// Check if the buffer ends with the trigger phrase.
    pub fn ends_with_trigger(&self) -> bool {
        let tlen = TRIGGER.len();
        if self.buf.len() < tlen {
            return false;
        }
        let tail_start = self.buf.len() - tlen;
        self.buf[tail_start..]
            .iter()
            .zip(TRIGGER.chars())
            .all(|(a, b)| *a == b)
    }
}
