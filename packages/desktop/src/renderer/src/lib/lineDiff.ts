/**
 * Line-level diff for the editor's git gutter change-bars: compares the editor
 * buffer to its git baseline and reports which lines in the CURRENT (modified)
 * doc are added / modified, and where content was deleted.
 *
 * Uses the prebuilt diff engine that ships INSIDE monaco-editor — the same
 * `DefaultLinesDiffComputer` the editor itself uses (line-level alignment +
 * character-level refinement + heuristics, with a built-in time budget). It
 * replaced a hand-rolled LCS that was O(n·m) in BOTH time and space (a full 2-D
 * table) and froze the renderer on large files. The engine isn't in monaco's
 * public `.d.ts`, so the import is a pinned deep path with a local type shim;
 * `lineDiff.test.ts` asserts the engine is present so a monaco bump that moves
 * the path fails loudly instead of silently dropping the gutter.
 */
// @ts-expect-error — deep internal path, no type declarations ship for it.
import { linesDiffComputers } from 'monaco-editor/esm/vs/editor/common/diff/linesDiffComputers.js';

export type LineChangeKind = 'add' | 'modify' | 'delete';

export interface LineChange {
  readonly kind: LineChangeKind;
  /** 1-based first affected line in the MODIFIED doc. For a delete this is the
   *  line now sitting just below the removed content. */
  readonly startLine: number;
  /** 1-based last affected line. Equals startLine for a delete marker. */
  readonly endLine: number;
}

// Minimal shapes of the engine's output we consume (no .d.ts ships for it).
interface LineRange {
  readonly startLineNumber: number;
  readonly endLineNumberExclusive: number;
  readonly isEmpty: boolean;
}
interface LineRangeMapping {
  readonly original: LineRange;
  readonly modified: LineRange;
}
interface DiffComputer {
  computeDiff(
    original: string[],
    modified: string[],
    options: { ignoreTrimWhitespace: boolean; maxComputationTimeMs: number; computeMoves: boolean },
  ): { changes: LineRangeMapping[]; hitTimeout: boolean };
}

/** The advanced line-diff computer (constructed once). Exported for the test that
 *  guards the deep-import path against a monaco upgrade silently moving it. */
export const diffComputer: DiffComputer = (
  linesDiffComputers as { getDefault(): DiffComputer }
).getDefault();

/** Split into lines for the diff. Empty text is ONE empty line (`['']`), like a
 *  real text model — the engine throws (BugIndicatingError) on a truly empty
 *  zero-line array. */
function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

export function computeLineChanges(original: string, modified: string): LineChange[] {
  if (original === modified) return [];
  const mod = splitLines(modified);
  // No baseline (a new file, or empty at HEAD) → every line is an addition. A
  // lone empty line has nothing to show. (Skipping the diff here also sidesteps
  // the engine's empty-side edge and keeps a new file's bars green, not blue.)
  if (original === '') {
    return mod.length === 1 && mod[0] === ''
      ? []
      : [{ kind: 'add', startLine: 1, endLine: mod.length }];
  }
  const { changes } = diffComputer.computeDiff(splitLines(original), mod, {
    ignoreTrimWhitespace: false, // git change-bars reflect whitespace-only edits too
    maxComputationTimeMs: 1000, // bounded; returns an approximation past the budget
    computeMoves: false,
  });
  return changes.map((c): LineChange => {
    if (c.original.isEmpty) {
      return {
        kind: 'add',
        startLine: c.modified.startLineNumber,
        endLine: c.modified.endLineNumberExclusive - 1,
      };
    }
    if (c.modified.isEmpty) {
      // Pure deletion: a marker on the line now at this position (the line below
      // the removed block), clamped into the doc; at EOF mark the last line.
      const line = Math.min(mod.length, Math.max(1, c.modified.startLineNumber));
      return { kind: 'delete', startLine: line, endLine: line };
    }
    return {
      kind: 'modify',
      startLine: c.modified.startLineNumber,
      endLine: c.modified.endLineNumberExclusive - 1,
    };
  });
}
