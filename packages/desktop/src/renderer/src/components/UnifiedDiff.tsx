import { Fragment, type JSX, useState } from 'react';
import { color, font, space } from '../design.js';
import type { DiffRow, DiffSeg } from '../lib/unifiedDiff.js';

/**
 * Renders GitHub-style UNIFIED diff rows (from lib/unifiedDiff) as lightweight
 * red/green/± lines — NO monaco editor instance, so it's cheap enough to drop
 * into a canvas card or the single-file diff view.
 *
 * Each line is painted as syntax-highlighted HTML (monaco colorize, passed in as
 * `oldHtml`/`newHtml` per side) on top of a word-level highlight layer — the
 * changed `innerChanges` segments get a stronger tint, positioned by `ch` columns
 * (the font is monospace). Falls back to plain text when colorize is unavailable.
 * A collapsed run renders as a clickable git hunk header (`@@ … @@`) that expands
 * the hidden unchanged lines on click.
 */

// Line backgrounds (subtle) + word-level highlight (stronger), as alpha over the
// app base — same pattern as the inline-conflict region tints.
const ADD_LINE = `${color.success}1a`;
const ADD_WORD = `${color.success}40`;
const DEL_LINE = `${color.danger}1a`;
const DEL_WORD = `${color.danger}40`;
const NUM_WIDTH = 44;
const SIGN_WIDTH = 20;

type LineRow = Exclude<DiffRow, { kind: 'gap' }>;
type GapRow = Extract<DiffRow, { kind: 'gap' }>;

export const UnifiedDiff = ({
  rows,
  oldHtml,
  newHtml,
}: {
  rows: readonly DiffRow[];
  oldHtml?: readonly string[] | undefined;
  newHtml?: readonly string[] | undefined;
}): JSX.Element => {
  // Which gaps the user expanded (keyed by the hunk's old-start line).
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const toggle = (key: number): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const htmlFor = (row: LineRow): string | undefined =>
    row.kind === 'add' ? newHtml?.[row.newLine - 1] : oldHtml?.[row.oldLine - 1];

  return (
    <div
      data-testid="unified-diff"
      style={{
        fontFamily: font.mono,
        fontSize: 12,
        lineHeight: '18px',
        background: color.bg,
        overflowX: 'auto',
        color: color.textSecondary,
      }}
    >
      {/* Sizes to the widest row so each line's tint spans full width even when the
          container scrolls horizontally. */}
      <div style={{ minWidth: 'max-content' }}>
        {rows.map((row, i) => {
          if (row.kind === 'gap') {
            const open = expanded.has(row.oldStart);
            return (
              <Fragment key={`g${row.oldStart}`}>
                <HunkBar row={row} open={open} onToggle={() => toggle(row.oldStart)} />
                {open &&
                  row.hidden.map((h, k) => (
                    <Row
                      key={`h${row.oldStart}-${k}`}
                      row={h as LineRow}
                      html={htmlFor(h as LineRow)}
                    />
                  ))}
              </Fragment>
            );
          }
          return <Row key={`${i}:${rowKey(row)}`} row={row} html={htmlFor(row)} />;
        })}
      </div>
    </div>
  );
};

const rowKey = (row: LineRow): string => {
  switch (row.kind) {
    case 'context':
      return `c${row.oldLine}`;
    case 'del':
      return `d${row.oldLine}`;
    case 'add':
      return `a${row.newLine}`;
  }
};

// The clickable git hunk header — a muted-blue bar showing `@@ -a,b +c,d @@`; the
// ▸/▾ toggles the collapsed unchanged lines (GitHub's expand affordance).
const HunkBar = ({
  row,
  open,
  onToggle,
}: {
  row: GapRow;
  open: boolean;
  onToggle: () => void;
}): JSX.Element => (
  <button
    type="button"
    onClick={onToggle}
    title={open ? '收起未改动的行' : '展开未改动的行'}
    style={{
      display: 'flex',
      width: '100%',
      alignItems: 'center',
      background: `${color.accent}14`,
      border: 'none',
      padding: 0,
      margin: 0,
      cursor: 'pointer',
      fontFamily: font.mono,
      fontSize: 12,
      lineHeight: '18px',
      color: color.textTertiary,
      textAlign: 'left',
    }}
  >
    <span
      style={{
        width: NUM_WIDTH * 2 + SIGN_WIDTH,
        flexShrink: 0,
        textAlign: 'center',
        color: color.accent,
        userSelect: 'none',
      }}
    >
      {open ? '▾' : '▸'}
    </span>
    <span style={{ padding: '1px 0' }}>
      @@ -{row.oldStart},{row.oldCount} +{row.newStart},{row.newCount} @@
    </span>
  </button>
);

const Gutter = ({ n }: { n: number | null }): JSX.Element => (
  <span
    style={{
      width: NUM_WIDTH,
      flexShrink: 0,
      textAlign: 'right',
      paddingRight: space[2],
      color: color.textGhost,
      background: color.surfaceMuted,
      userSelect: 'none',
    }}
  >
    {n ?? ''}
  </span>
);

/** Word-level highlight column ranges from the line's segments (1-based start). */
const wordRanges = (segs: readonly DiffSeg[]): Array<{ start: number; len: number }> => {
  const out: Array<{ start: number; len: number }> = [];
  let col = 1;
  for (const s of segs) {
    if (s.hi) out.push({ start: col, len: s.text.length });
    col += s.text.length;
  }
  return out;
};

const Row = ({ row, html }: { row: LineRow; html: string | undefined }): JSX.Element => {
  const isAdd = row.kind === 'add';
  const isDel = row.kind === 'del';
  const oldNum = row.kind === 'context' || isDel ? row.oldLine : null;
  const newNum = row.kind === 'context' || isAdd ? row.newLine : null;
  const words = isAdd || isDel ? wordRanges(row.segs) : [];
  const plain = row.kind === 'context' ? row.text || ' ' : row.segs.map((s) => s.text).join('');
  return (
    <div
      style={{
        display: 'flex',
        whiteSpace: 'pre',
        background: isAdd ? ADD_LINE : isDel ? DEL_LINE : 'transparent',
      }}
    >
      <Gutter n={oldNum} />
      <Gutter n={newNum} />
      <span
        style={{
          width: SIGN_WIDTH,
          flexShrink: 0,
          textAlign: 'center',
          userSelect: 'none',
          color: isAdd ? color.success : isDel ? color.danger : color.textGhost,
        }}
      >
        {isAdd ? '+' : isDel ? '−' : ' '}
      </span>
      <span style={{ flex: 1, position: 'relative', paddingRight: space[3] }}>
        {/* Word-level highlight rectangles, BEHIND the text (ch columns = monospace). */}
        {words.map((w) => (
          <span
            key={`w${w.start}`}
            aria-hidden
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${w.start - 1}ch`,
              width: `${w.len}ch`,
              background: isAdd ? ADD_WORD : DEL_WORD,
              borderRadius: 2,
              zIndex: 0,
            }}
          />
        ))}
        {/* Syntax-highlighted line on top (transparent bg), or plain text fallback. */}
        {html != null ? (
          <span
            style={{ position: 'relative', zIndex: 1, color: color.textPrimary }}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: monaco colorize output (escaped token spans), not user HTML.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <span style={{ position: 'relative', zIndex: 1, color: color.textPrimary }}>{plain}</span>
        )}
      </span>
    </div>
  );
};
