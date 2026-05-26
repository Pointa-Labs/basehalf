/**
 * Workspace = a folder the user has registered as a BaseHalf root.
 * Files stay where they are; we just track which folders are "ours" and which
 * one is currently active (so other modules know which root to operate on).
 */

export interface WorkspaceEntry {
  readonly name: string;
  readonly path: string;
  readonly addedAt: string;
}

export interface WorkspacesFile {
  readonly version: 1;
  readonly current: string | null;
  readonly workspaces: Record<string, Omit<WorkspaceEntry, 'name'>>;
}

export const EMPTY_WORKSPACES: WorkspacesFile = Object.freeze({
  version: 1,
  current: null,
  workspaces: {},
});

// ── Command args / results ──────────────────────────────────────────────────

export interface WorkspaceAddArgs {
  readonly path: string;
  readonly name?: string;
}
export interface WorkspaceAddResult {
  readonly workspace: WorkspaceEntry;
  readonly setAsCurrent: boolean;
  readonly bhDirCreated: boolean;
}

export type WorkspaceListArgs = Record<string, never>;
export interface WorkspaceListResult {
  readonly current: string | null;
  readonly workspaces: readonly WorkspaceEntry[];
}

export interface WorkspaceUseArgs {
  readonly name: string;
}
export interface WorkspaceUseResult {
  readonly current: WorkspaceEntry;
}

export type WorkspaceCurrentArgs = Record<string, never>;
export type WorkspaceCurrentResult =
  | { readonly current: WorkspaceEntry }
  | { readonly current: null };

export interface WorkspaceRemoveArgs {
  readonly name: string;
}
export interface WorkspaceRemoveResult {
  readonly removed: string;
  readonly newCurrent: string | null;
}
