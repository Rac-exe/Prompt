import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Apply stored theme synchronously before React mounts so the loading spinner
// and every subsequent state render in the correct theme — no FOUC.
// The window is still hidden at this point (show: false / setOpacity(0) in
// app-window-manager), so this always completes before the user sees anything.
(function applyStoredTheme() {
  try {
    const stored = localStorage.getItem('prompt-weaver-settings');
    if (stored) {
      const { theme } = JSON.parse(stored) as { theme?: string };
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
    // No stored settings (first launch) → keep light (no class added)
  } catch (_) {
    // Parse error → keep whatever the HTML blocking script set
  }
})();

createRoot(document.getElementById("root")!).render(<App />);
