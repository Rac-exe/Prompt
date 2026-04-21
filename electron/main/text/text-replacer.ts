import { exec } from "child_process";
import { promisify } from "util";
import * as Sentry from '@sentry/electron/main';

const execAsync = promisify(exec);

export class TextReplacer {
  private platform: string;

  constructor() {
    this.platform = process.platform;
  }

  async replaceText(originalText: string, newText: string): Promise<void> {
    if (this.platform === "win32") {
      await this.replaceTextWindows(originalText, newText);
    } else if (this.platform === "darwin") {
      await this.replaceTextMacOS(originalText, newText);
    } else {
      throw new Error(`Unsupported platform: ${this.platform}`);
    }
  }

  private async replaceTextWindows(originalText: string, newText: string): Promise<void> {
    // Strategy: Use clipboard + keyboard simulation
    // 1. Select all text (Ctrl+A) or select to start (Shift+Home)
    // 2. Copy new text to clipboard
    // 3. Paste (Ctrl+V)
    
    // Note: This is a simplified implementation
    // In production, you'd want to use a native module or more sophisticated approach
    
    try {
      // Use Base64 encoding to avoid PowerShell parsing issues with special characters
      // PowerShell can decode base64 and set clipboard safely
      const base64Text = Buffer.from(newText, 'utf8').toString('base64');
      
      const script = `
        $text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${base64Text}'))
        Set-Clipboard -Value $text
      `;
      
      // Write script to temp file to avoid command line parsing issues
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const tempFile = path.join(os.tmpdir(), `clipboard-${Date.now()}.ps1`);
      fs.writeFileSync(tempFile, script, 'utf8');
      
      try {
        await execAsync(`powershell -ExecutionPolicy Bypass -File "${tempFile}"`);
        
        // Clean up temp file
        try {
          fs.unlinkSync(tempFile);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
        
        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Simulate Ctrl+V to paste
        // This would require a native module or robot library
        // For now, we'll log it
        console.log("Text replacement requested:");
        console.log("Original:", originalText.substring(0, 100));
        console.log("New text copied to clipboard (length:", newText.length, "chars)");
        console.log("Note: User can now press Ctrl+V to paste");
        
      } catch (execError) {
        // Clean up temp file on error
        try {
          fs.unlinkSync(tempFile);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
        throw execError;
      }
      
      // TODO: Implement actual keyboard simulation using:
      // - robotjs
      // - native addon with SendInput (Windows) or CGEvent (macOS)
      // - Or use clipboard and instruct user to paste
      
    } catch (error) {
      console.error("Failed to replace text:", error);
      throw error;
    }
  }

  private async replaceTextMacOS(originalText: string, newText: string): Promise<void> {
    return Sentry.startSpan({ name: 'replaceTextMacOS', op: 'text.replace.macos' }, async (span) => {
      try {
        const { exec } = require("child_process");
        const { promisify } = require("util");
        const execAsync = promisify(exec);

        const proc = execAsync(`echo "${newText.replace(/"/g, '\\"')}" | pbcopy`);
        await proc;

        await new Promise(resolve => setTimeout(resolve, 100));

        console.log("Text replacement requested:");
        console.log("Original:", originalText);
        console.log("New:", newText);
        console.log("Note: Actual replacement requires native keyboard simulation");

        span.setAttribute('text.length', newText.length);
        Sentry.addBreadcrumb({ category: 'text-replacer', message: 'macOS text replacement completed', level: 'info' });
      } catch (error) {
        console.error("Failed to replace text:", error);
        Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
          tags: { component: 'text-replacer', op: 'replaceTextMacOS', platform: 'darwin' },
        });
        span.setStatus({ code: 2, message: 'exception' });
        throw error;
      }
    });
  }

