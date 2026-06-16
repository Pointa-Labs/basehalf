/**
 * Terminal pane context menu — the terminal's own right-click strategy.
 *
 * Unlike the file surfaces, this isn't file ops: it's the editing/clipboard +
 * pane-management actions a terminal needs (Copy/Paste/Select All/Clear, plus
 * New Tab / Split / Close). Copy/Select-All/Clear/Paste drive the clicked pane's
 * xterm instance (via termRegistry); the pane lifecycle actions go through the
 * terminal store. Paste reads the clipboard through the main process (reliable
 * under the renderer sandbox), Copy writes via navigator.clipboard (which works).
 *
 * The dock focuses the right-clicked pane before opening this, so Split/Close
 * target the pane the user actually clicked.
 */

import type { ContextMenuItem } from '../../store/contextMenu.js';
import { useTerminalStore } from '../../store/terminal.js';
import { termRegistry } from '../termRegistry.js';

export function buildTerminalMenu(paneId: string): ContextMenuItem[] {
  const term = termRegistry.get(paneId);
  const hasSelection = term?.hasSelection() ?? false;
  const store = useTerminalStore.getState();

  const copy = (): void => {
    const sel = termRegistry.get(paneId)?.getSelection() ?? '';
    if (sel) void navigator.clipboard.writeText(sel).catch(() => undefined);
  };
  const paste = (): void => {
    void window.bh
      .clipboardReadText()
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
