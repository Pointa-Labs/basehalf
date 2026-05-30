import type {
  SavedView,
  ViewListResult,
  WorkspaceCurrentResult,
  WorkspaceEntry,
  WorkspaceListResult,
  WorkspaceUseResult,
} from '@basehalf/core';
import { create } from 'zustand';
import { noteOpenedFile } from '../lib/recent-files.js';

interface WorkspaceState {
  workspaces: readonly WorkspaceEntry[];
  current: string | null;
  /**
   * Whether the *current* workspace's path is reachable on disk.
   * null = not yet probed; true = ok; false = missing (folder moved/deleted).
   * Sidebar uses this to swap NavTree for the WorkspaceUnreachable UI.
   */
  currentReachable: boolean | null;
  /** POSIX-relative path of the file the user is currently previewing.
   * Set by Canvas onNodeClick + Sidebar NavTree onClick. Drives the
   * FilePreview right-panel slot. */
  currentFile: string | null;
  /** When a file is opened FROM a content-search hit, the query to scroll to +
   *  flash inside the viewer (MD editor). null on a normal open. Consumed +
   *  cleared by FilePreview once it lands on the match (or gives up). */
  openMatchQuery: string | null;
  /** Saved views in the current workspace. Empty until refresh. */
  views: readonly SavedView[];
  /** Currently active view; null = the workspace's full canvas (all badges). */
  currentView: string | null;
  /** Active scope = a folder relative path that limits which badges Canvas shows.
   * null = the whole workspace. Set by double-clicking a folder badge. */
  folderScope: string | null;
  /** Flush the open MD editor's pending auto-save to disk, now. Registered by
   * MdEditor while mounted; awaited by TopBar before a workspace switch and by
   * FilePreview before closing, so auto-saved edits always land in the CURRENT
   * workspace before the context changes. null when no editor is open. */
  flushEditor: (() => Promise<void>) | null;
  setFlushEditor: (fn: (() => Promise<void>) | null) => void;
  error: string;
  busy: boolean;
  refresh: () => Promise<void>;
  pickAndAdd: () => Promise<void>;
  createDemo: (path: string) => Promise<void>;
  /** Add one or more dropped paths as workspaces (drag-drop from Finder).
   *  Each is registered with setup:true; errors per-path are aggregated
   *  into store.error so the user sees what failed without the others
   *  losing progress. */
  addDroppedPaths: (paths: readonly string[]) => Promise<void>;
  use: (name: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
  /** Rebind an existing workspace name to a new path (remove + re-add with same name). */
  repath: (name: string) => Promise<void>;
  renameWorkspace: (from: string, to: string) => Promise<void>;
  /** Open a file in the preview. `matchQuery` (set when opening from a content
   *  -search hit) is stashed in `openMatchQuery` so the viewer can jump to the
   *  passage; a normal open passes nothing and clears any stale target. */
  setCurrentFile: (file: string | null, matchQuery?: string | null) => void;
  /** Clear the pending search-match target (FilePreview calls this once it has
   *  landed on the match or given up retrying). */
  clearOpenMatchQuery: () => void;
  refreshViews: () => Promise<void>;
  setCurrentView: (id: string | null) => void;
  setFolderScope: (path: string | null) => void;
  createView: (name: string) => Promise<void>;
  renameView: (id: string, name: string) => Promise<void>;
  setViewPrompt: (id: string, prompt: string) => Promise<void>;
  deleteView: (id: string) => Promise<void>;
  /** Create an empty MD note (writes a workspace-relative file) and open it
   * in the preview. The watcher picks it up and badge.list materializes a
   * badge on the next refresh — no extra step needed. */
  createNote: (relPath: string) => Promise<void>;
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

// PATH_NOT_FOUND is encoded as a `[PATH_NOT_FOUND] …` prefix in the error
// message because Electron's contextBridge strips both custom Error
// properties (.code) AND instance-assigned standard ones (.name reverts
// to the prototype default "Error"). Message is the only field that
// reliably survives the bridge. See preload/index.ts.
const isPathNotFound = (err: unknown): boolean =>
  err instanceof Error && err.message.startsWith('[PATH_NOT_FOUND]');

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  current: null,
  currentReachable: null,
  currentFile: null,
  openMatchQuery: null,
  views: [],
  currentView: null,
  folderScope: null,
  flushEditor: null,
  setFlushEditor: (fn: (() => Promise<void>) | null) => set({ flushEditor: fn }),
  error: '',
  busy: false,

  refresh: async () => {
    try {
      const result = (await window.bh.run('workspace.list')) as WorkspaceListResult;
      set({
        workspaces: result.workspaces,
        current: result.current,
        currentReachable: null,
        currentFile: null,
        openMatchQuery: null,
        views: [],
        currentView: null,
        folderScope: null,
        flushEditor: null,
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
          await get().refreshViews();
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
      // setup: true installs the agent-protocol hint into CLAUDE.md and adds
      // .bh/cache/ to .gitignore. Both are non-destructive + idempotent (the
      // hint marker means re-adding the same folder is safe). Without this,
      // desktop-added workspaces silently lack the bridge that makes Claude
      // Code / Codex / Cursor recognise the protocol.
      await window.bh.run('workspace.add', { path, setup: true });
      await get().refresh();
      await startWatcher();
    } catch (err) {
      set({ error: formatError(err) });
    } finally {
      set({ busy: false });
    }
  },

  addDroppedPaths: async (paths: readonly string[]) => {
    if (get().busy || paths.length === 0) return;
    // A dropped folder may switch the active workspace (workspace.use below).
    // Flush the open editor to the CURRENT workspace first, so a pending
    // auto-save can't land in the newly-active workspace's same-named file.
    await get().flushEditor?.();
    set({ busy: true });
    const failures: string[] = [];
    // Snapshot the current workspace list once so we can detect drops
    // of already-registered paths in O(1) and switch instead of erroring.
    const existingByPath = new Map(get().workspaces.map((w) => [w.path, w.name]));
    try {
      for (const path of paths) {
        const alreadyRegistered = existingByPath.get(path);
        if (alreadyRegistered) {
          // Idempotent — same path dropped a second time switches to the
          // existing workspace instead of failing with "already exists".
          try {
            await window.bh.run('workspace.use', { name: alreadyRegistered });
          } catch (err) {
            failures.push(`${path}: ${formatError(err)}`);
          }
          continue;
        }
        try {
          await window.bh.run('workspace.add', { path, setup: true });
        } catch (err) {
          failures.push(`${path}: ${formatError(err)}`);
        }
      }
      await get().refresh();
      await startWatcher();
    } finally {
      set({ busy: false });
      if (failures.length > 0) {
        set({ error: `Drop failed for:\n  ${failures.join('\n  ')}` });
      }
    }
  },

  createDemo: async (path: string) => {
    if (get().busy) return;
    set({ busy: true });
    try {
      // workspace.createDemo creates the folder + seeds the interconnected
      // demo content + registers via workspace.add(setup:true). Idempotent
      // on re-run: existing files aren't overwritten, the workspace add
      // throws on name collision (the user picked a path whose basename
      // collides with an existing workspace), which we surface verbatim.
      await window.bh.run('workspace.createDemo', { path });
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
      // Reset per-workspace state so FilePreview / Canvas don't keep rendering
      // against the *previous* workspace's file paths (currentFile, view,
      // folderScope are all workspace-relative). Without this, an open
      // editor would keep its in-memory contents and write them back into
      // whatever file in the *new* workspace happens to share the same
      // relative path.
      set({
        current: cur.current ? cur.current.name : result.current.name,
        currentReachable: null,
        currentFile: null,
        openMatchQuery: null,
        views: [],
        currentView: null,
        folderScope: null,
        flushEditor: null,
        error: '',
      });
      await startWatcher();
      // Re-fetch reachable + views for the new workspace.
      const wsList = (await window.bh.run('workspace.list')) as WorkspaceListResult;
      const currentWs = wsList.workspaces.find((w) => w.name === wsList.current);
      if (currentWs) {
        try {
          await window.bh.run('workspace.listFiles', { path: currentWs.path });
          set({ currentReachable: true });
          await get().refreshViews();
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
      // Atomic rebind — previously this was workspace.remove +
      // workspace.add + workspace.use, which left the user with no
      // registration if the add failed (invalid path, etc.).
      // workspace.repath does the config rewrite in a single write and
      // preserves name + addedAt + current.
      await window.bh.run('workspace.repath', { name, path: newPath, setup: true });
      await get().refresh();
    } catch (err) {
      set({ error: formatError(err) });
    } finally {
      set({ busy: false });
    }
  },

  renameWorkspace: async (from: string, to: string) => {
    if (get().busy) return;
    set({ busy: true });
    try {
      await window.bh.run('workspace.rename', { from, to });
      // Refresh pulls the new name into `current` if it was the renamed one
      // (core's workspace.rename already updated the config pointer).
      await get().refresh();
    } catch (err) {
      set({ error: formatError(err) });
    } finally {
      set({ busy: false });
    }
  },

  setCurrentFile: (file: string | null, matchQuery: string | null = null) => {
    const { currentFile, flushEditor, current } = get();
    const finish = (): void => {
      // openMatchQuery only rides along when actually opening a file; a normal
      // open (no matchQuery) clears any stale target so it can't fire later.
      set({ currentFile: file, openMatchQuery: file !== null ? matchQuery : null });
      // Track opens per workspace so the palette can surface recents first.
      // Null = closing the preview; nothing to record.
      if (file !== null && current !== null) noteOpenedFile(current, file);
    };
    // Flush the editor we're leaving (while it's still mounted/alive) BEFORE
    // switching or closing — so the last keystrokes always persist. This is the
    // single safe flush point; MdEditor no longer flushes on unmount (which
    // could serialize a torn-down editor as empty and clobber the file).
    if (flushEditor && currentFile !== null && currentFile !== file) {
      void flushEditor().then(finish, finish);
    } else {
      finish();
    }
  },

  clearOpenMatchQuery: () => set({ openMatchQuery: null }),

  refreshViews: async () => {
    try {
      const result = (await window.bh.run('view.list', {})) as ViewListResult;
      set({ views: result.views });
    } catch (err) {
      set({ error: formatError(err) });
    }
  },

  setCurrentView: (id: string | null) => set({ currentView: id }),

  setFolderScope: (path: string | null) => set({ folderScope: path }),

  createView: async (name: string) => {
    try {
      await window.bh.run('view.create', { name });
      await get().refreshViews();
    } catch (err) {
      set({ error: formatError(err) });
    }
  },

  createNote: async (relPath: string) => {
    try {
      // Refuse to clobber an existing file. The New-note UX promises a
      // fresh note; without this guard, typing an existing path
      // (intro.md, etc.) silently overwrites the user's content with
      // a `# <basename>\n\n` stub. workspace.readFile throws
      // PATH_NOT_FOUND if the file doesn't exist; that's the success
      // signal for "safe to create".
      let alreadyExists = false;
      try {
        await window.bh.run('workspace.readFile', { path: relPath });
        alreadyExists = true;
      } catch (err) {
        if (!isPathNotFound(err)) throw err;
      }
      if (alreadyExists) {
        set({
          error: `Note already exists at "${relPath}". Open it from the sidebar to edit.`,
        });
        return;
      }
      const baseName = relPath.split('/').pop() ?? relPath;
      const title = baseName.replace(/\.md$/i, '');
      const body = `# ${title}\n\n`;
      await window.bh.run('workspace.writeFile', { path: relPath, content: body });
      // Route through setCurrentFile (not a bare set) so the editor we're leaving
      // FLUSHES its pending auto-save first — a bare currentFile swap remounts
      // MdEditor, which deliberately does NOT flush on unmount, silently dropping
      // the prior note's last keystrokes.
      get().setCurrentFile(relPath);
    } catch (err) {
      set({ error: formatError(err) });
    }
  },

  renameView: async (id: string, name: string) => {
    try {
      await window.bh.run('view.update', { id, patch: { name } });
      await get().refreshViews();
    } catch (err) {
      set({ error: formatError(err) });
    }
  },

  setViewPrompt: async (id: string, prompt: string) => {
    try {
      await window.bh.run('view.update', { id, patch: { prompt } });
      await get().refreshViews();
    } catch (err) {
      set({ error: formatError(err) });
    }
  },

  deleteView: async (id: string) => {
    try {
      await window.bh.run('view.delete', { id });
      // If the deleted view was active, drop back to main canvas.
      if (get().currentView === id) set({ currentView: null });
      await get().refreshViews();
    } catch (err) {
      set({ error: formatError(err) });
    }
  },

  clearError: () => set({ error: '' }),
}));
