/// Translates a Win32 virtual key code + shift state into a printable ASCII char.
///
/// Covers the full printable ASCII set. Non-printable keys return None,
/// which the caller treats as "ignore, don't update buffer".
///
/// Layout assumption: US QWERTY (matches existing JS KEYCODE_MAP behaviour).
/// This is sufficient for @prompt trigger detection.

pub fn vk_to_char(vk: u32, shift: bool) -> Option<char> {
    let ch = match vk {
        // Letters A–Z (VK codes 0x41–0x5A)
        0x41..=0x5A => {
            let base = b'a' + (vk - 0x41) as u8;
            if shift { (base as char).to_ascii_uppercase() } else { base as char }
        }
        // Digits + shift variants
        0x30 => if shift { ')' } else { '0' },
        0x31 => if shift { '!' } else { '1' },
        0x32 => if shift { '@' } else { '2' },
        0x33 => if shift { '#' } else { '3' },
        0x34 => if shift { '$' } else { '4' },
        0x35 => if shift { '%' } else { '5' },
        0x36 => if shift { '^' } else { '6' },
        0x37 => if shift { '&' } else { '7' },
        0x38 => if shift { '*' } else { '8' },
        0x39 => if shift { '(' } else { '9' },
        // Punctuation
        0xBD => if shift { '_' } else { '-' },  // VK_OEM_MINUS
        0xBB => if shift { '+' } else { '=' },  // VK_OEM_PLUS
        0xDB => if shift { '{' } else { '[' },  // VK_OEM_4
        0xDD => if shift { '}' } else { ']' },  // VK_OEM_6
        0xDC => if shift { '|' } else { '\\' }, // VK_OEM_5
        0xBA => if shift { ':' } else { ';' },  // VK_OEM_1
        0xDE => if shift { '"' } else { '\'' }, // VK_OEM_7
        0xBC => if shift { '<' } else { ',' },  // VK_OEM_COMMA
        0xBE => if shift { '>' } else { '.' },  // VK_OEM_PERIOD
        0xBF => if shift { '?' } else { '/' },  // VK_OEM_2
        0xC0 => if shift { '~' } else { '`' },  // VK_OEM_3
        // Space
        0x20 => ' ',
        _ => return None,
    };
    Some(ch)
}