  /**
   * Replace text in place by selecting original text and typing new text
   * This uses clipboard + keyboard simulation
   */
  async replaceTextInPlace(originalText: string, newText: string): Promise<void> {
    console.log("[TextReplacer] replaceTextInPlace called");
    console.log("[TextReplacer] Original text:", originalText.substring(0, 100));
    console.log("[TextReplacer] New text:", newText.substring(0, 100));

    // IMPORTANT: The originalText comes without the @prompt prefix, but the actual text
    // in the editor includes it. We need to search for the full text including @prompt.
    const fullOriginalText = `@prompt ${originalText}`;
    console.log("[TextReplacer] Full text to search for:", fullOriginalText.substring(0, 100));

    // TRY UI AUTOMATION (Windows only, true Word-like approach!)
    if (this.platform === "win32") {
      console.log("[TextReplacer] Attempting UI Automation (NO KEYBOARD)...");
      try {
        await this.replaceTextViaUIAutomation(fullOriginalText, newText);
        console.log("[TextReplacer] ✅ SUCCESS via UI Automation (Word-like)!");
        return; // Success! No keyboard needed!
      } catch (error) {
        console.log("[TextReplacer] ⚠️ UI Automation not available:", (error as Error).message);
        // Don't fall back to keyboard - just fail and tell user to use Copy button
      }
    }

    // If UI Automation fails, tell user to use Copy button
    throw new Error("Auto-replace not available for this input field. Please use the Copy button and paste manually (Ctrl+V).");
  }

  /**
   * Windows UI Automation - Direct text replacement (like MS Word)
   * NO KEYBOARD SIMULATION!
   */
  private async replaceTextViaUIAutomation(originalText: string, newText: string): Promise<void> {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    console.log("[UIAutomation] Starting Word-like text replacement");
    console.log("[UIAutomation] This uses Windows UI Automation API - NO KEYBOARD!");

    // Use Base64 encoding to avoid PowerShell parsing issues with newlines and special chars
    const base64Original = Buffer.from(originalText, 'utf8').toString('base64');
    const base64New = Buffer.from(newText, 'utf8').toString('base64');

    // PowerShell script using UI Automation
    const script = `
param([string]$originalBase64, [string]$newBase64)

# Decode Base64 parameters to avoid newline/special char issues
$original = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($originalBase64))
$new = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($newBase64))

try {
    # Load UI Automation assemblies
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes

    # Get the currently focused element (where cursor is)
    $focusedElement = [System.Windows.Automation.AutomationElement]::FocusedElement

    if ($null -eq $focusedElement) {
        throw "No focused element found"
    }

    $elementName = $focusedElement.Current.Name
    $controlType = $focusedElement.Current.ControlType.ProgrammaticName

    Write-Host "INFO: Focused element: $elementName"
    Write-Host "INFO: Control type: $controlType"

    # Try to get ValuePattern (this is the magic - direct text access!)
    try {
        $valuePattern = $focusedElement.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)

        if ($null -eq $valuePattern) {
            throw "ValuePattern is null"
        }

        # Get current text value
        $currentValue = $valuePattern.Current.Value

        if ($null -eq $currentValue) {
            $currentValue = ""
        }

        Write-Host "INFO: Current text length: $($currentValue.Length)"
        Write-Host "INFO: Current text (first 100 chars): $($currentValue.Substring(0, [Math]::Min(100, $currentValue.Length)))"
        Write-Host "INFO: Looking for: $original"
        Write-Host "INFO: Looking for text to replace..."

        # Find the FIRST occurrence index (case-insensitive to handle auto-corrections)
        $replacementIndex = $currentValue.IndexOf($original, [System.StringComparison]::OrdinalIgnoreCase)

        if ($replacementIndex -lt 0) {
            # Try exact match as fallback
            $replacementIndex = $currentValue.IndexOf($original)
        }

        if ($replacementIndex -lt 0) {
            Write-Host "ERROR: Text not found:"
            Write-Host "  - Looking for: '$original'"
            Write-Host "  - In text (first 200 chars): '$($currentValue.Substring(0, [Math]::Min(200, $currentValue.Length)))'"
            throw "Original text not found in current value"
        }

        Write-Host "INFO: Found text at index: $replacementIndex"

        # Get the actual matched text length (might differ in case due to auto-corrections)
        $matchedLength = $original.Length

        # Replace ONLY the first occurrence to avoid replacing multiple @prompt instances
        $beforeText = $currentValue.Substring(0, $replacementIndex)
        $afterText = $currentValue.Substring($replacementIndex + $matchedLength)
        $updatedValue = $beforeText + $new + $afterText

        Write-Host "INFO: Computed replacement - Before length: $($beforeText.Length), Match length: $matchedLength, New length: $($new.Length), After length: $($afterText.Length)"

        Write-Host "INFO: Replacement found, setting new value..."

        # THIS IS THE MAGIC: Direct text replacement, NO KEYBOARD!
        $valuePattern.SetValue($updatedValue)

        Write-Host "SUCCESS: Text replaced via UI Automation!"

        # Now move cursor to the end of replaced text (NO KEYBOARD!)
        try {
            Write-Host "INFO: Attempting to move cursor to end of replaced text..."

            # Try to get TextPattern for cursor positioning
            $textPattern = $focusedElement.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)

            if ($null -ne $textPattern) {
                # Get the document range
                $documentRange = $textPattern.DocumentRange

                # We already have replacementIndex from above, calculate end position
                $endPosition = $replacementIndex + $new.Length

                Write-Host "INFO: Replacement starts at index: $replacementIndex"
                Write-Host "INFO: Moving cursor to position: $endPosition (end of replaced text)"

                if ($replacementIndex -ge 0) {

                    # Move to the end position by moving from document start
                    $documentRange.MoveEndpointByUnit([System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start, [System.Windows.Automation.Text.TextUnit]::Character, $endPosition)
                    $documentRange.MoveEndpointByUnit([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End, [System.Windows.Automation.Text.TextUnit]::Character, 0)

                    # Select the range (which is just a cursor position now)
                    $documentRange.Select()

                    Write-Host "SUCCESS: Cursor moved to end of replaced text!"
                } else {
                    Write-Host "WARNING: Could not find replacement position in original text"
                }
            } else {
                Write-Host "WARNING: TextPattern not supported by this control (cursor will remain at start)"
            }
        } catch {
            Write-Host "WARNING: Could not move cursor: $_"
            Write-Host "WARNING: Text replaced successfully, but cursor remains at current position"
        }

        exit 0

    } catch {
        throw "ValuePattern not supported or failed: $_"
    }

} catch {
    Write-Host "ERROR: $_"
    exit 1
}
`;

    const scriptFile = path.join(os.tmpdir(), `uia-replace-${Date.now()}.ps1`);
    fs.writeFileSync(scriptFile, script, 'utf8');

    try {
      const result = await execAsync(
        `powershell -ExecutionPolicy Bypass -File "${scriptFile}" ` +
        `-originalBase64 "${base64Original}" ` +
        `-newBase64 "${base64New}"`,
        { timeout: 5000 }
      );

      // Clean up
      try {
        fs.unlinkSync(scriptFile);
      } catch (e) {
        // Ignore cleanup errors
      }

      console.log("[UIAutomation] PowerShell output:", result.stdout);

      if (result.stdout.includes("SUCCESS")) {
        console.log("[UIAutomation] ✅ Text replaced successfully (NO KEYBOARD!)");
        return;
      } else {
        throw new Error("UI Automation did not succeed");
      }

    } catch (error) {
      // Clean up
      try {
        fs.unlinkSync(scriptFile);
      } catch (e) {
        // Ignore cleanup errors
      }

      const errorObj = error as any;
      const errorMsg = errorObj.stderr || errorObj.stdout || errorObj.message || String(error);
      console.log("[UIAutomation] Failed with error:");
      console.log("[UIAutomation] STDERR:", errorObj.stderr);
      console.log("[UIAutomation] STDOUT:", errorObj.stdout);
      console.log("[UIAutomation] Message:", errorObj.message);
      throw new Error(`UI Automation not available: ${errorMsg}`);
    }
  }


