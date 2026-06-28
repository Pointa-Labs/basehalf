import { workspaceService } from '../../../../platform/workspaces/browser/workspaceService.js';
import { flushAll, flushPane } from '../../editor/browser/editorFlush.js';
import { noteStemFromTitle } from '../../editor/browser/noteTitleModel.js';
import { EDITOR_OVERLAY_PANE_ID } from './workspaceEditorOverlayActions.js';
import { formatWorkspaceError, isWorkspacePathNotFoundError } from './workspaceErrors.js';
import { emitEntryRemoved, emitEntryRenamed } from './workspaceFileEvents.js';
import {
  type WorkspaceEntryKind,
  closeEditorOverlayPatch,
  isOpenFileDeletedByEntry,
  parentFolderScopeAfterDelete,
  rebaseFolderScopeForRename,
  rebindOpenFileForEntryRename,
} from './workspaceModel.js';

interface WorkspaceFileActionState {
  readonly current: string | null;
  readonly openFile: string | null;
  readonly currentFile: string | null;
  readonly openMatchQuery: string | null;
  readonly folderScope: string | null;
  readonly titleFocusPath: string | null;
  readonly renamingPath: string | null;
  readonly error: string;
  readonly openInPanel: (
    file: string,
    opts?: { readonly pinned?: boolean; readonly matchQuery?: string | null },
  ) => void;
}

type WorkspaceFileSet = (patch: Partial<WorkspaceFileActionState>) => void;
type WorkspaceFileGet = () => WorkspaceFileActionState;

export interface WorkspaceFileActions {
  readonly createNote: (relPath: string) => Promise<void>;
  readonly newNote: (opts?: { readonly folder?: string | null }) => Promise<void>;
  readonly renameOpenFile: (title: string) => Promise<string | null>;
  readonly createFile: (relPath: string) => Promise<string | null>;
  readonly createFolder: (relPath: string) => Promise<string | null>;
  readonly renameEntry: (
    from: string,
    to: string,
    kind: WorkspaceEntryKind,
  ) => Promise<string | null>;
  readonly deleteEntry: (path: string, kind: WorkspaceEntryKind) => Promise<boolean>;
}

