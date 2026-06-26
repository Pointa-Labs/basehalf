import type { GitFileStatus, GitStatusResult } from '@basehalf/core';
import { create } from 'zustand';
import { buildFolderStatus } from '../lib/gitStatus.js';
import { useWorkspaceStore } from './workspace.js';

/**
 * Shared git status for the whole renderer — the SCM panel, the file-tree /
 * canvas coloring, and the editor gutter all read from here so there's ONE
 * `git.status` truth (not one fetch per surface). Refreshed on workspace change
 * and (debounced) on working-tree file events; the SCM panel also refreshes
 * after each git action.
 */
interface GitStatusState {
  status: GitStatusResult | null;
  error: string | null;
  /** path → its status, for O(1) tree / canvas lookups. Untracked dirs arrive
   *  as "dir/" (git collapses them), so a folder card matches on that key. */
  byPath: ReadonlyMap<string, GitFileStatus>;
  /** ancestor-folder path → a representative changed descendant, so a collapsed
   *  folder with edits inside shows as changed (deletes don't propagate). */
  folderStatus: ReadonlyMap<string, GitFileStatus>;
  refresh: () => Promise<void>;
  /** Clear on a workspace switch, before the new repo's first refresh. */
  reset: () => void;
}

export const useGitStatusStore = create<GitStatusState>((set) => ({
  status: null,
  error: null,
  byPath: new Map(),
  folderStatus: new Map(),
  refresh: async () => {
    // Bind to the workspace this read was issued for; a switch mid-flight must not
    // let a stale result (for the OLD repo) land on top of the NEW repo's state.
    const issuedFor = useWorkspaceStore.getState().current;
    const stale = (): boolean => useWorkspaceStore.getState().current !== issuedFor;
    try {
      const status = (await window.bh.run('git.status', {})) as GitStatusResult;
      if (stale()) return;
      set({
        status,
        byPath: new Map(status.files.map((f) => [f.path, f])),
        folderStatus: buildFolderStatus(status.files),
        error: null,
      });
    } catch (err) {
      if (stale()) return;
      set({
        status: null,
        byPath: new Map(),
        folderStatus: new Map(),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
  reset: () => set({ status: null, byPath: new Map(), folderStatus: new Map(), error: null }),
}));

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
/** Coalesce a burst of file events into a single git.status read. */
export function scheduleGitStatusRefresh(delayMs = 300): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void useGitStatusStore.getState().refresh(), delayMs);
}
