/**
 * Pure helpers for positioning the word-level highlight rectangles over a diff
 * line. Shared by the unified (<UnifiedDiff>) and side-by-side (<SplitDiff>)
 * renderers so both compute `ch`-column offsets the same way — accounting for tab
 * expansion and double-width CJK so the overlay lines up with monaco's colorize.
 */
import type { DiffSeg } from './unifiedDiff.js';

// The colorize tabSize (must match useFileDiff). Tabs render as this many columns.
export const TAB_SIZE = 2;

/** Roughly East-Asian Wide/Fullwidth — the CJK ranges monaco renders at DOUBLE
 *  width. Not exhaustive, but covers the dominant cases (Chinese / Japanese /
 *  Korean + fullwidth forms) so the overlay lines up in this Chinese-heavy app. */
export const isFullWidth = (code: number): boolean =>
  (code >= 0x1100 && code <= 0x115f) ||
  (code >= 0x2e80 && code <= 0xa4cf) ||
  (code >= 0xac00 && code <= 0xd7a3) ||
  (code >= 0xf900 && code <= 0xfaff) ||
  (code >= 0xfe30 && code <= 0xfe4f) ||
  (code >= 0xff00 && code <= 0xff60) ||
  (code >= 0xffe0 && code <= 0xffe6) ||
  (code >= 0x20000 && code <= 0x3fffd);

/** Visible-column width of a string starting at `startVis`, accounting for tab
 *  expansion + full-width chars — so the `ch`-positioned overlay matches what
 *  monaco renders (a tab → TAB_SIZE cols, a CJK char → 2 cols). */
export const visibleWidth = (text: string, startVis: number): number => {
  let w = 0;
  for (const ch of text) {
    if (ch === '\t') w += TAB_SIZE - ((startVis + w) % TAB_SIZE);
    else w += isFullWidth(ch.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return w;
};

/** Word-level highlight ranges in 0-based VISIBLE columns (not source columns). */
export const wordRanges = (segs: readonly DiffSeg[]): Array<{ start: number; len: number }> => {
  const out: Array<{ start: number; len: number }> = [];
  let vis = 0;
  for (const s of segs) {
    const w = visibleWidth(s.text, vis);
    if (s.hi) out.push({ start: vis, len: w });
    vis += w;
  }
  return out;
};
