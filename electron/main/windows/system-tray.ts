import { Tray, Menu, nativeImage, app } from 'electron';
import * as Sentry from '@sentry/electron/main';
import * as path from 'path';


/**
 * System tray manager
 * Provides tray icon and menu for app control
 */
export class SystemTray {
  private tray: Tray | null = null;
  private onOpenApp: () => void;
  private onToggleOverlay: () => void;
  private onQuit: () => void;

  constructor(
    onOpenApp: () => void,
    onToggleOverlay: () => void,
    onQuit: () => void
  ) {
    this.onOpenApp = onOpenApp;
    this.onToggleOverlay = onToggleOverlay;
    this.onQuit = onQuit;
  }

  /**
   * Create the system tray
   */
  create() {
    try {
      const isMac = process.platform === 'darwin';
      const iconName = isMac ? 'tray-iconTemplate.png' : 'tray-icon.png';
      const iconSize = isMac ? { width: 18, height: 18 } : { width: 32, height: 32 };
      const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, iconName)
        : path.join(app.getAppPath(), 'build', iconName);
      const icon = nativeImage.createFromPath(iconPath).resize(iconSize);

      this.tray = new Tray(icon);
      this.tray.setToolTip('Prmpt');

      this.updateMenu();

      // Click on tray icon opens app window
      this.tray.on('click', () => {
        this.onOpenApp();
      });

      Sentry.addBreadcrumb({ category: 'system-tray', message: 'System tray created', level: 'info' });
      console.log('[SystemTray] System tray created');
    } catch (err) {
      Sentry.captureException(err, { tags: { component: 'system-tray', op: 'create' } });
      console.error('[SystemTray] Failed to create system tray:', err);
    }
  }

  /**
   * Update the tray menu
   */
  private updateMenu() {
    if (!this.tray) return;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open Prmpt',
        click: () => this.onOpenApp(),
      },
      {
        label: `Toggle Overlay (${process.platform === 'darwin' ? 'Cmd' : 'Ctrl'}+5)`,
        click: () => this.onToggleOverlay(),
      },
      {
        type: 'separator',
      },
      {
        label: 'Quit',
        click: () => this.onQuit(),
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  /**
   * Destroy the tray
   */
  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
