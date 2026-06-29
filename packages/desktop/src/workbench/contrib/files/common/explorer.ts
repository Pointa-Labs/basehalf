import type {
  WorkbenchFileChangeEvent,
  WorkbenchFileChangeSubscription,
} from '../../../services/files/common/fileChangeTypes.js';
import type { WorkspaceListFilesEntry } from '../../../services/workspace/common/workspaceTypes.js';

export type ExplorerEntryKind = 'file' | 'folder';

export type ExplorerFileOperation =
  | {
      readonly type: 'create';
      readonly resource: string;
      readonly kind: ExplorerEntryKind;
    }
  | {
      readonly type: 'delete';
      readonly resource: string;
      readonly kind: ExplorerEntryKind;
    }
  | {
      readonly type: 'move';
      readonly resource: string;
      readonly target: string;
      readonly kind: ExplorerEntryKind;
    };

export interface ExplorerDataProvider {
  readonly listChildren: (path: string) => Promise<readonly WorkspaceListFilesEntry[]>;
  readonly onDidChangeFiles: (
    listener: (event: WorkbenchFileChangeEvent) => void,
  ) => WorkbenchFileChangeSubscription;
  readonly onDidRunOperation: (
    listener: (event: ExplorerFileOperation) => void,
  ) => WorkbenchFileChangeSubscription;
}

export interface ExplorerTreeState {
  readonly childrenByPath: ReadonlyMap<string, readonly WorkspaceListFilesEntry[]>;
  readonly expanded: ReadonlySet<string>;
  readonly rootPath: string;
}

export interface ExplorerTreeMutation {
  readonly childrenByPath: Map<string, readonly WorkspaceListFilesEntry[]>;
  readonly expanded: Set<string>;
}

export interface ExplorerService {
  readonly resolveChildren: (path: string) => Promise<readonly WorkspaceListFilesEntry[]>;
  readonly onDidChangeFiles: (
    listener: (event: WorkbenchFileChangeEvent) => void,
  ) => WorkbenchFileChangeSubscription;
  readonly onDidRunOperation: (
    listener: (event: ExplorerFileOperation) => void,
  ) => WorkbenchFileChangeSubscription;
  readonly affectedLoadedDirectories: (args: {
    readonly rootPath: string;
    readonly childrenByPath: ReadonlyMap<string, readonly WorkspaceListFilesEntry[]>;
    readonly event: WorkbenchFileChangeEvent;
  }) => readonly string[];
  readonly applyFileOperation: (
    state: ExplorerTreeState,
    operation: ExplorerFileOperation,
  ) => ExplorerTreeMutation;
  readonly applyFileEvent: (
    state: ExplorerTreeState,
    event: WorkbenchFileChangeEvent,
  ) => ExplorerTreeMutation | null;
}
