import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type HistoryStorage,
  LocalStorageHistoryService,
} from '../src/workbench/services/history/browser/historyService.js';

function memoryStorage(): HistoryStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe('LocalStorageHistoryService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists recent files through the injected browser storage', () => {
    const storage = memoryStorage();
    const service = new LocalStorageHistoryService(() => storage, 'test:recent-files');
    vi.spyOn(Date, 'now').mockReturnValueOnce(10).mockReturnValueOnce(20);

    service.noteOpenedFile('main', 'a.md');
    service.noteOpenedFile('main', 'b.md');

    expect(service.recentFilesFor('main')).toEqual(['b.md', 'a.md']);
  });

  it('degrades to empty recents when storage is unavailable', () => {
    const service = new LocalStorageHistoryService(() => {
      throw new Error('storage unavailable');
    }, 'test:recent-files');

    expect(() => service.noteOpenedFile('main', 'a.md')).not.toThrow();
    expect(service.recentFilesFor('main')).toEqual([]);
  });
});
