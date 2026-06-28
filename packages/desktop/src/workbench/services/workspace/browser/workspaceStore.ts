import { create } from 'zustand';
import {
  rebindCanvasSelectionForRename,
  rebindOpenFileForRename,
  toggleCanvasEditingCard,
} from '../common/workspaceModel.js';
import type { WorkspaceState } from '../common/workspaceStoreTypes.js';
import { createWorkspaceEditorOverlayActions } from './workspaceEditorOverlayActions.js';
import { createWorkspaceFileActions } from './workspaceFileActions.js';
import { createWorkspaceRegistryActions } from './workspaceRegistryActions.js';

export type { CanvasSelection } from '../common/workspaceModel.js';
export { EDITOR_OVERLAY_PANE_ID } from './workspaceEditorOverlayActions.js';

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
