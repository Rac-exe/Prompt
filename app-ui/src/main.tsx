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
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  _experiments: { enableLogs: true },
});

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Push from main process when user logs in/out (best-effort, may fire before renderer is ready)
window.electronAPI?.onSentryUser?.((user) => {
  Sentry.setUser(user ? { id: user.id, email: user.email } : null);
});

// Reliable fallback: auth:state-changed fires after the renderer calls auth:check,
// guaranteeing the listener is registered before the event arrives.
window.electronAPI?.onAuthStateChange?.((data) => {
  if (data.isAuthenticated && data.user) {
    const id = data.user.id ?? data.user.profile?.id;
    const email = data.user.email ?? data.user.profile?.email;
    if (id) {
      Sentry.setUser({ id, email });
      logger.info(logger.fmt`renderer.authenticated userId=${id}`);
    }
  } else {
    Sentry.setUser(null);
    logger.info('renderer.unauthenticated');
  }
});

logger.info('renderer.started window=main');

createRoot(document.getElementById("root")!).render(<App />);
