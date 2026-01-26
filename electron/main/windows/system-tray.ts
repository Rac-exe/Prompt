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
    // Create a simple white icon for the tray (16x16 px)
    const icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAADvSURBVDiNpdM/S8NAGMfxz+VSaCkIHRx0cXMXX4AvwMHBQRfBzcFJRHDSVRcRBBcHQV/AW3ARHJwUFBQVOjg4OFQQ/DOk1JL7OViSJm1T+8Ddc3c8n7vnuTvEGFljjJExRsYY6f8wxsgYI2OMzLKMMTLGyBgjY4zM/4wxMsZIY4yUMUbKGCNljJEyxkgZY6SMMVLGGCljjJQxRsoYI2WMkTLGSP2LMVLGGCljjJQxRsoYI2WMkTLGSBljpIwxUsYYKWOMlDFGyh8zxsgYI2OMkTFGxhgZY2SMkTHGyBgjY4yMMTLGyBgjY4yMMTLGyBgjY4yMMTL/AE7xN9Bx8KJ+AAAAAElFTkSuQmCC'
    );

    this.tray = new Tray(icon);
    this.tray.setToolTip('Prompt Optimizer');

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
        label: 'Open Prompt',
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
