import { app, Menu, MenuItemConstructorOptions } from 'electron';

/**
 * Build and install the application menu.
 *
 * Goals (per product decision):
 *   - macOS top menu bar must show "Prmpt" (not "Electron").
 *   - No View menu — that's where the default Reload, Force Reload, Toggle
 *     DevTools, Zoom In/Out/Reset accelerators live. Stripping the View menu
 *     unbinds Cmd+R, Cmd+Shift+R, Cmd+=, Cmd+-, Cmd+0, Cmd+Alt+I, etc.
 *   - The Quit item stays accessible (so users can quit from the macOS menu),
 *     but its Cmd+Q accelerator is removed — pressing Cmd+Q does nothing.
 *     Quit still works from the tray and from the menu item click.
 *   - On Windows we drop the menu entirely (`setApplicationMenu(null)`),
 *     which both hides the menu bar and unbinds the default accelerators
 *     (Ctrl+R, Ctrl+Shift+I, Ctrl+=, etc.).
 *
 * Must be called after `app.whenReady()` and AFTER `app.setName('Prmpt')`,
 * because role: 'appMenu' uses `app.name` for the first menu item label.
 */
export function installApplicationMenu(): void {
  if (process.platform !== 'darwin') {
    // Windows / Linux: no menu at all → no default accelerators to fight.
    Menu.setApplicationMenu(null);
    return;
  }

  const appName = app.name;

  const template: MenuItemConstructorOptions[] = [
    {
      label: appName,
      submenu: [
        { role: 'about', label: `About ${appName}` },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: `Hide ${appName}` },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        // Quit item without an accelerator — Cmd+Q is intentionally disabled
        // so the user cannot accidentally kill the app while typing in another
        // window. Quit is still available via this menu item and the tray.
        {
          label: `Quit ${appName}`,
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
