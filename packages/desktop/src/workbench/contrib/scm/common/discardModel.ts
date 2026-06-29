import type { GitRow } from './gitStatusModel.js';

export interface DiscardPlan {
  readonly trackedPaths: readonly string[];
  readonly untrackedEntries: readonly { path: string; kind: 'file' | 'folder' }[];
}

export function discardPlan(rows: readonly GitRow[]): DiscardPlan {
  const trackedPaths: string[] = [];
  const untrackedEntries: Array<{ path: string; kind: 'file' | 'folder' }> = [];
  for (const row of rows) {
    if (row.untracked) {
      untrackedEntries.push(entryKindForGitPath(row.path));
    } else {
      trackedPaths.push(row.path);
    }
  }
  return { trackedPaths, untrackedEntries };
}

export const entryKindForGitPath = (path: string): { path: string; kind: 'file' | 'folder' } => {
  const isDir = path.endsWith('/');
  return { path: isDir ? path.slice(0, -1) : path, kind: isDir ? 'folder' : 'file' };
};
