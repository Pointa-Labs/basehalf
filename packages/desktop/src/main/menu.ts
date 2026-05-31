import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';

const isMac = process.platform === 'darwin';

/**
 * Nudge the focused renderer to run its add-workspace flow (the store's
 * `pickAndAdd` — opens the native folder picker, registers the folder, and
 * installs the agent-protocol setup). The menu bar and the right-click menu
 * both go through here rather than duplicating that flow, so "Open Folder"
 * behaves identically no matter where it's invoked — one door.
 */
function emitOpenFolder(win?: BrowserWindow | null): void {
  const target = win && !win.isDestroyed() ? win : BrowserWindow.getFocusedWindow();
  target?.webContents.send('menu:open-folder');
}

/**
 * The application menu. Replacing Electron's default menu means we own the
 * whole bar — so we keep the standard Edit/View/Window roles (Electron expands
 * them with cut/copy/paste/selectAll, reload, minimize, …). Forgetting the
 * Edit role would silently break ⌘C/⌘V inside the block editor.
 *
 * The one addition over the defaults is File ▸ Open Folder… (⌘O) — the
 * primary "open another workspace" path now that the top bar no longer carries
 * an Add-folder button.
 */
export function buildAppMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => emitOpenFolder() },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}

/**
 * Native right-click menu, popped per webContents. Editable targets get the
 * standard clipboard roles (so the block editor gains a real context menu it
 * otherwise lacks); everywhere offers "Open Folder…" so a second workspace is
 * one right-click away without going to the menu bar.
 */
export function installContextMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      items.push(
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
      );
    } else if (params.selectionText) {
      items.push({ role: 'copy' }, { type: 'separator' });
    }
    items.push({
      label: 'Open Folder…',
      accelerator: 'CmdOrCtrl+O',
      click: () => emitOpenFolder(win),
    });
    Menu.buildFromTemplate(items).popup({ window: win });
  });
}
