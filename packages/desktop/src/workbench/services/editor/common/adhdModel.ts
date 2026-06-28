/**
 * Pure helpers for ADHD keyword highlighting (per private-docs/focus_mode_spec).
 * The ADHD mirror owns the canonical `adhd.yaml` (keywords + read
 * line-ranges); these helpers turn the keyword list into highlight spans for the
 * rich (BlockNote) Markdown editor — the only surface that carries reading aids
 * (read/unread is tracked by block id there, not line flags). The read-only
 * code/text viewer is plain, so the old line-flag helpers were removed.
 */

/** An inclusive 1-based line range `[start, end]` persisted in `adhd.yaml`. */
export type LineRange = readonly [number, number];

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

/** Merged, sorted `[start, end)` char offsets of every keyword occurrence in
 *  `text` — the same case-insensitive, longest-first, overlap-merged matching as
 *  {@link segmentLine}, but as bare offsets. Used to place inline keyword
 *  decorations in the rich (BlockNote) editor, where there are no rendered line
 *  rows to segment. */
export function keywordHits(text: string, keywords: readonly string[]): Array<[number, number]> {
  return segmentLine(text, keywords)
    .filter((seg) => seg.hit)
    .map((seg) => [seg.start, seg.start + seg.text.length] as [number, number]);
}
