import type { SearchQueryArgs, SearchQueryResult } from '../../../services/search/common/search.js';
import type { GitLogResult, GitSearchHistoryArgs } from '../../scm/common/git.js';

export type SearchMode = 'content' | 'history';

export const SEARCH_PANEL_MIN_QUERY_LENGTH = 2;
export const SEARCH_PANEL_CONTENT_DEBOUNCE_MS = 200;
export const SEARCH_PANEL_HISTORY_DEBOUNCE_MS = 250;
export const SEARCH_PANEL_MAX_FILES = 40;
export const SEARCH_PANEL_MAX_MATCHES_PER_FILE = 20;
export const SEARCH_PANEL_HISTORY_MAX_COMMITS = 100;

export interface SearchPanelOptions {
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly regex: boolean;
}

export interface SearchPanelMatchSegment {
  readonly text: string;
  readonly match: boolean;
}

export interface SearchPanelFileParts {
  readonly name: string;
  readonly dir: string;
}

export type SearchPanelOptionId = 'caseSensitive' | 'wholeWord' | 'regex';

export interface SearchPanelOptionState {
  readonly title: string;
  readonly disabled: boolean;
}

export function searchPanelQueryText(query: string): string {
  return query.trim();
}

export function searchPanelCanSearch(current: string | null, query: string): boolean {
  return current !== null && searchPanelQueryText(query).length >= SEARCH_PANEL_MIN_QUERY_LENGTH;
}

export function buildSearchPanelContentQueryArgs(
  query: string,
  options: SearchPanelOptions,
): SearchQueryArgs {
  return {
    query: searchPanelQueryText(query),
    maxFiles: SEARCH_PANEL_MAX_FILES,
    maxMatchesPerFile: SEARCH_PANEL_MAX_MATCHES_PER_FILE,
    caseSensitive: options.caseSensitive,
    wholeWord: options.wholeWord,
    regex: options.regex,
  };
}

export function buildSearchPanelHistoryQueryArgs(
  query: string,
  options: Pick<SearchPanelOptions, 'caseSensitive'>,
): GitSearchHistoryArgs {
  return {
    query: searchPanelQueryText(query),
    maxCount: SEARCH_PANEL_HISTORY_MAX_COMMITS,
    ignoreCase: !options.caseSensitive,
  };
}

export function buildSearchPanelHighlightRegex(
  query: string,
  options: SearchPanelOptions,
): RegExp | null {
  const q = searchPanelQueryText(query);
  if (q === '') return null;

  let source = options.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (options.wholeWord) source = `\\b(?:${source})\\b`;
  try {
    return new RegExp(source, options.caseSensitive ? 'g' : 'gi');
  } catch {
    return null;
  }
}

export function searchPanelHighlightSegments(
  text: string,
  regex: RegExp | null,
): SearchPanelMatchSegment[] {
  if (regex === null) return [{ text, match: false }];

  const out: SearchPanelMatchSegment[] = [];
  let last = 0;
  regex.lastIndex = 0;
  let match = regex.exec(text);
  while (match !== null) {
    if (match.index > last) out.push({ text: text.slice(last, match.index), match: false });
    out.push({ text: match[0], match: true });
    last = match.index + match[0].length;
    if (match[0].length === 0) regex.lastIndex++;
    match = regex.exec(text);
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false });
  return out;
}

export function searchPanelTotalMatches(result: SearchQueryResult | null): number {
  return result?.hits.reduce((count, hit) => count + hit.total, 0) ?? 0;
}

export function searchPanelStatusText(args: {
  readonly mode: SearchMode;
  readonly query: string;
  readonly loading: boolean;
  readonly result: SearchQueryResult | null;
  readonly history: GitLogResult['commits'] | null;
}): string | null {
  const q = searchPanelQueryText(args.query);
  if (q.length < SEARCH_PANEL_MIN_QUERY_LENGTH || args.loading) return null;

  if (args.mode === 'history') {
    const count = args.history?.length ?? 0;
    return count === 0 ? 'No matches in history' : `${count} commit(s) touched “${q}”`;
  }

  const hits = args.result?.hits ?? [];
  if (hits.length === 0) return 'No results';
  return `${searchPanelTotalMatches(args.result)} result(s) in ${hits.length} file(s)${
    args.result?.truncated ? ' (truncated)' : ''
  }`;
}

export function searchPanelHintText(args: {
  readonly mode: SearchMode;
  readonly query: string;
  readonly loading: boolean;
}): string | null {
  if (searchPanelQueryText(args.query).length < SEARCH_PANEL_MIN_QUERY_LENGTH) {
    return args.mode === 'history'
      ? 'Type at least 2 characters to find commits that added or removed this text.'
      : 'Type at least 2 characters to search file contents.';
  }
  return args.loading ? 'Searching…' : null;
}

export function searchPanelOptionState(
  mode: SearchMode,
  option: SearchPanelOptionId,
): SearchPanelOptionState {
  if (option === 'caseSensitive') return { title: 'Match Case', disabled: false };
  if (option === 'wholeWord') {
    return {
      title: mode === 'history' ? 'Match Whole Word (content search only)' : 'Match Whole Word',
      disabled: mode === 'history',
    };
  }
  return {
    title:
      mode === 'history'
        ? 'Use Regular Expression (content search only)'
        : 'Use Regular Expression',
    disabled: mode === 'history',
  };
}

export function searchPanelFileParts(file: string): SearchPanelFileParts {
  const slash = file.lastIndexOf('/');
  return {
    name: slash === -1 ? file : file.slice(slash + 1),
    dir: slash === -1 ? '' : file.slice(0, slash),
  };
}

export function searchPanelLandingQuery(matchText: string, query: string): string {
  return matchText.replace(/^…|…$/g, '').trim() || searchPanelQueryText(query);
}
