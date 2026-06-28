import type { ScmHistoryItemChange } from '../common/history.js';

export const historyItemChangeDisplayPath = (change: ScmHistoryItemChange): string =>
  change.originalPath ? `${change.originalPath} -> ${change.path}` : change.path;

export const historyItemChangeKey = (change: ScmHistoryItemChange): string =>
  `${change.status}:${historyItemChangeDisplayPath(change)}`;

export const commitDiffTitle = (shortHash: string): string => `${shortHash} -> parent`;
