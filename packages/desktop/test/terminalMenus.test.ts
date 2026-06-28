import type { Terminal as XTerm } from '@xterm/xterm';
import { describe, expect, it, vi } from 'vitest';
import {
  type ContextMenuAction,
  type ContextMenuItem,
  isContextMenuSeparator as isSeparator,
} from '../src/platform/contextview/common/contextMenu.js';
import { termRegistry } from '../src/workbench/contrib/terminal/browser/termRegistry.js';
import {
  type TerminalTabMenuActions,
  buildTerminalMenu,
  buildTerminalTabMenu,
} from '../src/workbench/contrib/terminal/browser/terminalMenus.js';

const tabActions = (): TerminalTabMenuActions => ({
  canCloseOthers: true,
  canCloseToRight: true,
  onRename: vi.fn(),
  onClose: vi.fn(),
  onCloseOthers: vi.fn(),
  onCloseToRight: vi.fn(),
  onSplitRight: vi.fn(),
  onSplitDown: vi.fn(),
  onNewTab: vi.fn(),
});

const ids = (items: readonly ContextMenuItem[]): string[] =>
  items.map((item) => (isSeparator(item) ? '---' : item.id));

const action = (items: readonly ContextMenuItem[], id: string): ContextMenuAction => {
  const item = items.find((entry) => !isSeparator(entry) && entry.id === id);
  if (!item || isSeparator(item)) throw new Error(`missing action ${id}`);
  return item;
};

describe('terminal menus', () => {
  it('keeps the pane menu groups in stable order', () => {
    const term = { hasSelection: () => true } as XTerm;
    termRegistry.register('p1', term);
    try {
      const menu = buildTerminalMenu('p1');

      expect(ids(menu)).toEqual([
        'term-copy',
        'term-paste',
        'term-select-all',
        'term-clear',
        '---',
        'term-new-tab',
        'term-split-right',
        'term-split-down',
        '---',
        'term-close',
      ]);
      expect(action(menu, 'term-copy').disabled).toBe(false);
      expect(action(menu, 'term-close').danger).toBe(true);
    } finally {
      termRegistry.unregister('p1');
    }
  });

  it('disables pane copy when there is no selected text', () => {
    const term = { hasSelection: () => false } as XTerm;
    termRegistry.register('p1', term);
    try {
      expect(action(buildTerminalMenu('p1'), 'term-copy').disabled).toBe(true);
    } finally {
      termRegistry.unregister('p1');
    }
  });

  it('keeps the VS Code-like tab menu groups in stable order', () => {
    expect(ids(buildTerminalTabMenu(tabActions()))).toEqual([
      'term-tab-new',
      'term-tab-split-right',
      'term-tab-split-down',
      '---',
      'term-tab-rename',
      '---',
      'term-tab-close',
      'term-tab-close-others',
      'term-tab-close-right',
    ]);
  });

  it('marks destructive and unavailable tab actions', () => {
    const menu = buildTerminalTabMenu({
      ...tabActions(),
      canCloseOthers: false,
      canCloseToRight: false,
    });

    expect(action(menu, 'term-tab-close').danger).toBe(true);
    expect(action(menu, 'term-tab-close-others').disabled).toBe(true);
    expect(action(menu, 'term-tab-close-right').disabled).toBe(true);
  });

  it('wires each tab command to the supplied terminal action', () => {
    const handlers = tabActions();
    const menu = buildTerminalTabMenu(handlers);

    action(menu, 'term-tab-new').run();
    action(menu, 'term-tab-split-right').run();
    action(menu, 'term-tab-split-down').run();
    action(menu, 'term-tab-rename').run();
    action(menu, 'term-tab-close').run();
    action(menu, 'term-tab-close-others').run();
    action(menu, 'term-tab-close-right').run();

    expect(handlers.onNewTab).toHaveBeenCalledTimes(1);
    expect(handlers.onSplitRight).toHaveBeenCalledTimes(1);
    expect(handlers.onSplitDown).toHaveBeenCalledTimes(1);
    expect(handlers.onRename).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(handlers.onCloseOthers).toHaveBeenCalledTimes(1);
    expect(handlers.onCloseToRight).toHaveBeenCalledTimes(1);
  });
});
