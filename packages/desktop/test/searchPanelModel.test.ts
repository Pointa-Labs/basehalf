import { describe, expect, it } from 'vitest';
import {
  SEARCH_PANEL_HISTORY_MAX_COMMITS,
  SEARCH_PANEL_MAX_FILES,
  SEARCH_PANEL_MAX_MATCHES_PER_FILE,
  buildSearchPanelContentQueryArgs,
  buildSearchPanelHighlightRegex,
  buildSearchPanelHistoryQueryArgs,
  searchPanelCanSearch,
  searchPanelFileParts,
  searchPanelHighlightSegments,
  searchPanelHintText,
  searchPanelLandingQuery,
  searchPanelOptionState,
  searchPanelStatusText,
  searchPanelTotalMatches,
} from '../src/workbench/contrib/search/common/searchPanelModel.js';
import type { SearchQueryResult } from '../src/workbench/services/search/common/search.js';

const result = (overrides: Partial<SearchQueryResult> = {}): SearchQueryResult => ({
  query: 'needle',
  hits: [
    { file: 'a.md', matches: [{ line: 1, text: 'needle here' }], total: 2 },
    { file: 'dir/b.md', matches: [{ line: 3, text: 'another needle' }], total: 1 },
  ],
  ...overrides,
});

describe('searchPanelModel', () => {
  it('guards searches on workspace and the VS Code-style minimum query length', () => {
    expect(searchPanelCanSearch(null, 'needle')).toBe(false);
    expect(searchPanelCanSearch('main', 'n')).toBe(false);
    expect(searchPanelCanSearch('main', '  ne  ')).toBe(true);
  });

  it('builds content and history provider arguments from panel state', () => {
    expect(
      buildSearchPanelContentQueryArgs('  needle  ', {
        caseSensitive: true,
        wholeWord: true,
        regex: false,
      }),
    ).toEqual({
      query: 'needle',
      maxFiles: SEARCH_PANEL_MAX_FILES,
      maxMatchesPerFile: SEARCH_PANEL_MAX_MATCHES_PER_FILE,
      caseSensitive: true,
      wholeWord: true,
      regex: false,
    });

    expect(buildSearchPanelHistoryQueryArgs('  needle  ', { caseSensitive: false })).toEqual({
      query: 'needle',
      maxCount: SEARCH_PANEL_HISTORY_MAX_COMMITS,
      ignoreCase: true,
    });
  });

  it('builds highlight regexes with literal, regex, case, and word semantics', () => {
    const literal = buildSearchPanelHighlightRegex('a.b', {
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });
    expect(searchPanelHighlightSegments('A.B a-b a.b', literal)).toEqual([
      { text: 'A.B', match: true },
      { text: ' a-b ', match: false },
      { text: 'a.b', match: true },
    ]);

    const word = buildSearchPanelHighlightRegex('cat', {
      caseSensitive: true,
      wholeWord: true,
      regex: false,
    });
    expect(searchPanelHighlightSegments('cat scatter cat', word)).toEqual([
      { text: 'cat', match: true },
      { text: ' scatter ', match: false },
      { text: 'cat', match: true },
    ]);

    expect(
      buildSearchPanelHighlightRegex('[', {
        caseSensitive: false,
        wholeWord: false,
        regex: true,
      }),
    ).toBeNull();
  });

  it('returns status and hint text without coupling it to React rendering', () => {
    expect(
      searchPanelStatusText({
        mode: 'content',
        query: 'needle',
        loading: false,
        result: result({ truncated: true }),
        history: null,
      }),
    ).toBe('3 result(s) in 2 file(s) (truncated)');
    expect(searchPanelTotalMatches(result())).toBe(3);

    expect(
      searchPanelStatusText({
        mode: 'history',
        query: 'needle',
        loading: false,
        result: null,
        history: [commit('a'), commit('b')],
      }),
    ).toBe('2 commit(s) touched “needle”');

    expect(
      searchPanelStatusText({
        mode: 'content',
        query: 'needle',
        loading: false,
        result: result({ hits: [] }),
        history: null,
      }),
    ).toBe('No results');
    expect(searchPanelHintText({ mode: 'content', query: 'n', loading: false })).toBe(
      'Type at least 2 characters to search file contents.',
    );
    expect(searchPanelHintText({ mode: 'history', query: 'needle', loading: true })).toBe(
      'Searching…',
    );
  });

  it('describes option state for content-only toggles', () => {
    expect(searchPanelOptionState('content', 'regex')).toEqual({
      title: 'Use Regular Expression',
      disabled: false,
    });
    expect(searchPanelOptionState('history', 'regex')).toEqual({
      title: 'Use Regular Expression (content search only)',
      disabled: true,
    });
    expect(searchPanelOptionState('history', 'caseSensitive')).toEqual({
      title: 'Match Case',
      disabled: false,
    });
  });

  it('keeps file-row and landing-query formatting outside the component', () => {
    expect(searchPanelFileParts('dir/note.md')).toEqual({ name: 'note.md', dir: 'dir' });
    expect(searchPanelFileParts('note.md')).toEqual({ name: 'note.md', dir: '' });
    expect(searchPanelLandingQuery('…needle here…', 'fallback')).toBe('needle here');
    expect(searchPanelLandingQuery('  ', ' fallback ')).toBe('fallback');
  });
});

function commit(subject: string) {
  return {
    hash: subject.repeat(8),
    shortHash: subject,
    parents: [],
    author: { name: 'A', email: 'a@example.com', date: '2026-01-01T00:00:00Z' },
    committer: { name: 'A', email: 'a@example.com', date: '2026-01-01T00:00:00Z' },
    subject,
    body: '',
    refs: [],
    tags: [],
    head: false,
  };
}
