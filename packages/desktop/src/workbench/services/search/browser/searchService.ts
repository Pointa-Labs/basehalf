import type { SearchQueryArgs, SearchQueryResult } from '../common/search.js';
import { type SearchChannel, searchChannel } from './searchChannel.js';

export interface SearchService {
  query(args: SearchQueryArgs): Promise<SearchQueryResult>;
}

export function createSearchService(channel: SearchChannel): SearchService {
  return {
    query: (args) => channel.query(args),
  };
}

export const searchService = createSearchService(searchChannel);
