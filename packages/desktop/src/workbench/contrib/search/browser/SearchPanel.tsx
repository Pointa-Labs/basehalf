import { type JSX, useEffect, useRef, useState } from 'react';
import { FileGlyph, badgeType } from '../../../browser/labels/FileGlyph.js';
import { useLayoutStore } from '../../../browser/layout/layoutStore.js';
import { color, font, radius, space, transition } from '../../../browser/style/design.js';
import { CountBadge } from '../../../browser/ui/primitives/CountBadge.js';
import { searchService } from '../../../services/search/browser/searchService.js';
import type { SearchQueryResult } from '../../../services/search/common/search.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import { gitScmService } from '../../scm/browser/gitScmService.js';
import { useScmViewStore } from '../../scm/browser/scmViewStore.js';
import type { GitLogResult } from '../../scm/common/git.js';

/**
 * SearchPanel — the sidebar's full-text Search view, modeled on VS Code's Search
 * results tree (grounded in searchview.css): a query box on top, then results
 * grouped by file. Each file row shows its icon + name + dimmed folder + a match
 * count badge and folds open to its matching lines, with the query substring
 * highlighted. Clicking a match opens the file and lands on the matched passage.
 *
 * Reuses the workbench search service (the same retrieval leg the
 * ⌘K palette uses); read-only — it never mutates files.
 */

const MAX_FILES = 40;
const MAX_PER_FILE = 20;
type SearchMode = 'content' | 'history';

/** Build the highlight regex matching the search backend matcher (same case/word/regex
 *  semantics), global so a snippet line can highlight EVERY match. null = the
 *  pattern is invalid / empty (renderer falls back to plain text). */
function buildHighlightRe(
  query: string,
  opts: { caseSensitive: boolean; wholeWord: boolean; regex: boolean },
): RegExp | null {
  if (query === '') return null;
  let src = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (opts.wholeWord) src = `\\b(?:${src})\\b`;
  try {
    return new RegExp(src, opts.caseSensitive ? 'g' : 'gi');
  } catch {
    return null;
  }
}

/** Split a line into highlighted/plain segments by a global regex. */
function segmentsFor(text: string, re: RegExp | null): Array<{ text: string; match: boolean }> {
  if (re === null) return [{ text, match: false }];
  const out: Array<{ text: string; match: boolean }> = [];
  let last = 0;
  re.lastIndex = 0;
  let m = re.exec(text);
  while (m !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), match: false });
    out.push({ text: m[0], match: true });
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++; // never loop forever on an empty match
    m = re.exec(text);
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false });
  return out;
}

