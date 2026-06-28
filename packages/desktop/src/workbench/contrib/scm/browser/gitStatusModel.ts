import type { GitFileStatus } from '../common/git.js';

/**
 * Turn the raw `git.status` file list (each with an index `x` + work-tree `y`
 * porcelain code) into the three SCM-panel groups — Merge / Staged / Changes —
 * the way a mature source-control view does. A file with BOTH a staged and an
 * unstaged change (e.g. x='M', y='M') appears in Staged AND Changes. Pure +
 * path-only so it's unit-tested without a real git.
 */

export interface GitRow {
  readonly path: string;
  /** Single-letter display status: M/A/D/R/C (tracked), U (untracked), ! (conflict). */
  readonly status: string;
  readonly staged: boolean;
  readonly untracked: boolean;
  readonly conflict: boolean;
  /** Rename/copy source (staged renames only). */
  readonly orig?: string;
}

export interface GitGroups {
  readonly merge: readonly GitRow[];
  readonly staged: readonly GitRow[];
  readonly changes: readonly GitRow[];
}

/** An unmerged (conflict) porcelain XY pair. Mirrors core's parse.isConflict. */
function isConflict(x: string, y: string): boolean {
  const xy = x + y;
  return xy === 'DD' || xy === 'AA' || xy === 'UU' || x === 'U' || y === 'U';
}

export function classifyStatus(files: readonly GitFileStatus[]): GitGroups {
  const merge: GitRow[] = [];
  const staged: GitRow[] = [];
  const changes: GitRow[] = [];
  for (const f of files) {
    if (isConflict(f.x, f.y)) {
      merge.push({ path: f.path, status: '!', staged: false, untracked: false, conflict: true });
      continue;
    }
    if (f.x === '?') {
      // Untracked (XY === '??') — a Working-Tree change, shown as new.
      changes.push({ path: f.path, status: 'U', staged: false, untracked: true, conflict: false });
      continue;
    }
    if (f.x !== ' ') {
      staged.push({
        path: f.path,
        status: f.x,
        staged: true,
        untracked: false,
        conflict: false,
        ...(f.orig !== undefined && { orig: f.orig }),
      });
    }
    if (f.y !== ' ') {
      changes.push({ path: f.path, status: f.y, staged: false, untracked: false, conflict: false });
    }
  }
  return { merge, staged, changes };
}

export function totalChangeCount(groups: GitGroups): number {
  return groups.merge.length + groups.staged.length + groups.changes.length;
}

/** Foreground color for a status letter, matching common SCM conventions. */
export function statusColor(
  row: GitRow,
  palette: { added: string; modified: string; deleted: string; conflict: string; renamed: string },
): string {
  if (row.conflict) return palette.conflict;
  if (row.untracked || row.status === 'A') return palette.added;
  if (row.status === 'D') return palette.deleted;
  if (row.status === 'R' || row.status === 'C') return palette.renamed;
  return palette.modified; // M / T / default
}

export interface GitDecoPalette {
  readonly added: string;
  readonly modified: string;
  readonly deleted: string;
  readonly conflict: string;
  readonly renamed: string;
  readonly untracked: string;
}

/**
 * The single-letter status + color for ONE file — for coloring a file-tree row or
 * a canvas card from its raw XY codes. Prefers the work-tree (unstaged) status
 * over the staged one, so a file you just edited reads as Modified, not Staged.
 */
export function fileDecoration(
  f: GitFileStatus,
  palette: GitDecoPalette,
): { letter: string; color: string; strikeThrough: boolean } {
  if (isConflict(f.x, f.y)) return { letter: '!', color: palette.conflict, strikeThrough: false };
  if (f.x === '?') return { letter: 'U', color: palette.untracked, strikeThrough: false };
  const code = f.y !== ' ' ? f.y : f.x;
  if (code === 'A') return { letter: 'A', color: palette.added, strikeThrough: false };
  // Deleted: strike the name through, so "this file is gone" reads without the letter.
  if (code === 'D') return { letter: 'D', color: palette.deleted, strikeThrough: true };
  if (code === 'R' || code === 'C')
    return { letter: code, color: palette.renamed, strikeThrough: false };
  return { letter: code === ' ' ? 'M' : code, color: palette.modified, strikeThrough: false };
}

/** A human-readable status label (for a tree/card tooltip) instead of a bare
 *  letter — the way a mature SCM names each state. Distinguishes a staged-only
 *  change (the X column) from a work-tree one. */
export function statusTooltip(f: GitFileStatus): string {
  if (isConflict(f.x, f.y)) return 'Conflict';
  if (f.x === '?') return 'Untracked';
  const staged = f.y === ' ' && f.x !== ' ';
  const code = f.y !== ' ' ? f.y : f.x;
  const base =
    code === 'A'
      ? 'Added'
      : code === 'D'
        ? 'Deleted'
        : code === 'R'
          ? 'Renamed'
          : code === 'C'
            ? 'Copied'
            : code === 'T'
              ? 'Type Changed'
              : 'Modified';
  return staged ? `Staged: ${base}` : base;
}

/**
 * Propagate each changed file's status up its ancestor folders, so a collapsed
 * folder containing edits shows as changed too (a mature SCM does this). Returns
 * folder-path → a representative changed descendant. DELETED files do NOT
 * propagate (else one delete would paint the whole parent chain). Conflicts win
 * over edits win over adds/untracked when a folder has several kinds inside.
 */
export function buildFolderStatus(files: readonly GitFileStatus[]): Map<string, GitFileStatus> {
  const rank = (f: GitFileStatus): number => {
    if (isConflict(f.x, f.y)) return 4;
    const code = f.y !== ' ' ? f.y : f.x;
    if (code === 'M' || code === 'T') return 3;
    if (code === 'R' || code === 'C') return 2;
    return 1; // A / U / others
  };
  const folders = new Map<string, GitFileStatus>();
  for (const f of files) {
    if (!isConflict(f.x, f.y) && (f.y !== ' ' ? f.y : f.x) === 'D') continue; // no delete propagation
    const clean = f.path.endsWith('/') ? f.path.slice(0, -1) : f.path;
    const parts = clean.split('/');
    parts.pop(); // drop the leaf — only ancestors get the propagated mark
    let acc = '';
    for (const part of parts) {
      acc = acc === '' ? part : `${acc}/${part}`;
      const cur = folders.get(acc);
      if (cur === undefined || rank(f) > rank(cur)) folders.set(acc, f);
    }
  }
  return folders;
}
