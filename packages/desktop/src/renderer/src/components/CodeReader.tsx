import {
  type CSSProperties,
  type JSX,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { color, font, radius, space } from '../design.js';
import { type LineRange, readLineCount, readLineFlags, segmentLine } from '../lib/adhd.js';
import { isImeComposing } from '../lib/imeGuard.js';
import { useWorkspaceStore } from '../store/workspace.js';

/**
 * The read-only code/text reader with ADHD reading aids layered on (per
 * private-docs/focus_mode_spec): keyword highlighting + read/unread line state,
 * backed by the core `adhd` module's `adhd.yaml`. This is the line-numbered viewer
 * where the spec's line-range model maps exactly — the BlockNote Markdown editor
 * has no source-line mapping, so adhd styling lives here, not on .md.
 *
 * Owns its own scroll container so it can also live-sync the first visible line
 * into focus.yaml (visible_lines.start) — the same field-scoped focus.set the
 * canvas/editor use, guarded so a debounced late fire can't repoint a closed file.
 */

interface AdhdState {
  readonly highlight_keywords?: readonly string[];
  readonly read_paragraphs?: readonly LineRange[];
}

const TEXT_VIEW_CAP = 200_000;
const LINE_HEIGHT = 1.6;
const VISIBLE_DEBOUNCE = 400;

function normalizeLines(text: string): string[] {
  const body = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  return body === '' ? [''] : body.split('\n');
}

export const CodeReader = ({
  file,
  text,
  truncated,
}: { file: string; text: string; truncated: boolean }): JSX.Element => {
  const lines = useMemo(() => normalizeLines(text), [text]);
  const lineCount = lines.length;

  const [adhd, setAdhd] = useState<AdhdState>({});
  const [draftKw, setDraftKw] = useState('');
  // Shift-click range anchor on the gutter.
  const anchorRef = useRef<number | null>(null);

  // Load adhd.yaml for this file (re-load on file change). An agent editing
  // .bh/mirror/<file>/adhd.yaml directly isn't polled here (v1) — reopening the
  // file re-reads it.
  useEffect(() => {
    let cancelled = false;
    setAdhd({});
    void (async () => {
      try {
        const res = (await window.bh.run('adhd.get', { file })) as AdhdState | null;
        if (!cancelled) setAdhd(res ?? {});
      } catch {
        if (!cancelled) setAdhd({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const keywords = useMemo(() => adhd.highlight_keywords ?? [], [adhd]);
  const ranges = useMemo(() => adhd.read_paragraphs ?? [], [adhd]);
  const flags = useMemo(() => readLineFlags(ranges, lineCount), [ranges, lineCount]);
  const readCount = useMemo(() => readLineCount(ranges, lineCount), [ranges, lineCount]);

  // Every adhd command returns the new adhd state (or null when it prunes empty) —
  // apply it directly so the view reflects the edit without a re-fetch.
  const apply = useCallback(
    async (command: string, args: Record<string, unknown>) => {
      try {
        const res = (await window.bh.run(command, { file, ...args })) as AdhdState | null;
        setAdhd(res ?? {});
      } catch {
        /* best-effort — leave the UI as-is on a failed write */
      }
    },
    [file],
  );

  const addKeyword = useCallback(() => {
    const kw = draftKw.trim();
    if (kw === '') return;
    setDraftKw('');
    void apply('adhd.addKeyword', { keyword: kw });
  }, [draftKw, apply]);

  const removeKeyword = useCallback(
    (kw: string) => void apply('adhd.removeKeyword', { keyword: kw }),
    [apply],
  );

  const onGutterClick = useCallback(
    (ln: number, shiftKey: boolean) => {
      const anchor = anchorRef.current;
      if (shiftKey && anchor !== null) {
        const [s, e] = anchor <= ln ? [anchor, ln] : [ln, anchor];
        void apply('adhd.markRead', { start: s, end: e });
        return;
      }
      anchorRef.current = ln;
      void apply(flags[ln - 1] ? 'adhd.markUnread' : 'adhd.markRead', { start: ln, end: ln });
    },
    [apply, flags],
  );

  const markAll = useCallback(
    () => void apply('adhd.markRead', { start: 1, end: lineCount }),
    [apply, lineCount],
  );
  const clearRead = useCallback(
    () => void apply('adhd.markUnread', { start: 1, end: lineCount }),
    [apply, lineCount],
  );

  // ── Live-sync the first visible line into focus.yaml ───────────────────────
  const pushVisibleLine = useMemo(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fn = (start: number): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const st = useWorkspaceStore.getState();
        if (st.openFile !== file || !st.current) return;
        void window.bh
          .run('focus.set', {
            path: file,
            kind: 'file',
            visible_lines: { start },
            workspace: st.current,
          })
          .catch(() => undefined);
      }, VISIBLE_DEBOUNCE);
    };
    fn.cancel = (): void => {
      if (timer) clearTimeout(timer);
    };
    return fn;
  }, [file]);
  useEffect(() => () => pushVisibleLine.cancel(), [pushVisibleLine]);

  const onScroll = useCallback(
    (el: HTMLDivElement) => {
      const lineHeightPx = font.size.caption * LINE_HEIGHT;
      const first = Math.max(1, Math.floor((el.scrollTop - space[4]) / lineHeightPx) + 1);
      pushVisibleLine(first);
    },
    [pushVisibleLine],
  );

  const lineStyle: CSSProperties = {
    fontFamily: font.mono,
    fontSize: font.size.caption,
    lineHeight: LINE_HEIGHT,
    whiteSpace: 'pre',
    tabSize: 2,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* ADHD reading-aids toolbar — keyword chips + read progress. Outside the
          scroll container so the visible-line math below stays a clean
          (scrollTop − padding) / lineHeight. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: space[2],
          padding: `${space[2]}px ${space[4]}px`,
          borderBottom: `1px solid ${color.divider}`,
          background: color.surfaceMuted,
          flexShrink: 0,
          fontFamily: font.sans,
          fontSize: font.size.caption,
        }}
      >
        <span style={{ color: color.textTertiary }}>Highlight</span>
        {keywords.map((kw) => (
          <span
            key={kw}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: space[1],
              padding: `2px ${space[2]}px`,
              borderRadius: radius.sm,
              background: color.warningSoft,
              color: color.warning,
            }}
          >
            {kw}
            <button
              type="button"
              aria-label={`Remove keyword ${kw}`}
              onClick={() => removeKeyword(kw)}
              style={{
                border: 'none',
                background: 'transparent',
                color: color.warning,
                cursor: 'pointer',
                padding: 0,
                lineHeight: 1,
                fontSize: font.size.caption,
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draftKw}
          onChange={(e) => setDraftKw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isImeComposing(e)) {
              e.preventDefault();
              addKeyword();
            }
          }}
          placeholder="Add keyword…"
          style={{
            flex: '0 1 140px',
            minWidth: 90,
            border: `1px solid ${color.border}`,
            borderRadius: radius.sm,
            background: color.surface,
            color: color.textPrimary,
            padding: `2px ${space[2]}px`,
            fontFamily: font.sans,
            fontSize: font.size.caption,
            outline: 'none',
          }}
        />
        <span style={{ flex: 1 }} />
        <span style={{ color: color.textTertiary }}>
          Read {readCount}/{lineCount}
        </span>
        <button type="button" onClick={markAll} style={toolButtonStyle}>
          Mark all read
        </button>
        <button type="button" onClick={clearRead} style={toolButtonStyle}>
          Clear
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }} onScroll={(e) => onScroll(e.currentTarget)}>
        <div style={{ paddingTop: space[4], paddingBottom: space[4], minHeight: '100%' }}>
          {lines.map((line, i) => {
            const ln = i + 1;
            const read = flags[i] === true;
            const segments = segmentLine(line, keywords);
            return (
              <div key={`line-${ln}`} style={{ display: 'flex', opacity: read ? 0.4 : 1 }}>
                <button
                  type="button"
                  title={read ? 'Mark unread (shift-click for a range)' : 'Mark read'}
                  onClick={(e) => onGutterClick(ln, e.shiftKey)}
                  style={{
                    ...lineStyle,
                    position: 'sticky',
                    left: 0,
                    flexShrink: 0,
                    width: 52,
                    textAlign: 'right',
                    padding: `0 ${space[3]}px`,
                    border: 'none',
                    borderRight: `1px solid ${color.divider}`,
                    background: color.surfaceMuted,
                    color: color.textGhost,
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  {ln}
                </button>
                <pre
                  style={{
                    ...lineStyle,
                    margin: 0,
                    padding: `0 ${space[4]}px`,
                    color: color.textPrimary,
                  }}
                >
                  {segments.map((seg) =>
                    seg.hit ? (
                      <mark
                        key={seg.start}
                        style={{
                          background: color.warningSoft,
                          color: color.warning,
                          borderRadius: 2,
                        }}
                      >
                        {seg.text}
                      </mark>
                    ) : (
                      <span key={seg.start}>{seg.text}</span>
                    ),
                  )}
                </pre>
              </div>
            );
          })}
          {truncated && (
            <div
              style={{
                padding: `${space[2]}px ${space[4]}px 0`,
                fontFamily: font.sans,
                fontSize: font.size.micro,
                color: color.textTertiary,
              }}
            >
              … truncated (showing the first {TEXT_VIEW_CAP.toLocaleString()} characters) — open the
              file in your editor for the full contents.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const toolButtonStyle: CSSProperties = {
  border: `1px solid ${color.border}`,
  borderRadius: radius.sm,
  background: color.surface,
  color: color.textTertiary,
  cursor: 'pointer',
  padding: `2px ${space[2]}px`,
  fontFamily: font.sans,
  fontSize: font.size.caption,
};