export function createWorkspaceFileActions(
  set: WorkspaceFileSet,
  get: WorkspaceFileGet,
): WorkspaceFileActions {
  return {
    renameOpenFile: async (title) => {
      const { openFile, current } = get();
      if (openFile === null) return null;
      const stem = noteStemFromTitle(title);
      // Blank or unchanged title -> no rename, but report the current path so the
      // caller can still act on it (e.g. drop focus into the body on Enter).
      if (stem === null) return openFile;
      const slash = openFile.lastIndexOf('/');
      const dir = slash === -1 ? '' : openFile.slice(0, slash);
      const desired = dir === '' ? `${stem}.md` : `${dir}/${stem}.md`;
      if (desired === openFile) return openFile;
      // Persist the body to the OLD path before moving it. A blocked flush
      // (open conflict / failed write) aborts so we never rename out from under
      // unsaved edits. Same gate as closeEditor / a file switch.
      if ((await flushPane(EDITOR_OVERLAY_PANE_ID)) === false) {
        set({ error: "Save or resolve this file's changes before renaming it." });
        return null;
      }
      if (get().current !== current) return null;
      try {
        const res = await workspaceService.renameFile(openFile, desired);
        // Workspace switched during the flush / IPC -> the new root already reset
        // the open file; don't clobber it. Rebind eagerly to the landing path so
        // the editor follows immediately (the watcher's later rename event no-ops).
        if (get().current !== current) return null;
        if (res.renamed) {
          set({ openFile: res.to, currentFile: res.to });
          return res.to;
        }
        return openFile;
      } catch (err) {
        if (get().current === current) set({ error: formatWorkspaceError(err) });
        return null;
      }
    },

    createNote: async (relPath: string) => {
      const ws = get().current;
      if (ws === null) return;
      try {
        // Flush + gate the OPEN editor FIRST. If it's blocked on an unresolved
        // disk-conflict banner the switch below can't proceed, so creating the
        // stub now would leave an orphan empty note on disk that we never open.
        if ((await flushAll()) === false) {
          set({
            error: "Save or resolve this file's changes before creating a note.",
          });
          return;
        }
        if (get().current !== ws) return;
        // Refuse to clobber an existing file. workspace.readFile throws
        // PATH_NOT_FOUND if the file doesn't exist; that's the success signal.
        let alreadyExists = false;
        try {
          await workspaceService.readFile(relPath);
          alreadyExists = true;
        } catch (err) {
          if (!isWorkspacePathNotFoundError(err)) throw err;
        }
        if (alreadyExists) {
          if (get().current !== ws) return;
          set({
            error: `Note already exists at "${relPath}". Open it from the sidebar to edit.`,
          });
          return;
        }
        if (get().current !== ws) return;
        await workspaceService.writeFile(relPath, '');
        if (get().current !== ws) return;
        get().openInPanel(relPath);
      } catch (err) {
        if (get().current === ws) set({ error: formatWorkspaceError(err) });
      }
    },

    newNote: async (opts) => {
      const folder = opts?.folder ?? null;
      const ws = get().current;
      if (ws === null) return;
      if ((await flushPane(EDITOR_OVERLAY_PANE_ID)) === false) {
        set({ error: "Save or resolve this file's changes before opening a new note." });
        return;
      }
      if (get().current !== ws) return;
      try {
        let name = '';
        for (let i = 0; i < 1000; i++) {
          const base = i === 0 ? 'untitled.md' : `untitled-${i}.md`;
          const candidate = folder === null ? base : `${folder}/${base}`;
          let taken = false;
          try {
            await workspaceService.readFile(candidate);
            taken = true;
          } catch (err) {
            if (!isWorkspacePathNotFoundError(err)) throw err;
          }
          if (!taken) {
            name = candidate;
            break;
          }
        }
        if (name === '') {
          if (get().current !== ws) return;
          set({ error: 'Too many untitled notes - name one before creating another.' });
          return;
        }
        if (get().current !== ws) return;
        await workspaceService.writeFile(name, '');
        if (get().current !== ws) return;
        get().openInPanel(name);
        set({ titleFocusPath: name });
      } catch (err) {
        if (get().current === ws) set({ error: formatWorkspaceError(err) });
      }
    },

    createFile: async (relPath) => {
      const ws = get().current;
      if (ws === null) return null;
      // No editor switch: the file-tree "New File" creates + inline-names, it
      // doesn't open the big editor. The watcher surfaces the new row/card.
      try {
        const res = await workspaceService.createFile(relPath);
        return get().current === ws ? res.path : null;
      } catch (err) {
        if (get().current === ws) set({ error: formatWorkspaceError(err) });
        return null;
      }
    },

    createFolder: async (relPath) => {
      const ws = get().current;
      if (ws === null) return null;
      try {
        const res = await workspaceService.createFolder(relPath);
        return get().current === ws ? res.path : null;
      } catch (err) {
        if (get().current === ws) set({ error: formatWorkspaceError(err) });
        return null;
      }
    },

    renameEntry: async (from, to, kind) => {
      const ws = get().current;
      if (ws === null) return null;
      if (from === to) return from;
      // A rename can move the OPEN file or a containing folder: persist edits to
      // the old path first and abort on an unresolved conflict.
      if ((await flushAll()) === false) {
        set({ error: "Save or resolve this file's changes before renaming." });
        return null;
      }
      if (get().current !== ws) return null;
      try {
        const res = await workspaceService.renameEntry(from, to, kind);
        if (get().current !== ws) return null;
        if (res.renamed) {
          const rebound = rebindOpenFileForEntryRename(get().openFile, from, res.to, kind);
          if (rebound !== null) set({ openFile: rebound, currentFile: rebound });
          const rebasedScope = rebaseFolderScopeForRename(get().folderScope, from, res.to, kind);
          if (rebasedScope !== get().folderScope) set({ folderScope: rebasedScope });
          emitEntryRenamed(from, res.to, kind);
        }
        return res.renamed ? res.to : from;
      } catch (err) {
        if (get().current === ws) set({ error: formatWorkspaceError(err) });
        return null;
      }
    },

    deleteEntry: async (path, kind) => {
      const ws = get().current;
      if (ws === null) return false;
      // If the open file is the target (or lives inside a deleted folder), drop it
      // without flushing: flushing would rewrite a file we're about to delete.
      const open = get().openFile;
      const prevCurrent = get().currentFile;
      const prevMatchQuery = get().openMatchQuery;
      const wasOpen = isOpenFileDeletedByEntry(open, path, kind);
      if (wasOpen) set(closeEditorOverlayPatch());
      try {
        const res = await workspaceService.deleteEntry(path, kind);
        if (res.deleted && get().current === ws) {
          const parentScope = parentFolderScopeAfterDelete(get().folderScope, path, kind);
          if (parentScope !== undefined) {
            set({ folderScope: parentScope, renamingPath: null });
          }
          emitEntryRemoved(path, kind);
        }
        return res.deleted;
      } catch (err) {
        if (wasOpen && get().current === ws)
          set({ openFile: open, currentFile: prevCurrent, openMatchQuery: prevMatchQuery });
        if (get().current === ws) set({ error: formatWorkspaceError(err) });
        return false;
      }
    },
  };
}
