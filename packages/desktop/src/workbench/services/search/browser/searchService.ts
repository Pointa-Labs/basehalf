import type { SearchService as SearchServiceContract } from '../common/search.js';
import { type SearchChannel, searchChannel } from './searchChannel.js';

export type { SearchService } from '../common/search.js';

export function createSearchService(channel: SearchChannel): SearchServiceContract {
  return {
    query: (args) => channel.query(args),
  };
}

export const searchService = createSearchService(searchChannel);
