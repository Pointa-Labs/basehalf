import { beforeEach, describe, expect, it } from 'vitest';
import {
  type ContextMenuItem,
  isSeparator,
  openContextMenu,
  useContextMenuStore,
} from '../src/workbench/browser/parts/contextmenu/contextMenuStore.js';

const action = (id: string): ContextMenuItem => ({ id, label: id, run: () => undefined });
const sep: ContextMenuItem = { separator: true };
const shape = (items: readonly ContextMenuItem[]): string[] =>
  items.map((i) => (isSeparator(i) ? '|' : i.id));

describe('context-menu store', () => {
  beforeEach(() => useContextMenuStore.getState().close());

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
    useContextMenuStore.getState().close();
    const s = useContextMenuStore.getState();
    expect(s.open).toBe(false);
    expect(s.items).toEqual([]);
  });
});
