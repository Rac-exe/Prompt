#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Patches the dev-mode Electron binary so the macOS menu bar shows "Prmpt"
 * instead of "Electron".
 *
 * Why this is needed:
 *   The first item in the macOS menu bar is forcibly populated by the OS
 *   from the running binary's CFBundleName / CFBundleDisplayName — it
 *   ignores app.setName() and ignores whatever label you pass to your
 *   custom Menu template. In `npm run dev` we launch
 *   node_modules/electron/dist/Electron.app whose plist still says
 *   "Electron", so the menu bar shows "Electron". Packaged builds are
 *   already correct because electron-builder bakes productName ("Prmpt")
 *   into the plist of the produced .app.
 *
 * What this script does:
 *   On macOS only, set CFBundleName / CFBundleDisplayName to "Prmpt"
 *   inside node_modules/electron/dist/Electron.app/Contents/Info.plist.
 *   Idempotent — safe to re-run after every `npm install`.
 *
 * Wired as `postinstall` in package.json so it runs automatically.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const APP_NAME = 'Prmpt';

if (process.platform !== 'darwin') {
  process.exit(0);
}

const plistPath = path.join(
  __dirname,
  '..',
  'node_modules',
  'electron',
  'dist',
  'Electron.app',
  'Contents',
  'Info.plist',
);

if (!fs.existsSync(plistPath)) {
  // electron not installed yet (e.g. running before deps are present) — nothing to do
  process.exit(0);
}

function plist(args) {
  return execFileSync('/usr/libexec/PlistBuddy', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function setKey(key, value) {
  try {
    const current = plist(['-c', `Print :${key}`, plistPath]);
    if (current === value) return false;
    plist(['-c', `Set :${key} ${value}`, plistPath]);
    return true;
  } catch (_err) {
    plist(['-c', `Add :${key} string ${value}`, plistPath]);
    return true;
  }
}

try {
  const a = setKey('CFBundleName', APP_NAME);
  const b = setKey('CFBundleDisplayName', APP_NAME);
  if (a || b) {
    console.log(`[patch-dev-electron-name] Set CFBundleName / CFBundleDisplayName → "${APP_NAME}"`);
  }
} catch (err) {
  console.warn(`[patch-dev-electron-name] Skipped — ${err.message}`);
}
