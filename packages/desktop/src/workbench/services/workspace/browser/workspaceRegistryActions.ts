import { nativeHostService } from '../../../../platform/native/browser/nativeHostService.js';
import { workspaceService } from '../../../../platform/workspaces/browser/workspaceService.js';
import type { WorkspaceEntry } from '../../../../platform/workspaces/common/workspaces.js';
import { flushAll } from '../../editor/common/editorFlush.js';
import { badgeService } from '../../mirror/browser/badgeService.js';
import { focusService } from '../../mirror/browser/focusService.js';
import { suspendMirrorWrites } from '../../mirror/browser/mirrorWrites.js';
import type { WorkspaceRegistryActions } from '../common/workspaceActions.js';
import { workspaceRefreshPatch } from '../common/workspaceModel.js';
import { formatWorkspaceError, isWorkspacePathNotFoundError } from './workspaceErrors.js';

const ensuredRoots = new Set<string>();

interface WorkspaceRegistryActionState {
  readonly workspaces: readonly WorkspaceEntry[];
  readonly current: string | null;
  readonly currentReachable: boolean | null;
  readonly openRoots: readonly string[];
  readonly error: string;
  readonly busy: boolean;
  readonly refresh: () => Promise<void>;
}

type WorkspaceRegistrySet = (patch: Partial<WorkspaceRegistryActionState>) => void;
type WorkspaceRegistryGet = () => WorkspaceRegistryActionState;

async function startWatcher(): Promise<void> {
  try {
    await workspaceService.startWatcher();
  } catch {
    // Non-fatal — workspace UI works without the watcher; we'd just miss
    // external edits until the next refresh.
  }
}

async function openOrFocusWorkspace(name: string): Promise<boolean> {
  const { reused } = await nativeHostService.openWorkspace(name);
  return reused;
}

async function reopenHere(name: string | null): Promise<void> {
  suspendMirrorWrites();
  await nativeHostService.reopenWindow(name);
}

export function createWorkspaceRegistryActions(
  set: WorkspaceRegistrySet,
  get: WorkspaceRegistryGet,
): WorkspaceRegistryActions {
  return {
    refresh: async () => {
      try {
        const result = await workspaceService.listWorkspaces();
        set(
          workspaceRefreshPatch(
            { workspaces: get().workspaces, current: get().current },
            { workspaces: result.workspaces, current: result.current },
          ),
        );
        const currentWs = result.current
          ? result.workspaces.find((w) => w.name === result.current)
          : null;
        if (currentWs) {
          try {
            await workspaceService.probePath(currentWs.path);
            set({ currentReachable: true });
            if (!ensuredRoots.has(currentWs.path)) {
              ensuredRoots.add(currentWs.path);
              void workspaceService.ensureSetup().catch(() => undefined);
            }
            await startWatcher();
            void focusService.pruneDangling().catch(() => undefined);
            void badgeService.pruneDangling().catch(() => undefined);
          } catch (err) {
            if (isWorkspacePathNotFoundError(err)) {
              set({ currentReachable: false });
            } else {
              set({ error: formatWorkspaceError(err) });
            }
          }
        }
      } catch (err) {
        set({ error: formatWorkspaceError(err) });
      }
    },

    refreshOpenRoots: async () => {
      try {
        set({ openRoots: await nativeHostService.getOpenWorkspaces() });
      } catch {
        // Best-effort: a failed fetch just leaves the "Open" markers stale.
      }
    },

    pickAndAdd: async () => {
      if (get().busy) return;
      set({ busy: true });
      try {
        const path = await nativeHostService.pickWorkspace();
        if (!path) return;
        const added = await workspaceService.addWorkspace(path, { setup: true });
        const reused = await openOrFocusWorkspace(added.workspace.name);
        if (!reused) await get().refresh();
      } catch (err) {
        set({ error: formatWorkspaceError(err) });
      } finally {
        set({ busy: false });
      }
    },

    addDroppedPaths: async (paths: readonly string[]) => {
      if (get().busy || paths.length === 0) return;
      set({ busy: true });
      try {
        const failures: string[] = [];
        let lastName: string | null = null;
        for (const path of paths) {
          try {
            const added = await workspaceService.addWorkspace(path, { setup: true });
            lastName = added.workspace.name;
          } catch (err) {
            failures.push(`${path}: ${formatWorkspaceError(err)}`);
          }
        }
        if (lastName !== null) {
          nativeHostService.notifyWorkspacesChanged();
          const reused = await openOrFocusWorkspace(lastName);
          if (!reused) await get().refresh();
        } else if (failures.length > 0) {
          set({ error: `Drop failed for:\n  ${failures.join('\n  ')}` });
        }
      } catch (err) {
        set({ error: formatWorkspaceError(err) });
      } finally {
        set({ busy: false });
      }
    },

    createDemo: async (path: string) => {
      if (get().busy) return;
      set({ busy: true });
      try {
        const result = await workspaceService.createDemo(path);
        const reused = await openOrFocusWorkspace(result.workspace.name);
        if (!reused) await get().refresh();
      } catch (err) {
        set({ error: formatWorkspaceError(err) });
      } finally {
        set({ busy: false });
      }
    },

    use: async (name: string) => {
      if (get().busy) return;
      set({ busy: true });
      try {
        const reused = await openOrFocusWorkspace(name);
        if (!reused) await get().refresh();
      } catch (err) {
        set({ error: formatWorkspaceError(err) });
      } finally {
        set({ busy: false });
      }
    },

    remove: async (name: string) => {
      if (get().busy) return;
      set({ busy: true });
      try {
        if ((await flushAll()) === false) {
          set({ error: "Save or resolve this file's changes before removing a workspace." });
          return;
        }
        const wasCurrent = get().current === name;
        await workspaceService.removeWorkspace(name);
        nativeHostService.notifyWorkspacesChanged();
        if (wasCurrent) {
          await reopenHere(null);
        } else {
          await get().refresh();
        }
      } catch (err) {
        set({ error: formatWorkspaceError(err) });
      } finally {
        set({ busy: false });
      }
    },

    repath: async (name: string) => {
      if (get().busy) return;
      set({ busy: true });
      try {
        const newPath = await nativeHostService.pickWorkspace();
        if (!newPath) return;
        if ((await flushAll()) === false) {
          set({ error: "Save or resolve this file's changes before relocating a workspace." });
          return;
        }
        const wasCurrent = get().current === name;
        await workspaceService.relocateWorkspace(name, newPath, { setup: true });
        nativeHostService.notifyWorkspacesChanged();
        if (wasCurrent) {
          await reopenHere(name);
        } else {
          await get().refresh();
        }
      } catch (err) {
        set({ error: formatWorkspaceError(err) });
      } finally {
        set({ busy: false });
      }
    },

    renameWorkspace: async (from: string, to: string) => {
      if (get().busy) return;
      set({ busy: true });
      try {
        if ((await flushAll()) === false) {
          set({ error: "Save or resolve this file's changes before renaming a workspace." });
          return;
        }
        await workspaceService.renameWorkspace(from, to);
        nativeHostService.notifyWorkspacesChanged();
        await get().refresh();
      } catch (err) {
        set({ error: formatWorkspaceError(err) });
      } finally {
        set({ busy: false });
      }
    },
  };
}
