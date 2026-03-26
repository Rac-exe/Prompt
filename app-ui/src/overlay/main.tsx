import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  release: 'prmpt@2.0.0',
  environment: import.meta.env.DEV ? 'development' : 'production',
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({ maskAllText: true }),
    Sentry.captureConsoleIntegration({ levels: ['error', 'warn'] }),
  ],
  tracesSampleRate: 1.0,
  replaysOnErrorSampleRate: 1.0,
  initialScope: { tags: { window: 'overlay' } },
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

// Signal to main process that the React UI is mounted and painted.
// Wait one animation frame after React's commit so the browser has
// actually flushed pixels to the compositor before we allow show().
requestAnimationFrame(() => {
  window.electronAPI?.overlay?.notifyReady?.();
});