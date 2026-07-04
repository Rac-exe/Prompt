import * as Sentry from '@sentry/react';
const { logger } = Sentry;

declare const __APP_VERSION__: string;

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  release: `prmpt@${__APP_VERSION__}`,
  environment: import.meta.env.DEV ? 'development' : 'production',
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({ maskAllText: true, blockAllMedia: false }),
    Sentry.consoleLoggingIntegration(),
  ],
  tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.2,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  _experiments: { enableLogs: true },
  beforeSend(event) {
    const PII_RE = /prompt|content|message|text/i;
    if (event.extra) {
      for (const key of Object.keys(event.extra)) {
        if (PII_RE.test(key)) event.extra[key] = '[REDACTED]';
      }
    }
    if (event.breadcrumbs) {
      for (const bc of event.breadcrumbs) {
        if (bc.data) {
          for (const key of Object.keys(bc.data)) {
            if (PII_RE.test(key)) (bc.data as Record<string, unknown>)[key] = '[REDACTED]';
          }
        }
      }
    }
    if (event.exception?.values) {
      for (const ex of event.exception.values) {
        if (ex.value && PII_RE.test(ex.value)) ex.value = '[REDACTED]';
        for (const frame of ex.stacktrace?.frames ?? []) {
          if (frame.vars) {
            for (const key of Object.keys(frame.vars)) {
              if (PII_RE.test(key)) frame.vars[key] = '[REDACTED]';
            }
          }
        }
      }
    }
    return event;
  },
});

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Push from main process when user logs in/out (best-effort, may fire before renderer is ready)
window.electronAPI?.onSentryUser?.((user) => {
  Sentry.setUser(user ? { id: user.id } : null);
});

// Reliable fallback: auth:state-changed fires after the renderer calls auth:check,
// guaranteeing the listener is registered before the event arrives.
window.electronAPI?.onAuthStateChange?.((data) => {
    if (data.isAuthenticated && data.user) {
    const id = data.user.id ?? data.user.profile?.id;
    if (id) {
      Sentry.setUser({ id });
      logger.info(logger.fmt`renderer.authenticated userId=${id}`);
    }
  } else {
    Sentry.setUser(null);
    logger.info('renderer.unauthenticated');
  }
});

logger.info('renderer.started window=main');

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
