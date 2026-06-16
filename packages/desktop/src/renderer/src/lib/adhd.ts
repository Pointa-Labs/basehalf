/**
 * Pure helpers for the ADHD reading-aids view (per private-docs/focus_mode_spec):
 * keyword highlighting + read/unread line state. The core `adhd` module owns the
 * canonical `adhd.yaml` (keywords + read line-ranges); these helpers project that
 * onto the rendered text in the read-only code/text viewer (the line-numbered view
 * where the spec's line-range model maps exactly — the BlockNote Markdown editor
 * has no source-line mapping, so adhd styling is text-viewer-only for now).
 */

/** An inclusive 1-based line range `[start, end]`, mirroring core's LineRange. */
export type LineRange = readonly [number, number];

/**
 * Per-line read flags for lines `1..lineCount` (index `i` = line `i + 1`). A line
 * is read when it falls inside any read range. Ranges are clamped to the file so a
 * stale range past EOF (the file shrank) can't write out of bounds.
 */
export function readLineFlags(ranges: readonly LineRange[], lineCount: number): boolean[] {
  const flags = new Array<boolean>(Math.max(0, lineCount)).fill(false);
  for (const [start, end] of ranges) {
    const lo = Math.max(1, Math.min(start, end));
    const hi = Math.min(lineCount, Math.max(start, end));
    for (let ln = lo; ln <= hi; ln++) flags[ln - 1] = true;
  }
  return flags;
}

/** Count of distinct read lines within `1..lineCount` (for the "read N/M" summary). */
export function readLineCount(ranges: readonly LineRange[], lineCount: number): number {
  return readLineFlags(ranges, lineCount).reduce((n, read) => (read ? n + 1 : n), 0);
}

/** A run of a line's text, flagged when it is part of a keyword hit. `start` is
 *  the 0-based char offset of the run within the line — a stable React key (the
 *  segments are a monotonic split, so offsets are unique and ordered). */
export interface KeywordSegment {
  readonly text: string;
  readonly hit: boolean;
  readonly start: number;
}

/**
 * Split one line into segments, marking case-insensitive keyword occurrences as
 * hits. Keywords are matched longest-first and overlapping hits are merged, so two
 * keywords sharing a span produce one clean highlight (no nested/torn markup).
 * Blank keywords are ignored; a line with no hit returns a single non-hit segment.
 */
export function segmentLine(line: string, keywords: readonly string[]): KeywordSegment[] {
  const kws = keywords.map((k) => k.trim()).filter((k) => k.length > 0);
  if (kws.length === 0 || line === '') return [{ text: line, hit: false, start: 0 }];
  const lower = line.toLowerCase();
  const hits: Array<[number, number]> = [];
  for (const kw of kws) {
    const needle = kw.toLowerCase();
    let from = 0;
    while (from <= lower.length) {
      const idx = lower.indexOf(needle, from);
      if (idx === -1) break;
      hits.push([idx, idx + needle.length]);
      from = idx + needle.length;
    }
  }
  if (hits.length === 0) return [{ text: line, hit: false, start: 0 }];
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of hits) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  const segments: KeywordSegment[] = [];
  let pos = 0;
  for (const [s, e] of merged) {
    if (s > pos) segments.push({ text: line.slice(pos, s), hit: false, start: pos });
    segments.push({ text: line.slice(s, e), hit: true, start: s });
    pos = e;
  }
  if (pos < line.length) segments.push({ text: line.slice(pos), hit: false, start: pos });
  return segments;
}

/** Toggle whether `[start, end]` is "in" a contiguous click selection on the
 *  gutter, used to compute a shift-click range from an anchor line. */
export function rangeBetween(anchor: number, line: number): LineRange {
  return anchor <= line ? [anchor, line] : [line, anchor];
}
