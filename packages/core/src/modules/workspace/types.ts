/**
 * Workspace = a folder the user has registered as a BaseHalf root.
 * Files stay where they are; we just track which folders are "ours" and which
 * one is currently active (so other modules know which root to operate on).
 */

export interface WorkspaceEntry {
  readonly name: string;
  readonly path: string;
  readonly addedAt: string;
  /** Last canvas viewport (pan + zoom). Restored on workspace.use. */
  readonly viewport?: ViewportState;
}

/** Canvas viewport state — pan + zoom. Per-workspace, persisted in
 * workspaces.json so opening a workspace restores the last view. */
export interface ViewportState {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scale: number;
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
  /** If true: also append `.bh/` to .gitignore + append a recall hint to CLAUDE.md (both non-destructive). */
  readonly setup?: boolean;
}

export interface SetupReport {
  /** `.bh/` line added to .gitignore. */
  readonly gitignoreUpdated: boolean;
  /** Recall hint section added to CLAUDE.md. */
  readonly claudeMdUpdated: boolean;
  /** Already had `.bh/` in .gitignore — skipped. */
  readonly gitignoreSkipped: boolean;
  /** CLAUDE.md already had the recall hint — skipped. */
  readonly claudeMdSkipped: boolean;
  /** No .gitignore (no git repo or not yet initialized) — skipped, with note. */
  readonly gitignoreAbsent: boolean;
}

export interface WorkspaceAddResult {
  readonly workspace: WorkspaceEntry;
  readonly setAsCurrent: boolean;
  readonly bhDirCreated: boolean;
  /** Only present if --setup was passed. */
  readonly setup?: SetupReport;
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

export interface WorkspaceListFilesArgs {
  readonly path: string;
}
export interface WorkspaceListFilesEntry {
  readonly name: string;
  readonly type: 'file' | 'dir';
}
export interface WorkspaceListFilesResult {
  readonly path: string;
  readonly entries: readonly WorkspaceListFilesEntry[];
}

export type WorkspaceGetViewportArgs = Record<string, never>;
export type WorkspaceGetViewportResult = ViewportState | null;

/** Read/write user files in the current workspace. Path is POSIX-style
 * relative to the workspace root; absolute paths or `..` traversal are
 * rejected. Writes are the *only* path through which bh modifies user
 * files — used by the BlockNote editor (PR 14) and nothing else for v0. */
export interface WorkspaceReadFileArgs {
  readonly path: string;
}
export interface WorkspaceReadFileResult {
  readonly path: string;
  readonly content: string;
}

export interface WorkspaceWriteFileArgs {
  readonly path: string;
  readonly content: string;
}
export interface WorkspaceWriteFileResult {
  readonly path: string;
  readonly bytes: number;
}

export interface WorkspaceSetViewportArgs {
  readonly viewport: ViewportState;
}
export type WorkspaceSetViewportResult = Record<string, never>;
