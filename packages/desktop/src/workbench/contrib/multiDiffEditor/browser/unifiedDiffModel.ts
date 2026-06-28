/**
 * Turn (original, modified) text into GitHub-style UNIFIED diff rows — the data a
 * lightweight diff renderer paints as red/green/±  lines. Pure + unit-tested; the
 * <UnifiedDiff> component (and the canvas card preview) render the rows, syntax-
 * highlighting each via monaco's colorize and tinting the word-level segments.
 *
 * Uses the SAME diff engine the gutter uses (lineDiff's `diffComputer`) — line
 * alignment + character-level `innerChanges` (the word-level green/red spans).
 *
 * A row is one of:
 *   context — an unchanged line, shown with BOTH line numbers
 *   del     — a removed line (old number, '−'), split into word-level segments
 *   add     — an added line   (new number, '+'), split into word-level segments
 *   gap     — a collapsed boundary, rendered as a git hunk header `@@ … @@`
 */
import { diffComputer } from '../../../services/editor/browser/lineDiff.js';

/** A run of characters within a changed line: word-level highlighted, or plain. */
export interface DiffSeg {
  readonly text: string;
  readonly hi: boolean;
}

export type DiffRow =
  | {
      readonly kind: 'context';
      readonly oldLine: number;
      readonly newLine: number;
      readonly text: string;
    }
  | { readonly kind: 'del'; readonly oldLine: number; readonly segs: readonly DiffSeg[] }
  | { readonly kind: 'add'; readonly newLine: number; readonly segs: readonly DiffSeg[] }
  // A collapsed boundary rendered as a git hunk header `@@ -oldStart,oldCount
  // +newStart,newCount @@` (the ranges of the hunk that FOLLOWS the gap).
  | {
      readonly kind: 'gap';
      readonly oldStart: number;
      readonly oldCount: number;
      readonly newStart: number;
      readonly newCount: number;
      // The collapsed unchanged CONTEXT rows, kept so the gap can expand on click.
      readonly hidden: readonly DiffRow[];
    };

/** Per visual hunk old-side range used to locate git's raw hunk for
 *  stage/unstage/revert. Add-only hunks can have no old-side rows at all
 *  (`@@ -0,0 +1,n @@`), so `oldFrom`/`oldTo` may be 0 to target that anchor. */
export interface HunkOldRange {
  readonly oldFrom: number;
  readonly oldTo: number;
}

// The engine's richer change shape (no .d.ts ships for the deep import; lineDiff
// types only the line ranges, so re-declare what we additionally consume here).
interface EngineRange {
  readonly startLineNumber: number;
  readonly startColumn: number;
  readonly endLineNumber: number;
  readonly endColumn: number;
}
interface EngineInnerChange {
  readonly originalRange: EngineRange;
  readonly modifiedRange: EngineRange;
}
interface EngineLineRange {
  readonly startLineNumber: number;
  readonly endLineNumberExclusive: number;
}
interface EngineChange {
  readonly original: EngineLineRange;
  readonly modified: EngineLineRange;
  readonly innerChanges: readonly EngineInnerChange[] | undefined;
}

const DEFAULT_CONTEXT = 3;

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/** Clip a possibly-multi-line inner-change range to one line → its 1-based
 *  [startCol, endCol) on that line, or null if the range doesn't touch it. */
function clipToLine(
  r: EngineRange,
  lineNum: number,
  lineLen: number,
): readonly [number, number] | null {
  if (lineNum < r.startLineNumber || lineNum > r.endLineNumber) return null;
  const start = lineNum === r.startLineNumber ? r.startColumn : 1;
  const end = lineNum === r.endLineNumber ? r.endColumn : lineLen + 1;
  return end > start ? [start, end] : null;
}

