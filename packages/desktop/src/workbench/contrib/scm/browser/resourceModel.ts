import type { GitRow } from '../common/gitStatusModel.js';

/** A human status label for a row's aria-label (so a screen reader announces
 *  "name, Modified, dir" instead of stopping at the filename). */
export const rowStatusText = (row: GitRow): string => {
  if (row.conflict) return 'Conflict';
  if (row.untracked) return 'Untracked';
  const base =
    row.status === 'A'
      ? 'Added'
      : row.status === 'D'
        ? 'Deleted'
        : row.status === 'R'
          ? 'Renamed'
          : row.status === 'C'
            ? 'Copied'
            : 'Modified';
  return row.staged ? `Staged: ${base}` : base;
};
