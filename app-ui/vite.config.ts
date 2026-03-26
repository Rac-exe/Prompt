import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { sentryVitePlugin } from "@sentry/vite-plugin";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: "./", // Required for Electron file:// protocol
  envDir: "..", // Read .env from Prompt/ root (parent of app-ui/)
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    mode === "production" &&
      sentryVitePlugin({
        org: process.env.SENTRY_ORG || "prmpt",
        project: process.env.SENTRY_PROJECT || "prmpt-desktop",
        authToken: process.env.SENTRY_AUTH_TOKEN,
        release: { name: "prmpt@2.0.0" },
        sourcemaps: { filesToDeleteAfterUpload: ["../electron/renderer/app-ui/**/*.map"] },
      }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../electron/renderer/app-ui", // Build directly to Electron
    emptyDir: true, // Clean before build
    sourcemap: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        overlay: path.resolve(__dirname, "overlay.html"),
      },
      output: {
        manualChunks: undefined, // Single bundle for Electron
      },
    },
  },
}));
