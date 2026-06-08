/**
 * Workspace = a folder the user has registered as a BaseHalf root.
 * Files stay where they are; we just track which folders are "ours" and which
 * one is currently active (so other modules know which root to operate on).
 */

import type { BadgeFile } from '../badges/types.js';

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
  /** If true: also append `.bh/cache/` to .gitignore + append the
   *  agent-protocol hint to CLAUDE.md (both non-destructive + idempotent). */
  readonly setup?: boolean;
}

export interface SetupReport {
  /** `.bh/cache/` line added to .gitignore. */
  readonly gitignoreUpdated: boolean;
  /** Workspace-hint section added to CLAUDE.md (Claude Code). */
  readonly claudeMdUpdated: boolean;
  /** Workspace-hint section added to AGENTS.md (the cross-tool convention). */
  readonly agentsMdUpdated: boolean;
  /** Workspace-hint section added to .github/copilot-instructions.md (in-IDE Copilot). */
  readonly copilotMdUpdated: boolean;
  /** `.gitignore` already had `.bh/cache/` — skipped. */
  readonly gitignoreSkipped: boolean;
  /** CLAUDE.md already had the hint marker (or a symlink was refused) — skipped. */
  readonly claudeMdSkipped: boolean;
  /** AGENTS.md already had the hint marker (or a symlink was refused) — skipped. */
  readonly agentsMdSkipped: boolean;
  /** .github/copilot-instructions.md already had the hint marker (or refused) — skipped. */
  readonly copilotMdSkipped: boolean;
  /** No .gitignore (no git repo or not yet initialized) — skipped, with note. */
  readonly gitignoreAbsent: boolean;
}

export interface WorkspaceAddResult {
  readonly workspace: WorkspaceEntry;
  readonly setAsCurrent: boolean;
  readonly bhDirCreated: boolean;
  /** Only present when called with `setup: true`. */
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

export interface WorkspaceRenameArgs {
  readonly from: string;
  readonly to: string;
}
export interface WorkspaceRenameResult {
  readonly workspace: WorkspaceEntry;
  /** True when the renamed workspace was the current one and the
   *  `current` pointer was updated to the new name. */
  readonly currentUpdated: boolean;
}

export interface WorkspaceRepathArgs {
  readonly name: string;
  readonly path: string;
  /** When true, also run runSetup on the new path (CLAUDE.md hint + .gitignore). */
  readonly setup?: boolean;
}
export interface WorkspaceRepathResult {
  readonly workspace: WorkspaceEntry;
  readonly bhDirCreated: boolean;
  /** Only present when `setup: true` was passed. */
  readonly setup?: SetupReport;
}

export interface WorkspaceCreateDemoArgs {
  /** Absolute path where the demo workspace lives. Created if missing. */
  readonly path: string;
  /** Workspace name; defaults to the basename of `path`. */
  readonly name?: string;
}
export interface WorkspaceCreateDemoResult {
  readonly workspace: WorkspaceEntry;
  /** Files seeded (relative paths). Useful for showing the user what
   *  appeared in their folder. */
  readonly filesCreated: readonly string[];
  /** Whether the user's CLAUDE.md / .gitignore got the agent-protocol
   *  hint + cache-ignore (always true on success — demo enforces setup). */
  readonly setup: SetupReport;
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

/** `workspace.listCanvas({folder})` — the DIRECT children (one level) of a
 * folder, each merged with its sparse badge overlay. folder=null is the
 * workspace root. Files are filtered to canvas-supported types; tooling dirs
 * are skipped. Unannotated entries come back as synthesized default badges so
 * the renderer's badge→node mapping is unchanged. This is the canvas's data
 * source — it reads the filesystem per folder instead of a materialized mirror. */
export interface WorkspaceListCanvasArgs {
  readonly folder: string | null;
}
export interface WorkspaceListCanvasResult {
  readonly badges: readonly BadgeFile[];
}

/** `workspace.listSupportedFiles({folder})` — all canvas-supported files under
 * a folder, RECURSIVELY (workspace-relative POSIX paths, sorted). folder=null
 * is the whole workspace. Powers focus-folder and the ⌘K file picker — reads
 * the filesystem, not the badge mirror, so it sees unannotated files too. */
export interface WorkspaceListSupportedFilesArgs {
  readonly folder: string | null;
}
export interface WorkspaceListSupportedFilesResult {
  readonly files: readonly string[];
}

export type WorkspaceGetViewportArgs = Record<string, never>;
export type WorkspaceGetViewportResult = ViewportState | null;

/** Read/write user files in the current workspace. Path is POSIX-style
 * relative to the workspace root; absolute paths or `..` traversal are
 * rejected. Writes are the *only* path through which bh modifies user
 * files — used by the BlockNote editor (PR 14) and nothing else for v0. */
export interface WorkspaceReadFileArgs {
  readonly path: string;
  /** Optional cap: return at most this many characters of content. Lets a
   *  preview/viewer avoid shipping a multi-MB file across the IPC boundary and
   *  holding it whole in the renderer when only a slice is ever shown. When
   *  omitted, the full file is returned (editor save-path needs the whole file). */
  readonly maxChars?: number;
}
export interface WorkspaceReadFileResult {
  readonly path: string;
  readonly content: string;
  /** True when `maxChars` was set and the file was longer — i.e. `content` is a
   *  prefix. Lets the caller show a "… N more" affordance honestly. */
  readonly truncated?: boolean;
  /** True when the rendered prefix contains NUL bytes or invalid UTF-8 — i.e.
   *  the file is binary, not text. `content` is still returned verbatim (never
   *  blanked); the text viewer uses this to show a "binary file" message
   *  instead of rendering mojibake, which is what lets extension-less files be
   *  viewable without an ever-growing extension allowlist. */
  readonly binary?: boolean;
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
