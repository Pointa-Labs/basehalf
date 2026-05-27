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
