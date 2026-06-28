export interface SearchQueryArgs {
  readonly query: string;
  readonly maxFiles?: number;
  readonly maxMatchesPerFile?: number;
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
  readonly regex?: boolean;
}

export interface SearchMatch {
  readonly line: number;
  readonly text: string;
}

export interface SearchHit {
  readonly file: string;
  readonly matches: readonly SearchMatch[];
  readonly total: number;
  readonly truncated?: boolean;
}

export interface SearchQueryResult {
  readonly query: string;
  readonly hits: readonly SearchHit[];
  readonly truncated?: boolean;
}

export interface SearchBriefArgs {
  readonly query: string;
  readonly maxFiles?: number;
  readonly maxMatchesPerFile?: number;
}

export interface SearchBriefResult {
  readonly query: string;
  readonly brief: string;
  readonly files: readonly string[];
  readonly truncated?: boolean;
}

export const SEARCH_IPC_CHANNELS = {
  query: 'search:query',
  brief: 'search:brief',
} as const;

export type SearchIpcChannel = (typeof SEARCH_IPC_CHANNELS)[keyof typeof SEARCH_IPC_CHANNELS];

export interface SearchChannelBridge {
  query(args: SearchQueryArgs): Promise<SearchQueryResult>;
  brief(args: SearchBriefArgs): Promise<SearchBriefResult>;
}

export interface SearchService {
  query(args: SearchQueryArgs): Promise<SearchQueryResult>;
}

export interface SearchBridge {
  readonly search: SearchChannelBridge;
}

export function asSearchQueryArgs(raw: unknown): SearchQueryArgs {
  if (typeof raw !== 'object' || raw === null) return { query: '' };
  const value = raw as Record<string, unknown>;
  return {
    query: typeof value.query === 'string' ? value.query : '',
    ...(typeof value.maxFiles === 'number' && { maxFiles: value.maxFiles }),
    ...(typeof value.maxMatchesPerFile === 'number' && {
      maxMatchesPerFile: value.maxMatchesPerFile,
    }),
    ...(typeof value.caseSensitive === 'boolean' && { caseSensitive: value.caseSensitive }),
    ...(typeof value.wholeWord === 'boolean' && { wholeWord: value.wholeWord }),
    ...(typeof value.regex === 'boolean' && { regex: value.regex }),
  };
}

export function asSearchBriefArgs(raw: unknown): SearchBriefArgs {
  if (typeof raw !== 'object' || raw === null) return { query: '' };
  const value = raw as Record<string, unknown>;
  return {
    query: typeof value.query === 'string' ? value.query : '',
    ...(typeof value.maxFiles === 'number' && { maxFiles: value.maxFiles }),
    ...(typeof value.maxMatchesPerFile === 'number' && {
      maxMatchesPerFile: value.maxMatchesPerFile,
    }),
  };
}
