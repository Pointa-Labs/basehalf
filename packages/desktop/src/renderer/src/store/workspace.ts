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
  error: string;
  busy: boolean;
  refresh: () => Promise<void>;
  pickAndAdd: () => Promise<void>;
  use: (name: string) => Promise<void>;
  clearError: () => void;
}

const formatError = (err: unknown): string =>
  err instanceof Error ? `${err.name}: ${err.message}` : String(err);

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  current: null,
  error: '',
  busy: false,

  refresh: async () => {
    try {
      const result = (await window.bh.run('workspace.list')) as WorkspaceListResult;
      set({ workspaces: result.workspaces, current: result.current, error: '' });
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
      // Re-read current via dedicated command for canonical value.
      const cur = (await window.bh.run('workspace.current')) as WorkspaceCurrentResult;
      set({ current: cur.current ? cur.current.name : result.current.name, error: '' });
    } catch (err) {
      set({ error: formatError(err) });
    } finally {
      set({ busy: false });
    }
  },

  clearError: () => set({ error: '' }),
}));
