import type { GitRow } from './gitStatusModel.js';

export type ScmGroupId = 'merge' | 'staged' | 'changes';

export const rowKey = (groupId: ScmGroupId, row: GitRow): string => `${groupId}:${row.path}`;
