import type {
  WorkspaceCurrentResult,
  WorkspaceEntry,
  WorkspaceListResult,
  WorkspaceUseResult,
} from '@basehalf/core';
import { create } from 'zustand';

interface WorkspaceState {
  workspaces: readonly WorkspaceEntry[];
  current: string | null;
  /**
   * Whether the *current* workspace's path is reachable on disk.
   * null = not yet probed; true = ok; false = missing (folder moved/deleted).
   * Sidebar uses this to swap NavTree for the WorkspaceUnreachable UI.
   */
  currentReachable: boolean | null;
  error: string;
  busy: boolean;
  refresh: () => Promise<void>;
  pickAndAdd: () => Promise<void>;
  use: (name: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
  /** Rebind an existing workspace name to a new path (remove + re-add with same name). */
  repath: (name: string) => Promise<void>;
  clearError: () => void;
}

const formatError = (err: unknown): string =>
  err instanceof Error ? `${err.name}: ${err.message}` : String(err);

// Fire-and-forget: ask main to start the file watcher for the now-current
// workspace. If the renderer crashes between switches, main still has the
// previous watcher; watcher.start is idempotent and short-circuits when
// already watching the same root.
async function startWatcher(): Promise<void> {
  try {
    await window.bh.run('watcher.start', {});
  } catch {
    // Non-fatal — workspace UI works without the watcher; we'd just miss
    // external edits until the next refresh.
  }
}

const isPathNotFound = (err: unknown): boolean =>
  err instanceof Error && (err as Error & { code?: string }).code === 'PATH_NOT_FOUND';

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  current: null,
  currentReachable: null,
  error: '',
  busy: false,

  refresh: async () => {
    try {
      const result = (await window.bh.run('workspace.list')) as WorkspaceListResult;
      set({
        workspaces: result.workspaces,
        current: result.current,
        currentReachable: null,
        error: '',
      });
      const currentWs = result.current
        ? result.workspaces.find((w) => w.name === result.current)
        : null;
      if (currentWs) {
        try {
          await window.bh.run('workspace.listFiles', { path: currentWs.path });
          set({ currentReachable: true });
          await startWatcher();
        } catch (err) {
          if (isPathNotFound(err)) {
            set({ currentReachable: false });
          } else {
            set({ error: formatError(err) });
          }
        }
      }
    } catch (err) {
      set({ error: formatError(err) });
    }
  },

  pickAndAdd: async () => {
    if (get().busy) return;
    set({ busy: true });
    try {
      const path = await window.bh.pickWorkspace();
      if (!path) return;
      await window.bh.run('workspace.add', { path });
      await get().refresh();
      await startWatcher();
    } catch (err) {
      set({ error: formatError(err) });
    } finally {
      set({ busy: false });
    }
  },

  use: async (name: string) => {
    if (get().busy) return;
    set({ busy: true });
    try {
      const result = (await window.bh.run('workspace.use', { name })) as WorkspaceUseResult;
      const cur = (await window.bh.run('workspace.current')) as WorkspaceCurrentResult;
      set({ current: cur.current ? cur.current.name : result.current.name, error: '' });
      await startWatcher();
    } catch (err) {
      set({ error: formatError(err) });
    } finally {
      set({ busy: false });
    }
  },

  remove: async (name: string) => {
    if (get().busy) return;
    set({ busy: true });
    try {
      await window.bh.run('workspace.remove', { name });
      await get().refresh();
    } catch (err) {
      set({ error: formatError(err) });
    } finally {
      set({ busy: false });
    }
  },

  repath: async (name: string) => {
    if (get().busy) return;
    const newPath = await window.bh.pickWorkspace();
    if (!newPath) return;
    set({ busy: true });
    try {
      await window.bh.run('workspace.remove', { name });
      await window.bh.run('workspace.add', { path: newPath, name });
      // Restore as current — workspace.remove may have demoted it.
      await window.bh.run('workspace.use', { name });
      await get().refresh();
    } catch (err) {
      set({ error: formatError(err) });
    } finally {
      set({ busy: false });
    }
  },

  clearError: () => set({ error: '' }),
}));
