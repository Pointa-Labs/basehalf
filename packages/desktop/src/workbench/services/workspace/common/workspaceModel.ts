import { renamePanelTab } from '../../editor/common/panelTabModel.js';
import type { WorkspaceEntry } from './workspaceTypes.js';

export type CanvasSelection =
  | { kind: 'file'; files: readonly string[]; source: 'canvas' }
  | { kind: 'folder'; folder: string; source: 'canvas' }
  | null;

export type WorkspaceEntryKind = 'file' | 'folder';

export interface GitDiffEditorInput {
  readonly path: string;
  readonly staged: boolean;
  readonly leftRef?: string;
  readonly rightRef?: string;
  readonly title?: string;
}

export interface PullRequestEditorInput {
  readonly number: number;
  readonly title: string;
  readonly remoteUrl: string;
  readonly url: string;
}

export const WORKSPACE_RESOURCE_EDITOR_INPUT_TYPE_ID =
  'workbench.editors.resourceEditorInput' as const;
export const WORKSPACE_DIFF_EDITOR_INPUT_TYPE_ID = 'workbench.editors.diffEditorInput' as const;
export const WORKSPACE_GIT_GRAPH_EDITOR_INPUT_TYPE_ID = 'basehalf.editors.gitGraphInput' as const;
export const WORKSPACE_MERGE_EDITOR_INPUT_TYPE_ID = 'basehalf.editors.mergeEditorInput' as const;
export const WORKSPACE_PULL_REQUEST_EDITOR_INPUT_TYPE_ID =
  'basehalf.editors.pullRequestEditorInput' as const;

export interface WorkspaceResourceEditorInput {
  readonly typeId: typeof WORKSPACE_RESOURCE_EDITOR_INPUT_TYPE_ID;
  readonly resource: string;
  readonly matchQuery: string | null;
}

export type WorkspaceDiffEditorInput = GitDiffEditorInput & {
  readonly typeId: typeof WORKSPACE_DIFF_EDITOR_INPUT_TYPE_ID;
  readonly resource: string;
};

export interface WorkspaceGitGraphEditorInput {
  readonly typeId: typeof WORKSPACE_GIT_GRAPH_EDITOR_INPUT_TYPE_ID;
  readonly resource: undefined;
}

export interface WorkspaceMergeEditorInput {
  readonly typeId: typeof WORKSPACE_MERGE_EDITOR_INPUT_TYPE_ID;
  readonly resource: string;
}

export type WorkspacePullRequestEditorInput = PullRequestEditorInput & {
  readonly typeId: typeof WORKSPACE_PULL_REQUEST_EDITOR_INPUT_TYPE_ID;
  readonly resource: string;
};

export type WorkspaceEditorInput =
  | WorkspaceResourceEditorInput
  | WorkspaceDiffEditorInput
  | WorkspaceGitGraphEditorInput
  | WorkspaceMergeEditorInput
  | WorkspacePullRequestEditorInput;

export interface WorkspaceEditorOverlaySnapshot {
  readonly openFile: string | null;
  readonly openMatchQuery?: string | null;
  readonly gitDiff: GitDiffEditorInput | null;
  readonly gitGraphOpen: boolean;
  readonly mergeFile: string | null;
  readonly prView: PullRequestEditorInput | null;
}

export type WorkspaceEditorOverlayKind =
  | 'pullRequest'
  | 'merge'
  | 'gitGraph'
  | 'gitDiff'
  | 'file'
  | null;

