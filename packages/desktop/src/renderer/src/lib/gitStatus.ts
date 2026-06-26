import type { GitFileStatus } from '@basehalf/core';

/**
 * Turn the raw `git.status` file list (each with an index `x` + work-tree `y`
 * porcelain code) into the three SCM-panel groups — Merge / Staged / Changes —
 * the way VS Code's Source Control view does. A file with BOTH a staged and an
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

/** Foreground color for a status letter, matching VS Code's SCM conventions. */
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
