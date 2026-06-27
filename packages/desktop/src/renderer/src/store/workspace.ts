import type { WorkspaceEntry, WorkspaceListResult } from '@basehalf/core';
import { create } from 'zustand';
import { flushAll, flushPane } from '../lib/editorFlush.js';
import { emitEntryRemoved, emitEntryRenamed } from '../lib/fileEvents.js';
import { suspendMirrorWrites } from '../lib/mirrorWrites.js';
import { noteStemFromTitle } from '../lib/noteTitle.js';
import { renamePanelTab } from '../lib/panelTab.js';
import { noteOpenedFile } from '../lib/recent-files.js';

/** The single full-canvas editor overlay's synthetic pane id. The open editor
 *  registers its flusher under this key (editorFlush) so the navigation /
 *  quit-flush gate can persist it before the context changes — there is only
 *  ever one open file, so one stable key suffices (no pane tree). */
export const EDITOR_OVERLAY_PANE_ID = 'editor-overlay';

/** Roots whose BaseHalf scaffold this window has already ensured. `refresh()`
 *  runs on every registry/window broadcast (not just first load), but the
 *  app-update migration only needs to run ONCE per bound root per window — so we
 *  gate `workspace.ensureSetup` here instead of re-running the whole installer
 *  on every broadcast. Module-scoped = per renderer = per window, which is the
 *  right granularity (one window binds one root). */
const ensuredRoots = new Set<string>();

export type CanvasSelection =
  | { kind: 'file'; files: readonly string[]; source: 'canvas' }
  | { kind: 'folder'; folder: string; source: 'canvas' }
  | null;