export interface WorkspaceEditorOverlayPatch {
  readonly openFile: string | null;
  readonly currentFile: string | null;
  readonly openMatchQuery: string | null;
  readonly gitDiff: GitDiffEditorInput | null;
  readonly gitGraphOpen: boolean;
  readonly mergeFile: string | null;
  readonly prView: PullRequestEditorInput | null;
}

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
  readonly gitDiff?: null;
  readonly gitGraphOpen?: false;
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
): WorkspaceEditorOverlayPatch =>
  workspaceEditorOverlayPatchFromInput({
    typeId: WORKSPACE_RESOURCE_EDITOR_INPUT_TYPE_ID,
    resource: file,
    matchQuery: opts.matchQuery ?? null,
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

export const openGitDiffOverlayPatch = (gitDiff: GitDiffEditorInput): WorkspaceEditorOverlayPatch =>
  workspaceEditorOverlayPatchFromInput({
    ...gitDiff,
    typeId: WORKSPACE_DIFF_EDITOR_INPUT_TYPE_ID,
    resource: gitDiff.path,
  });

export const openGitGraphOverlayPatch = (): WorkspaceEditorOverlayPatch =>
  workspaceEditorOverlayPatchFromInput({
    typeId: WORKSPACE_GIT_GRAPH_EDITOR_INPUT_TYPE_ID,
    resource: undefined,
  });

export const openMergeOverlayPatch = (mergeFile: string): WorkspaceEditorOverlayPatch =>
  workspaceEditorOverlayPatchFromInput({
    typeId: WORKSPACE_MERGE_EDITOR_INPUT_TYPE_ID,
    resource: mergeFile,
  });

export const openPullRequestOverlayPatch = (
  prView: PullRequestEditorInput,
): WorkspaceEditorOverlayPatch =>
  workspaceEditorOverlayPatchFromInput({
    ...prView,
    typeId: WORKSPACE_PULL_REQUEST_EDITOR_INPUT_TYPE_ID,
    resource: prView.url,
  });

export const workspaceEditorInputFromSnapshot = (
  state: WorkspaceEditorOverlaySnapshot,
): WorkspaceEditorInput | null => {
  if (state.prView !== null) {
    return {
      ...state.prView,
      typeId: WORKSPACE_PULL_REQUEST_EDITOR_INPUT_TYPE_ID,
      resource: state.prView.url,
    };
  }
  if (state.mergeFile !== null) {
    return {
      typeId: WORKSPACE_MERGE_EDITOR_INPUT_TYPE_ID,
      resource: state.mergeFile,
    };
  }
  if (state.gitGraphOpen) {
    return {
      typeId: WORKSPACE_GIT_GRAPH_EDITOR_INPUT_TYPE_ID,
      resource: undefined,
    };
  }
  if (state.gitDiff !== null) {
    return {
      ...state.gitDiff,
      typeId: WORKSPACE_DIFF_EDITOR_INPUT_TYPE_ID,
      resource: state.gitDiff.path,
    };
  }
  if (state.openFile !== null) {
    return {
      typeId: WORKSPACE_RESOURCE_EDITOR_INPUT_TYPE_ID,
      resource: state.openFile,
      matchQuery: state.openMatchQuery ?? null,
    };
  }
  return null;
};

export const workspaceEditorOverlayKindFromInput = (
  input: WorkspaceEditorInput | null,
): WorkspaceEditorOverlayKind => {
  switch (input?.typeId) {
    case WORKSPACE_PULL_REQUEST_EDITOR_INPUT_TYPE_ID:
      return 'pullRequest';
    case WORKSPACE_MERGE_EDITOR_INPUT_TYPE_ID:
      return 'merge';
    case WORKSPACE_GIT_GRAPH_EDITOR_INPUT_TYPE_ID:
      return 'gitGraph';
    case WORKSPACE_DIFF_EDITOR_INPUT_TYPE_ID:
      return 'gitDiff';
    case WORKSPACE_RESOURCE_EDITOR_INPUT_TYPE_ID:
      return 'file';
    case undefined:
      return null;
  }
};

export const workspaceEditorOverlayPatchFromInput = (
  input: WorkspaceEditorInput | null,
): WorkspaceEditorOverlayPatch => {
  const closed = {
    openFile: null,
    currentFile: null,
    openMatchQuery: null,
    gitDiff: null,
    gitGraphOpen: false,
    mergeFile: null,
    prView: null,
  } satisfies WorkspaceEditorOverlayPatch;

  switch (input?.typeId) {
    case WORKSPACE_RESOURCE_EDITOR_INPUT_TYPE_ID:
      return {
        ...closed,
        openFile: input.resource,
        currentFile: input.resource,
        openMatchQuery: input.matchQuery,
      };
    case WORKSPACE_DIFF_EDITOR_INPUT_TYPE_ID:
      return {
        ...closed,
        gitDiff: {
          path: input.path,
          staged: input.staged,
          ...(input.leftRef !== undefined ? { leftRef: input.leftRef } : {}),
          ...(input.rightRef !== undefined ? { rightRef: input.rightRef } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
        },
      };
    case WORKSPACE_GIT_GRAPH_EDITOR_INPUT_TYPE_ID:
      return { ...closed, gitGraphOpen: true };
    case WORKSPACE_MERGE_EDITOR_INPUT_TYPE_ID:
      return { ...closed, mergeFile: input.resource };
    case WORKSPACE_PULL_REQUEST_EDITOR_INPUT_TYPE_ID:
      return {
        ...closed,
        prView: {
          number: input.number,
          title: input.title,
          remoteUrl: input.remoteUrl,
          url: input.url,
        },
      };
    case undefined:
      return closed;
  }
};

export const workspaceEditorOverlayKind = (
  state: WorkspaceEditorOverlaySnapshot,
): WorkspaceEditorOverlayKind =>
  workspaceEditorOverlayKindFromInput(workspaceEditorInputFromSnapshot(state));

export const isWorkspaceEditorOverlayOpen = (state: WorkspaceEditorOverlaySnapshot): boolean =>
  workspaceEditorOverlayKind(state) !== null;

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
        gitDiff: null,
        gitGraphOpen: false,
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
