import type { GitRow } from '../common/gitStatusModel.js';

export type ScmGroupId = 'merge' | 'staged' | 'changes';
export type CommitAfter = 'push' | 'sync';

export interface CommitActionOptions {
  readonly after?: CommitAfter;
  readonly amend?: boolean;
}

export interface RowAction {
  label: string;
  glyph: string;
  onClick: () => void;
  danger?: boolean;
}

export const rowKey = (groupId: ScmGroupId, row: GitRow): string => `${groupId}:${row.path}`;
