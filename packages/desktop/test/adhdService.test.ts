import { describe, expect, it } from 'vitest';
import type { AdhdChannel } from '../src/workbench/services/mirror/browser/adhdChannel.js';
import { createAdhdService } from '../src/workbench/services/mirror/browser/adhdService.js';

describe('adhdService', () => {
  it('maps reading-aid operations to the ADHD channel', async () => {
    const calls: Array<{ name: string; args?: unknown }> = [];
    const state = { path: 'a.md', kind: 'file' as const, highlight_keywords: ['term'] };
    const channel: AdhdChannel = {
      get: async (file) => {
        calls.push({ name: 'get', args: file });
        return state;
      },
      set: async (args) => {
        calls.push({ name: 'set', args });
        return state;
      },
      addKeyword: async (args) => {
        calls.push({ name: 'addKeyword', args });
        return state;
      },
      removeKeyword: async (args) => {
        calls.push({ name: 'removeKeyword', args });
        return null;
      },
      markRead: async (args) => {
        calls.push({ name: 'markRead', args });
        return state;
      },
      markUnread: async (args) => {
        calls.push({ name: 'markUnread', args });
        return null;
      },
      revision: async () => ({ count: 0, maxMtimeMs: 0 }),
      relocate: async () => ({ moved: 0 }),
      purgeNode: async () => ({ removed: 0 }),
    };
    const service = createAdhdService(channel);

    expect(await service.get('a.md')).toEqual(state);
    expect(await service.addKeyword('a.md', 'term')).toEqual(state);
    expect(await service.removeKeyword('a.md', 'term')).toBeNull();
    expect(await service.markRead('a.md', { start: 1, end: 3 })).toEqual(state);
    expect(await service.markUnread('a.md', { start: 2, end: 2 })).toBeNull();
    expect(
      await service.set('a.md', { highlight_keywords: ['x'], read_paragraphs: [[1, 2]] }),
    ).toEqual(state);

    expect(calls).toEqual([
      { name: 'get', args: 'a.md' },
      { name: 'addKeyword', args: { file: 'a.md', keyword: 'term' } },
      { name: 'removeKeyword', args: { file: 'a.md', keyword: 'term' } },
      { name: 'markRead', args: { file: 'a.md', start: 1, end: 3 } },
      { name: 'markUnread', args: { file: 'a.md', start: 2, end: 2 } },
      {
        name: 'set',
        args: { file: 'a.md', highlight_keywords: ['x'], read_paragraphs: [[1, 2]] },
      },
    ]);
  });
});
