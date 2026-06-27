import { Fragment, type JSX, useEffect, useState } from 'react';
import { color, font, space } from '../design.js';
import { wordRanges } from '../lib/diffHighlight.js';
import { type SplitCell, type SplitRow, computeSplitRows } from '../lib/splitDiff.js';
import type { DiffRow } from '../lib/unifiedDiff.js';

/**
 * SIDE-BY-SIDE (split) diff — VS Code's default diff editor layout: the original
 * on the left, the modified on the right, changed lines tinted (red left / green
 * right) with the same word-level inner highlight as the unified view. Read-only:
 * a lightweight DOM painter (no monaco editor), fed split rows from lib/splitDiff
 * and per-side syntax HTML (monaco colorize) via oldHtml/newHtml.
 */

const ADD_LINE = `${color.success}1a`;
const ADD_WORD = `${color.success}40`;
const DEL_LINE = `${color.danger}1a`;
const DEL_WORD = `${color.danger}40`;
const NUM_WIDTH = 44;

type GapRow = Extract<DiffRow, { kind: 'gap' }>;

export const SplitDiff = ({
  rows,
  oldHtml,
  newHtml,
  renderHunkAction,
}: {
  rows: readonly DiffRow[];
  oldHtml?: readonly string[] | undefined;
  newHtml?: readonly string[] | undefined;
  /** Same per-hunk action (Stage/Revert) the unified view renders, placed on the
   *  first changed row of each hunk. `hunkIndex` = gaps before the row. */
  renderHunkAction?: (hunkIndex: number) => JSX.Element | null;
}): JSX.Element => {
  const split = computeSplitRows(rows);
  // Which gaps the user expanded (keyed by position — gaps never reorder within a
  // diff, and a fresh fetch rebuilds `rows` wholesale, so position is a stable key).
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const toggle = (key: number): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rows` is the reset trigger (not read in the body).
  useEffect(() => {
    setExpanded(new Set());
  }, [rows]);

  let hunkIndex = 0;
  let anchoredHunk = -1;

  return (
    <div
      data-testid="split-diff"
      style={{
        fontFamily: font.mono,
        fontSize: 12,
        lineHeight: '18px',
        background: color.bg,
        color: color.textSecondary,
      }}
    >
      {split.map((row, i) => {
        if (row.kind === 'gap') {
          const open = expanded.has(i);
          const bar = (
            // biome-ignore lint/suspicious/noArrayIndexKey: a gap's identity IS its position — rows are recomputed wholesale, never reordered.
            <Fragment key={`g${i}`}>
              <HunkBar row={row} open={open} onToggle={() => toggle(i)} />
              {open &&
                computeSplitRows(row.hidden).map((h, k) =>
                  h.kind === 'pair' ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: positional hidden rows within a stable gap.
                    <PairRow key={`h${i}-${k}`} row={h} oldHtml={oldHtml} newHtml={newHtml} />
                  ) : null,
                )}
            </Fragment>
          );
          hunkIndex++;
          return bar;
        }
        // First changed row of a hunk → a nav anchor (prev/next jumps to these) +
        // the optional Stage/Revert control (same hunkIndex the diff view keys on).
        const isChanged = row.left?.changed === true || row.right?.changed === true;
        const isHunkStart = isChanged && anchoredHunk !== hunkIndex;
        if (isHunkStart) anchoredHunk = hunkIndex;
        const action = isHunkStart ? (renderHunkAction?.(hunkIndex) ?? null) : null;
        return (
          <PairRow
            // biome-ignore lint/suspicious/noArrayIndexKey: split rows are positional; a fresh fetch rebuilds the array wholesale.
            key={`p${i}`}
            row={row}
            oldHtml={oldHtml}
            newHtml={newHtml}
            anchor={isHunkStart ? hunkIndex : undefined}
            action={action}
          />
        );
      })}
    </div>
  );
};

const PairRow = ({
  row,
  oldHtml,
  newHtml,
  anchor,
  action,
}: {
  row: Extract<SplitRow, { kind: 'pair' }>;
  oldHtml?: readonly string[] | undefined;
  newHtml?: readonly string[] | undefined;
  anchor?: number;
  action?: JSX.Element | null;
}): JSX.Element => (
  <div
    style={{ display: 'flex', position: 'relative' }}
    {...(anchor !== undefined ? { 'data-hunk-anchor': anchor } : {})}
  >
    <Side cell={row.left} side="left" html={oldHtml} />
    <div style={{ width: 1, flexShrink: 0, background: color.divider }} />
    <Side cell={row.right} side="right" html={newHtml} />
    {action != null && (
      <div style={{ position: 'absolute', top: 0, right: space[2], display: 'flex' }}>{action}</div>
    )}
  </div>
);

const Side = ({
  cell,
  side,
  html,
}: {
  cell: SplitCell | null;
  side: 'left' | 'right';
  html?: readonly string[] | undefined;
}): JSX.Element => {
  // A null cell is a blank filler opposite an unmatched add/delete (VS Code's
  // diagonal-hatched empty region; here a flat muted band).
  if (cell === null) {
    return (
      <div style={{ flex: 1, minWidth: 0, background: color.surfaceMuted, display: 'flex' }}>
        <Gutter n={null} />
      </div>
    );
  }
  const tint = !cell.changed ? 'transparent' : side === 'left' ? DEL_LINE : ADD_LINE;
  const wordTint = side === 'left' ? DEL_WORD : ADD_WORD;
  const words = cell.changed && cell.segs ? wordRanges(cell.segs) : [];
  const plain = cell.changed ? (cell.segs?.map((s) => s.text).join('') ?? '') : cell.text || ' ';
  const lineHtml = html?.[cell.lineNo - 1];
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', background: tint, overflowX: 'auto' }}>
      <Gutter n={cell.lineNo} />
      <span style={{ flex: 1, position: 'relative', paddingRight: space[3], whiteSpace: 'pre' }}>
        {words.map((w) => (
          <span
            key={`w${w.start}`}
            aria-hidden
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${w.start}ch`,
              width: `${w.len}ch`,
              background: wordTint,
              borderRadius: 2,
              zIndex: 0,
            }}
          />
        ))}
        {lineHtml != null ? (
          <span
            style={{ position: 'relative', zIndex: 1, color: color.textPrimary }}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: monaco colorize output (escaped token spans), not user HTML.
            dangerouslySetInnerHTML={{ __html: lineHtml }}
          />
        ) : (
          <span style={{ position: 'relative', zIndex: 1, color: color.textPrimary }}>{plain}</span>
        )}
      </span>
    </div>
  );
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
      whiteSpace: 'pre',
    }}
  >
    {n ?? ''}
  </span>
);

// Full-width clickable git hunk header — same affordance as the unified view.
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
      gap: space[2],
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
    <span style={{ width: NUM_WIDTH, flexShrink: 0, textAlign: 'center', color: color.accent }}>
      {open ? '▾' : '▸'}
    </span>
    <span>
      @@ -{row.oldStart},{row.oldCount} +{row.newStart},{row.newCount} @@
    </span>
  </button>
);
