import { describe, expect, it } from 'vitest';
import {
  noteRecentFileOpened,
  parseRecentFilesMap,
  recentFilesForWorkspace,
  serializeRecentFilesMap,
  trimRecentFiles,
} from '../src/workbench/services/history/common/recentFilesModel.js';

describe('recentFilesModel', () => {
  it('records workspace-scoped files most-recent-first without mutating the input map', () => {
    const initial = { main: { 'a.md': 10 } };
    const next = noteRecentFileOpened(initial, 'main', 'b.md', 20);

    expect(initial).toEqual({ main: { 'a.md': 10 } });
    expect(next).toEqual({ main: { 'a.md': 10, 'b.md': 20 } });
    expect(recentFilesForWorkspace(next, 'main')).toEqual(['b.md', 'a.md']);
    expect(recentFilesForWorkspace(next, 'other')).toEqual([]);
  });

  it('moves reopened files to the front and trims old entries', () => {
    const map = noteRecentFileOpened(
      { main: { 'a.md': 10, 'b.md': 20, 'c.md': 30 } },
      'main',
      'a.md',
      40,
    );

    expect(recentFilesForWorkspace(map, 'main')).toEqual(['a.md', 'c.md', 'b.md']);
    expect(trimRecentFiles({ 'a.md': 10, 'b.md': 20, 'c.md': 30 }, 2)).toEqual({
      'c.md': 30,
      'b.md': 20,
    });
  });

  it('normalizes persisted storage into the typed recent-files map', () => {
    expect(parseRecentFilesMap(null)).toEqual({});
    expect(parseRecentFilesMap('not-json')).toEqual({});
    expect(
      parseRecentFilesMap(
        JSON.stringify({
          main: { 'a.md': 10, 'bad.md': 'later' },
          empty: {},
          invalid: [],
        }),
      ),
    ).toEqual({ main: { 'a.md': 10 } });
  });

  it('serializes the storage shape without adding browser dependencies', () => {
    expect(serializeRecentFilesMap({ main: { 'a.md': 10 } })).toBe('{"main":{"a.md":10}}');
  });
});
