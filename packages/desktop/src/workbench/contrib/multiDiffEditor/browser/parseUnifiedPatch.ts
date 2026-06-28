import type { DiffRow } from './unifiedDiffModel.js';

/**
 * Parse a GitHub-style file patch (the `patch` field from /pulls/{n}/files — bare
 * `@@` hunks, no file header) into the DiffRow[] our <UnifiedDiff> renderer paints.
 * GitHub gives line-level (not word-level) diffs, so each add/del line is a single
 * un-highlighted segment. Pure + unit-tested; the in-app PR viewer feeds the rows
 * straight to UnifiedDiff (no monaco colorize → plain-text fallback).
 */
export function parseUnifiedPatch(patch: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const line of patch.split('\n')) {
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h !== null) {
      const oldStart = Number(h[1]);
      const newStart = Number(h[3]);
      rows.push({
        kind: 'gap',
        oldStart,
        oldCount: h[2] !== undefined ? Number(h[2]) : 1,
        newStart,
        newCount: h[4] !== undefined ? Number(h[4]) : 1,
        hidden: [],
      });
      oldLine = oldStart;
      newLine = newStart;
      continue;
    }
    const tag = line.charAt(0);
    if (tag === '+') {
      rows.push({ kind: 'add', newLine, segs: [{ text: line.slice(1), hi: false }] });
      newLine++;
    } else if (tag === '-') {
      rows.push({ kind: 'del', oldLine, segs: [{ text: line.slice(1), hi: false }] });
      oldLine++;
    } else if (tag === ' ') {
      rows.push({ kind: 'context', oldLine, newLine, text: line.slice(1) });
      oldLine++;
      newLine++;
    }
    // '\' ("\ No newline at end of file") and any stray blank line → ignored.
  }
  return rows;
}
