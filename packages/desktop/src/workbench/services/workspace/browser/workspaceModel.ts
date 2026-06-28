import type { WorkspaceEntry } from '../../../../platform/workspaces/common/workspaces.js';
import { renamePanelTab } from '../../editor/browser/panelTabModel.js';

export type CanvasSelection =
  | { kind: 'file'; files: readonly string[]; source: 'canvas' }
  | { kind: 'folder'; folder: string; source: 'canvas' }
  | null;

export type WorkspaceEntryKind = 'file' | 'folder';

export interface WorkspaceRegistrySnapshot {
  readonly workspaces: readonly WorkspaceEntry[];
  readonly current: string | null;
}

export interface WorkspaceSurfacePatch {
  readonly workspaces: readonly WorkspaceEntry[];
  readonly current: string | null;
  readonly currentReachable: null;
  readonly error: '';
  readonly openFile?: null;
  readonly mergeFile?: null;
  readonly prView?: null;
  readonly currentFile?: null;
  readonly canvasSelection?: null;
  readonly openMatchQuery?: null;
  readonly folderScope?: null;
  readonly renamingPath?: null;
}

export const openEditorOverlayPatch = (
  file: string,
  opts: { readonly matchQuery?: string | null } = {},
): { openFile: string; currentFile: string; openMatchQuery: string | null } => ({
  openFile: file,
  currentFile: file,
  openMatchQuery: opts.matchQuery ?? null,
});

export const closeEditorOverlayPatch = (): {
  openFile: null;
  currentFile: null;
  openMatchQuery: null;
} => ({
  openFile: null,
  currentFile: null,
  openMatchQuery: null,
});

export const shouldPreserveWorkspaceSurface = (
  previous: WorkspaceRegistrySnapshot,
  next: WorkspaceRegistrySnapshot,
): boolean => {
  if (previous.current === null) return false;
  const oldPath = previous.workspaces.find((w) => w.name === previous.current)?.path;
  const newPath = next.current
    ? next.workspaces.find((w) => w.name === next.current)?.path
    : undefined;
  return oldPath !== undefined && oldPath === newPath;
};

export const workspaceRefreshPatch = (
  previous: WorkspaceRegistrySnapshot,
  next: WorkspaceRegistrySnapshot,
): WorkspaceSurfacePatch =>
  shouldPreserveWorkspaceSurface(previous, next)
    ? {
        workspaces: next.workspaces,
        current: next.current,
        currentReachable: null,
        error: '',
      }
    : {
        workspaces: next.workspaces,
        current: next.current,
        currentReachable: null,
        openFile: null,
        mergeFile: null,
        prView: null,
        currentFile: null,
        canvasSelection: null,
        openMatchQuery: null,
        folderScope: null,
        renamingPath: null,
        error: '',
      };

export const rebindCanvasSelectionForRename = (
  selection: CanvasSelection,
  from: string,
  to: string,
): CanvasSelection => {
  if (selection?.kind === 'file') {
    return {
      ...selection,
      files: selection.files.map((file) => renamePanelTab(file, from, to)),
    };
  }
  if (selection?.kind === 'folder' && selection.folder === from) {
    return { ...selection, folder: to };
  }
  return selection;
};

export const rebindOpenFileForRename = (
  openFile: string | null,
  from: string,
  to: string,
): string | null => (openFile === null ? null : renamePanelTab(openFile, from, to));

export const rebindOpenFileForEntryRename = (
  openFile: string | null,
  from: string,
  to: string,
  kind: WorkspaceEntryKind,
): string | null => {
  if (openFile === null) return null;
  if (kind === 'file') return openFile === from ? to : null;
  return openFile.startsWith(`${from}/`) ? to + openFile.slice(from.length) : null;
};

export const rebaseFolderScopeForRename = (
  scope: string | null,
  from: string,
  to: string,
  kind: WorkspaceEntryKind,
): string | null => {
  if (kind !== 'folder' || scope === null) return scope;
  return scope === from || scope.startsWith(`${from}/`) ? to + scope.slice(from.length) : scope;
};

export const toggleCanvasEditingCard = (
  ids: ReadonlySet<string>,
  id: string,
  editing: boolean,
): ReadonlySet<string> | null => {
  const has = ids.has(id);
  if (editing === has) return null;
  const next = new Set(ids);
  if (editing) next.add(id);
  else next.delete(id);
  return next;
};

export const isOpenFileDeletedByEntry = (
  openFile: string | null,
  path: string,
  kind: WorkspaceEntryKind,
): boolean =>
  openFile !== null &&
  (openFile === path || (kind === 'folder' && openFile.startsWith(`${path}/`)));

export const parentFolderScopeAfterDelete = (
  scope: string | null,
  path: string,
  kind: WorkspaceEntryKind,
): string | null | undefined => {
  if (kind !== 'folder' || scope === null) return undefined;
  if (scope !== path && !scope.startsWith(`${path}/`)) return undefined;
  const slash = path.lastIndexOf('/');
  return slash === -1 ? null : path.slice(0, slash);
};