interface WorkspaceState {
  workspaces: readonly WorkspaceEntry[];
  current: string | null;
  /**
   * Whether the *current* workspace's path is reachable on disk.
   * null = not yet probed; true = ok; false = missing (folder moved/deleted).
   * Sidebar uses this to swap NavTree for the WorkspaceUnreachable UI.
   */
  currentReachable: boolean | null;
  /** POSIX-relative path of the file open in the full-canvas editor overlay, or
   *  null when no file is open (the canvas is the home surface). One file at a
   *  time — opening another replaces it. The NavTree highlight + the overlay
   *  read this. */
  openFile: string | null;
  /** Derived alias of `openFile` kept for the file-tree highlight / focus reads
   *  that still ask for "the active file". Always equals `openFile`. */
  currentFile: string | null;
  /** A just-created note whose title input should auto-focus + select (the
   *  the new-note flow: type the title to name the file). The title input
   *  consumes it once, then clears it. null = no pending request. */
  titleFocusPath: string | null;
  /** Open a file in the full-canvas editor overlay (replacing whatever was open),
   *  flush-gated: the previously-open editor flushes its pending edits first, and
   *  an unresolved disk-conflict / failed write BLOCKS the switch (the user
   *  resolves it before leaving). `matchQuery` scrolls the MD viewer to a
   *  content-search hit. (`pinned` is accepted + ignored — there are no tabs to
   *  pin; kept so every caller stays source-compatible.) */
  openInPanel: (file: string, opts?: { pinned?: boolean; matchQuery?: string | null }) => void;
  /** Close the editor overlay back to the canvas (flush-gated: a clean editor
   *  persists its last edits; an unresolved conflict / failed write keeps it
   *  open so the user resolves it). Esc / the ✕ / ⌘W drive this. */
  closeEditor: () => void;
  /** A git diff open in the overlay (a Source Control row / commit-file click).
   *  Working-tree diffs leave refs unset (staged picks HEAD↔index vs index↔tree);
   *  a commit-file diff sets leftRef/rightRef (parent ↔ commit) + a title.
   *  Takes precedence over `openFile` in the overlay. */
  gitDiff: {
    path: string;
    staged: boolean;
    leftRef?: string;
    rightRef?: string;
    title?: string;
  } | null;
  openGitDiff: (path: string, staged: boolean) => void;
  /** Open a historical commit's change to one file (parent ↔ commit) in the diff
   *  overlay. `parentRef` defaults to `${ref}^`; a root commit shows a full add. */
  openCommitDiff: (path: string, ref: string, parentRef?: string, title?: string) => void;
  closeGitDiff: () => void;
  /** The full-page Git Graph view open over the canvas (a 1:1 Git Graph surface). */
  gitGraphOpen: boolean;
  openGitGraph: () => void;
  closeGitGraph: () => void;
  /** The 3-way merge editor open over the canvas for a conflicted file (its path). */
  mergeFile: string | null;
  openMerge: (path: string) => void;
  closeMerge: () => void;
  /** Rebind the open file's path (the watcher saw it renamed on disk). No flush —
   *  the old path is gone; the editor remounts on the new bytes. No-op when the
   *  renamed file isn't the open one. */
  renameTab: (from: string, to: string) => void;
  /** Card ids currently being inline-edited on the canvas. While non-empty the
   *  canvas disables viewport virtualization, so React Flow can't unmount a card
   *  mid-edit (a pan/zoom that culls the editing tile would otherwise cancel its
   *  debounced autosave → lost keystrokes). Folders are one level, so the canvas
   *  is small and rendering it un-virtualized during an edit is cheap. */
  canvasEditingCardIds: ReadonlySet<string>;
  setCanvasCardEditing: (id: string, editing: boolean) => void;
  /** The current object(s) the user selected on the canvas — UI object state for
   *  the resize/move/connect affordances only. Purely in-renderer: selection does
   *  NOT write to `.bh/`. What the agent sees is the focus mirror — the open file
   *  or the scoped folder's viewport (Canvas's focus effect), not the selection. */
  canvasSelection: CanvasSelection;
  setCanvasSelection: (selection: CanvasSelection) => void;
  /** When a file is opened FROM a content-search hit, the query to scroll to +
   *  flash inside the viewer (MD editor). null on a normal open. Consumed +
   *  cleared by FilePreview once it lands on the match (or gives up). */
  openMatchQuery: string | null;
  /** Active scope = a folder relative path that limits which badges Canvas shows.
   * null = the whole workspace. Set by double-clicking a folder badge. */
  folderScope: string | null;
  error: string;
  /** Transient confirmation line ("Copied report.pdf into …") — the calm
   *  counterpart of `error`. Rendered by App in an info-toned banner;
   *  auto-dismissed there. */
  notice: string;
  busy: boolean;
  /** Workspace paths a live window currently shows (from main) — the welcome
   *  list marks these "Open". Refreshed on a window/registry change broadcast. */
  openRoots: readonly string[];
  refresh: () => Promise<void>;
  /** Re-fetch `openRoots` from main (after a window/registry change). */
  refreshOpenRoots: () => Promise<void>;
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
  /** Clear the pending search-match target (FilePreview calls this once it has
   *  landed on the match or given up retrying). */
  clearOpenMatchQuery: () => void;
  /** Change the canvas folder scope. Async + flush-gated like a file/workspace
   *  switch: a scope change replaces the canvas node set, unmounting any card
   *  being edited inline — so it must flush pending edits first and ABORT (leave
   *  the scope unchanged) if a flush is blocked by an open conflict / failed
   *  write, exactly so a disk conflict can't be navigated away from into data loss. */
  setFolderScope: (path: string | null) => Promise<void>;
  /** Jump the canvas to a folder scope (or the workspace root, `null`) AND close
   *  any open editor — the breadcrumb's "go to an ancestor" action. Flush-gated
   *  exactly like {@link setFolderScope}: a blocked flush (an open conflict /
   *  failed write) aborts the navigation and keeps the editor open, so a disk
   *  conflict can't be navigated past into data loss. */
  navigateToFolder: (path: string | null) => Promise<void>;
  /** Create an empty MD note (writes a workspace-relative file) and open it
   * in the overlay. The watcher picks it up and the canvas re-reads the folder,
   * so the note appears as a tile — no badge is created until you annotate it. */
  createNote: (relPath: string) => Promise<void>;
  /** Create a blank untitled note and open it in the overlay — the
   *  ghost-card / ⌘N / double-click-empty gesture. (A code editor's "new
   *  untitled" adapted to our file=truth model: it's a real `untitled-N.md` in
   *  the user's folder.) `folder` scopes the new file into a workspace-relative
   *  subfolder (the canvas passes its folder scope). */
  newNote: (opts?: { folder?: string | null }) => Promise<void>;
  /** Rename the OPEN note from a typed title — the title IS the filename (minus
   *  `.md`). Flush-gated (the body persists to the old path first; a blocked
   *  flush aborts), then `workspace.renameFile` moves the file and the open
   *  editor rebinds to the landing path. No-op on a blank or unchanged title.
   *  The badge / ref / focus cascade is the watcher's job, not this action's. */
  renameOpenFile: (title: string) => Promise<string | null>;
  /** Context-menu "New File": create an empty file at a workspace-relative path
   *  (collision-suffixed by core, never clobbers) and open it. Returns the
   *  landing path, or null on failure / workspace switch. The watcher refreshes
   *  the tree + canvas. */
  createFile: (relPath: string) => Promise<string | null>;
  /** Context-menu "New Folder": create a folder (collision-suffixed). Returns
   *  the landing path. No editor impact; the watcher refreshes the tree + canvas. */
  createFolder: (relPath: string) => Promise<string | null>;
  /** Context-menu "Rename": move a file/folder, cascading the badge overlay (core
   *  renameEntry). Flush-gated; rebinds the open editor if it pointed at the moved
   *  path (file) or lived under the moved folder. Returns the landing path. */
  renameEntry: (from: string, to: string, kind: 'file' | 'folder') => Promise<string | null>;
  /** Context-menu "Delete": send a file/folder to the OS trash (desktop host) or
   *  permanently remove it (CLI fallback), purging its badge overlay. Closes the
   *  editor first if it was showing the deleted path. Returns true on success. */
  deleteEntry: (path: string, kind: 'file' | 'folder') => Promise<boolean>;
  /** The entry (workspace-relative path) currently in inline-rename mode, or null.
   *  A SHARED signal: whichever surface shows that entry (sidebar row or canvas
   *  card) renders an InlineEditInput for it. Set by the context-menu "Rename"
   *  action and right after a "New File/Folder" create (so the user names it in
   *  place). Cleared on commit/cancel. */
  renamingPath: string | null;
  beginRename: (path: string) => void;
  endRename: () => void;
  /** Clear {@link titleFocusPath} once the title input has consumed it. */
  consumeTitleFocus: () => void;
  /** The path whose body editor should take the cursor next — set when the title
   *  input commits on Enter, so focus drops into that note's first block. Keyed
   *  by PATH (not a bare flag) so that after a title rename remounts the editor,
   *  only the editor on the NEW path consumes it — never the old one on its way
   *  out. The mounted panel editor consumes it once its content has seeded. */
  bodyFocusPath: string | null;
  requestBodyFocus: (path: string) => void;
  consumeBodyFocus: () => void;
  setNotice: (message: string) => void;
  clearNotice: () => void;
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

// OPEN-OR-FOCUS a workspace in the multi-window model. Main focuses the window
// already showing it, else reuses THIS window if it's the welcome/empty one
// (rebind+reload), else opens a NEW window — leaving THIS window on its own
// workspace. Returns whether THIS window was reused (reloaded → tearing down) vs
// a different window focused/created (this window stays → caller resets busy +
// re-lists). NO mirror-write suspend: the only reuse case is the welcome window,
// which has no focused file to mirror, and the other branches don't reload us.
async function openOrFocusWorkspace(name: string): Promise<boolean> {
  const { reused } = await window.bh.openWorkspace(name);
  return reused;
}

// Rebind THIS window to a workspace (or the welcome state, null) and reload it —
// the two in-place flows: removing the open workspace (→ welcome) and repath (the
// bound path moved under this exact window). The old page keeps running for a few
// ms until the reload commits, so SUSPEND the debounced mirror writers (a pending
// one could fire in that gap and write an old-root path into the new binding).
// Callers flush the editors (flushAll) first. See lib/mirrorWrites.
async function reopenHere(name: string | null): Promise<void> {
  suspendMirrorWrites();
  await window.bh.reopenWindow(name);
}

// PATH_NOT_FOUND is encoded as a `[PATH_NOT_FOUND] …` prefix in the error
// message because Electron's contextBridge strips both custom Error
// properties (.code) AND instance-assigned standard ones (.name reverts
// to the prototype default "Error"). Message is the only field that
// reliably survives the bridge. See preload/index.ts.
const isPathNotFound = (err: unknown): boolean =>
  err instanceof Error && err.message.startsWith('[PATH_NOT_FOUND]');

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  // Open `file` in the single full-canvas editor overlay, replacing whatever was
  // open. Flush-gated: when an editor is already open on a DIFFERENT file, flush
  // it first (its last keystrokes persist) and refuse the switch on an
  // unresolved disk conflict — same rule as the old per-pane tab switch.
  const openOverlay = (file: string, opts: { matchQuery?: string | null } = {}): void => {
    const { openFile, current } = get();
    // Re-opening the already-open file is just a (re)scroll to the match.
    const willSwitch = openFile !== null && openFile !== file;
    const finish = (): void => {
      // Workspace switched during the async flush → abort: opening the old root's
      // relative path into the new workspace would show the wrong file.
      if (get().current !== current) return;
      set({
        openFile: file,
        currentFile: file,
        openMatchQuery: opts.matchQuery ?? null,
      });
      if (current !== null) noteOpenedFile(current, file);
      // Focus is mirrored by Canvas's single openFile-aware effect (so closing a
      // file repoints focus back to the folder) — not written here, to avoid a
      // redundant double-write and keep one source of truth.
    };
    // Flush the open editor (still mounted/alive) BEFORE switching its file —
    // last keystrokes persist. A `false` resolution = an unresolved disk
    // conflict; don't switch.
    if (willSwitch) {
      void flushPane(EDITOR_OVERLAY_PANE_ID).then((ok) => {
        if (ok) finish();
        else set({ error: "Save or resolve this file's changes before leaving it." });
      }, finish);
    } else {
      finish();
    }
  };
  return {
    workspaces: [],
    current: null,
    openRoots: [],
    currentReachable: null,
    openFile: null,
    gitDiff: null,
    currentFile: null,
    titleFocusPath: null,
    bodyFocusPath: null,
    renamingPath: null,
    canvasEditingCardIds: new Set<string>(),
    canvasSelection: null,
    openMatchQuery: null,
    folderScope: null,
    error: '',
    notice: '',
    busy: false,

    refresh: async () => {
      try {
        const result = (await window.bh.run('workspace.list')) as WorkspaceListResult;
        // A window's bound workspace never changes IN PLACE — a switch is a
        // window reload that mounts fresh — so a `refresh()` within a live
        // renderer is always the SAME workspace (after add/remove-other, or a
        // RENAME that changes only the name, not the folder). Identity is the
        // bound FOLDER PATH: keep the live UI (open file / selection / scope)
        // whenever the path is unchanged; only a genuinely different path (which
        // a reload would have produced) resets. This also lets a rename update
        // `current` to the new name without yanking the editor.
        const oldPath = get().workspaces.find((w) => w.name === get().current)?.path;
        const newPath = result.workspaces.find((w) => w.name === result.current)?.path;
        if (get().current !== null && oldPath !== undefined && oldPath === newPath) {
          set({
            workspaces: result.workspaces,
            current: result.current,
            currentReachable: null,
            error: '',
          });
        } else {
          set({
            workspaces: result.workspaces,
            current: result.current,
            currentReachable: null,
            openFile: null,
            mergeFile: null,
            currentFile: null,
            canvasSelection: null,
            openMatchQuery: null,
            folderScope: null,
            renamingPath: null,
            error: '',
          });
        }
        const currentWs = result.current
          ? result.workspaces.find((w) => w.name === result.current)
          : null;
        if (currentWs) {
          try {
            await window.bh.run('workspace.listFiles', { path: currentWs.path });
            set({ currentReachable: true });
            // App-update migration path for already-registered workspaces. New
            // folders get setup via workspace.add({ setup:true }); existing
            // folders opened after an update get the same idempotent scaffold
            // here, scoped to this window's bound root. Gated to once per root so
            // routine registry/window broadcasts (which also call refresh) don't
            // re-run the installer; fire-and-forget so it never blocks the canvas.
            if (!ensuredRoots.has(currentWs.path)) {
              ensuredRoots.add(currentWs.path);
              void window.bh.run('workspace.ensureSetup', {}).catch(() => undefined);
            }
            await startWatcher();
            // On every workspace LOAD, reconcile the derived mirror against disk
            // (the on-open liveness sweep core's `add`/`use` no longer runs — it
            // belongs to whichever window OPENS the workspace, bound to its root).
            // A current_focus or a badge gone stale while the app was closed (git
            // checkout / external rm) would otherwise point the agent at a deleted
            // file. Cheap + idempotent; fire-and-forget so a hiccup never blocks
            // the canvas. Both inject this window's bound root via bh:run.
            void window.bh.run('focus.pruneDangling', {}).catch(() => undefined);
            void window.bh.run('badge.pruneDangling', {}).catch(() => undefined);
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

    refreshOpenRoots: async () => {
      try {
        set({ openRoots: await window.bh.getOpenWorkspaces() });
      } catch {
        // Best-effort: a failed fetch just leaves the "Open" markers stale.
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
        // desktop-added workspaces silently lack the bridge that makes coding
        // agents recognise the protocol.
        const added = (await window.bh.run('workspace.add', { path, setup: true })) as {
          workspace: { name: string };
        };
        // Open-or-focus: from the welcome window this REUSES it (reload into the
        // folder); from a window that already has a workspace it focuses the
        // folder's existing window or opens a NEW one — THIS window stays put. No
        // flush gate: the welcome window has no editor, and the new-window branch
        // doesn't reload us. add is idempotent by path (re-adding just opens it).
        const reused = await openOrFocusWorkspace(added.workspace.name);
        if (!reused) await get().refresh(); // this window stayed → surface the new ws
      } catch (err) {
        set({ error: formatError(err) });
      } finally {
        set({ busy: false });
      }
    },

    addDroppedPaths: async (paths: readonly string[]) => {
      if (get().busy || paths.length === 0) return;
      set({ busy: true });
      try {
        // workspace.add is idempotent by path (re-adding a registered folder
        // returns its existing entry) and auto-resolves name collisions, so
        // dropping is just add-then-open. Multiple folders: all register; the last
        // successful one is opened-or-focused (the rest stay registered).
        const failures: string[] = [];
        let lastName: string | null = null;
        for (const path of paths) {
          try {
            const added = (await window.bh.run('workspace.add', { path, setup: true })) as {
              workspace: { name: string };
            };
            lastName = added.workspace.name;
          } catch (err) {
            failures.push(`${path}: ${formatError(err)}`);
          }
        }
        if (lastName !== null) {
          window.bh.notifyWorkspacesChanged(); // all registrations (incl. non-opened) → menus
          // Open-or-focus the last drop (reuse welcome / focus existing / new
          // window). No flush gate — see pickAndAdd.
          const reused = await openOrFocusWorkspace(lastName);
          if (!reused) await get().refresh();
        } else if (failures.length > 0) {
          set({ error: `Drop failed for:\n  ${failures.join('\n  ')}` });
        }
      } catch (err) {
        set({ error: formatError(err) });
      } finally {
        set({ busy: false });
      }
    },

    createDemo: async (path: string) => {
      if (get().busy) return;
      set({ busy: true });
      try {
        // workspace.createDemo creates the folder + seeds the interconnected
        // demo content + registers via workspace.add(setup:true). Idempotent
        // on re-run: existing files aren't overwritten, re-adding the same
        // path returns the existing registration, and a basename collision
        // with a different folder auto-suffixes the name.
        const r = (await window.bh.run('workspace.createDemo', { path })) as {
          workspace: { name: string };
        };
        // Open-or-focus the demo (reuse the welcome window — the common
        // onboarding case — else focus/open its own window). No flush gate.
        const reused = await openOrFocusWorkspace(r.workspace.name);
        if (!reused) await get().refresh();
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
        // Open-or-focus another registered workspace (the command palette's
        // workspace rows): focus its window if open, else open a new one — THIS
        // window stays on its own workspace (the one-window-per-workspace model).
        // Only when THIS window is the welcome window does it get reused+reloaded.
        // No flush gate: this window isn't navigating away unless it's the
        // (editor-less) welcome window.
        const reused = await openOrFocusWorkspace(name);
        if (!reused) await get().refresh();
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
        if ((await flushAll()) === false) {
          set({ error: "Save or resolve this file's changes before removing a workspace." });
          return;
        }
        const wasCurrent = get().current === name;
        await window.bh.run('workspace.remove', { name });
        window.bh.notifyWorkspacesChanged(); // rebuild Open Recent / Dock menu
        if (wasCurrent) {
          // Removing the workspace THIS window has open → reload THIS window to the
          // welcome state (the desktop never auto-promotes a survivor). One window
          // per workspace, so no other window can be on it.
          await reopenHere(null);
        } else {
          // A different workspace was removed — just refresh the list.
          await get().refresh();
        }
      } catch (err) {
        set({ error: formatError(err) });
      } finally {
        set({ busy: false });
      }
    },

    repath: async (name: string) => {
      if (get().busy) return;
      // Hold the busy lock ACROSS the picker (like pickAndAdd) — else other
      // workspace-mutating actions (⌘O / Remove / a palette switch, reachable via
      // the app menu while the native picker sheet is open) can interleave with
      // this repath. The picker runs INSIDE the try so a picker rejection (a
      // platform-level dialog error) can't escape with busy stuck true — that would
      // wedge every workspace action AND disable this screen's own recovery buttons.
      set({ busy: true });
      try {
        const newPath = await window.bh.pickWorkspace();
        if (!newPath) return; // cancelled — finally resets busy
        // Flush+gate the open editor before the reload (see pickAndAdd).
        if ((await flushAll()) === false) {
          set({ error: "Save or resolve this file's changes before relocating a workspace." });
          return;
        }
        // Atomic rebind — previously this was workspace.remove + workspace.add,
        // which left the user with no registration if the add failed. repath does
        // the config rewrite in a single write and preserves name + addedAt.
        const wasCurrent = get().current === name;
        await window.bh.run('workspace.repath', { name, path: newPath, setup: true });
        window.bh.notifyWorkspacesChanged(); // rebuild Open Recent / Dock menu
        if (wasCurrent) {
          // The window↔workspace binding is by PATH; this workspace just moved,
          // so THIS window's binding is stale — reopen it at the new path (rebind
          // + reload). One window per workspace, so no sibling window is affected.
          await reopenHere(name);
        } else {
          await get().refresh();
        }
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
        if ((await flushAll()) === false) {
          set({ error: "Save or resolve this file's changes before renaming a workspace." });
          return;
        }
        await window.bh.run('workspace.rename', { from, to });
        window.bh.notifyWorkspacesChanged(); // rebuild Open Recent / Dock menu
        // Refresh pulls the new name into `current` if it was the renamed one
        // (core's workspace.rename already updated the config pointer).
        await get().refresh();
      } catch (err) {
        set({ error: formatError(err) });
      } finally {
        set({ busy: false });
      }
    },

    openInPanel: (file, opts = {}) => openOverlay(file, { matchQuery: opts.matchQuery }),

    closeEditor: () => {
      const { openFile, current } = get();
      if (openFile === null) return;
      const finish = (): void => {
        // Workspace switched during the flush → the new root already nulled
        // openFile; nothing to close.
        if (get().current !== current) return;
        set({ openFile: null, currentFile: null, openMatchQuery: null });
      };
      // Flush the open editor before tearing it down — its last keystrokes
      // persist. An unresolved conflict / failed write keeps it open so the user
      // resolves it (the editor's own banner offers the escape hatch).
      void flushPane(EDITOR_OVERLAY_PANE_ID).then((ok) => {
        if (ok) finish();
        else set({ error: "Save or resolve this file's changes before closing it." });
      }, finish);
    },

    openGitDiff: (path, staged) => {
      // Flush any open editor first (its last edits persist; a conflict blocks),
      // then swap the overlay to the read-only diff.
      void flushPane(EDITOR_OVERLAY_PANE_ID).then((ok) => {
        if (ok) set({ openFile: null, gitDiff: { path, staged } });
      });
    },
    openCommitDiff: (path, ref, parentRef, title) => {
      void flushPane(EDITOR_OVERLAY_PANE_ID).then((ok) => {
        if (ok)
          set({
            openFile: null,
            gitDiff: { path, staged: false, leftRef: parentRef ?? `${ref}^`, rightRef: ref, title },
          });
      });
    },
    closeGitDiff: () => set({ gitDiff: null }),
    gitGraphOpen: false,
    openGitGraph: () => {
      void flushPane(EDITOR_OVERLAY_PANE_ID).then((ok) => {
        if (ok) set({ openFile: null, gitDiff: null, gitGraphOpen: true });
      });
    },
    closeGitGraph: () => set({ gitGraphOpen: false }),
    mergeFile: null,
    openMerge: (path) => {
      void flushPane(EDITOR_OVERLAY_PANE_ID).then((ok) => {
        if (ok) set({ openFile: null, gitDiff: null, gitGraphOpen: false, mergeFile: path });
      });
    },
    closeMerge: () => set({ mergeFile: null }),

    consumeTitleFocus: () => set({ titleFocusPath: null }),

    requestBodyFocus: (path) => set({ bodyFocusPath: path }),
    consumeBodyFocus: () => set({ bodyFocusPath: null }),

    renameOpenFile: async (title) => {
      const { openFile, current } = get();
      if (openFile === null) return null;
      const stem = noteStemFromTitle(title);
      // Blank or unchanged title → no rename, but report the current path so the
      // caller can still act on it (e.g. drop focus into the body on Enter).
      if (stem === null) return openFile;
      const slash = openFile.lastIndexOf('/');
      const dir = slash === -1 ? '' : openFile.slice(0, slash);
      const desired = dir === '' ? `${stem}.md` : `${dir}/${stem}.md`;
      if (desired === openFile) return openFile;
      // Persist the body to the OLD path before moving it — a blocked flush
      // (open conflict / failed write) aborts so we never rename out from under
      // unsaved edits. Same gate as closeEditor / a file switch.
      if ((await flushPane(EDITOR_OVERLAY_PANE_ID)) === false) {
        set({ error: "Save or resolve this file's changes before renaming it." });
        return null;
      }
      try {
        const res = (await window.bh.run('workspace.renameFile', {
          from: openFile,
          to: desired,
        })) as { from: string; to: string; renamed: boolean };
        // Workspace switched during the flush / IPC → the new root already reset
        // the open file; don't clobber it. Rebind eagerly to the landing path so
        // the editor follows immediately (the watcher's later 'rename' event then
        // no-ops in renameTab, since openFile already equals `to`). The badge /
        // ref / focus cascade rides that same watcher event.
        if (get().current !== current) return null;
        if (res.renamed) {
          set({ openFile: res.to, currentFile: res.to });
          return res.to;
        }
        return openFile;
      } catch (err) {
        set({ error: formatError(err) });
        return null;
      }
    },

    renameTab: (from, to) =>
      set((s) => {
        // Rebind the open file's path in place. No flush — the old path is gone on
        // disk; the editor remounts on `to`.
        const openFile = s.openFile === null ? null : renamePanelTab(s.openFile, from, to);
        const canvasSelection =
          s.canvasSelection?.kind === 'file'
            ? {
                ...s.canvasSelection,
                files: s.canvasSelection.files.map((file) => renamePanelTab(file, from, to)),
              }
            : s.canvasSelection?.kind === 'folder' && s.canvasSelection.folder === from
              ? { ...s.canvasSelection, folder: to }
              : s.canvasSelection;
        return { openFile, currentFile: openFile, canvasSelection };
      }),

    setCanvasCardEditing: (id, editing) =>
      set((s) => {
        const has = s.canvasEditingCardIds.has(id);
        if (editing === has) return {}; // no-op: avoid churning renders
        const next = new Set(s.canvasEditingCardIds);
        if (editing) next.add(id);
        else next.delete(id);
        return { canvasEditingCardIds: next };
      }),

    setCanvasSelection: (selection) => set({ canvasSelection: selection }),

    clearOpenMatchQuery: () => set({ openMatchQuery: null }),

    setFolderScope: async (path: string | null) => {
      // Flush (and gate on) every mounted editor before swapping the canvas: an
      // inline-editing card whose file leaves the new scope unmounts, and an
      // un-flushed / conflicted edit would vanish. A blocked flush aborts the
      // scope change — same rule as a file switch / workspace switch.
      if ((await flushAll()) === false) return;
      // Drop any pending inline-rename: the entry being named may not exist at the
      // new scope, which would otherwise strand `renamingPath` with no input shown.
      set({ folderScope: path, renamingPath: null });
    },

    navigateToFolder: async (path: string | null) => {
      const current = get().current;
      // Flush + gate every mounted editor (same rule as setFolderScope / a file
      // switch). A blocked flush aborts — keep the editor open so the conflict is
      // resolved rather than silently navigated past into data loss.
      if ((await flushAll()) === false) {
        set({ error: "Save or resolve this file's changes before leaving it." });
        return;
      }
      // Workspace switched during the flush → the new root already reset scope +
      // open file; don't clobber it.
      if (get().current !== current) return;
      set({
        openFile: null,
        currentFile: null,
        openMatchQuery: null,
        folderScope: path,
        renamingPath: null,
      });
    },

    createNote: async (relPath: string) => {
      try {
        const ws = get().current;
        // Flush + gate the OPEN editor FIRST. If it's blocked on an unresolved
        // disk-conflict banner the switch below can't proceed — so creating the
        // stub now would leave an orphan empty note on disk that we never open.
        // (A clean flush also lands the current note's pending edits before we
        // navigate away.)
        if ((await flushAll()) === false) {
          set({
            error: "Save or resolve this file's changes before creating a note.",
          });
          return;
        }
        // Workspace switched during the flush → abort, so the readFile/writeFile
        // below (which resolve the active workspace lazily) can't create + open the
        // note in the wrong root.
        if (get().current !== ws) return;
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
        // Blank body — the filename IS the title now (shown in the title input;
        // see NoteTitle), so a `# <basename>` heading would just duplicate it.
        await window.bh.run('workspace.writeFile', { path: relPath, content: '' });
        // Open it (via openInPanel so the editor we're leaving FLUSHES its pending
        // auto-save first — a bare openFile swap remounts MdEditor, which
        // deliberately does NOT flush on unmount, silently dropping the prior
        // note's last keystrokes).
        get().openInPanel(relPath);
      } catch (err) {
        set({ error: formatError(err) });
      }
    },

    newNote: async (opts) => {
      const folder = opts?.folder ?? null;
      const ws = get().current;
      // No workspace open → nowhere to create the file; quiet no-op (⌘N and
      // the palette are reachable from the welcome state).
      if (ws === null) return;
      // Persist the open editor before it switches to the new note (and gate on an
      // unresolved conflict, so we don't create an orphan stub we can't open).
      // openInPanel below also flushes — a no-op after this clean flush.
      if ((await flushPane(EDITOR_OVERLAY_PANE_ID)) === false) {
        set({ error: "Save or resolve this file's changes before opening a new note." });
        return;
      }
      // Workspace switched during the flush → abort, so we don't create the untitled
      // note in the wrong root.
      if (get().current !== ws) return;
      try {
        // Find a free untitled name — CHECK each candidate (incl. the last) so we
        // never overwrite an existing note. readFile throws PATH_NOT_FOUND when free.
        let name = '';
        for (let i = 0; i < 1000; i++) {
          const base = i === 0 ? 'untitled.md' : `untitled-${i}.md`;
          const candidate = folder === null ? base : `${folder}/${base}`;
          let taken = false;
          try {
            await window.bh.run('workspace.readFile', { path: candidate });
            taken = true;
          } catch (err) {
            if (!isPathNotFound(err)) throw err;
          }
          if (!taken) {
            name = candidate;
            break;
          }
        }
        if (name === '') {
          set({ error: 'Too many untitled notes — name one before creating another.' });
          return;
        }
        // Re-check RIGHT before writing: the free-name search above awaits one or
        // more readFile calls, during which the workspace could switch — without this
        // the note would be created + opened in the wrong root.
        if (get().current !== ws) return;
        // Blank file — MdEditor seeds an editable paragraph for an empty note.
        await window.bh.run('workspace.writeFile', { path: name, content: '' });
        // And again after the write IPC: a switch here would otherwise open the same
        // relative name in the NEW root, hiding the note we just created in the old one.
        if (get().current !== ws) return;
        get().openInPanel(name);
        // New-note flow: focus + select the title so typing names the file.
        set({ titleFocusPath: name });
      } catch (err) {
        set({ error: formatError(err) });
      }
    },

    createFile: async (relPath) => {
      const ws = get().current;
      if (ws === null) return null;
      // No editor switch (the file-tree "New File" creates + inline-names, it
      // doesn't open the big editor — that's ⌘N / double-click). So no flush is
      // needed; the watcher's add event surfaces the new row/card.
      try {
        const res = (await window.bh.run('workspace.createFile', { path: relPath })) as {
          path: string;
        };
        return get().current === ws ? res.path : null;
      } catch (err) {
        set({ error: formatError(err) });
        return null;
      }
    },

    createFolder: async (relPath) => {
      const ws = get().current;
      if (ws === null) return null;
      // No editor impact (a new empty folder opens nothing), so no flush needed —
      // the watcher's add event refreshes the tree + canvas.
      try {
        const res = (await window.bh.run('workspace.createFolder', { path: relPath })) as {
          path: string;
        };
        return get().current === ws ? res.path : null;
      } catch (err) {
        set({ error: formatError(err) });
        return null;
      }
    },

    renameEntry: async (from, to, kind) => {
      const ws = get().current;
      if (ws === null) return null;
      if (from === to) return from;
      // A rename can move the OPEN file (or its containing folder): persist edits
      // to the old path first and abort on an unresolved conflict — same gate as
      // renameOpenFile.
      if ((await flushAll()) === false) {
        set({ error: "Save or resolve this file's changes before renaming." });
        return null;
      }
      if (get().current !== ws) return null;
      try {
        const res = (await window.bh.run('workspace.renameEntry', { from, to, kind })) as {
          from: string;
          to: string;
          renamed: boolean;
        };
        if (get().current !== ws) return null;
        if (res.renamed) {
          // Rebind the open editor if it pointed at the moved path. Exact match for
          // a file; prefix-remap for a child of a renamed folder (the watcher's
          // per-child rename events would also rebind, but do it now for immediacy).
          const open = get().openFile;
          if (open !== null) {
            const rebound =
              kind === 'file' && open === from
                ? res.to
                : kind === 'folder' && open.startsWith(`${from}/`)
                  ? res.to + open.slice(from.length)
                  : null;
            if (rebound !== null) set({ openFile: rebound, currentFile: rebound });
          }
          // If the canvas is scoped INTO the renamed folder (or it IS the folder),
          // remap folderScope the same way — else the canvas keeps pointing at the
          // old path and its next reload throws PATH_NOT_FOUND (a stuck dead scope).
          if (kind === 'folder') {
            const scope = get().folderScope;
            if (scope !== null && (scope === from || scope.startsWith(`${from}/`))) {
              set({ folderScope: res.to + scope.slice(from.length) });
            }
          }
          // Optimistic UI: remap the card/row in place NOW rather than waiting for
          // the watcher's rename event + reload (the same round-trip lag as delete).
          emitEntryRenamed(from, res.to, kind);
        }
        return res.renamed ? res.to : from;
      } catch (err) {
        set({ error: formatError(err) });
        return null;
      }
    },

    deleteEntry: async (path, kind) => {
      const ws = get().current;
      if (ws === null) return false;
      // If the open file is the target (or lives inside a deleted folder), drop it
      // WITHOUT flushing: flushing would rewrite a file we're about to delete, and
      // a conflict flush must not block a delete. The editor remounts to empty.
      const open = get().openFile;
      const prevCurrent = get().currentFile;
      const prevMatchQuery = get().openMatchQuery;
      const wasOpen =
        open !== null && (open === path || (kind === 'folder' && open.startsWith(`${path}/`)));
      if (wasOpen) set({ openFile: null, currentFile: null, openMatchQuery: null });
      try {
        const res = (await window.bh.run('workspace.deleteEntry', { path, kind })) as {
          deleted: boolean;
        };
        // Confine the optimistic update to the workspace the delete was issued in
        // (emitEntryRemoved is a global bus): if the user switched workspaces during
        // the trash IPC, firing `path` — relative to the OLD root — would wrongly
        // drop a same-named entry in the NEW workspace. Mirrors createFile/renameEntry.
        if (res.deleted && get().current === ws) {
          // If the canvas is scoped INTO the just-deleted folder (or it IS that
          // folder), raise the scope to its parent (or root) so the canvas doesn't
          // dead-end on a vanished path (stale child cards + a PATH_NOT_FOUND banner).
          if (kind === 'folder') {
            const scope = get().folderScope;
            if (scope !== null && (scope === path || scope.startsWith(`${path}/`))) {
              const slash = path.lastIndexOf('/');
              set({ folderScope: slash === -1 ? null : path.slice(0, slash), renamingPath: null });
            }
          }
          // Optimistic UI: drop the card/row NOW instead of waiting for the watcher
          // to observe the unlink (chokidar latency + the canvas's 1100ms settle).
          // The watcher's later event just confirms an already-gone entry.
          emitEntryRemoved(path, kind);
        }
        return res.deleted;
      } catch (err) {
        // The disk delete failed (trash rejected / locked / path gone) — the entry
        // still exists, so restore the editor we optimistically closed rather than
        // leaving the user on a blank pane with only a toast.
        if (wasOpen)
          set({ openFile: open, currentFile: prevCurrent, openMatchQuery: prevMatchQuery });
        set({ error: formatError(err) });
        return false;
      }
    },

    beginRename: (path) => set({ renamingPath: path }),
    endRename: () => set({ renamingPath: null }),

    setNotice: (message: string) => set({ notice: message }),
    clearNotice: () => set({ notice: '' }),

    clearError: () => set({ error: '' }),
  };
});
