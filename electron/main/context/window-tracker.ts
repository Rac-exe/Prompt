import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const execAsync = promisify(exec);

export interface WindowContext {
  handle: string;
  title: string;
  bounds: { x: number; y: number; width: number; height: number };
  processName: string;
}

export class WindowTracker {
  private currentContext: WindowContext | null = null;
  private updateInterval: NodeJS.Timeout | null = null;
  private readonly platform: string;

  constructor() {
    this.platform = process.platform;
  }

  async getActiveWindow(): Promise<WindowContext> {
    if (this.platform === "win32") {
      return this.getWindowsActiveWindow();
    } else if (this.platform === "darwin") {
      return this.getMacOSActiveWindow();
    } else {
      throw new Error(`Unsupported platform: ${this.platform}`);
    }
  }

  private async getWindowsActiveWindow(): Promise<WindowContext> {
    const script = `Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
public struct RECT { public int Left, Top, Right, Bottom; }
"@
$hwnd = [Win32]::GetForegroundWindow()
$rect = New-Object RECT
[Win32]::GetWindowRect($hwnd, [ref]$rect)
$title = New-Object System.Text.StringBuilder 256
[Win32]::GetWindowText($hwnd, $title, 256)
$pid = 0
[Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid)
try {
  $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
  $procName = if ($proc) { $proc.ProcessName } else { "unknown" }
} catch {
  $procName = "unknown"
}
Write-Output "$($rect.Left),$($rect.Top),$($rect.Right),$($rect.Bottom)|$($title.ToString())|$procName"`;

    // Write script to temporary file to avoid command line parsing issues
    const tempFile = path.join(os.tmpdir(), `window-tracker-${Date.now()}.ps1`);
    
    try {
      fs.writeFileSync(tempFile, script, 'utf8');
      
      const { stdout } = await execAsync(
        `powershell -ExecutionPolicy Bypass -File "${tempFile}"`
      );
      
      // Clean up temp file
      try {
        fs.unlinkSync(tempFile);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      const parts = stdout.trim().split("|");
      // PowerShell may output extra lines, so get the last line of the first part (coordinates)
      const coordsStr = parts[0].trim().split(/\r?\n/).pop() || parts[0].trim();

      const coords = coordsStr.split(",").map(Number);

      // Validate coordinates
      if (coords.length !== 4 || coords.some(c => isNaN(c))) {
        console.error(`[WindowTracker] Failed to parse coordinates from: "${coordsStr}"`);
        throw new Error(`Failed to parse window coordinates: ${coordsStr}`);
      }

      const bounds = {
        x: coords[0],
        y: coords[1],
        width: coords[2] - coords[0],
        height: coords[3] - coords[1]
      };
      
      return {
        handle: "unknown", // Would need native module for actual handle
        title: parts[1] || "Unknown",
        bounds: bounds,
        processName: parts[2] || "unknown"
      };
    } catch (error) {
      throw new Error(`Failed to get window context: ${error}`);
    }
  }

  private async getMacOSActiveWindow(): Promise<WindowContext> {
    const script = `
      tell application "System Events"
        set frontApp to name of first application process whose frontmost is true
        
        -- Skip if this is Electron (our own app)
        if frontApp is "Electron" or frontApp is "node" then
          return "SKIP"
        end if
        
        try
          set frontWindow to window 1 of process frontApp
          set windowPosition to position of frontWindow
          set windowSize to size of frontWindow
          set windowTitle to title of frontWindow
          return (item 1 of windowPosition as text) & ", " & (item 2 of windowPosition as text) & "|" & (item 1 of windowSize as text) & ", " & (item 2 of windowSize as text) & "|" & windowTitle & "|" & frontApp
        on error
          -- App has no windows, return basic info
          return "0, 0|800, 600|" & frontApp & "|" & frontApp
        end try
      end tell
    `;

    try {
      const { stdout } = await execAsync(`osascript -e '${script}'`);
      const output = stdout.trim();
      
      // Skip if it's our own app
      if (output === "SKIP") {
        if (this.currentContext) {
          return this.currentContext; // Return last known context
        }
        throw new Error("Electron app is focused, no external window context");
      }
      
      const parts = output.split("|");
      const pos = parts[0].split(", ").map(Number);
      const size = parts[1].split(", ").map(Number);
      
      return {
        handle: "unknown",
        title: parts[2] || "",
        bounds: {
          x: pos[0] || 0,
          y: pos[1] || 0,
          width: size[0] || 800,
          height: size[1] || 600
        },
        processName: parts[3] || "unknown"
      };
    } catch (error) {
      throw new Error(`Failed to get window context: ${error}`);
    }
  }

  startTracking(intervalMs: number = 1000) {
    if (this.updateInterval) {
      return; // Already tracking
    }

    // Get initial context
    this.getActiveWindow().then(context => {
      this.currentContext = context;
    }).catch(error => {
      console.error("Failed to get initial window context:", error);
    });

    this.updateInterval = setInterval(async () => {
      try {
        this.currentContext = await this.getActiveWindow();
      } catch (error) {
        // Silently fail - window tracking is best effort
        // Don't log - this happens when our own app is focused
      }
    }, intervalMs);
  }

  stopTracking() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.currentContext = null;
  }

