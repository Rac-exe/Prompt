# Prmpt — app UI

The React frontend for the Prmpt desktop app: the main App Window and the
`@prompt` Overlay (two Vite entry points, `index.html` and `overlay.html`).
It builds into `../electron/renderer/app-ui/`, which Electron loads.

```bash
npm install        # or, from the repo root: npm run install:ui
npm run build      # or, from the repo root: npm run build:ui
npm run dev        # Vite dev server (browser preview; Electron loads the build)
npm test           # Vitest unit tests
```

See the [main README](../README.md) for how to run the whole app.
