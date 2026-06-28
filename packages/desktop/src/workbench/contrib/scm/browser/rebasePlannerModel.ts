import type { GitCommit, GitRebaseItem } from '../common/git.js';

export type RebasePlanAction = GitRebaseItem['action'];

export interface RebasePlanRow {
  readonly commit: GitCommit;
  readonly action: RebasePlanAction;
  readonly message?: string;
}

export const REBASE_ACTION_LABEL: Record<RebasePlanAction, string> = {
  pick: 'Pick',
  drop: 'Discard',
  fixup: 'Fixup',
  reword: 'Reword',
};

export function commitsToRebaseRows(commits: readonly GitCommit[]): RebasePlanRow[] {
  return [...commits].reverse().map((commit) => ({ commit, action: 'pick' }));
}

export function setRebaseRowAction(
  rows: readonly RebasePlanRow[],
  index: number,
  action: RebasePlanAction,
): RebasePlanRow[] {
  return normalizeRebaseRows(
    rows.map((row, rowIndex) => (rowIndex === index ? { ...row, action } : row)),
  );
}

export function rewordRebaseRow(
  rows: readonly RebasePlanRow[],
  index: number,
  message: string,
): RebasePlanRow[] {
  return rows.map((row, rowIndex) =>
    rowIndex === index ? { ...row, action: 'reword', message } : row,
  );
}

export function moveRebaseRow(
  rows: readonly RebasePlanRow[],
  index: number,
  direction: -1 | 1,
): RebasePlanRow[] {
  const target = index + direction;
  if (target < 0 || target >= rows.length) return [...rows];
  const next = [...rows];
  const current = next[index];
  const targetRow = next[target];
  if (current === undefined || targetRow === undefined) return [...rows];
  next[index] = targetRow;
  next[target] = current;
  return normalizeRebaseRows(next);
}

export function rebasePlanItems(rows: readonly RebasePlanRow[]): GitRebaseItem[] {
  return normalizeRebaseRows(rows).map((row) =>
    row.action === 'reword' && row.message
      ? { sha: row.commit.hash, action: 'reword', message: row.message }
      : { sha: row.commit.hash, action: row.action },
  );
}

export function keptRebaseRowCount(rows: readonly RebasePlanRow[] | null): number {
  return rows?.filter((row) => row.action !== 'drop').length ?? 0;
}

export function canUseRebaseAction(
  rows: readonly RebasePlanRow[],
  index: number,
  action: RebasePlanAction,
): boolean {
  if (action !== 'fixup') return true;
  return rows.slice(0, index).some((row) => row.action !== 'drop');
}

export function normalizeRebaseRows(rows: readonly RebasePlanRow[]): RebasePlanRow[] {
  let hasPreviousKept = false;
  return rows.map((row) => {
    const action = row.action === 'fixup' && !hasPreviousKept ? 'pick' : row.action;
    if (action !== 'drop') hasPreviousKept = true;
    return action === row.action ? row : { ...row, action };
  });
}
