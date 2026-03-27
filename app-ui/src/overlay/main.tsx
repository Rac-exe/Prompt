import * as Sentry from '@sentry/react';
const { logger } = Sentry;

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  release: 'prmpt@0.1.0',
  environment: import.meta.env.DEV ? 'development' : 'production',
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({ maskAllText: true }),
    Sentry.consoleLoggingIntegration(),
  ],
  tracesSampleRate: 1.0,
  replaysOnErrorSampleRate: 1.0,
  initialScope: { tags: { window: 'overlay' } },
  _experiments: { enableLogs: true },
});

import React from 'react';
import ReactDOM from 'react-dom/client';
import OverlayApp from './App';
import './overlay.css';

window.electronAPI?.onSentryUser?.((user) => {
  Sentry.setUser(user ? { id: user.id, email: user.email } : null);
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
    Sentry.setUser({ id: data.sentryUser.id, email: data.sentryUser.email });
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