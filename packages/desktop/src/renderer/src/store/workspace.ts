import type {
  WorkspaceCurrentResult,
  WorkspaceEntry,
  WorkspaceListResult,
  WorkspaceUseResult,
} from '@basehalf/core';
import { create } from 'zustand';
import { flushAll, flushPane } from '../lib/editorFlush.js';
import { loadPanes, renamePanes, savePanes } from '../lib/layoutPersist.js';
import {
  type PaneNode,
  adoptPaneIds,
  allLeaves,
  closeInLeaf,
  emptyLeaf,
  findLeaf,
  firstLeaf,
  leafCount,
  moveInLeaf,
  normalizeTree,
  openInLeaf,
  pinInLeaf,
  removeLeaf,
  renameInLeaf,
  setFraction,
  splitLeaf,
  updateLeaf,
} from '../lib/paneTree.js';
import { badgeTabId, isBadgeTab, renamePanelTab } from '../lib/panelTab.js';
import { noteOpenedFile } from '../lib/recent-files.js';

/** Where a dragged tab lands on a pane: the center (move in as a tab) or one of
 *  the four edges (split that way). */
export type DropRegion = 'center' | 'left' | 'right' | 'up' | 'down';

/** The active pane's active file — the derived `currentFile` convenience. */
const deriveCurrent = (tree: PaneNode, activePaneId: string): string | null =>
  findLeaf(tree, activePaneId)?.activeFile ?? null;

export type CanvasSelection =
  | { kind: 'file'; files: readonly string[]; source: 'canvas' }
  | { kind: 'folder'; folder: string; source: 'canvas' }
  | null;

/** The pane state to load when a workspace opens: its saved layout (tabs +
 *  splits) if any, else a fresh empty pane. Reveals the panel when it restores
 *  open tabs. (Stale tabs for deleted files degrade gracefully — the editor
 *  surfaces a not-found error you can close.) */
const paneResetFor = (
  ws: string | null,
): { paneTree: PaneNode; activePaneId: string; rightPanelOpen: boolean } => {
  const restored = loadPanes(ws);
  if (restored) {
    // Heal a degenerate persisted layout (empty NON-sole panes — e.g. two empty
    // panes side by side saved by an earlier build) instead of resurrecting it
    // verbatim. loadPanes only checks "≥1 leaf", so without this an empty split
    // survives forever across reloads.
    const tree = normalizeTree(restored.paneTree);
    // Advance the pane-id counter past the restored ids so a later split / new pane
    // can't collide with one of them (which would corrupt findLeaf / tab moves).
    adoptPaneIds(tree);
    const activePaneId = findLeaf(tree, restored.activePaneId)
      ? restored.activePaneId
      : firstLeaf(tree).id;
    const rightPanelOpen = allLeaves(tree).some((l) => l.tabs.length > 0);
    return { paneTree: tree, activePaneId, rightPanelOpen };
  }
  const fresh = emptyLeaf();
  return { paneTree: fresh, activePaneId: fresh.id, rightPanelOpen: false };
};