/** The word-level highlight ranges on one line of one side, sorted by column. */
function innerRangesForLine(
  inner: readonly EngineInnerChange[] | undefined,
  side: 'original' | 'modified',
  lineNum: number,
  lineLen: number,
): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  for (const ic of inner ?? []) {
    const clipped = clipToLine(
      side === 'original' ? ic.originalRange : ic.modifiedRange,
      lineNum,
      lineLen,
    );
    if (clipped) out.push(clipped);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Split a line into highlighted/plain segments from sorted, non-overlapping
 *  1-based [startCol, endCol) ranges. */
export function segmentLine(
  text: string,
  ranges: ReadonlyArray<readonly [number, number]>,
): DiffSeg[] {
  if (ranges.length === 0) return [{ text, hi: false }];
  const segs: DiffSeg[] = [];
  let col = 1;
  for (const [s, e] of ranges) {
    if (s > col) segs.push({ text: text.slice(col - 1, s - 1), hi: false });
    segs.push({ text: text.slice(s - 1, e - 1), hi: true });
    col = e;
  }
  if (col <= text.length) segs.push({ text: text.slice(col - 1), hi: false });
  return segs.filter((seg) => seg.text.length > 0);
}

/** Build the FULL row sequence (every context line shown; no gaps yet). */
function buildRows(orig: string[], mod: string[], changes: readonly EngineChange[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let oc = 1;
  let mc = 1;
  const pushContext = (uptoOrig: number): void => {
    while (oc < uptoOrig) {
      rows.push({ kind: 'context', oldLine: oc, newLine: mc, text: orig[oc - 1] ?? '' });
      oc++;
      mc++;
    }
  };
  for (const c of changes) {
    pushContext(c.original.startLineNumber);
    // Word-level highlights only for a MODIFY (a line replaced by a line). A pure
    // add/delete has no counterpart, so the whole line IS the change — no inner box
    // (matches GitHub).
    const origEmpty = c.original.startLineNumber === c.original.endLineNumberExclusive;
    const modEmpty = c.modified.startLineNumber === c.modified.endLineNumberExclusive;
    const inner = !origEmpty && !modEmpty ? c.innerChanges : undefined;
    for (let ln = c.original.startLineNumber; ln < c.original.endLineNumberExclusive; ln++) {
      const text = orig[ln - 1] ?? '';
      rows.push({
        kind: 'del',
        oldLine: ln,
        segs: segmentLine(text, innerRangesForLine(inner, 'original', ln, text.length)),
      });
    }
    oc = c.original.endLineNumberExclusive;
    for (let ln = c.modified.startLineNumber; ln < c.modified.endLineNumberExclusive; ln++) {
      const text = mod[ln - 1] ?? '';
      rows.push({
        kind: 'add',
        newLine: ln,
        segs: segmentLine(text, innerRangesForLine(inner, 'modified', ln, text.length)),
      });
    }
    mc = c.modified.endLineNumberExclusive;
  }
  pushContext(orig.length + 1);
  return rows;
}

/** Collapse runs of context longer than 2·context into a gap, keeping `context`
 *  lines next to each change (and only the inner side at the file's start/end). */
function collapse(rows: readonly DiffRow[], context: number): DiffRow[] {
  if (context === Number.POSITIVE_INFINITY) return [...rows];
  const out: DiffRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row?.kind !== 'context') {
      if (row) out.push(row);
      i++;
      continue;
    }
    // Gather the maximal run of context rows [i, j).
    let j = i;
    while (j < rows.length && rows[j]?.kind === 'context') j++;
    const runLen = j - i;
    const atStart = i === 0;
    const atEnd = j === rows.length;
    const keepTop = atStart ? 0 : context;
    const keepBot = atEnd ? 0 : context;
    if (runLen > keepTop + keepBot + 1) {
      for (let k = i; k < i + keepTop; k++) out.push(rows[k] as DiffRow);
      // ranges filled later; the collapsed middle is kept in `hidden` for expand.
      out.push({
        kind: 'gap',
        oldStart: 0,
        oldCount: 0,
        newStart: 0,
        newCount: 0,
        hidden: rows.slice(i + keepTop, j - keepBot),
      });
      for (let k = j - keepBot; k < j; k++) out.push(rows[k] as DiffRow);
    } else {
      for (let k = i; k < j; k++) out.push(rows[k] as DiffRow);
    }
    i = j;
  }
  return out;
}

/**
 * Unified diff rows for (original, modified). `context` = unchanged lines kept
 * around each change (default 3, GitHub-like); pass Infinity to show the whole
 * file (the full single-file view), or a small number for a compact card preview.
 */
