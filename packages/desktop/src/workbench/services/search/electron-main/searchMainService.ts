import type {
  SearchBriefArgs,
  SearchBriefResult,
  SearchQueryArgs,
  SearchQueryResult,
} from '../common/search.js';
import type { SearchBackendProvider } from './searchBackendProvider.js';

/**
 * Main-process search service consumed by explicit Search IPC channels. Search
 * execution is injected as a backend provider so the service boundary stays
 * explicit and testable.
 */
export class SearchMainService {
  constructor(private readonly backend: SearchBackendProvider) {}

  query(workspaceRoot: string | null, args: SearchQueryArgs): Promise<SearchQueryResult> {
    return this.backend.query(workspaceRoot, args);
  }

  brief(workspaceRoot: string | null, args: SearchBriefArgs): Promise<SearchBriefResult> {
    return this.backend.brief(workspaceRoot, args);
  }
}