  getCurrentContext(): WindowContext | null {
    return this.currentContext;
  }

  /**
   * Restore focus to a window matching the given context
   * This is used before UI Automation to ensure the target window has focus
   */
  async restoreFocusToWindow(context: WindowContext): Promise<void> {
    if (this.platform === "win32") {
      return this.restoreFocusWindows(context);
    } else if (this.platform === "darwin") {
      return this.restoreFocusMacOS(context);
    }
  }

  /**
   * NEW: Restore focus to a window by window handle
   * Simplified version that directly focuses the window by handle
   */
  async restoreFocusToWindowByHandle(handle: string): Promise<void> {
    console.log(`[WindowTracker] Restoring focus to window handle: ${handle}`);

    if (this.platform === "win32") {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

# Parse handle from string (remove "0x" prefix if present)
$handleStr = "${handle}".Replace("0x", "")
$handleInt = [Convert]::ToInt64($handleStr, 16)
$hwnd = [IntPtr]::new($handleInt)

# Show window (in case it's minimized)
[Win32]::ShowWindow($hwnd, 9) # SW_RESTORE = 9

# Set foreground
[Win32]::SetForegroundWindow($hwnd)

Write-Host "SUCCESS: Window focused"
`;

      try {
        const result = await execAsync(`powershell -Command "${script.replace(/"/g, '\\"')}"`);
        console.log("[WindowTracker] Window focus restored:", result.stdout);
      } catch (error) {
        console.error("[WindowTracker] Failed to restore focus:", error);
        throw error;
      }
    } else if (this.platform === "darwin") {
      // macOS implementation would go here
      console.log("[WindowTracker] macOS focus restoration not implemented yet");
    }
  }

  private async restoreFocusWindows(context: WindowContext): Promise<void> {
    console.log(`[WindowTracker] Restoring focus to: ${context.processName} - "${context.title}"`);

    // PowerShell script to find and focus window by process name and title
    const script = `
param([string]$processName, [string]$windowTitle)

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
}
"@

$foundWindow = $null

# Enum all windows and find matching one
$callback = {
  param($hwnd, $lParam)

  # Check if window is visible
  if (-not [Win32]::IsWindowVisible($hwnd)) {
    return $true
  }

  # Get process ID
  $pid = 0
  [Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid)

  try {
    $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq $processName) {
      # Get window title
      $title = New-Object System.Text.StringBuilder 256
      [Win32]::GetWindowText($hwnd, $title, 256)
      $titleStr = $title.ToString()

      # Match by title (case-insensitive partial match)
      if ($titleStr -like "*$windowTitle*") {
        $script:foundWindow = $hwnd
        return $false  # Stop enumeration
      }
    }
  } catch {
    # Ignore errors for this window
  }

  return $true  # Continue enumeration
}

$delegateType = [System.Delegate]::CreateDelegate([Win32+EnumWindowsProc], $callback)
[Win32]::EnumWindows($delegateType, [IntPtr]::Zero)

if ($null -ne $script:foundWindow) {
  # Show window if minimized
  [Win32]::ShowWindow($script:foundWindow, 9) # SW_RESTORE = 9

  # Set foreground window
  [Win32]::SetForegroundWindow($script:foundWindow)

  Write-Host "SUCCESS: Focus restored to window"
  exit 0
} else {
  Write-Host "WARNING: Could not find window to restore focus"
  exit 1
}
`;

    const tempFile = path.join(os.tmpdir(), `restore-focus-${Date.now()}.ps1`);
    fs.writeFileSync(tempFile, script, 'utf8');

    try {
      const result = await execAsync(
        `powershell -ExecutionPolicy Bypass -File "${tempFile}" ` +
        `-processName "${context.processName}" ` +
        `-windowTitle "${context.title.replace(/"/g, '""')}"`
      );

      // Clean up
      try {
        fs.unlinkSync(tempFile);
      } catch (e) {
        // Ignore cleanup errors
      }

      if (result.stdout.includes("SUCCESS")) {
        console.log("[WindowTracker] Focus restored successfully");
        // Give window time to receive focus
        await new Promise(resolve => setTimeout(resolve, 100));
      } else {
        console.warn("[WindowTracker] Could not restore focus:", result.stdout);
      }
    } catch (error) {
      // Clean up
      try {
        fs.unlinkSync(tempFile);
      } catch (e) {
        // Ignore cleanup errors
      }
      console.error("[WindowTracker] Failed to restore focus:", error);
    }
  }

  private async restoreFocusMacOS(context: WindowContext): Promise<void> {
    console.log(`[WindowTracker] Restoring focus to: ${context.processName}`);

    const script = `
      tell application "${context.processName}"
        activate
      end tell
    `;

    try {
      await execAsync(`osascript -e '${script}'`);
      console.log("[WindowTracker] Focus restored successfully");
      // Give window time to receive focus
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error("[WindowTracker] Failed to restore focus:", error);
    }
  }
}
