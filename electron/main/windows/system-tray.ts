import { Tray, Menu, nativeImage, app } from 'electron';
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
    // In packaged mode the tray icon lives in extraResources.
    // In dev mode it lives in build/ at the project root (app.getAppPath()).
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'tray-icon.png')
      : path.join(app.getAppPath(), 'build', 'tray-icon.png');
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 });

    this.tray = new Tray(icon);
    this.tray.setToolTip('Prmpt');

    this.updateMenu();

    // Click on tray icon opens app window
    this.tray.on('click', () => {
      this.onOpenApp();
    });

    console.log('[SystemTray] System tray created');
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
        label: 'Toggle Overlay (Ctrl+5)',
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
