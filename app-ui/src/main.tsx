import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  release: 'prmpt@2.0.0',
  environment: import.meta.env.DEV ? 'development' : 'production',
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({ maskAllText: true, blockAllMedia: false }),
    Sentry.captureConsoleIntegration({ levels: ['error', 'warn'] }),
  ],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

window.electronAPI?.onSentryUser?.((user) => {
  Sentry.setUser(user ? { id: user.id, email: user.email } : null);
});

createRoot(document.getElementById("root")!).render(<App />);
