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
 * Nudge the focused renderer to run a workspace-management dialog (rename /
 * remove the ACTIVE workspace). These rare, destructive ops live in the File
 * menu — not the command palette, where they'd sit one mistyped Enter away
 * from "open a file". The renderer owns the dialogs + store calls; main just
 * triggers, mirroring emitOpenFolder. The renderer no-ops when no workspace
 * is open (native menus can't cheaply track that state).
 */
function emitWorkspaceAction(action: 'rename' | 'remove'): void {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu:workspace-action', action);
}

/** Hooks the View menu's zoom items call. The caller owns the authoritative zoom
 *  level (so repeated steps don't drift on Electron's factor↔level rounding) and
 *  is responsible for clamping, applying it to the window, and persisting it. */
export interface ZoomMenuHooks {
  getZoomLevel: () => number;
  applyZoomLevel: (level: number) => void;
}

/**
 * The application menu. Replacing Electron's default menu means we own the
 * whole bar — so we keep the standard Edit/View/Window roles (Electron expands
 * them with cut/copy/paste/selectAll, reload, minimize, …). Forgetting the
 * Edit role would silently break ⌘C/⌘V inside the block editor.
 *
 * Additions over the defaults:
 *  - File ▸ Open Folder… (⌘O) — the primary "open another workspace" path.
 *  - A custom View submenu whose zoom steps by ±1 zoom level per press (≈20%,
 *    matching a mature code editor) instead of Electron's smaller ±0.5 default,
 *    with ⌘0 = Actual Size. The level is owned + persisted by the caller.
 */
export function buildAppMenu(zoom: ZoomMenuHooks): Menu {
  const zoomIn = (): void => zoom.applyZoomLevel(zoom.getZoomLevel() + 1);
  const zoomOut = (): void => zoom.applyZoomLevel(zoom.getZoomLevel() - 1);
  const resetZoom = (): void => zoom.applyZoomLevel(0);
  // A menu item can hold only ONE accelerator, so each extra key (the bare ⌘= and
  // the numpad keys, matching a mature editor) rides a hidden twin item.
  // `acceleratorWorksWhenHidden` keeps its key live even though it isn't shown.
  const altAccel = (
    label: string,
    accelerator: string,
    click: () => void,
  ): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click,
    visible: false,
    acceleratorWorksWhenHidden: true,
  });
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => emitOpenFolder() },
        { type: 'separator' },
        { label: 'Rename Workspace…', click: () => emitWorkspaceAction('rename') },
        { label: 'Remove Workspace…', click: () => emitWorkspaceAction('remove') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      // Custom View menu: same items as Electron's `viewMenu` role, but the zoom
      // commands step the window zoom like a mature editor (±1 level / ⌘0 reset).
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        // Zoom: ±1 level (≈20%) per press, ⌘0 = Actual Size. The visible items show
        // the conventional ⌘0 / ⌘+ / ⌘- ; hidden twins add the bare ⌘= and the
        // numpad keys (numpad +/−/0), matching a mature editor's full key set.
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: resetZoom },
        altAccel('Actual Size', 'CmdOrCtrl+num0', resetZoom),
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: zoomIn },
        altAccel('Zoom In', 'CmdOrCtrl+=', zoomIn),
        altAccel('Zoom In', 'CmdOrCtrl+numadd', zoomIn),
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: zoomOut },
        altAccel('Zoom Out', 'CmdOrCtrl+numsub', zoomOut),
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
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
