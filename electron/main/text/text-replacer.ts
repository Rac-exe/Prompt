import { exec } from "child_process";
import { promisify } from "util";

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
    try {
      // Copy to clipboard using pbcopy
      const { exec } = require("child_process");
      const { promisify } = require("util");
      const execAsync = promisify(exec);
      
      // Use pbcopy to set clipboard
      const proc = execAsync(`echo "${newText.replace(/"/g, '\\"')}" | pbcopy`);
      await proc;
      
      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Simulate Cmd+V
      // Would need native module or AppleScript
      console.log("Text replacement requested:");
      console.log("Original:", originalText);
      console.log("New:", newText);
      console.log("Note: Actual replacement requires native keyboard simulation");
      
    } catch (error) {
      console.error("Failed to replace text:", error);
      throw error;
    }
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
