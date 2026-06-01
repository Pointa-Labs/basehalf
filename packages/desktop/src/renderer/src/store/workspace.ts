import type {
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
  /** POSIX-relative path of the ACTIVE right-panel tab (the file whose editor is
   * mounted). Opened from the sidebar / palette / inbound list. null = no active
   * tab. (Canvas double-click opens a floating preview instead — separate path.) */
  currentFile: string | null;
  /** Files open as tabs in the right panel, in tab order. The active one is
   * `currentFile`; only the active tab has a live (mounted) editor. */
  tabs: string[];
  /** Whether the right panel is shown — the top-right toggle. Tabs persist while
   * hidden, so toggling back restores them. */
  rightPanelOpen: boolean;
  /** Show/hide the right panel without losing its tabs (the top-right toggle). */
  toggleRightPanel: () => void;
  /** Close a right-panel tab. Closing the ACTIVE tab flushes its editor first
   * (same gate as a file switch) and activates a neighbor; a non-active tab
   * isn't mounted, so it just drops. */
  closeTab: (file: string, opts?: { bypassFlush?: boolean }) => void;
  /** When a file is opened FROM a content-search hit, the query to scroll to +
   *  flash inside the viewer (MD editor). null on a normal open. Consumed +
   *  cleared by FilePreview once it lands on the match (or gives up). */
  openMatchQuery: string | null;
  /** Active scope = a folder relative path that limits which badges Canvas shows.
   * null = the whole workspace. Set by double-clicking a folder badge. */
  folderScope: string | null;
  /** Flush the open MD editor's pending auto-save to disk, now. Registered by
   * MdEditor while mounted; awaited by TopBar before a workspace switch and by
   * FilePreview before closing, so auto-saved edits always land in the CURRENT
   * workspace before the context changes. null when no editor is open. */
  // Resolves `false` when an unresolved disk-conflict banner is up (or one
  // surfaces mid-flush) — navigation MUST NOT proceed, so the user is forced to
  // pick Keep/Reload rather than silently clobbering either side. `true` = the
  // editor flushed (or had nothing pending) and it's safe to switch/close.
  flushEditor: (() => Promise<boolean>) | null;
  setFlushEditor: (fn: (() => Promise<boolean>) | null) => void;
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
  setCurrentFile: (
    file: string | null,
    matchQuery?: string | null,
    opts?: { bypassFlush?: boolean },
  ) => void;
  /** Clear the pending search-match target (FilePreview calls this once it has
   *  landed on the match or given up retrying). */
  clearOpenMatchQuery: () => void;
  setFolderScope: (path: string | null) => void;
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
  tabs: [],
  rightPanelOpen: true,
  openMatchQuery: null,
  // (saved-view state removed — a folder is the grouping unit now)
  folderScope: null,
  flushEditor: null,
  setFlushEditor: (fn: (() => Promise<boolean>) | null) => set({ flushEditor: fn }),
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
        tabs: [],
        openMatchQuery: null,
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
      // Flush+gate the open editor BEFORE refresh() unmounts it (nulls
      // currentFile): persist its edits to the CURRENT workspace, and block on
      // an unresolved conflict / failed save rather than dropping them silently.
      // (After the picker, so cancelling it never surfaces a spurious error.)
      if ((await get().flushEditor?.()) === false) {
        set({ error: "Save or resolve this file's changes before adding a workspace." });
        return;
      }
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
    // Claim the busy lock BEFORE the async flush below (an IPC round-trip), so a
    // second drop can't race in during it.
    set({ busy: true });
    // A dropped folder may switch the active workspace (workspace.use below).
    // Flush the open editor to the CURRENT workspace first, so a pending
    // auto-save can't land in the newly-active workspace's same-named file.
    // A `false` flush = an unresolved conflict is open: block the switch so the
    // user resolves it against THIS workspace's file before we re-point roots.
    // A REJECTED flush (torn-down editor) is non-blocking — proceed, matching
    // setCurrentFile — and the `.catch` keeps it from escaping past this `await`
    // and leaking busy=true (the await is outside the try/finally below).
    if (
      (await get()
        .flushEditor?.()
        .catch(() => undefined)) === false
    ) {
      set({
        busy: false,
        error: "Save or resolve this file's changes before changing workspace.",
      });
      return;
    }
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
      // Flush+gate the open editor before refresh() unmounts it (see pickAndAdd).
      if ((await get().flushEditor?.()) === false) {
        set({ error: "Save or resolve this file's changes before creating the demo workspace." });
        return;
      }
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
    // Claim the busy lock BEFORE the async flush below: that flush is an IPC
    // round-trip, and leaving busy=false during it would let a second switch
    // (or any busy-gated action) race in on top of this one.
    set({ busy: true });
    // Flush the open editor to the CURRENT workspace before re-pointing roots,
    // so its pending edits land in the right file. A `false` flush = an
    // unresolved conflict: block the switch and send the user to Keep/Reload.
    // A REJECTED flush (torn-down editor) is non-blocking — proceed, matching
    // setCurrentFile — and the `.catch` keeps it from escaping past this `await`
    // and leaking busy=true (the await is outside the try/finally below).
    if (
      (await get()
        .flushEditor?.()
        .catch(() => undefined)) === false
    ) {
      set({
        busy: false,
        error: "Save or resolve this file's changes before changing workspace.",
      });
      return;
    }
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
        tabs: [],
        openMatchQuery: null,
        folderScope: null,
        flushEditor: null,
        error: '',
      });
      await startWatcher();
      // Re-fetch reachable state for the new workspace.
      const wsList = (await window.bh.run('workspace.list')) as WorkspaceListResult;
      const currentWs = wsList.workspaces.find((w) => w.name === wsList.current);
      if (currentWs) {
        try {
          await window.bh.run('workspace.listFiles', { path: currentWs.path });
          set({ currentReachable: true });
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
      // Flush+gate the open editor before refresh() unmounts it (see pickAndAdd).
      if ((await get().flushEditor?.()) === false) {
        set({ error: "Save or resolve this file's changes before removing a workspace." });
        return;
      }
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
      // Flush+gate the open editor before refresh() unmounts it (see pickAndAdd).
      if ((await get().flushEditor?.()) === false) {
        set({ error: "Save or resolve this file's changes before relocating a workspace." });
        return;
      }
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
      // Flush+gate the open editor before refresh() unmounts it (see pickAndAdd).
      // rename keeps the same folder/files, so a clean flush persists; only an
      // unresolved conflict / failed save blocks.
      if ((await get().flushEditor?.()) === false) {
        set({ error: "Save or resolve this file's changes before renaming a workspace." });
        return;
      }
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

  setCurrentFile: (
    file: string | null,
    matchQuery: string | null = null,
    opts: { bypassFlush?: boolean } = {},
  ) => {
    const { currentFile, flushEditor, current } = get();
    const finish = (): void => {
      // openMatchQuery only rides along when actually opening a file; a normal
      // open (no matchQuery) clears any stale target so it can't fire later.
      set((s) => ({
        currentFile: file,
        // Opening a file makes it the active tab (appending it if new) and reveals
        // the panel. A null (clear, e.g. workspace reset path) leaves tabs +
        // the panel-open flag untouched.
        tabs: file !== null && !s.tabs.includes(file) ? [...s.tabs, file] : s.tabs,
        rightPanelOpen: file !== null ? true : s.rightPanelOpen,
        openMatchQuery: file !== null ? matchQuery : null,
      }));
      // Track opens per workspace so the palette can surface recents first.
      // Null = closing the preview; nothing to record.
      if (file !== null && current !== null) noteOpenedFile(current, file);
    };
    // bypassFlush: the file we're leaving was renamed/moved out from under the
    // editor (App.tsx rename rebind). Its OLD path is gone on disk, so flushing
    // to it would RESURRECT a deleted file, and the conflict gate would trap the
    // editor on a path that no longer exists. Rebind straight through — the fresh
    // MdEditor mount loads the new path's current bytes (any unsaved local edits
    // to the vanished path are intentionally discarded, not written to a ghost).
    if (opts.bypassFlush) {
      finish();
      return;
    }
    // Flush the editor we're leaving (while it's still mounted/alive) BEFORE
    // switching or closing — so the last keystrokes always persist. This is the
    // single safe flush point; MdEditor no longer flushes on unmount (which
    // could serialize a torn-down editor as empty and clobber the file).
    if (flushEditor && currentFile !== null && currentFile !== file) {
      // A `false` resolution means an unresolved disk conflict is open — don't
      // switch/close (that would silently drop local OR clobber the external
      // edit); keep the editor up and nudge the user to the Keep/Reload buttons.
      void flushEditor().then((ok) => {
        if (ok) finish();
        else set({ error: "Save or resolve this file's changes before leaving it." });
      }, finish);
    } else {
      finish();
    }
  },

  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),

  closeTab: (file, opts = {}) => {
    const { tabs, currentFile, flushEditor } = get();
    const idx = tabs.indexOf(file);
    if (idx === -1) return;
    const nextTabs = tabs.filter((t) => t !== file);
    const finish = (): void => {
      if (currentFile === file) {
        // Activate the tab that slid into this slot (the right neighbor), else the
        // left neighbor, else nothing — the panel goes empty when the last closes.
        const nextActive = nextTabs[idx] ?? nextTabs[idx - 1] ?? null;
        set({ tabs: nextTabs, currentFile: nextActive, openMatchQuery: null });
      } else {
        set({ tabs: nextTabs });
      }
    };
    // Only the ACTIVE tab has a live editor. Closing it follows the same
    // flush-before-leave gate as a file switch — a `false` (unresolved conflict /
    // failed write) keeps the tab so the user resolves it. A non-active tab isn't
    // mounted, so there's nothing to flush — just drop it.
    if (currentFile === file && flushEditor && opts.bypassFlush !== true) {
      void flushEditor().then((ok) => {
        if (ok) finish();
        else set({ error: "Save or resolve this file's changes before closing it." });
      }, finish);
    } else {
      finish();
    }
  },

  clearOpenMatchQuery: () => set({ openMatchQuery: null }),

  setFolderScope: (path: string | null) => set({ folderScope: path }),

  createNote: async (relPath: string) => {
    try {
      // Flush + gate the OPEN editor FIRST. If it's blocked on an unresolved
      // disk-conflict banner the switch below can't proceed — so creating the
      // stub now would leave an orphan empty note on disk that we never open.
      // (A clean flush also lands the current note's pending edits before we
      // navigate away.)
      if ((await get().flushEditor?.()) === false) {
        set({
          error: "Save or resolve this file's changes before creating a note.",
        });
        return;
      }
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

  clearError: () => set({ error: '' }),
}));