export function computeUnifiedDiff(
  original: string,
  modified: string,
  opts: { context?: number; ignoreWhitespace?: boolean } = {},
): DiffRow[] {
  const context = opts.context ?? DEFAULT_CONTEXT;
  const orig = splitLines(original);
  const mod = splitLines(modified);
  if (original === modified) {
    const all = orig.map(
      (text, i): DiffRow => ({ kind: 'context', oldLine: i + 1, newLine: i + 1, text }),
    );
    return fillHunkHeaders(trimTrailingBlank(collapse(all, context)));
  }
  const { changes } = diffComputer.computeDiff(orig, mod, {
    ignoreTrimWhitespace: opts.ignoreWhitespace ?? false,
    maxComputationTimeMs: 1000,
    computeMoves: false,
  }) as unknown as { changes: EngineChange[] };
  return fillHunkHeaders(trimTrailingBlank(collapse(buildRows(orig, mod, changes), context)));
}

/** Fill each gap's hunk-header ranges from the hunk that FOLLOWS it (the rows up
 *  to the next gap / end), so it renders as `@@ -oldStart,oldCount +newStart,
 *  newCount @@` — git's hunk header. */
function fillHunkHeaders(rows: DiffRow[]): DiffRow[] {
  return rows.map((row, i): DiffRow => {
    if (row.kind !== 'gap') return row;
    let oldStart = 0;
    let newStart = 0;
    let oldCount = 0;
    let newCount = 0;
    for (let j = i + 1; j < rows.length && rows[j]?.kind !== 'gap'; j++) {
      const r = rows[j] as DiffRow;
      if (r.kind === 'context') {
        if (oldStart === 0) oldStart = r.oldLine;
        if (newStart === 0) newStart = r.newLine;
        oldCount++;
        newCount++;
      } else if (r.kind === 'del') {
        if (oldStart === 0) oldStart = r.oldLine;
        oldCount++;
      } else if (r.kind === 'add') {
        if (newStart === 0) newStart = r.newLine;
        newCount++;
      }
    }
    return {
      kind: 'gap',
      oldStart: oldStart || 1,
      newStart: newStart || 1,
      oldCount,
      newCount,
      hidden: row.hidden,
    };
  });
}

/** Drop the phantom trailing empty CONTEXT line — a file ending in "\n" splits to
 *  a final "" that would otherwise render as a stray blank row (git/GitHub don't
 *  show it). Only trims when it's unchanged context, never a real add/del. */
function trimTrailingBlank(rows: DiffRow[]): DiffRow[] {
  const last = rows[rows.length - 1];
  if (last?.kind === 'context' && last.text === '') rows.pop();
  return rows;
}

/** +N / −M counts for a file header badge. */
export function diffStat(rows: readonly DiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.kind === 'add') added++;
    else if (r.kind === 'del') removed++;
  }
  return { added, removed };
}

/** Map the same hunk indexes rendered by UnifiedDiff/SplitDiff to old-side line
 *  ranges. A gap increments the visual hunk index; the rows after it belong to
 *  the following hunk. Pure-add hunks need a synthetic old-side anchor so they
 *  can still be matched against git's `oldCount 0` hunk. */
export function hunkOldRanges(rows: readonly DiffRow[]): HunkOldRange[] {
  const out: Array<{ oldFrom: number; oldTo: number }> = [];
  let hunkIndex = 0;
  let lastOldLine = 0;
  const at = (i: number): { oldFrom: number; oldTo: number } => {
    while (out.length <= i)
      out.push({ oldFrom: Number.POSITIVE_INFINITY, oldTo: Number.NEGATIVE_INFINITY });
    return out[i] as { oldFrom: number; oldTo: number };
  };
  const noteOldLine = (line: number): void => {
    const hunk = at(hunkIndex);
    hunk.oldFrom = Math.min(hunk.oldFrom, line);
    hunk.oldTo = Math.max(hunk.oldTo, line);
    lastOldLine = Math.max(lastOldLine, line);
  };
  const noteAddOnlyAnchor = (): void => {
    const hunk = at(hunkIndex);
    if (hunk.oldFrom !== Number.POSITIVE_INFINITY) return;
    hunk.oldFrom = lastOldLine;
    hunk.oldTo = lastOldLine;
  };
  for (const row of rows) {
    if (row.kind === 'gap') {
      for (const hidden of row.hidden) {
        if (hidden.kind === 'context' || hidden.kind === 'del') lastOldLine = hidden.oldLine;
      }
      hunkIndex++;
      continue;
    }
    if (row.kind === 'context' || row.kind === 'del') {
      noteOldLine(row.oldLine);
    } else if (row.kind === 'add') {
      noteAddOnlyAnchor();
    }
  }
  return out;
}
