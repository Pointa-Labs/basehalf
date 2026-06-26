/**
 * Parse + resolve git merge-conflict markers for the editor's inline conflict UI.
 * A conflict block looks like:
 *
 *   <<<<<<< HEAD            ← startLine (current / "ours")
 *   ...current...
 *   =======                 ← sepLine
 *   ...incoming...
 *   >>>>>>> other-branch    ← endLine (incoming / "theirs")
 *
 * Pure + unit-tested; the CodeEditor draws widgets/decorations from findConflicts
 * and rewrites the block with resolveConflict on a button click.
 */

export interface ConflictBlock {
  /** 1-based line of the `<<<<<<<` marker. */
  readonly startLine: number;
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
  let sep = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('<<<<<<<')) {
      start = i + 1;
      sep = -1;
    } else if (line.startsWith('=======') && start !== -1 && sep === -1) {
      // Only inside an open conflict — a stray `=======` (e.g. a Markdown rule)
      // outside one is ignored.
      sep = i + 1;
    } else if (line.startsWith('>>>>>>>') && start !== -1 && sep !== -1) {
      blocks.push({ startLine: start, sepLine: sep, endLine: i + 1 });
      start = -1;
      sep = -1;
    }
  }
  return blocks;
}

/** The replacement text (no trailing newline) for a resolved block — the
 *  current side, the incoming side, or both — markers stripped. */
export function resolveConflict(
  text: string,
  block: ConflictBlock,
  choice: ConflictChoice,
): string {
  const lines = text.split('\n');
  const current = lines.slice(block.startLine, block.sepLine - 1); // between <<< and ===
  const incoming = lines.slice(block.sepLine, block.endLine - 1); // between === and >>>
  const chosen =
    choice === 'current' ? current : choice === 'incoming' ? incoming : [...current, ...incoming];
  return chosen.join('\n');
}