export const SearchPanel = (): JSX.Element => {
  const current = useWorkspaceStore((s) => s.current);
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const [query, setQuery] = useState('');
  // 'content' = full-text over current files; 'history' = git pickaxe over commit
  // history ("when did I write X"), BaseHalf's retrieval-over-time leg.
  const [mode, setMode] = useState<SearchMode>('content');
  const [result, setResult] = useState<SearchQueryResult | null>(null);
  const [history, setHistory] = useState<GitLogResult['commits'] | null>(null);
  const [loadingMode, setLoadingMode] = useState<SearchMode | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus the box when the view opens.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced query (≥2 chars), workspace-guarded — same pattern as the palette.
  // One effect owns both modes so an inactive mode can never clear the active
  // mode's loading/status state after a mode switch.
  useEffect(() => {
    const q = query.trim();
    setLoadingMode(null);
    if (current === null || q.length < 2) {
      setResult(null);
      setHistory(null);
      return;
    }
    let cancelled = false;
    setLoadingMode(mode);
    if (mode === 'history') {
      setResult(null);
      const handle = window.setTimeout(() => {
        void (async () => {
          try {
            const commits = await gitScmService.searchHistory({
              query: q,
              maxCount: 100,
              ignoreCase: !caseSensitive,
            });
            if (!cancelled) setHistory(commits);
          } catch {
            if (!cancelled) setHistory([]);
          } finally {
            if (!cancelled) setLoadingMode(null);
          }
        })();
      }, 250);
      return () => {
        cancelled = true;
        window.clearTimeout(handle);
      };
    }

    setHistory(null);
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const r = await searchService.query({
            query: q,
            maxFiles: MAX_FILES,
            maxMatchesPerFile: MAX_PER_FILE,
            caseSensitive,
            wholeWord,
            regex,
          });
          if (!cancelled) {
            setResult(r);
            setCollapsed(new Set());
          }
        } catch {
          if (!cancelled) setResult(null);
        } finally {
          if (!cancelled) setLoadingMode(null);
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, mode, current, caseSensitive, wholeWord, regex]);

  const toggle = (file: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });

  const hits = result?.hits ?? [];
  const totalMatches = hits.reduce((n, h) => n + h.total, 0);
  const highlightRe = buildHighlightRe(query.trim(), { caseSensitive, wholeWord, regex });
  const loading = loadingMode === mode;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ padding: `${space[2]}px ${space[3]}px`, flexShrink: 0 }}>
        <div style={{ position: 'relative' }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search workspace"
            data-testid="search-panel-input"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              height: 26,
              background: color.bg,
              border: `1px solid ${color.border}`,
              borderRadius: radius.md,
              color: color.textPrimary,
              fontFamily: font.sans,
              fontSize: font.size.caption,
              padding: `0 64px 0 ${space[2]}px`,
              outline: 'none',
            }}
          />
          {/* VS Code's search options: match case / whole word / regex. */}
          <div
            style={{
              position: 'absolute',
              top: 3,
              right: 3,
              display: 'flex',
              gap: 1,
            }}
          >
            <OptBtn
              label="Aa"
              title="Match Case"
              active={caseSensitive}
              onClick={() => setCaseSensitive((v) => !v)}
            />
            <OptBtn
              label="ab|"
              title={
                mode === 'history' ? 'Match Whole Word (content search only)' : 'Match Whole Word'
              }
              active={wholeWord}
              disabled={mode === 'history'}
              onClick={() => setWholeWord((v) => !v)}
            />
            <OptBtn
              label=".*"
              title={
                mode === 'history'
                  ? 'Use Regular Expression (content search only)'
                  : 'Use Regular Expression'
              }
              active={regex}
              disabled={mode === 'history'}
              onClick={() => setRegex((v) => !v)}
            />
          </div>
        </div>
        {/* Content (current files) ↔ History (git pickaxe over commits). */}
        <div
          role="radiogroup"
          aria-label="Search mode"
          style={{ display: 'flex', gap: space[1], marginTop: space[2] }}
        >
          <SegBtn label="Content" active={mode === 'content'} onClick={() => setMode('content')} />
          <SegBtn
            label="Git History"
            active={mode === 'history'}
            onClick={() => setMode('history')}
          />
        </div>
        {query.trim().length >= 2 && !loading && (
          <div
            role="status"
            aria-live="polite"
            style={{
              marginTop: space[1],
              color: color.textTertiary,
              fontFamily: font.sans,
              fontSize: font.size.micro,
            }}
          >
            {mode === 'history'
              ? (history?.length ?? 0) === 0
                ? 'No matches in history'
                : `${history?.length ?? 0} commit(s) touched “${query.trim()}”`
              : hits.length === 0
                ? 'No results'
                : `${totalMatches} result(s) in ${hits.length} file(s)${result?.truncated ? ' (truncated)' : ''}`}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {query.trim().length < 2 ? (
          <Hint>
            {mode === 'history'
              ? 'Type at least 2 characters to find commits that added or removed this text.'
              : 'Type at least 2 characters to search file contents.'}
          </Hint>
        ) : loading ? (
          <Hint>Searching…</Hint>
        ) : mode === 'history' ? (
          (history ?? []).map((c) => (
            <button
              key={c.hash}
              type="button"
              title={`${c.shortHash} · View in Graph`}
              aria-label={`Show commit ${c.shortHash} in source control graph: ${c.subject}`}
              onClick={() => {
                useLayoutStore.getState().setSidebarView('scm');
                useScmViewStore.getState().revealCommit(c.hash);
              }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                width: '100%',
                padding: `${space[1]}px ${space[3]}px`,
                background: 'none',
                border: 'none',
                borderBottom: `1px solid ${color.divider}`,
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = color.divider;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'none';
              }}
            >
              <span
                style={{
                  color: color.textPrimary,
                  fontFamily: font.sans,
                  fontSize: font.size.caption,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  width: '100%',
                }}
              >
                {c.subject}
              </span>
              <span
                style={{
                  color: color.textTertiary,
                  fontFamily: font.mono,
                  fontSize: font.size.micro,
                }}
              >
                {c.shortHash} · {c.author.name} · {c.author.date.slice(0, 10)}
              </span>
            </button>
          ))
        ) : (
          hits.map((hit) => {
            const slash = hit.file.lastIndexOf('/');
            const name = slash === -1 ? hit.file : hit.file.slice(slash + 1);
            const dir = slash === -1 ? '' : hit.file.slice(0, slash);
            const open = !collapsed.has(hit.file);
            return (
              <div key={hit.file}>
                <button
                  type="button"
                  onClick={() => toggle(hit.file)}
                  aria-expanded={open}
                  aria-label={`${open ? 'Collapse' : 'Expand'} ${hit.file}, ${hit.total} ${
                    hit.total === 1 ? 'match' : 'matches'
                  }`}
                  title={hit.file}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: space[1],
                    width: '100%',
                    height: 22,
                    padding: `0 ${space[2]}px`,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: color.textPrimary,
                    fontFamily: font.sans,
                    fontSize: font.size.caption,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 12,
                      flexShrink: 0,
                      transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
                      transition: transition(['transform']),
                      color: color.textTertiary,
                    }}
                  >
                    ▸
                  </span>
                  <FileGlyph type={badgeType(name, false)} tone={color.textTertiary} size={13} />
                  <span style={{ flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {name}
                  </span>
                  {dir !== '' && (
                    <span
                      style={{
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: color.textGhost,
                        fontSize: font.size.micro,
                      }}
                    >
                      {dir}
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
                    <CountBadge count={hit.total} />
                  </span>
                </button>
                {open &&
                  hit.matches.map((m) => (
                    <button
                      key={`${hit.file}:${m.line}`}
                      type="button"
                      onClick={() => {
                        const landingQuery = m.text.replace(/^…|…$/g, '').trim() || query.trim();
                        openInPanel(hit.file, { pinned: true, matchQuery: landingQuery });
                      }}
                      aria-label={`Open ${hit.file} from search result on line ${m.line}`}
                      title={`${hit.file}:${m.line}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: space[2],
                        width: '100%',
                        height: 22,
                        padding: `0 ${space[2]}px 0 ${space[4]}px`,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                        color: color.textSecondary,
                        fontFamily: font.mono,
                        fontSize: font.size.micro,
                        overflow: 'hidden',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = color.divider;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'none';
                      }}
                    >
                      <span style={{ color: color.textGhost, flexShrink: 0, minWidth: 22 }}>
                        {m.line}
                      </span>
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'pre',
                        }}
                      >
                        {(() => {
                          // Key by each segment's char offset (stable + unique),
                          // not the array index.
                          let off = 0;
                          return segmentsFor(m.text, highlightRe).map((seg) => {
                            const key = off;
                            off += seg.text.length;
                            return seg.match ? (
                              <mark
                                key={key}
                                style={{
                                  background: `${color.warning}55`,
                                  color: color.textPrimary,
                                  borderRadius: 2,
                                }}
                              >
                                {seg.text}
                              </mark>
                            ) : (
                              <span key={key}>{seg.text}</span>
                            );
                          });
                        })()}
                      </span>
                    </button>
                  ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

const OptBtn = ({
  label,
  title,
  active,
  disabled = false,
  onClick,
}: {
  label: string;
  title: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element => (
  <button
    type="button"
    title={title}
    aria-label={title}
    aria-pressed={active}
    disabled={disabled}
    onClick={onClick}
    style={{
      width: 20,
      height: 20,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: active ? color.accentSofter : 'none',
      border: `1px solid ${active ? color.accent : 'transparent'}`,
      borderRadius: radius.sm,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      color: active ? color.accent : color.textTertiary,
      fontFamily: font.mono,
      fontSize: 10,
      lineHeight: 1,
    }}
  >
    {label}
  </button>
);

const SegBtn = ({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element => (
  <button
    type="button"
    role="radio"
    aria-checked={active}
    onClick={onClick}
    style={{
      flex: 1,
      height: 22,
      background: active ? color.accentSofter : 'none',
      border: `1px solid ${active ? color.accent : color.border}`,
      borderRadius: radius.sm,
      cursor: 'pointer',
      color: active ? color.accent : color.textTertiary,
      fontFamily: font.sans,
      fontSize: font.size.micro,
    }}
  >
    {label}
  </button>
);

const Hint = ({ children }: { children: string }): JSX.Element => (
  <div
    style={{
      padding: `${space[4]}px ${space[4]}px`,
      color: color.textTertiary,
      fontFamily: font.sans,
      fontSize: font.size.caption,
      lineHeight: 1.5,
    }}
  >
    {children}
  </div>
);