  /**
   * NEW WORKFLOW: Replace @prompt marker with optimized text
   * Steps:
   * 1. Move cursor back 7 characters (length of "@prompt")
   * 2. Select 7 characters forward (select "@prompt")
   * 3. Delete selection
   * 4. Paste optimized text
   *
   * @param cursorPosition - Current cursor position (after "@prompt")
   * @param optimizedText - The text to replace @prompt with
   */
  async replacePromptMarkerWithText(cursorPosition: number, optimizedText: string): Promise<void> {
    console.log("[TextReplacer] NEW WORKFLOW: Replacing @prompt marker");
    console.log("[TextReplacer] Cursor position:", cursorPosition);
    console.log("[TextReplacer] Will delete 7 chars backward and paste optimized text");

    if (this.platform === "win32") {
      await this.replacePromptMarkerWindows(optimizedText);
    } else if (this.platform === "darwin") {
      await this.replacePromptMarkerMacOS(optimizedText);
    } else {
      throw new Error(`Unsupported platform: ${this.platform}`);
    }
  }

  /**
   * Windows implementation: Delete @prompt and paste optimized text
   * Uses keyboard simulation (Backspace x7 + paste)
   */
  private async replacePromptMarkerWindows(optimizedText: string): Promise<void> {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    console.log("[TextReplacer] Windows: Deleting @prompt (7 chars) and pasting optimized text");

    // Step 1: Copy optimized text to clipboard
    await this.copyToClipboard(optimizedText);
    console.log("[TextReplacer] Optimized text copied to clipboard");

    // Step 2: Send 7 Backspace keys to delete "@prompt"
    // Use PowerShell SendKeys or use UI Automation
    const script = `
Add-Type -AssemblyName System.Windows.Forms

# Send 7 Backspace keys to delete "@prompt"
for ($i = 0; $i -lt 7; $i++) {
    [System.Windows.Forms.SendKeys]::SendWait("{BACKSPACE}")
    Start-Sleep -Milliseconds 20
}

# Wait a bit
Start-Sleep -Milliseconds 50

# Send Ctrl+V to paste optimized text
[System.Windows.Forms.SendKeys]::SendWait("^v")

Write-Host "SUCCESS: @prompt deleted and text pasted"
`;

    const scriptFile = path.join(os.tmpdir(), `replace-prompt-${Date.now()}.ps1`);
    fs.writeFileSync(scriptFile, script, 'utf8');

    try {
      const result = await execAsync(
        `powershell -ExecutionPolicy Bypass -File "${scriptFile}"`,
        { timeout: 5000 }
      );

      // Clean up
      try {
        fs.unlinkSync(scriptFile);
      } catch (e) {
        // Ignore cleanup errors
      }

      console.log("[TextReplacer] PowerShell output:", result.stdout);

      if (result.stdout.includes("SUCCESS")) {
        console.log("[TextReplacer] ✅ @prompt replaced successfully");
        return;
      } else {
        throw new Error("Failed to replace @prompt");
      }
    } catch (error) {
      // Clean up
      try {
        fs.unlinkSync(scriptFile);
      } catch (e) {
        // Ignore cleanup errors
      }

      const errorObj = error as any;
      const errorMsg = errorObj.stderr || errorObj.stdout || errorObj.message || String(error);
      console.error("[TextReplacer] Failed to replace @prompt:", errorMsg);
      throw new Error(`Failed to replace @prompt: ${errorMsg}`);
    }
  }

