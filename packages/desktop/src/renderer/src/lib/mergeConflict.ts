/**
 * Parse + resolve git merge-conflict markers for the editor's inline conflict UI.
 * A conflict block looks like:
 *
 *   <<<<<<< HEAD            ← startLine (current / "ours")
 *   ...current...
 *   ||||||| base            ← baseLine (diff3 only — the common ancestor section)
 *   ...base...
 *   =======                 ← sepLine
 *   ...incoming...
 *   >>>>>>> other-branch    ← endLine (incoming / "theirs")
 *
 * The `|||||||` base section appears under `merge.conflictStyle=diff3`/`zdiff3`.
 * It is the common ancestor, NOT part of either side — it must be excluded from
 * "current" and dropped on resolve (matching git's merge-conflict handling).
 *
 * Pure + unit-tested; the CodeEditor draws widgets/decorations from findConflicts
 * and rewrites the block with resolveConflict on a button click.
 */

export interface ConflictBlock {
  /** 1-based line of the `<<<<<<<` marker. */
  readonly startLine: number;
  /** 1-based line of the `|||||||` base marker (diff3 only); absent otherwise. */
  readonly baseLine?: number;
  /** 1-based line of the `=======` separator. */
  readonly sepLine: number;
  /** 1-based line of the `>>>>>>>` marker. */
  readonly endLine: number;
}

export type ConflictChoice = 'current' | 'incoming' | 'both';

export function findConflicts(text: string): ConflictBlock[] {
  const lines = text.split('\n');
  const blocks: ConflictBlock[] = [];
  let start = -1;
  let base = -1;
  let sep = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('<<<<<<<')) {
      start = i + 1;
      base = -1;
      sep = -1;
    } else if (line.startsWith('|||||||') && start !== -1 && sep === -1 && base === -1) {
      // diff3 common-ancestor section: it ends the "current" side.
      base = i + 1;
    } else if (line === '=======' && start !== -1 && sep === -1) {
      // Exact match (the separator is bare 7 `=`), so a Markdown `=========`
      // underline inside a block isn't mistaken for a separator. A stray
      // `=======` outside an open conflict is still ignored (start === -1).
      sep = i + 1;
    } else if (line.startsWith('>>>>>>>') && start !== -1 && sep !== -1) {
      blocks.push(
        base !== -1
          ? { startLine: start, baseLine: base, sepLine: sep, endLine: i + 1 }
          : { startLine: start, sepLine: sep, endLine: i + 1 },
      );
      start = -1;
      base = -1;
      sep = -1;
    }
  }
  return blocks;
}

/** The replacement text (no trailing newline) for a resolved block — the
 *  current side, the incoming side, or both — markers (and the diff3 base) stripped. */
export function resolveConflict(
  text: string,
  block: ConflictBlock,
  choice: ConflictChoice,
): string {
  const lines = text.split('\n');
  // "current" ends at the base marker when present (diff3), else at the separator.
  const currentEnd = (block.baseLine ?? block.sepLine) - 1;
  const current = lines.slice(block.startLine, currentEnd); // between <<< and (||| | ===)
  const incoming = lines.slice(block.sepLine, block.endLine - 1); // between === and >>>
  const chosen =
    choice === 'current' ? current : choice === 'incoming' ? incoming : [...current, ...incoming];
  return chosen.join('\n');
}
