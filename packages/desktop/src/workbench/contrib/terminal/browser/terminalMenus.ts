import type { ContextMenuItem } from '../../../browser/parts/contextmenu/contextMenuStore.js';
import { termRegistry } from './termRegistry.js';
import { useTerminalStore } from './terminalStore.js';

export interface TerminalTabMenuActions {
  readonly canCloseOthers: boolean;
  readonly canCloseToRight: boolean;
  readonly onRename: () => void;
  readonly onClose: () => void;
  readonly onCloseOthers: () => void;
  readonly onCloseToRight: () => void;
  readonly onSplitRight: () => void;
  readonly onSplitDown: () => void;
  readonly onNewTab: () => void;
}

/**
 * Terminal menu models, following VS Code's terminalMenus.ts boundary:
 * TerminalInstanceContext (pane) and TerminalTabContext (tab) actions live here,
 * while React components only decide where and when to open the menu.
 */
export function buildTerminalMenu(paneId: string): ContextMenuItem[] {
  const term = termRegistry.get(paneId);
  const hasSelection = term?.hasSelection() ?? false;
  const store = useTerminalStore.getState();

  const copy = (): void => {
    const sel = termRegistry.get(paneId)?.getSelection() ?? '';
    if (sel) void navigator.clipboard.writeText(sel).catch(() => undefined);
  };
  const paste = (): void => {
    void navigator.clipboard
      .readText()
      .then((text) => {
        if (text) termRegistry.get(paneId)?.paste(text);
      })
      .catch(() => undefined);
  };

  return [
    { id: 'term-copy', label: 'Copy', disabled: !hasSelection, run: copy },
    { id: 'term-paste', label: 'Paste', run: paste },
    {
      id: 'term-select-all',
      label: 'Select All',
      run: () => termRegistry.get(paneId)?.selectAll(),
    },
    { id: 'term-clear', label: 'Clear', run: () => termRegistry.get(paneId)?.clear() },
    { separator: true },
    { id: 'term-new-tab', label: 'New Terminal Tab', run: () => store.newTab() },
    { id: 'term-split-right', label: 'Split Right', run: () => store.splitPane('right') },
    { id: 'term-split-down', label: 'Split Down', run: () => store.splitPane('down') },
    { separator: true },
    { id: 'term-close', label: 'Close Pane', danger: true, run: () => store.closePane(paneId) },
  ];
}

export function buildTerminalTabMenu({
  canCloseOthers,
  canCloseToRight,
  onRename,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onSplitRight,
  onSplitDown,
  onNewTab,
}: TerminalTabMenuActions): ContextMenuItem[] {
  return [
    { id: 'term-tab-new', label: 'New Terminal Tab', run: onNewTab },
    { id: 'term-tab-split-right', label: 'Split Pane Right', run: onSplitRight },
    { id: 'term-tab-split-down', label: 'Split Pane Down', run: onSplitDown },
    { separator: true },
    { id: 'term-tab-rename', label: 'Rename...', run: onRename },
    { separator: true },
    { id: 'term-tab-close', label: 'Close Tab', danger: true, run: onClose },
    {
      id: 'term-tab-close-others',
      label: 'Close Other Tabs',
      disabled: !canCloseOthers,
      run: onCloseOthers,
    },
    {
      id: 'term-tab-close-right',
      label: 'Close Tabs to the Right',
      disabled: !canCloseToRight,
      run: onCloseToRight,
    },
  ];
}
