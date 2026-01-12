import { app, BrowserWindow } from "electron";
import { PromptOptimizerApp } from "./app";

let optimizerApp: PromptOptimizerApp | null = null;

// Handle app lifecycle
app.whenReady().then(async () => {
  optimizerApp = new PromptOptimizerApp();
  await optimizerApp.initialize();
});

app.on("window-all-closed", () => {
  // This is a background service - keep running even when overlay windows close
  // Don't quit the app when windows close - it should continue running in the background
  // The user can quit manually via Ctrl+C or by closing the Electron process
});

app.on("activate", async () => {
  // Recreate app on macOS when dock icon is clicked
  if (optimizerApp === null) {
    optimizerApp = new PromptOptimizerApp();
    await optimizerApp.initialize();
  }
});

app.on("before-quit", async () => {
  if (optimizerApp) {
    await optimizerApp.shutdown();
  }
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Focus existing window if user tries to open another instance
  });
}
