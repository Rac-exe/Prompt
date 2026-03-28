import * as Sentry from '@sentry/react';
const { logger } = Sentry;

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  release: 'prmpt@0.1.0',
  environment: import.meta.env.DEV ? 'development' : 'production',
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({ maskAllText: true, blockAllMedia: false }),
    Sentry.consoleLoggingIntegration(),
  ],
  tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.2,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  initialScope: { tags: { window: 'overlay' } },
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

import React from 'react';
import ReactDOM from 'react-dom/client';
import OverlayApp from './App';
import './overlay.css';

window.electronAPI?.onSentryUser?.((user) => {
  Sentry.setUser(user ? { id: user.id } : null);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OverlayApp />
  </React.StrictMode>,
);

// Set Sentry user identity each time the overlay opens (payload includes sentryUser).
// This is reliable because overlay:opened is always sent after the renderer is ready.
window.electronAPI?.overlay?.onOpened?.((data: any) => {
  if (data?.sentryUser?.id) {
    Sentry.setUser({ id: data.sentryUser.id });
    logger.info(logger.fmt`overlay.opened userId=${data.sentryUser.id} authenticated=${String(!!data.isAuthenticated)}`);
  } else {
    // Clear stale user if overlay opens unauthenticated
    Sentry.setUser(null);
    logger.info(logger.fmt`overlay.opened authenticated=${String(!!data?.isAuthenticated)}`);
  }
});

// Signal to main process that the React UI is mounted and painted.
// Wait one animation frame after React's commit so the browser has
// actually flushed pixels to the compositor before we allow show().
requestAnimationFrame(() => {
  window.electronAPI?.overlay?.notifyReady?.();
});