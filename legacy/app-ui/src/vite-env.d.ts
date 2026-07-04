/// <reference types="vite/client" />
/// <reference path="./types/electron.d.ts" />

interface Window {
  electronAPI: import('./types/electron').ElectronAPI;
}
