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

/** Nudge the focused renderer to open the Settings overlay (the renderer owns
 *  the UI; main just triggers — mirroring emitOpenFolder). Lives in the app
 *  menu on macOS (the conventional ⌘, spot) and in File elsewhere. */
function emitOpenSettings(): void {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu:open-settings');
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

/**
 * Nudge the focused renderer to close its active EDITOR TAB. ⌘W must close a
 * tab, not the window — but on macOS the `{ role: 'close' }` menu item carries
 * ⌘W and its accelerator fires before the renderer ever sees the keystroke, so
 * the in-renderer ⌘W handler was dead. We own the accelerator here and forward
 * it; the window-close gesture moves to ⇧⌘W (role: 'close'). The renderer
 * no-ops when no tab is open.
 */
function emitCloseTab(): void {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu:close-tab');
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
export function buildAppMenu(zoom: ZoomMenuHooks, onNewWindow: () => void): Menu {
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
  // The macOS app menu, spelled out instead of `{ role: 'appMenu' }` so we can
  // slot "Settings…" into its conventional home (between About and Services,
  // on ⌘,). Everything else matches what the role would have produced.
  const macAppMenu: MenuItemConstructorOptions = {
    role: 'appMenu',
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: emitOpenSettings },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [macAppMenu] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Window', accelerator: 'Shift+CmdOrCtrl+N', click: () => onNewWindow() },
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => emitOpenFolder() },
        { type: 'separator' },
        { label: 'Rename Workspace…', click: () => emitWorkspaceAction('rename') },
        { label: 'Remove Workspace…', click: () => emitWorkspaceAction('remove') },
        { type: 'separator' },
        // On macOS Settings lives in the app menu (above); elsewhere File is
        // its conventional home.
        ...(isMac
          ? []
          : [
              {
                label: 'Settings…',
                accelerator: 'CmdOrCtrl+,',
                click: emitOpenSettings,
              } as MenuItemConstructorOptions,
              { type: 'separator' } as MenuItemConstructorOptions,
            ]),
        // ⌘W closes the active editor tab (forwarded to the renderer); the
        // window-close gesture is ⇧⌘W. On non-macOS the conventional Quit stays.
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: emitCloseTab },
        isMac
          ? { label: 'Close Window', accelerator: 'Shift+Cmd+W', role: 'close' }
          : { role: 'quit' },
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
 * Native right-click menu, popped per webContents — now CONTENT-AWARE so it
 * coexists with the renderer's in-app context menus.
 *
 * The renderer owns the context menu for every BaseHalf surface (sidebar tree,
 * canvas, cards, terminal). This native menu only fires for genuine text-editing
 * contexts the renderer doesn't claim: an editable field (the block editor's
 * rich text — which needs cut/copy/paste) or a plain selection (offer Copy).
 * Everywhere else it pops NOTHING, so the in-app menu is the only one shown.
 *
 * This is decided synchronously from Electron's `params` — NOT via a renderer
 * handshake — because the DOM `contextmenu` event's `preventDefault()` does NOT
 * suppress this main-process `context-menu` event. Reading `isEditable` /
 * `selectionText` here avoids any event-ordering race. (The old always-on
 * "Open Folder…" moved to the File menu + the canvas's in-app background menu.)
 */
// One-shot suppression: set synchronously by the renderer (via sendSync) the
// instant it opens an IN-APP context menu, so the native menu doesn't ALSO pop.
// This is the only race-free way to suppress over a surface that Electron reports
// as `isEditable` but the renderer owns — chiefly the terminal, whose xterm helper
// <textarea> can be the right-click target. The DOM `contextmenu` event (where the
// renderer claims) always precedes this `context-menu` event, and sendSync blocks
// until this flag is set, so it's reliably consumed by the very next pop.
let suppressNextNativeMenu = false;
export function claimNativeContextMenuSuppression(): void {
  suppressNextNativeMenu = true;
  // Belt-and-suspenders: auto-clear so a claim with no following context-menu
  // (shouldn't happen — every right-click fires one) can't strand the flag and
  // swallow the editor's next legitimate native menu.
  setTimeout(() => {
    suppressNextNativeMenu = false;
  }, 200);
}

export function installContextMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_event, params) => {
    if (suppressNextNativeMenu) {
      suppressNextNativeMenu = false;
      return; // the renderer opened its own in-app menu for this gesture
    }
    const items: MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
    } else if (params.selectionText) {
      items.push({ role: 'copy' });
    }
    // Non-editable, no selection → a BaseHalf surface owns its own menu; pop nothing.
    if (items.length === 0) return;
    Menu.buildFromTemplate(items).popup({ window: win });
  });
}
