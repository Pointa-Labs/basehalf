import type { LineRange } from './types.js';

/**
 * Pure line-range algebra for `read_paragraphs`. Ranges are inclusive, 1-based
 * `[start, end]` pairs; the canonical form is sorted, non-overlapping, and
 * gap-coalesced (two ranges with no unread line between them merge). A line not
 * inside any range is "unread".
 */

/** Validate a single range: integers, 1-based, start ≤ end. Throws on bad input. */
export function assertValidRange(start: number, end: number): void {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error(`adhd: line range must be integers, got [${start}, ${end}]`);
  }
  if (start < 1) throw new Error(`adhd: line numbers are 1-based, got start=${start}`);
  if (end < start) throw new Error(`adhd: range end (${end}) is before start (${start})`);
}

/** Sort + merge overlapping OR gap-free-adjacent ranges into the canonical set. */
export function normalizeRanges(ranges: readonly LineRange[]): LineRange[] {
  for (const r of ranges) {
    if (!Array.isArray(r) || r.length !== 2) {
      throw new Error(
        `adhd: read_paragraphs entries must be [start, end] pairs, got ${JSON.stringify(r)}`,
      );
    }
    assertValidRange(r[0], r[1]);
  }
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    // Merge when overlapping OR touching with no gap (s ≤ last.end + 1).
    if (last && s <= last[1] + 1) {
      if (e > last[1]) last[1] = e;
    } else {
      out.push([s, e]);
    }
  }
  return out;
}

/** Add `[start, end]` to the read set (merge). */
export function mergeRange(ranges: readonly LineRange[], start: number, end: number): LineRange[] {
  assertValidRange(start, end);
  return normalizeRanges([...ranges, [start, end]]);
}

/** Subtract `[start, end]` from the read set (splitting ranges it bisects). */
export function subtractRange(
  ranges: readonly LineRange[],
  start: number,
  end: number,
): LineRange[] {
  assertValidRange(start, end);
  const out: [number, number][] = [];
  for (const [a, b] of normalizeRanges(ranges)) {
    if (b < start || a > end) {
      out.push([a, b]); // disjoint — keep whole
      continue;
    }
    if (a < start) out.push([a, start - 1]); // surviving left piece
    if (b > end) out.push([end + 1, b]); // surviving right piece
  }
  return out;
}
