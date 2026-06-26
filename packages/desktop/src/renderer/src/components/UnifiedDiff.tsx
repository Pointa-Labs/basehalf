import type { JSX } from 'react';
import { color, font, space } from '../design.js';
import type { DiffRow } from '../lib/unifiedDiff.js';

/**
 * Renders GitHub-style UNIFIED diff rows (from lib/unifiedDiff) as lightweight
 * red/green/± lines — NO monaco editor instance, so it's cheap enough to drop
 * into a canvas card or the single-file diff view. Word-level `innerChanges`
 * segments get a stronger tint; long unchanged runs are shown as a collapsed gap.
 *
 * Presentational + dumb: it only paints `rows`. Syntax highlighting (monaco
 * colorize) is a later pass; v1 is plain monospace + diff tints.
 */

// Line backgrounds (subtle) + word-level highlight (stronger), as alpha over the
// app base — same pattern as the inline-conflict region tints.
const ADD_LINE = `${color.success}1a`;
const ADD_WORD = `${color.success}40`;
const DEL_LINE = `${color.danger}1a`;
const DEL_WORD = `${color.danger}40`;
const NUM_WIDTH = 44;
const SIGN_WIDTH = 20;

export const UnifiedDiff = ({ rows }: { rows: readonly DiffRow[] }): JSX.Element => (
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
      {rows.map((row, i) => (
        <Row key={`${i}:${rowKey(row)}`} row={row} />
      ))}
    </div>
  </div>
);

const rowKey = (row: DiffRow): string => {
  switch (row.kind) {
    case 'context':
      return `c${row.oldLine}`;
    case 'del':
      return `d${row.oldLine}`;
    case 'add':
      return `a${row.newLine}`;
    case 'gap':
      return `g${row.count}`;
  }
};

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

const Row = ({ row }: { row: DiffRow }): JSX.Element => {
  if (row.kind === 'gap') {
    return (
      <div style={{ display: 'flex', background: color.surfaceMuted }}>
        <span style={{ width: NUM_WIDTH * 2 + SIGN_WIDTH, flexShrink: 0 }} />
        <span
          style={{
            color: color.textTertiary,
            fontFamily: font.sans,
            fontSize: 11,
            padding: '1px 0',
          }}
        >
          ⋯ {row.count} 行未改动
        </span>
      </div>
    );
  }
  const isAdd = row.kind === 'add';
  const isDel = row.kind === 'del';
  const oldNum = row.kind === 'context' || isDel ? row.oldLine : null;
  const newNum = row.kind === 'context' || isAdd ? row.newLine : null;
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
      <span style={{ flex: 1, paddingRight: space[3], color: color.textPrimary }}>
        {row.kind === 'context'
          ? row.text || ' '
          : row.segs.map((seg, j) =>
              seg.hi ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional within a stable line.
                <span key={j} style={{ background: isAdd ? ADD_WORD : DEL_WORD, borderRadius: 2 }}>
                  {seg.text}
                </span>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional within a stable line.
                <span key={j}>{seg.text}</span>
              ),
            )}
      </span>
    </div>
  );
};
