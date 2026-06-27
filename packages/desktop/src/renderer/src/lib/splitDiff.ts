/**
 * Fold the UNIFIED diff rows (lib/unifiedDiff) into SIDE-BY-SIDE rows: each visual
 * row carries an optional left (original) and right (modified) cell. This is the
 * pure data <SplitDiff> paints as two columns — VS Code's default diff editor view.
 *
 * Pairing rule (matches what a split editor shows):
 *   context line  → both sides show it (same text, its own line number)
 *   a change block (some deletes then some adds, as unifiedDiff emits them) → pair
 *     them index-wise: row k shows delete[k] on the left and add[k] on the right;
 *     when one side runs out, that side is a blank filler (null cell).
 *   gap           → carried through unchanged (the collapsed-context hunk header).
 *
 * Reuses each line's word-level `segs`, so the green/red inner highlight is identical
 * to the unified view — only the layout differs.
 */
import type { DiffRow, DiffSeg } from './unifiedDiff.js';

/** One side of a split row. `text` for a context line; `segs` for a changed line. */
export interface SplitCell {
  readonly lineNo: number;
  readonly changed: boolean;
  readonly segs?: readonly DiffSeg[];
  readonly text?: string;
}

export type SplitRow =
  | { readonly kind: 'pair'; readonly left: SplitCell | null; readonly right: SplitCell | null }
  | Extract<DiffRow, { kind: 'gap' }>;

/** Convert a run of (only context/del/add) rows into paired split rows. Used for
 *  the whole diff and, on expand, for a gap's hidden context rows. */
export function computeSplitRows(rows: readonly DiffRow[]): SplitRow[] {
  const out: SplitRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    if (r === undefined) {
      i++;
      continue;
    }
    if (r.kind === 'gap') {
      out.push(r);
      i++;
      continue;
    }
    if (r.kind === 'context') {
      out.push({
        kind: 'pair',
        left: { lineNo: r.oldLine, changed: false, text: r.text },
        right: { lineNo: r.newLine, changed: false, text: r.text },
      });
      i++;
      continue;
    }
    // A change block: the deletes, then the adds (unifiedDiff emits them in that order).
    const dels: Array<Extract<DiffRow, { kind: 'del' }>> = [];
    while (i < rows.length && rows[i]?.kind === 'del') {
      dels.push(rows[i] as Extract<DiffRow, { kind: 'del' }>);
      i++;
    }
    const adds: Array<Extract<DiffRow, { kind: 'add' }>> = [];
    while (i < rows.length && rows[i]?.kind === 'add') {
      adds.push(rows[i] as Extract<DiffRow, { kind: 'add' }>);
      i++;
    }
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) {
      const d = dels[k];
      const a = adds[k];
      out.push({
        kind: 'pair',
        left: d ? { lineNo: d.oldLine, changed: true, segs: d.segs } : null,
        right: a ? { lineNo: a.newLine, changed: true, segs: a.segs } : null,
      });
    }
  }
  return out;
}
