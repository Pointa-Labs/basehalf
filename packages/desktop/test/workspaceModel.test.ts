import { describe, expect, it } from 'vitest';
import {
  closeEditorOverlayPatch,
  isOpenFileDeletedByEntry,
  openEditorOverlayPatch,
  parentFolderScopeAfterDelete,
  rebaseFolderScopeForRename,
  rebindCanvasSelectionForRename,
  rebindOpenFileForEntryRename,
  rebindOpenFileForRename,
  toggleCanvasEditingCard,
  workspaceRefreshPatch,
} from '../src/workbench/services/workspace/browser/workspaceModel.js';

describe('workspaceModel', () => {
  it('builds editor overlay open and close patches', () => {
    expect(openEditorOverlayPatch('a.md')).toEqual({
      openFile: 'a.md',
      currentFile: 'a.md',
      openMatchQuery: null,
    });
    expect(openEditorOverlayPatch('a.md', { matchQuery: 'needle' }).openMatchQuery).toBe('needle');
    expect(closeEditorOverlayPatch()).toEqual({
      openFile: null,
      currentFile: null,
      openMatchQuery: null,
    });
  });

  it('preserves the live surface when a workspace rename keeps the same path', () => {
    const patch = workspaceRefreshPatch(
      { current: 'Old', workspaces: [{ name: 'Old', path: '/repo', addedAt: 1 }] },
      { current: 'New', workspaces: [{ name: 'New', path: '/repo', addedAt: 1 }] },
    );
    expect(patch).toMatchObject({ current: 'New', workspaces: [{ name: 'New' }] });
    expect(patch.openFile).toBeUndefined();
    expect(patch.folderScope).toBeUndefined();
  });

  it('resets editor and canvas state when the current workspace path changes', () => {
    const patch = workspaceRefreshPatch(
      { current: 'Old', workspaces: [{ name: 'Old', path: '/old', addedAt: 1 }] },
      { current: 'New', workspaces: [{ name: 'New', path: '/new', addedAt: 1 }] },
    );
    expect(patch.openFile).toBe(null);
    expect(patch.currentFile).toBe(null);
    expect(patch.folderScope).toBe(null);
    expect(patch.canvasSelection).toBe(null);
  });

  it('rebinds editor and canvas selections after renames', () => {
    expect(rebindOpenFileForRename('src/a.md', 'src/a.md', 'src/b.md')).toBe('src/b.md');
    expect(rebindOpenFileForRename('src/other.md', 'src/a.md', 'src/b.md')).toBe('src/other.md');

    expect(
      rebindCanvasSelectionForRename(
        { kind: 'file', files: ['src/a.md', 'src/other.md'], source: 'canvas' },
        'src/a.md',
        'src/b.md',
      ),
    ).toEqual({ kind: 'file', files: ['src/b.md', 'src/other.md'], source: 'canvas' });

    expect(
      rebindCanvasSelectionForRename(
        { kind: 'folder', folder: 'docs', source: 'canvas' },
        'docs',
        'notes',
      ),
    ).toEqual({ kind: 'folder', folder: 'notes', source: 'canvas' });
  });

  it('rebinds open files and folder scopes for entry-level folder renames', () => {
    expect(rebindOpenFileForEntryRename('docs/a.md', 'docs', 'notes', 'folder')).toBe('notes/a.md');
    expect(rebindOpenFileForEntryRename('docs.md', 'docs', 'notes', 'folder')).toBe(null);
    expect(rebindOpenFileForEntryRename('docs/a.md', 'docs/a.md', 'docs/b.md', 'file')).toBe(
      'docs/b.md',
    );

    expect(rebaseFolderScopeForRename('docs/deep', 'docs', 'notes', 'folder')).toBe('notes/deep');
    expect(rebaseFolderScopeForRename('other', 'docs', 'notes', 'folder')).toBe('other');
    expect(rebaseFolderScopeForRename('docs', 'docs', 'notes', 'file')).toBe('docs');
  });

  it('updates edit sets and delete fallout without churning no-op state', () => {
    const empty = new Set<string>();
    expect(toggleCanvasEditingCard(empty, 'a.md', false)).toBe(null);
    const editing = toggleCanvasEditingCard(empty, 'a.md', true);
    expect(editing?.has('a.md')).toBe(true);
    expect(toggleCanvasEditingCard(editing ?? empty, 'a.md', true)).toBe(null);

    expect(isOpenFileDeletedByEntry('docs/a.md', 'docs', 'folder')).toBe(true);
    expect(isOpenFileDeletedByEntry('docs.md', 'docs', 'folder')).toBe(false);
    expect(parentFolderScopeAfterDelete('docs/deep', 'docs', 'folder')).toBe(null);
    expect(parentFolderScopeAfterDelete('src/docs/deep', 'src/docs', 'folder')).toBe('src');
    expect(parentFolderScopeAfterDelete('elsewhere', 'src/docs', 'folder')).toBeUndefined();
  });
});
