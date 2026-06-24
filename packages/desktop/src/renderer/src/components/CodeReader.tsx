import { type CSSProperties, type JSX, useCallback, useEffect, useMemo } from 'react';
import { color, font, space } from '../design.js';
import { makeFileFocusPusher } from '../lib/focusPush.js';

/**
 * The read-only code/text reader — a plain line-numbered viewer.
 *
 * ADHD reading aids (keyword highlight + read/unread) deliberately do NOT live
 * here: per the product decision they're a Markdown-only surface (see the
 * `editor.readingMode` setting + lib/adhdHighlight on the rich editor). A code or
 * text file is read, not annotated, so this viewer stays minimal.
 *
 * Owns its own scroll container so it can live-sync the first visible line into
 * focus.yaml (visible_lines.start) — the same field-scoped focus.set the
 * canvas/editor use, guarded so a debounced late fire can't repoint a closed file.
 */

const TEXT_VIEW_CAP = 200_000;
const LINE_HEIGHT = 1.6;

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

  // ── Live-sync the first visible line into focus.yaml ───────────────────────
  // Through the shared focus pusher (debounce + open-file/switch liveness checks
  // live there; main injects this window's bound workspace root).
  const pushFocus = useMemo(() => makeFileFocusPusher(file), [file]);
  useEffect(() => () => pushFocus.cancel(), [pushFocus]);

  const onScroll = useCallback(
    (el: HTMLDivElement) => {
      const lineHeightPx = font.size.caption * LINE_HEIGHT;
      const first = Math.max(1, Math.floor((el.scrollTop - space[4]) / lineHeightPx) + 1);
      pushFocus(() => ({ visible_lines: { start: first } }));
    },
    [pushFocus],
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
      <div style={{ flex: 1, overflow: 'auto' }} onScroll={(e) => onScroll(e.currentTarget)}>
        <div style={{ paddingTop: space[4], paddingBottom: space[4], minHeight: '100%' }}>
          {lines.map((line, i) => {
            const ln = i + 1;
            return (
              <div key={`line-${ln}`} style={{ display: 'flex' }}>
                <span
                  style={{
                    ...lineStyle,
                    position: 'sticky',
                    left: 0,
                    flexShrink: 0,
                    width: 52,
                    textAlign: 'right',
                    padding: `0 ${space[3]}px`,
                    borderRight: `1px solid ${color.divider}`,
                    background: color.surfaceMuted,
                    color: color.textGhost,
                    userSelect: 'none',
                  }}
                >
                  {ln}
                </span>
                <pre
                  style={{
                    ...lineStyle,
                    margin: 0,
                    padding: `0 ${space[4]}px`,
                    color: color.textPrimary,
                  }}
                >
                  {line}
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