interface WorkspaceState {
  workspaces: readonly WorkspaceEntry[];
  current: string | null;
  /**
   * Whether the *current* workspace's path is reachable on disk.
   * null = not yet probed; true = ok; false = missing (folder moved/deleted).
   * Sidebar uses this to swap NavTree for the WorkspaceUnreachable UI.
   */
  currentReachable: boolean | null;
  /** POSIX-relative path of the ACTIVE pane's active tab (derived convenience for
   * the file-tree highlight / focus). null = no active tab anywhere. */
  currentFile: string | null;
  /** The right panel's pane tree (a binary split tree of editor groups). Each
   * leaf pane has its own tabs + active + preview slot; only mounted (active per
   * pane) editors exist. See lib/paneTree. */
  paneTree: PaneNode;
  /** Which leaf pane is focused — drives `currentFile` and where a sidebar /
   * palette open lands by default. */
  activePaneId: string;
  /** Whether the right panel is shown — the top-right toggle. Panes persist while
   * hidden, so toggling back restores them. */
  rightPanelOpen: boolean;
  /** Show/hide the right panel without losing its panes (the top-right toggle). */
  toggleRightPanel: () => void;
  /** Open a file in a pane (default = the active pane), and activate it
   * (flush-gated). Default is a PREVIEW open (replaces the pane's preview slot);
   * `pinned` opens/keeps a permanent tab. Re-opening an already-open file just
   * activates it (and promotes it if `pinned`). Reveals the panel. */
  openInPanel: (
    file: string,
    opts?: { pinned?: boolean; matchQuery?: string | null; paneId?: string },
  ) => void;
  /** Open this file's BaseHalf-defined File Badge page as a right-panel tab. */
  openBadgeInPanel: (file: string, opts?: { paneId?: string }) => void;
  /** Promote a pane's preview tab to a permanent (pinned) tab. */
  pinTab: (paneId: string, file: string) => void;
  /** Drop the currently-dragged tab (store.tabDrag) onto a pane's TAB STRIP at
   *  `toIndex`. Same pane → reorder; a DIFFERENT pane → move it in at that
   *  position (collapsing the source pane if it empties). */
  dropTabOnStrip: (toPaneId: string, toIndex: number) => void;
  /** Rebind an open tab's path across ALL panes (the watcher saw it renamed on
   * disk). No flush — the old path is gone; the editor remounts on the new bytes. */
  renameTab: (from: string, to: string) => void;
  /** Close a tab in a pane. Closing the ACTIVE tab flushes that pane's editor
   * first; emptying a non-root pane removes it (collapsing the split). */
  closeTab: (paneId: string, file: string, opts?: { bypassFlush?: boolean }) => void;
  /** Focus a pane (its active file becomes `currentFile`). */
  setActivePane: (paneId: string) => void;
  /** Split a pane and open `file` (pinned) in the new pane, which becomes active.
   * direction 'row' = side by side, 'column' = stacked; `before` puts the new
   * pane first (left / top). The drop overlay drives this. */
  splitPane: (
    sourcePaneId: string,
    direction: 'row' | 'column',
    file: string,
    opts?: { before?: boolean },
  ) => void;
  /** Set a split node's divider fraction (0..1 for child `a`). */
  setPaneFraction: (splitId: string, fraction: number) => void;
  /** A tab currently being dragged — drives the cross-pane drop overlay. null
   *  when no tab drag is in flight. */
  tabDrag: { file: string; sourcePaneId: string } | null;
  setTabDrag: (drag: { file: string; sourcePaneId: string } | null) => void;
  /** Drop a dragged tab onto a pane: 'center' MOVES it in as a tab; an edge
   *  SPLITS that pane in that direction and moves it into the new pane. Removes
   *  it from the source pane (collapsing the source if it empties). */
  dropTab: (file: string, fromPaneId: string, targetPaneId: string, region: DropRegion) => void;
  /** A badge being dragged from the CANVAS over the right panel — its live dock
   *  target (which pane + which drop region). null when the cursor is over the
   *  canvas (normal reposition / autopan) or no badge drag is in flight. Drives
   *  the panel's dock highlight AND suppresses canvas auto-pan, so the gesture can
   *  settle onto the panel instead of the map sliding out from under it. */
  canvasDockDrag: { paneId: string; region: DropRegion } | null;
  setCanvasDockDrag: (target: { paneId: string; region: DropRegion } | null) => void;
  /** Open a canvas badge in the right panel at a drop region (the canvas→panel
   *  drag-dock lands here): 'center' adds it as a tab in `paneId`; an edge splits
   *  that pane and opens it in the new pane. A reference open (like the sidebar) —
   *  the badge stays on the canvas. */
  dockBadge: (file: string, paneId: string, region: DropRegion) => void;
  /** The current object(s) the user selected on the canvas. This is UI object
   *  state only: resize/move/connect affordances read it, while Agent Context
   *  remains an explicit `.bh/focus.md` action. */
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
  /** Clear the pending search-match target (FilePreview calls this once it has
   *  landed on the match or given up retrying). */
  clearOpenMatchQuery: () => void;
  setFolderScope: (path: string | null) => void;
  /** Create an empty MD note (writes a workspace-relative file) and open it
   * in the preview. The watcher picks it up and badge.list materializes a
   * badge on the next refresh — no extra step needed. */
  createNote: (relPath: string) => Promise<void>;
  /** Create a blank untitled note and open it (pinned) in a pane — the
   *  double-click-empty-tab-strip gesture. (A code editor's "new untitled"
   *  adapted to our file=truth model: it's a real `untitled-N.md`.) */
  newNote: (paneId?: string) => Promise<void>;
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

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  const initialPane = emptyLeaf();
  const openPanelTab = (
    tab: string,
    opts: { pinned?: boolean; matchQuery?: string | null; paneId?: string } = {},
  ): void => {
    const { paneTree, activePaneId, current } = get();
    const targetLeaf = findLeaf(paneTree, opts.paneId ?? activePaneId) ?? firstLeaf(paneTree);
    const paneId = targetLeaf.id;
    // We only need a flush when the TARGET pane's active editor/page is being replaced.
    const willSwitch = targetLeaf.activeFile !== null && targetLeaf.activeFile !== tab;
    const finish = (): void => {
      // Workspace switched during the async flush → abort: opening the old root's
      // relative path into the new workspace would show the wrong file (restored
      // layouts reuse pane ids). Also abort if the target pane was closed/collapsed
      // during the flush — else updateLeaf is a no-op but we'd still point
      // activePane/currentFile at a pane no rendered leaf owns.
      if (get().current !== current || !findLeaf(get().paneTree, paneId)) return;
      set((s) => {
        const tree = updateLeaf(s.paneTree, paneId, (l) =>
          openInLeaf(l, tab, { pinned: opts.pinned }),
        );
        return {
          paneTree: tree,
          activePaneId: paneId,
          currentFile: tab,
          rightPanelOpen: true,
          openMatchQuery: opts.matchQuery ?? null,
        };
      });
      if (current !== null && !isBadgeTab(tab)) noteOpenedFile(current, tab);
    };
    // Flush the target pane's editor/page (still mounted/alive) BEFORE switching
    // its active tab — last keystrokes persist. A `false` resolution = an
    // unresolved disk conflict; don't switch.
    if (willSwitch) {
      void flushPane(paneId).then((ok) => {
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
    currentReachable: null,
    currentFile: null,
    paneTree: initialPane,
    activePaneId: initialPane.id,
    // Default closed — the canvas owns the full width until you open a file (which
    // reveals the panel) or click the top-right toggle (which opens it to its empty
    // state). Keeps the canvas the home surface.
    rightPanelOpen: false,
    tabDrag: null,
    canvasDockDrag: null,
    canvasSelection: null,
    openMatchQuery: null,
    // (saved-view state removed — a folder is the grouping unit now)
    folderScope: null,
    error: '',
    busy: false,

    refresh: async () => {
      try {
        const result = (await window.bh.run('workspace.list')) as WorkspaceListResult;
        // A SAME-workspace refresh (e.g. after adding/removing ANOTHER workspace)
        // must KEEP the live UI context — reloading panes from localStorage would
        // clobber tab/split changes still inside the 400ms save debounce, and the
        // layout subscriber would then write that stale tree back. Only a workspace
        // CHANGE resets panes (+ canvas selection / folder scope / search jump). "Same" means
        // same NAME *and* same PATH — `repath()` keeps the name but points at a new
        // folder, which must reset (else stale editors write the old folder's content
        // into the new root).
        const oldPath = get().workspaces.find((w) => w.name === get().current)?.path;
        const newPath = result.workspaces.find((w) => w.name === result.current)?.path;
        if (get().current !== null && result.current === get().current && oldPath === newPath) {
          set({
            workspaces: result.workspaces,
            current: result.current,
            currentReachable: null,
            error: '',
          });
        } else {
          const panes = paneResetFor(result.current);
          set({
            workspaces: result.workspaces,
            current: result.current,
            currentReachable: null,
            currentFile: deriveCurrent(panes.paneTree, panes.activePaneId),
            paneTree: panes.paneTree,
            activePaneId: panes.activePaneId,
            rightPanelOpen: panes.rightPanelOpen,
            canvasSelection: null,
            openMatchQuery: null,
            folderScope: null,
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
        if ((await flushAll()) === false) {
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
      if ((await flushAll()) === false) {
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
        if ((await flushAll()) === false) {
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
      if ((await flushAll()) === false) {
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
        const nextName = cur.current ? cur.current.name : result.current.name;
        const panes = paneResetFor(nextName);
        set({
          current: nextName,
          currentReachable: null,
          currentFile: deriveCurrent(panes.paneTree, panes.activePaneId),
          paneTree: panes.paneTree,
          activePaneId: panes.activePaneId,
          rightPanelOpen: panes.rightPanelOpen,
          canvasSelection: null,
          openMatchQuery: null,
          folderScope: null,
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
        if ((await flushAll()) === false) {
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
        if ((await flushAll()) === false) {
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
        if ((await flushAll()) === false) {
          set({ error: "Save or resolve this file's changes before renaming a workspace." });
          return;
        }
        await window.bh.run('workspace.rename', { from, to });
        // Migrate the saved pane layout to the new name BEFORE refresh() loads from
        // it — otherwise the renamed workspace's tabs/splits vanish (the layout is
        // orphaned under the old key). For the ACTIVE workspace, pass the live
        // layout so a rearrange still inside the save debounce isn't lost.
        const s = get();
        renamePanes(
          from,
          to,
          s.current === from ? { paneTree: s.paneTree, activePaneId: s.activePaneId } : undefined,
        );
        // Refresh pulls the new name into `current` if it was the renamed one
        // (core's workspace.rename already updated the config pointer).
        await get().refresh();
      } catch (err) {
        set({ error: formatError(err) });
      } finally {
        set({ busy: false });
      }
    },

    openInPanel: (file, opts = {}) => openPanelTab(file, opts),

    openBadgeInPanel: (file, opts = {}) =>
      openPanelTab(badgeTabId(file), { paneId: opts.paneId, pinned: true }),

    pinTab: (paneId, file) =>
      set((s) => ({ paneTree: updateLeaf(s.paneTree, paneId, (l) => pinInLeaf(l, file)) })),

    dropTabOnStrip: (toPaneId, toIndex) => {
      const drag = get().tabDrag;
      if (!drag) return;
      const { file, sourcePaneId } = drag;
      const ws = get().current;
      const crossPane = sourcePaneId !== toPaneId;
      const srcLeaf = findLeaf(get().paneTree, sourcePaneId);
      const tgtLeaf = findLeaf(get().paneTree, toPaneId);
      // Moving the source's ACTIVE editor across panes — flush it first.
      const needFlush = crossPane && srcLeaf?.activeFile === file;
      // The move activates `file` in the target, unmounting whatever was active
      // there — flush that editor too, or its debounce-window edits are lost.
      const needTgtFlush = crossPane && tgtLeaf?.activeFile != null && tgtLeaf.activeFile !== file;
      const finish = (): void => {
        if (get().current !== ws) {
          set({ tabDrag: null }); // workspace switched mid-flush — abort the move
          return;
        }
        set((s) => {
          let tree = s.paneTree;
          if (!crossPane) {
            tree = updateLeaf(tree, toPaneId, (l) => moveInLeaf(l, file, toIndex));
          } else {
            tree = updateLeaf(tree, sourcePaneId, (l) => closeInLeaf(l, file));
            // Add to the target (pinned, appends), then slot it to toIndex.
            tree = updateLeaf(tree, toPaneId, (l) =>
              moveInLeaf(openInLeaf(l, file, { pinned: true }), file, toIndex),
            );
          }
          let activePaneId = toPaneId;
          if (crossPane) {
            const src = findLeaf(tree, sourcePaneId);
            if (src && src.tabs.length === 0 && leafCount(tree) > 1) {
              tree = removeLeaf(tree, sourcePaneId) ?? tree;
              if (!findLeaf(tree, activePaneId)) activePaneId = firstLeaf(tree).id;
            }
          }
          return {
            paneTree: tree,
            activePaneId,
            currentFile: deriveCurrent(tree, activePaneId),
            rightPanelOpen: true,
            tabDrag: null,
          };
        });
      };
      if (needFlush || needTgtFlush) {
        void Promise.all([
          needFlush ? flushPane(sourcePaneId) : Promise.resolve(true),
          needTgtFlush ? flushPane(toPaneId) : Promise.resolve(true),
        ]).then(([a, b]) => {
          if (a && b) finish();
          else
            set({ error: "Save or resolve this file's changes before moving it.", tabDrag: null });
        }, finish);
      } else {
        finish();
      }
    },

    renameTab: (from, to) =>
      set((s) => {
        // Rebind the path across EVERY view. No flush — the old path is gone on
        // disk; affected editors remount on `to`.
        let tree = s.paneTree;
        for (const leaf of allLeaves(tree)) {
          tree = updateLeaf(tree, leaf.id, (l) => renameInLeaf(l, from, to));
        }
        const canvasSelection =
          s.canvasSelection?.kind === 'file'
            ? {
                ...s.canvasSelection,
                files: s.canvasSelection.files.map((file) => renamePanelTab(file, from, to)),
              }
            : s.canvasSelection?.kind === 'folder' && s.canvasSelection.folder === from
              ? { ...s.canvasSelection, folder: to }
              : s.canvasSelection;
        return {
          paneTree: tree,
          currentFile: s.currentFile === null ? null : renamePanelTab(s.currentFile, from, to),
          canvasSelection,
        };
      }),

    setActivePane: (paneId) =>
      set((s) => ({ activePaneId: paneId, currentFile: deriveCurrent(s.paneTree, paneId) })),

    splitPane: (sourcePaneId, direction, file, opts = {}) => {
      const ws = get().current;
      const finish = (): void => {
        // Abort if the workspace switched OR the source pane was closed/collapsed
        // during the flush — else splitLeaf no-ops but we'd set activePaneId to a
        // newLeaf that isn't in the tree.
        if (get().current !== ws || !findLeaf(get().paneTree, sourcePaneId)) return;
        const newLeaf = openInLeaf(emptyLeaf(), file, { pinned: true });
        set((s) => ({
          paneTree: splitLeaf(s.paneTree, sourcePaneId, direction, newLeaf, opts.before === true),
          activePaneId: newLeaf.id,
          currentFile: file,
          rightPanelOpen: true,
        }));
        const cur = get().current;
        if (cur !== null && !isBadgeTab(file)) noteOpenedFile(cur, file);
      };
      // Restructuring the tree unmounts + remounts the source pane's editor, which
      // cancels its debounced autosave — flush it first or its last edits are
      // stranded in the in-memory Yjs doc, never written to disk. An unresolved
      // conflict blocks the split. (⌘\, an edge-dock, and a programmatic split all
      // land here.)
      void flushPane(sourcePaneId).then((ok) => {
        if (ok) finish();
        else set({ error: "Save or resolve this file's changes before splitting." });
      }, finish);
    },

    setPaneFraction: (splitId, fraction) =>
      set((s) => ({ paneTree: setFraction(s.paneTree, splitId, fraction) })),

    setTabDrag: (drag) => set({ tabDrag: drag }),

    setCanvasDockDrag: (target) =>
      set((s) => {
        // Skip no-op sets (same pane + region) so a per-mousemove drag handler
        // doesn't churn renders across the whole panel.
        const cur = s.canvasDockDrag;
        if (cur === target) return {};
        if (cur && target && cur.paneId === target.paneId && cur.region === target.region) {
          return {};
        }
        return { canvasDockDrag: target };
      }),

    dockBadge: (file, paneId, region) => {
      // Reuse the flush-gated open paths: 'center' adds a tab to the target pane;
      // an edge splits it. (The badge itself stays on the canvas — Canvas snaps it
      // back; this is a reference open, not a move.)
      if (region === 'center') {
        get().openInPanel(file, { pinned: true, paneId });
      } else {
        const direction = region === 'left' || region === 'right' ? 'row' : 'column';
        const before = region === 'left' || region === 'up';
        get().splitPane(paneId, direction, file, { before });
      }
      set({ canvasDockDrag: null });
    },

    dropTab: (file, fromPaneId, targetPaneId, region) => {
      const ws = get().current;
      const srcLeaf = findLeaf(get().paneTree, fromPaneId);
      const tgtLeaf = findLeaf(get().paneTree, targetPaneId);
      // Every pane whose ACTIVE editor unmounts during this drop must flush first
      // (an unmount cancels the autosave). The SOURCE flushes when `file` is its
      // active editor (it moves out). A CENTER drop replaces the target's active
      // editor; an EDGE drop SPLITS the target, remounting its active editor too
      // (same as splitPane). A Set dedups the same-pane case.
      const toFlush = new Set<string>();
      if (srcLeaf?.activeFile === file) toFlush.add(fromPaneId);
      if (region === 'center') {
        if (
          fromPaneId !== targetPaneId &&
          tgtLeaf?.activeFile != null &&
          tgtLeaf.activeFile !== file
        ) {
          toFlush.add(targetPaneId);
        }
      } else if (tgtLeaf?.activeFile != null && tgtLeaf.activeFile !== file) {
        toFlush.add(targetPaneId);
      }
      const finish = (): void => {
        if (get().current !== ws) {
          set({ tabDrag: null }); // workspace switched mid-flush — abort the move
          return;
        }
        set((s) => {
          let tree = s.paneTree;
          let activePaneId = s.activePaneId;
          if (region === 'center') {
            // Already in this pane → nothing to move (the strip handles reorder).
            if (fromPaneId === targetPaneId) return { tabDrag: null };
            tree = updateLeaf(tree, targetPaneId, (l) => openInLeaf(l, file, { pinned: true }));
            tree = updateLeaf(tree, fromPaneId, (l) => closeInLeaf(l, file));
            activePaneId = targetPaneId;
          } else {
            const direction = region === 'left' || region === 'right' ? 'row' : 'column';
            const before = region === 'left' || region === 'up';
            const newLeaf = openInLeaf(emptyLeaf(), file, { pinned: true });
            tree = splitLeaf(tree, targetPaneId, direction, newLeaf, before);
            tree = updateLeaf(tree, fromPaneId, (l) => closeInLeaf(l, file));
            activePaneId = newLeaf.id;
          }
          // Collapse the source pane if the move emptied it (and it isn't the only
          // pane left).
          const src = findLeaf(tree, fromPaneId);
          if (src && src.tabs.length === 0 && leafCount(tree) > 1) {
            tree = removeLeaf(tree, fromPaneId) ?? tree;
            if (!findLeaf(tree, activePaneId)) activePaneId = firstLeaf(tree).id;
          }
          return {
            paneTree: tree,
            activePaneId,
            currentFile: deriveCurrent(tree, activePaneId),
            rightPanelOpen: true,
            tabDrag: null,
          };
        });
      };
      if (toFlush.size > 0) {
        void Promise.all([...toFlush].map((p) => flushPane(p))).then((oks) => {
          if (oks.every(Boolean)) finish();
          else
            set({ error: "Save or resolve this file's changes before moving it.", tabDrag: null });
        }, finish);
      } else {
        finish();
      }
    },

    setCanvasSelection: (selection) => set({ canvasSelection: selection }),

    toggleRightPanel: () => {
      if (!get().rightPanelOpen) {
        set({ rightPanelOpen: true });
        return;
      }
      // Hiding the panel unmounts every panel editor (EditorSpace renders null), and
      // an unmount cancels the debounced autosave — so flush first, or the last
      // keystrokes are lost. Flush ONLY the pane-tree editors, not the canvas float
      // (which stays mounted) — else an unrelated float conflict would wrongly block
      // the toggle. An unresolved conflict keeps the panel open to resolve.
      const panes = allLeaves(get().paneTree).map((l) => l.id);
      void Promise.all(panes.map((p) => flushPane(p))).then((oks) => {
        if (oks.every(Boolean)) set({ rightPanelOpen: false });
        else set({ error: "Save or resolve this file's changes before hiding the panel." });
      });
    },

    closeTab: (paneId, file, opts = {}) => {
      const { paneTree, current: ws } = get();
      const leaf = findLeaf(paneTree, paneId);
      if (!leaf || !leaf.tabs.includes(file)) return;
      const isActiveTab = leaf.activeFile === file;
      const finish = (): void => {
        // Workspace switched during the flush → abort: restored layouts reuse pane
        // ids, so finishing now could close the same relative file in the new workspace.
        if (get().current !== ws) return;
        set((s) => {
          let tree = updateLeaf(s.paneTree, paneId, (l) => closeInLeaf(l, file));
          let activePaneId = s.activePaneId;
          const after = findLeaf(tree, paneId);
          // Emptying a NON-root pane removes it (collapsing the split); the only
          // remaining pane stays even when empty (shows the panel's empty state).
          if (after && after.tabs.length === 0 && leafCount(tree) > 1) {
            tree = removeLeaf(tree, paneId) ?? tree;
            if (!findLeaf(tree, activePaneId)) activePaneId = firstLeaf(tree).id;
          }
          return {
            paneTree: tree,
            activePaneId,
            currentFile: deriveCurrent(tree, activePaneId),
            openMatchQuery: null,
          };
        });
      };
      // Only the ACTIVE tab has a live editor. Closing it follows the same
      // flush-before-leave gate as a file switch — a `false` (unresolved conflict /
      // failed write) keeps the tab so the user resolves it. A non-active tab isn't
      // mounted, so there's nothing to flush — just drop it.
      if (isActiveTab && opts.bypassFlush !== true) {
        void flushPane(paneId).then((ok) => {
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
        const baseName = relPath.split('/').pop() ?? relPath;
        const title = baseName.replace(/\.md$/i, '');
        const body = `# ${title}\n\n`;
        await window.bh.run('workspace.writeFile', { path: relPath, content: body });
        // Open pinned (you just made it to work on it) via openInPanel so the editor
        // we're leaving FLUSHES its pending auto-save first — a bare currentFile swap
        // remounts MdEditor, which deliberately does NOT flush on unmount, silently
        // dropping the prior note's last keystrokes.
        get().openInPanel(relPath, { pinned: true });
      } catch (err) {
        set({ error: formatError(err) });
      }
    },

    newNote: async (paneId) => {
      const target = paneId ?? get().activePaneId;
      const ws = get().current;
      // Persist the target pane's editor before it switches to the new note (and
      // gate on an unresolved conflict, so we don't create an orphan stub we can't
      // open). openInPanel below also flushes — a no-op after this clean flush.
      if ((await flushPane(target)) === false) {
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
          const candidate = i === 0 ? 'untitled.md' : `untitled-${i}.md`;
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
        get().openInPanel(name, { pinned: true, paneId: target });
      } catch (err) {
        set({ error: formatError(err) });
      }
    },

    clearError: () => set({ error: '' }),
  };
});

/** A stray empty pane: an empty leaf that ISN'T the sole pane. The layout invariant
 *  forbids these — an empty pane may exist only as the single quiet home. */
const hasStrayEmpty = (tree: PaneNode): boolean =>
  leafCount(tree) > 1 && allLeaves(tree).some((l) => l.tabs.length === 0);

// Maintain the layout invariant in ONE place, then persist. The invariant — "an
// empty pane may exist only as the SOLE pane" — mirrors a mature code editor's
// model: an empty editor group auto-closes unless it's the last one, and the big
// empty watermark means the *whole* area is empty (never two of them). Rather than
// guard every op (split / dock / drop / restore) against leaving a stray empty
// pane, we heal it here whenever the tree changes — so any current or future path
// is covered at a single choke point. The re-entrant setState re-runs this
// subscriber on the healed tree (now stray-free, since normalizeTree is
// idempotent), which then falls through to persist.
useWorkspaceStore.subscribe((s, prev) => {
  if (s.paneTree === prev.paneTree && s.activePaneId === prev.activePaneId) return;
  if (hasStrayEmpty(s.paneTree)) {
    const tree = normalizeTree(s.paneTree);
    const activePaneId = findLeaf(tree, s.activePaneId) ? s.activePaneId : firstLeaf(tree).id;
    useWorkspaceStore.setState({
      paneTree: tree,
      activePaneId,
      currentFile: deriveCurrent(tree, activePaneId),
    });
    return;
  }
  // Persist the right-panel layout (open tabs + splits + active pane) per workspace
  // so it's restored on the next reload. Debounced inside savePanes; no-op without
  // a workspace.
  savePanes(s.current, { paneTree: s.paneTree, activePaneId: s.activePaneId });
});
