import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    root: '.',
    include: ['tests/unit/**/*.test.ts', 'tests/e2e/**/*.test.ts'],
    environment: 'node',
    globals: true,
    setupFiles: [],
    globalSetup: ['./tests/setup.ts'],
    testTimeout: 15000,
    alias: {
      '@electron/main': path.resolve(__dirname, 'electron/main'),
    },
  },
});
