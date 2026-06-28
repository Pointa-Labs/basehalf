import type { PullRequestEditorInput, WorkspaceEntryKind } from './workspaceModel.js';

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

export interface WorkspaceRegistryActions {
  readonly refresh: () => Promise<void>;
  readonly refreshOpenRoots: () => Promise<void>;
  readonly pickAndAdd: () => Promise<void>;
  readonly createDemo: (path: string) => Promise<void>;
  readonly addDroppedPaths: (paths: readonly string[]) => Promise<void>;
  readonly use: (name: string) => Promise<void>;
  readonly remove: (name: string) => Promise<void>;
  readonly repath: (name: string) => Promise<void>;
  readonly renameWorkspace: (from: string, to: string) => Promise<void>;
}
