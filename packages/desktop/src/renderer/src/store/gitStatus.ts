import type { GitFileStatus, GitStatusResult } from '@basehalf/core';
import { create } from 'zustand';

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
  refresh: () => Promise<void>;
  /** Clear on a workspace switch, before the new repo's first refresh. */
  reset: () => void;
}

export const useGitStatusStore = create<GitStatusState>((set) => ({
  status: null,
  error: null,
  byPath: new Map(),
  refresh: async () => {
    try {
      const status = (await window.bh.run('git.status', {})) as GitStatusResult;
      set({
        status,
        byPath: new Map(status.files.map((f) => [f.path, f])),
        error: null,
      });
    } catch (err) {
      set({
        status: null,
        byPath: new Map(),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
  reset: () => set({ status: null, byPath: new Map(), error: null }),
}));

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
/** Coalesce a burst of file events into a single git.status read. */
export function scheduleGitStatusRefresh(delayMs = 300): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void useGitStatusStore.getState().refresh(), delayMs);
}
