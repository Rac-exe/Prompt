import React from 'react';
import ReactDOM from 'react-dom/client';
import OverlayApp from './App';
import '../index.css';
import './overlay.css';

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
