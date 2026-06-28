import { create } from 'zustand';
import type { WorkspaceEntry } from '../../../../platform/workspaces/common/workspaces.js';
import { createWorkspaceEditorOverlayActions } from './workspaceEditorOverlayActions.js';
import { createWorkspaceFileActions } from './workspaceFileActions.js';
import {
  type CanvasSelection,
  type GitDiffEditorInput,
  type PullRequestEditorInput,
  rebindCanvasSelectionForRename,
  rebindOpenFileForRename,
  toggleCanvasEditingCard,
} from './workspaceModel.js';
import { createWorkspaceRegistryActions } from './workspaceRegistryActions.js';

export type { CanvasSelection } from './workspaceModel.js';
export { EDITOR_OVERLAY_PANE_ID } from './workspaceEditorOverlayActions.js';

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
  gitDiff: GitDiffEditorInput | null;
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
  /** The in-app GitHub PR viewer open over the canvas. */
  prView: PullRequestEditorInput | null;
  openPr: (pr: PullRequestEditorInput) => void;
  closePr: () => void;
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
   *  counterpart of `error`. Rendered by the workbench root in an info-toned banner;
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
   *  (collision-suffixed by the workspace service, never clobbers) and open it. Returns the
   *  landing path, or null on failure / workspace switch. The watcher refreshes
   *  the tree + canvas. */
  createFile: (relPath: string) => Promise<string | null>;
  /** Context-menu "New Folder": create a folder (collision-suffixed). Returns
   *  the landing path. No editor impact; the watcher refreshes the tree + canvas. */
  createFolder: (relPath: string) => Promise<string | null>;
  /** Context-menu "Rename": move a file/folder, cascading the badge overlay.
   *  Flush-gated; rebinds the open editor if it pointed at the moved
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

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
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

    ...createWorkspaceRegistryActions(set, get),

    gitGraphOpen: false,
    mergeFile: null,
    prView: null,
    ...createWorkspaceEditorOverlayActions(set, get),

    consumeTitleFocus: () => set({ titleFocusPath: null }),

    requestBodyFocus: (path) => set({ bodyFocusPath: path }),
    consumeBodyFocus: () => set({ bodyFocusPath: null }),

    ...createWorkspaceFileActions(set, get),

    renameTab: (from, to) =>
      set((s) => {
        // Rebind the open file's path in place. No flush — the old path is gone on
        // disk; the editor remounts on `to`.
        const openFile = rebindOpenFileForRename(s.openFile, from, to);
        const canvasSelection = rebindCanvasSelectionForRename(s.canvasSelection, from, to);
        return { openFile, currentFile: openFile, canvasSelection };
      }),

    setCanvasCardEditing: (id, editing) =>
      set((s) => {
        const next = toggleCanvasEditingCard(s.canvasEditingCardIds, id, editing);
        if (next === null) return {}; // no-op: avoid churning renders
        return { canvasEditingCardIds: next };
      }),

    setCanvasSelection: (selection) => set({ canvasSelection: selection }),

    clearOpenMatchQuery: () => set({ openMatchQuery: null }),

    beginRename: (path) => set({ renamingPath: path }),
    endRename: () => set({ renamingPath: null }),

    setNotice: (message: string) => set({ notice: message }),
    clearNotice: () => set({ notice: '' }),

    clearError: () => set({ error: '' }),
  };
});