  /**
   * macOS implementation: Delete @prompt and paste optimized text
   */
  private async replacePromptMarkerMacOS(optimizedText: string): Promise<void> {
    return Sentry.startSpan({ name: 'replacePromptMarkerMacOS', op: 'text.replace_marker.macos' }, async (span) => {
      console.log("[TextReplacer] macOS: Deleting @prompt and pasting optimized text");

      await this.copyToClipboard(optimizedText);

      const script = `
        repeat 7 times
          tell application "System Events" to keystroke (ASCII character 8)
          delay 0.02
        end repeat
        delay 0.05
        tell application "System Events" to keystroke "v" using command down
      `;

      try {
        await execAsync(`osascript -e '${script.replace(/'/g, "\\'")}'`);
        console.log("[TextReplacer] @prompt replaced successfully (macOS)");
        span.setAttribute('text.length', optimizedText.length);
        Sentry.addBreadcrumb({ category: 'text-replacer', message: 'macOS @prompt marker replaced', level: 'info' });
      } catch (error) {
        console.error("[TextReplacer] macOS replacement failed:", error);
        Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
          tags: { component: 'text-replacer', op: 'replacePromptMarkerMacOS', platform: 'darwin' },
        });
        span.setStatus({ code: 2, message: 'exception' });
        throw error;
      }
    });
  }

  /**
   * Alternative: Use clipboard approach and show instruction to user
   */
  async copyToClipboard(text: string): Promise<void> {
    if (this.platform === "win32") {
      // Use Base64 encoding to avoid PowerShell parsing issues
      const base64Text = Buffer.from(text, 'utf8').toString('base64');
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const script = `
        $text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${base64Text}'))
        Set-Clipboard -Value $text
      `;
      const tempFile = path.join(os.tmpdir(), `clipboard-${Date.now()}.ps1`);
      fs.writeFileSync(tempFile, script, 'utf8');
      
      try {
        await execAsync(`powershell -ExecutionPolicy Bypass -File "${tempFile}"`);
        try {
          fs.unlinkSync(tempFile);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
      } catch (error) {
        try {
          fs.unlinkSync(tempFile);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
        throw error;
      }
    } else if (this.platform === "darwin") {
      const { exec } = require("child_process");
      const { promisify } = require("util");
      const execAsync = promisify(exec);
      await execAsync(`echo "${text.replace(/"/g, '\\"')}" | pbcopy`);
    }
  }
}
