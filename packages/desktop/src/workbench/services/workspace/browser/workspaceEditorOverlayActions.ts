import { flushAll, flushPane } from '../../editor/common/editorFlush.js';
import { historyService } from '../../history/browser/historyService.js';
import {
  type GitDiffEditorInput,
  type PullRequestEditorInput,
  closeEditorOverlayPatch,
  openEditorOverlayPatch,
  openGitDiffOverlayPatch,
  openGitGraphOverlayPatch,
  openMergeOverlayPatch,
  openPullRequestOverlayPatch,
} from './workspaceModel.js';

/** The single full-canvas editor overlay's synthetic pane id. The open editor
 *  registers its flusher under this key (editorFlush) so the navigation /
 *  quit-flush gate can persist it before the context changes — there is only
 *  ever one open file, so one stable key suffices (no pane tree). */
export const EDITOR_OVERLAY_PANE_ID = 'editor-overlay';

interface WorkspaceEditorOverlayActionState {
  readonly current: string | null;
  readonly openFile: string | null;
  readonly currentFile: string | null;
  readonly openMatchQuery: string | null;
  readonly gitDiff: GitDiffEditorInput | null;
  readonly gitGraphOpen: boolean;
  readonly mergeFile: string | null;
  readonly prView: PullRequestEditorInput | null;
  readonly error: string;
  readonly folderScope: string | null;
  readonly renamingPath: string | null;
}

type WorkspaceEditorOverlaySet = (patch: Partial<WorkspaceEditorOverlayActionState>) => void;
type WorkspaceEditorOverlayGet = () => WorkspaceEditorOverlayActionState;

export interface WorkspaceEditorOverlayActions {
  readonly openInPanel: (
    file: string,
    opts?: { readonly pinned?: boolean; readonly matchQuery?: string | null },
  ) => void;
  readonly closeEditor: () => void;
  readonly openGitDiff: (path: string, staged: boolean) => void;
  readonly openCommitDiff: (path: string, ref: string, parentRef?: string, title?: string) => void;
  readonly closeGitDiff: () => void;
  readonly openGitGraph: () => void;
  readonly closeGitGraph: () => void;
  readonly openMerge: (path: string) => void;
  readonly closeMerge: () => void;
  readonly openPr: (pr: PullRequestEditorInput) => void;
  readonly closePr: () => void;
  readonly setFolderScope: (path: string | null) => Promise<void>;
  readonly navigateToFolder: (path: string | null) => Promise<void>;
}

export function createWorkspaceEditorOverlayActions(
  set: WorkspaceEditorOverlaySet,
  get: WorkspaceEditorOverlayGet,
): WorkspaceEditorOverlayActions {
  const afterOverlayFlush = (run: () => void): void => {
    const current = get().current;
    void flushPane(EDITOR_OVERLAY_PANE_ID).then((ok) => {
      if (ok && get().current === current) run();
    });
  };

  // Open `file` in the single full-canvas editor overlay, replacing whatever was
  // open. Flush-gated: when an editor is already open on a DIFFERENT file, flush
  // it first (its last keystrokes persist) and refuse the switch on an
  // unresolved disk conflict — same rule as the old per-pane tab switch.
  const openOverlay = (file: string, opts: { matchQuery?: string | null } = {}): void => {
    const { openFile, current } = get();
    const willSwitch = openFile !== null && openFile !== file;
    const finish = (): void => {
      // Workspace switched during the async flush → abort: opening the old root's
      // relative path into the new workspace would show the wrong file.
      if (get().current !== current) return;
      if (current !== null) historyService.noteOpenedFile(current, file);
      set(openEditorOverlayPatch(file, opts));
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
    openInPanel: (file, opts = {}) => openOverlay(file, { matchQuery: opts.matchQuery }),

    closeEditor: () => {
      const { openFile, current } = get();
      if (openFile === null) return;
      const finish = (): void => {
        if (get().current !== current) return;
        set(closeEditorOverlayPatch());
      };
      void flushPane(EDITOR_OVERLAY_PANE_ID).then((ok) => {
        if (ok) finish();
        else set({ error: "Save or resolve this file's changes before closing it." });
      }, finish);
    },

    openGitDiff: (path, staged) => {
      afterOverlayFlush(() => set(openGitDiffOverlayPatch({ path, staged })));
    },

    openCommitDiff: (path, ref, parentRef, title) => {
      afterOverlayFlush(() =>
        set(
          openGitDiffOverlayPatch({
            path,
            staged: false,
            leftRef: parentRef ?? `${ref}^`,
            rightRef: ref,
            title,
          }),
        ),
      );
    },

    closeGitDiff: () => set({ gitDiff: null }),

    openGitGraph: () => {
      afterOverlayFlush(() => set(openGitGraphOverlayPatch()));
    },

    closeGitGraph: () => set({ gitGraphOpen: false }),

    openMerge: (path) => {
      afterOverlayFlush(() => set(openMergeOverlayPatch(path)));
    },

    closeMerge: () => set({ mergeFile: null }),

    openPr: (pr) => {
      afterOverlayFlush(() => set(openPullRequestOverlayPatch(pr)));
    },

    closePr: () => set({ prView: null }),

    setFolderScope: async (path: string | null) => {
      const current = get().current;
      // Flush (and gate on) every mounted editor before swapping the canvas: an
      // inline-editing card whose file leaves the new scope unmounts, and an
      // un-flushed / conflicted edit would vanish. A blocked flush aborts the
      // scope change — same rule as a file switch / workspace switch.
      if ((await flushAll()) === false) return;
      if (get().current !== current) return;
      // Drop any pending inline-rename: the entry being named may not exist at
      // the new scope, which would otherwise strand `renamingPath` with no input.
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
      if (get().current !== current) return;
      set({
        ...closeEditorOverlayPatch(),
        folderScope: path,
        renamingPath: null,
      });
    },
  };
}
