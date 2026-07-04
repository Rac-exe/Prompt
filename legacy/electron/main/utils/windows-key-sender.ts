/**
 * Windows SendInput utility for synchronous keystroke injection
 * 
 * CRITICAL: This module simulates keystrokes to inject the final character
 * before opening the overlay. It MUST execute synchronously (no async/await)
 * to preserve Windows focus-steal permission within the same input frame.
 * 
 * Implementation:
 * - Uses child_process.execSync to run PowerShell script
 * - PowerShell uses .NET [System.Windows.Forms.SendKeys]
 * - Blocking execution preserves OS input frame
 * 
 * Used by @prompt trigger to inject the final 't' character before
 * stealing focus to the overlay, preventing swallowed keystrokes.
 */

import * as os from 'os';
import { execSync } from 'child_process';

/**
 * Send a single keystroke synchronously using PowerShell SendKeys
 * 
 * CRITICAL: This function is BLOCKING and SYNCHRONOUS by design.
 * Do NOT convert to async or add any Promise/setTimeout wrappers.
 * 
 * @param char - Single character to send (e.g., 't')
 * @returns true if successful, false otherwise
 */
export function sendKeystrokeSyncWindows(char: string): boolean {
  // Only works on Windows
  if (os.platform() !== 'win32') {
    console.warn('[WindowsKeySender] Not on Windows, skipping keystroke injection');
    return false;
  }

  try {
    // Escape special characters for PowerShell
    const escapedChar = char.replace(/["'`$]/g, '`$&');
    
    // PowerShell command using SendKeys
    // We load System.Windows.Forms assembly and use SendKeys.SendWait
    // SendWait is synchronous (blocks until key is processed)
    const psCommand = `
      Add-Type -AssemblyName System.Windows.Forms;
      [System.Windows.Forms.SendKeys]::SendWait('${escapedChar}')
    `.trim();

    // CRITICAL: execSync is BLOCKING and SYNCHRONOUS
    // This is REQUIRED to stay within the same Windows input frame
    execSync(`powershell.exe -NoProfile -NonInteractive -Command "${psCommand}"`, {
      timeout: 1000, // 1 second max
      windowsHide: true,
      encoding: 'utf8'
    });

    console.log(`[WindowsKeySender] Successfully injected keystroke: "${char}"`);
    return true;
  } catch (error) {
    console.error('[WindowsKeySender] Failed to send keystroke:', error);
    return false;
  }
}

/**
 * Fallback: No-op on non-Windows platforms
 * 
 * On macOS/Linux, the race condition doesn't occur the same way,
 * so manual injection isn't needed.
 */
export function sendKeystrokeSync(char: string): boolean {
  if (os.platform() === 'win32') {
    return sendKeystrokeSyncWindows(char);
  }
  
  // No-op on other platforms
  console.log(`[KeySender] Platform ${os.platform()} - no keystroke injection needed`);
  return true;
}
