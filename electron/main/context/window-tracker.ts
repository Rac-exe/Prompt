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
      console.log(`[WindowTracker] Raw stdout: "${stdout.trim()}"`);
      console.log(`[WindowTracker] Parts:`, parts);
      console.log(`[WindowTracker] Coords string (extracted): "${coordsStr}"`);
      
      const coords = coordsStr.split(",").map(Number);
      console.log(`[WindowTracker] Parsed coords:`, coords);
      
      // Validate coordinates
      if (coords.length !== 4 || coords.some(c => isNaN(c))) {
        console.error(`[WindowTracker] Invalid coordinates parsed:`, coords);
        throw new Error(`Failed to parse window coordinates: ${coordsStr}`);
      }
      
      const bounds = {
        x: coords[0],
        y: coords[1],
        width: coords[2] - coords[0],
        height: coords[3] - coords[1]
      };
      
      console.log(`[WindowTracker] Window bounds:`, bounds);
      
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
        set frontWindow to window 1 of process frontApp
        set windowPosition to position of frontWindow
        set windowSize to size of frontWindow
        set windowTitle to title of frontWindow
      end tell
      return windowPosition & "|" & windowSize & "|" & windowTitle & "|" & frontApp
    `;

    try {
      const { stdout } = await execAsync(`osascript -e '${script}'`);
      const parts = stdout.trim().split("|");
      const pos = parts[0].split(", ").map(Number);
      const size = parts[1].split(", ").map(Number);
      
      return {
        handle: "unknown",
        title: parts[2] || "",
        bounds: {
          x: pos[0],
          y: pos[1],
          width: size[0],
          height: size[1]
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
        console.debug("Failed to update window context:", error);
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
}
