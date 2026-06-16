import { describe, expect, it } from 'vitest';
import { buildFileMenu } from '../src/renderer/src/lib/menus/fileMenu.js';
import { type ContextMenuItem, isSeparator } from '../src/renderer/src/store/contextMenu.js';

const shape = (items: readonly ContextMenuItem[]): string[] =>
  items.map((i) => (isSeparator(i) ? '|' : i.id));

const find = (items: readonly ContextMenuItem[], id: string) =>
  items.find((i) => !isSeparator(i) && i.id === id);

describe('buildFileMenu', () => {
  it('background (no target) → just New File / New Folder', () => {
    expect(shape(buildFileMenu({ newItemDir: null }))).toEqual(['new-file', 'new-folder']);
  });

  it('file target with onOpen → Open, New×2, Rename, Delete (grouped)', () => {
    const items = buildFileMenu({
      target: { path: 'a.md', kind: 'file' },
      newItemDir: null,
      onOpen: () => undefined,
    });
    expect(shape(items)).toEqual(['open', '|', 'new-file', 'new-folder', '|', 'rename', 'delete']);
  });

  it('Delete is destructive (danger)', () => {
    const items = buildFileMenu({ target: { path: 'a.md', kind: 'file' }, newItemDir: null });
    const del = find(items, 'delete');
    expect(del && !isSeparator(del) && del.danger).toBe(true);
  });

  it('target without onOpen → no Open item', () => {
    const items = buildFileMenu({ target: { path: 'docs', kind: 'folder' }, newItemDir: 'docs' });
    expect(shape(items)).toEqual(['new-file', 'new-folder', '|', 'rename', 'delete']);
  });

  it('includeCreate:false (canvas card) → no New File/Folder, just Open/Rename/Delete', () => {
    const items = buildFileMenu({
      target: { path: 'docs', kind: 'folder' },
      newItemDir: null,
      includeCreate: false,
      onOpen: () => undefined,
    });
    expect(shape(items)).toEqual(['open', '|', 'rename', 'delete']);
  });

  it('folder Open item is labelled "Open Folder"', () => {
    const items = buildFileMenu({
      target: { path: 'docs', kind: 'folder' },
      newItemDir: 'docs',
      onOpen: () => undefined,
    });
    const open = find(items, 'open');
    expect(open && !isSeparator(open) && open.label).toBe('Open Folder');
  });
});
