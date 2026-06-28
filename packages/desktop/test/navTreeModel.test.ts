import { describe, expect, it } from 'vitest';
import {
  isAgentHintFile,
  isVisibleNavEntry,
  joinNavPath,
  navTreeKeyboardIntent,
  newItemDirForEntry,
  parentAbsPath,
  parentRelPath,
  relativeToNavRoot,
  renameTargetForBasename,
  sortNavEntries,
} from '../src/workbench/contrib/files/browser/navTreeModel.js';

describe('navTreeModel', () => {
  it('filters only the default hidden workspace entries', () => {
    expect(isVisibleNavEntry({ name: '.bh', type: 'dir' })).toBe(false);
    expect(isVisibleNavEntry({ name: 'node_modules', type: 'dir' })).toBe(false);
    expect(isVisibleNavEntry({ name: '.env', type: 'file' })).toBe(true);
    expect(isVisibleNavEntry({ name: 'src', type: 'dir' })).toBe(true);
  });

  it('sorts folders before files by name', () => {
    expect(
      sortNavEntries([
        { name: 'z.md', type: 'file' },
        { name: 'src', type: 'dir' },
        { name: 'README.md', type: 'file' },
        { name: 'docs', type: 'dir' },
      ]).map((e) => e.name),
    ).toEqual(['docs', 'src', 'README.md', 'z.md']);
  });

  it('maps absolute tree paths to workspace-relative paths', () => {
    expect(joinNavPath('/repo', 'src')).toBe('/repo/src');
    expect(joinNavPath('/repo/', 'src')).toBe('/repo/src');
    expect(relativeToNavRoot('/repo', '/repo/src/a.md')).toBe('src/a.md');
    expect(relativeToNavRoot('/repo/', '/repo/src/a.md')).toBe('src/a.md');
    expect(parentRelPath('src/a.md')).toBe('src');
    expect(parentAbsPath('/repo', 'src/a.md')).toBe('/repo/src');
    expect(parentAbsPath('/repo', 'README.md')).toBe('/repo');
  });

  it('recognizes root-level agent hint files', () => {
    expect(isAgentHintFile(0, { name: 'AGENTS.md', type: 'file' })).toBe(true);
    expect(isAgentHintFile(0, { name: 'CLAUDE.md', type: 'file' })).toBe(true);
    expect(isAgentHintFile(1, { name: 'AGENTS.md', type: 'file' })).toBe(false);
    expect(isAgentHintFile(0, { name: 'AGENTS.md', type: 'dir' })).toBe(false);
  });

  it('keeps inline rename basename-only and computes create targets', () => {
    expect(renameTargetForBasename('src/a.md', 'b.md')).toBe('src/b.md');
    expect(renameTargetForBasename('a.md', 'b.md')).toBe('b.md');
    expect(renameTargetForBasename('src/a.md', 'nested/b.md')).toBe(null);
    expect(renameTargetForBasename('src/a.md', 'nested\\b.md')).toBe(null);
    expect(renameTargetForBasename('src/a.md', '   ')).toBe(null);
    expect(renameTargetForBasename('src/a.md', '.')).toBe(null);
    expect(renameTargetForBasename('src/a.md', '..')).toBe(null);
    expect(renameTargetForBasename('src/a.md', ' b.md ')).toBe('src/b.md');

    expect(newItemDirForEntry({ rel: 'docs', parentRel: '', isDir: true })).toBe('docs');
    expect(newItemDirForEntry({ rel: 'docs/a.md', parentRel: 'docs', isDir: false })).toBe('docs');
    expect(newItemDirForEntry({ rel: 'README.md', parentRel: '', isDir: false })).toBe(null);
  });

  it('maps visible-tree keyboard input to VS Code-style focus and file intents', () => {
    const items = [
      { rel: 'docs', kind: 'folder' as const, depth: 0, isExpanded: true },
      { rel: 'docs/a.md', kind: 'file' as const, depth: 1, isExpanded: false },
      { rel: 'src', kind: 'folder' as const, depth: 0, isExpanded: false },
      { rel: 'README.md', kind: 'file' as const, depth: 0, isExpanded: false },
    ];

    expect(navTreeKeyboardIntent(items, 'docs', { key: 'ArrowDown' })).toEqual({
      type: 'focus',
      rel: 'docs/a.md',
    });
    expect(navTreeKeyboardIntent(items, 'docs/a.md', { key: 'ArrowUp' })).toEqual({
      type: 'focus',
      rel: 'docs',
    });
    expect(navTreeKeyboardIntent(items, 'docs/a.md', { key: 'Home' })).toEqual({
      type: 'focus',
      rel: 'docs',
    });
    expect(navTreeKeyboardIntent(items, 'docs', { key: 'End' })).toEqual({
      type: 'focus',
      rel: 'README.md',
    });
    expect(navTreeKeyboardIntent(items, 'src', { key: 'ArrowRight' })).toEqual({
      type: 'expand',
    });
    expect(navTreeKeyboardIntent(items, 'docs', { key: 'ArrowRight' })).toEqual({
      type: 'focus',
      rel: 'docs/a.md',
    });
    expect(navTreeKeyboardIntent(items, 'docs', { key: 'ArrowLeft' })).toEqual({
      type: 'collapse',
    });
    expect(navTreeKeyboardIntent(items, 'docs/a.md', { key: 'ArrowLeft' })).toEqual({
      type: 'focus',
      rel: 'docs',
    });
    expect(navTreeKeyboardIntent(items, 'README.md', { key: 'Enter', isMac: false })).toEqual({
      type: 'open',
    });
    expect(navTreeKeyboardIntent(items, 'README.md', { key: 'Enter', isMac: true })).toEqual({
      type: 'rename',
    });
    expect(navTreeKeyboardIntent(items, 'README.md', { key: ' ' })).toEqual({
      type: 'open',
    });
    expect(navTreeKeyboardIntent(items, 'README.md', { key: 'F2' })).toEqual({
      type: 'rename',
    });
    expect(navTreeKeyboardIntent(items, 'README.md', { key: 'Delete' })).toEqual({
      type: 'delete',
    });
    expect(navTreeKeyboardIntent(items, 'README.md', { key: 'Backspace', metaKey: true })).toEqual({
      type: 'delete',
    });
    expect(navTreeKeyboardIntent(items, 'README.md', { key: 'F10', shiftKey: true })).toEqual({
      type: 'contextMenu',
    });
  });
});
