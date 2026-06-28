import type { WorkspaceEntry } from '../../../../platform/workspaces/common/workspaces.js';
import type {
  CanvasSelection,
  GitDiffEditorInput,
  PullRequestEditorInput,
} from '../common/workspaceModel.js';
import type { WorkspaceEditorOverlayActions } from './workspaceEditorOverlayActions.js';
import type { WorkspaceFileActions } from './workspaceFileActions.js';
import type { WorkspaceRegistryActions } from './workspaceRegistryActions.js';

export interface WorkspaceState
  extends WorkspaceRegistryActions,
    WorkspaceEditorOverlayActions,
    WorkspaceFileActions {
  readonly workspaces: readonly WorkspaceEntry[];
  readonly current: string | null;
  readonly currentReachable: boolean | null;
  readonly openRoots: readonly string[];
  readonly openFile: string | null;
  readonly currentFile: string | null;
  readonly titleFocusPath: string | null;
  readonly bodyFocusPath: string | null;
  readonly openMatchQuery: string | null;
  readonly folderScope: string | null;
  readonly gitDiff: GitDiffEditorInput | null;
  readonly gitGraphOpen: boolean;
  readonly mergeFile: string | null;
  readonly prView: PullRequestEditorInput | null;
  readonly canvasEditingCardIds: ReadonlySet<string>;
  readonly canvasSelection: CanvasSelection;
  readonly renamingPath: string | null;
  readonly error: string;
  readonly notice: string;
  readonly busy: boolean;
  readonly renameTab: (from: string, to: string) => void;
  readonly setCanvasCardEditing: (id: string, editing: boolean) => void;
  readonly setCanvasSelection: (selection: CanvasSelection) => void;
  readonly clearOpenMatchQuery: () => void;
  readonly beginRename: (path: string) => void;
  readonly endRename: () => void;
  readonly consumeTitleFocus: () => void;
  readonly requestBodyFocus: (path: string) => void;
  readonly consumeBodyFocus: () => void;
  readonly setNotice: (message: string) => void;
  readonly clearNotice: () => void;
  readonly clearError: () => void;
}
