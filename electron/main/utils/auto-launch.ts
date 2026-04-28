import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as Sentry from '@sentry/electron/main';

/**
 * Auto-launch (start-at-login) preference manager.
 *
 * Stores a per-machine JSON file in app.getPath('userData')/auto-launch.json.
 * Auto-launch is a system-level concern (per-machine, not per-user), so it
 * is intentionally NOT persisted to Supabase alongside other user settings.
 *
 * Default is enabled — every fresh install registers itself as a login item
 * on first packaged launch. Users can opt out via the tray menu or the
 * Settings → Customize → Startup toggle, and the choice persists across
 * reboots and sessions.
 *
 * Silent launch on boot is handled by isSilentLaunch() in index-new.ts:
 *   - macOS: app.getLoginItemSettings().wasOpenedAsHidden (set via openAsHidden)
 *   - Windows: process.argv.includes('--hidden') (set via args)
 */

interface AutoLaunchStore {
  enabled: boolean;
}

const DEFAULT_STORE: AutoLaunchStore = { enabled: true };

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'auto-launch.json');
}

function readStore(): AutoLaunchStore {
  try {
    const filePath = getStorePath();
    if (!fs.existsSync(filePath)) return { ...DEFAULT_STORE };
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AutoLaunchStore>;
    return { enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_STORE.enabled };
  } catch (err) {
    Sentry.captureException(err, { level: 'warning', tags: { component: 'auto-launch', op: 'read' } });
    return { ...DEFAULT_STORE };
  }
}

function writeStore(store: AutoLaunchStore): void {
  try {
    const filePath = getStorePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    Sentry.captureException(err, { level: 'warning', tags: { component: 'auto-launch', op: 'write' } });
  }
}

/**
 * Read the user's preference. Defaults to true if the file doesn't exist
 * (i.e. fresh install — auto-launch is enabled by default for every user).
 */
export function getAutoLaunchPreference(): boolean {
  return readStore().enabled;
}

/**
 * Persist the user's preference to disk. Does not touch the OS — call
 * applyAutoLaunchToOS() separately to keep the registry/login item in sync.
 */
export function setAutoLaunchPreference(enabled: boolean): void {
  writeStore({ enabled });
}

/**
 * Push the preference to the OS-level login item.
 *
 * Skipped when the app is unpackaged (dev mode) — we never want
 * `npm run dev` to register the dev electron binary as a login item.
 */
export function applyAutoLaunchToOS(enabled: boolean): void {
  if (!app.isPackaged) {
    console.log(`[AutoLaunch] Skipping OS sync (dev mode), preference=${enabled}`);
    return;
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true,
      ...(process.platform === 'win32'
        ? { path: process.execPath, args: ['--hidden'] }
        : {}),
    });
    Sentry.addBreadcrumb({
      category: 'auto-launch',
      message: `Login item ${enabled ? 'registered' : 'unregistered'}`,
      level: 'info',
      data: { platform: process.platform },
    });
    console.log(`[AutoLaunch] OS login item ${enabled ? 'enabled' : 'disabled'}`);
  } catch (err) {
    Sentry.captureException(err, { level: 'warning', tags: { component: 'auto-launch', op: 'apply' } });
    console.error('[AutoLaunch] Failed to apply OS setting:', err);
  }
}

/**
 * Enforce the stored preference against the OS on every startup.
 *
 * On a fresh install the store doesn't exist yet → defaults to true →
 * registers the login item. On subsequent launches it re-asserts the
 * user's saved choice (handy if e.g. the user uninstalled and reinstalled,
 * or if the registry entry was wiped by another tool).
 */
export function syncAutoLaunchOnStartup(): void {
  applyAutoLaunchToOS(getAutoLaunchPreference());
}
