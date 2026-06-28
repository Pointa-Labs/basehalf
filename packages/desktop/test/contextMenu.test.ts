import { beforeEach, describe, expect, it } from 'vitest';
import {
  contextMenuService,
  openContextMenu,
  useContextMenuStore,
} from '../src/platform/contextview/browser/contextMenuService.js';
import {
  type ContextMenuItem,
  isContextMenuSeparator,
} from '../src/platform/contextview/common/contextMenu.js';

const action = (id: string): ContextMenuItem => ({ id, label: id, run: () => undefined });
const sep: ContextMenuItem = { separator: true };
const shape = (items: readonly ContextMenuItem[]): string[] =>
  items.map((i) => (isContextMenuSeparator(i) ? '|' : i.id));

describe('context-menu service', () => {
  beforeEach(() => contextMenuService.closeContextMenu());

  it('does not open for an empty item list', () => {
    openContextMenu(10, 20, []);
    expect(useContextMenuStore.getState().open).toBe(false);
  });

  it('does not open for a separators-only list', () => {
    openContextMenu(10, 20, [sep, sep]);
    expect(useContextMenuStore.getState().open).toBe(false);
  });

  it('opens at the cursor point with actionable items', () => {
    openContextMenu(42, 17, [action('a')]);
    const s = useContextMenuStore.getState();
    expect(s.open).toBe(true);
    expect(s.x).toBe(42);
    expect(s.y).toBe(17);
    expect(shape(s.items)).toEqual(['a']);
  });

  it('trims leading / trailing / consecutive separators', () => {
    openContextMenu(0, 0, [sep, action('a'), sep, sep, action('b'), sep]);
    expect(shape(useContextMenuStore.getState().items)).toEqual(['a', '|', 'b']);
  });

  it('close clears open + items', () => {
    openContextMenu(0, 0, [action('a')]);
    contextMenuService.closeContextMenu();
    const s = useContextMenuStore.getState();
    expect(s.open).toBe(false);
    expect(s.items).toEqual([]);
  });

  it('runs onHide when the service closes an open menu', () => {
    let didCancel: boolean | undefined;
    contextMenuService.showContextMenu({
      getAnchor: () => ({ x: 1, y: 2 }),
      getActions: () => [action('a')],
      onHide: (value) => {
        didCancel = value;
      },
    });

    contextMenuService.closeContextMenu({ didCancel: false });

    expect(didCancel).toBe(false);
    expect(useContextMenuStore.getState().open).toBe(false);
  });
});
