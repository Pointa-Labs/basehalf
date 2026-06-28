import { describe, expect, it } from 'vitest';
import type { SearchChannel } from '../src/workbench/services/search/browser/searchChannel.js';
import { createSearchService } from '../src/workbench/services/search/browser/searchService.js';

describe('searchService', () => {
  it('maps content search to the search channel', async () => {
    const calls: unknown[] = [];
    const channel: SearchChannel = {
      query: async (args) => {
        calls.push(args);
        return { query: 'needle', hits: [{ file: 'a.md', matches: [], total: 1 }] };
      },
      brief: async () => ({ query: 'needle', brief: '', files: [] }),
    };
    const service = createSearchService(channel);

    await expect(
      service.query({
        query: 'needle',
        maxFiles: 10,
        maxMatchesPerFile: 2,
        caseSensitive: true,
        wholeWord: true,
        regex: false,
      }),
    ).resolves.toMatchObject({ query: 'needle', hits: [{ file: 'a.md' }] });

    expect(calls).toEqual([
      {
        query: 'needle',
        maxFiles: 10,
        maxMatchesPerFile: 2,
        caseSensitive: true,
        wholeWord: true,
        regex: false,
      },
    ]);
  });
});
