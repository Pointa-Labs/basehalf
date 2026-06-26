/**
 * Workspace = a folder the user has registered as a BaseHalf root.
 * Files stay where they are; we just track which folders are "ours". There is no
 * global "current" pointer: the active workspace is bound per call (per window)
 * via `ctx.workspaceRoot`, so the registry is a pure set of folders.
 */

import type { CanvasEdge, CanvasSize } from '../canvas/types.js';

export interface WorkspaceEntry {
  readonly name: string;
  readonly path: string;
  readonly addedAt: string;
  /** ISO timestamp a window last opened this workspace — bumped by
   *  `workspace.touch` on every open. Drives the "recent workspaces" ordering
   *  (welcome list / Dock recent / File ▸ Open Recent). Absent until first opened. */
  readonly lastOpenedAt?: string;
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
  readonly workspaces: Record<string, Omit<WorkspaceEntry, 'name'>>;
}

export const EMPTY_WORKSPACES: WorkspacesFile = Object.freeze({
  version: 1,
  workspaces: {},
});

// ── Command args / results ──────────────────────────────────────────────────

export interface WorkspaceAddArgs {
  readonly path: string;
  readonly name?: string;
  /** If true: also append `.bh/cache/` to .gitignore, install the
   *  agent-protocol hint, and write `.bh/agent-harness/` docs.
   *  All setup writes are non-destructive + idempotent. */
  readonly setup?: boolean;
}

export interface SetupReport {
  /** `.bh/cache/` line added to .gitignore. */
  readonly gitignoreUpdated: boolean;
  /** Agent harness docs written under `.bh/agent-harness/`. */
  readonly agentHarnessUpdated: boolean;
  /** Workspace-hint section added to CLAUDE.md (Claude Code). */
  readonly claudeMdUpdated: boolean;
  /** Workspace-hint section added to AGENTS.md (the cross-tool convention). */
  readonly agentsMdUpdated: boolean;
  /** `.gitignore` already had `.bh/cache/` — skipped. */
  readonly gitignoreSkipped: boolean;
  /** Agent harness docs already matched, or a symlink/path escape was refused. */
  readonly agentHarnessSkipped: boolean;
  /** CLAUDE.md already had the hint marker (or a symlink was refused) — skipped. */
  readonly claudeMdSkipped: boolean;
  /** AGENTS.md already had the hint marker (or a symlink was refused) — skipped. */
  readonly agentsMdSkipped: boolean;
  /** No .gitignore (no git repo or not yet initialized) — skipped, with note. */
  readonly gitignoreAbsent: boolean;
}

export interface WorkspaceAddResult {
  readonly workspace: WorkspaceEntry;
  readonly bhDirCreated: boolean;
  /** True when the path was already registered (folder identity is the
   *  path): the existing entry is returned and nothing new is written. */
  readonly alreadyRegistered: boolean;
  /** Only present when called with `setup: true`. */
  readonly setup?: SetupReport;
}

export type WorkspaceListArgs = Record<string, never>;
export interface WorkspaceListResult {
  /** The workspace THIS call is bound to (its name), derived from the call's
   *  workspaceRoot — not a global pointer. null when no root is bound. */
  readonly current: string | null;
  readonly workspaces: readonly WorkspaceEntry[];
}

export interface WorkspaceUseArgs {
  readonly name: string;
}
export interface WorkspaceUseResult {
  readonly current: WorkspaceEntry;
}

/** `workspace.touch({ path })` — bump the registered workspace at `path`'s
 *  `lastOpenedAt` to now. By PATH (the folder identity), so the desktop can call
 *  it with a window's bound root without resolving a name. A no-op (`touched:
 *  false`) when the path isn't registered. */
export interface WorkspaceTouchArgs {
  readonly path: string;
}
export interface WorkspaceTouchResult {
  readonly touched: boolean;
  readonly name?: string;
  readonly lastOpenedAt?: string;
}

export type WorkspaceCurrentArgs = Record<string, never>;
export type WorkspaceCurrentResult =
  | { readonly current: WorkspaceEntry }
  | { readonly current: null };

/** `workspace.ensureSetup()` — run the idempotent BaseHalf workspace scaffold
 *  installer for the workspace bound to this call. Used when an existing
 *  workspace is opened after an app update. */
export type WorkspaceEnsureSetupArgs = Record<string, never>;
export type WorkspaceEnsureSetupResult = SetupReport;

export interface WorkspaceRemoveArgs {
  readonly name: string;
}
export interface WorkspaceRemoveResult {
  readonly removed: string;
}

export interface WorkspaceRenameArgs {
  readonly from: string;
  readonly to: string;
}
export interface WorkspaceRenameResult {
  readonly workspace: WorkspaceEntry;
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

/** `workspace.listCanvas({folder})` — the canvas's data source for one folder
 * (folder=null is the workspace root). Returns the folder's DIRECT children (one
 * level, canvas-supported types only, tooling dirs skipped) merged from BOTH
 * layers: each child's sparse badge overlay (description + reference graph) and
 * its card position from the folder's canvas.yaml, plus the folder's edges + size.
 * Reads the filesystem per folder instead of a materialized mirror; unannotated
 * children come back with empty reference arrays and no card (auto-laid-out). */
export interface WorkspaceListCanvasArgs {
  readonly folder: string | null;
}

/** One direct child surfaced in a folder card's contents preview. */
export interface CanvasFolderPreviewItem {
  readonly name: string;
  readonly kind: 'file' | 'folder';
}
/** Lightweight, derived peek at a folder's DIRECT contents — drives the canvas
 *  folder card's "what's inside" list. `total` is the count of canvas-supported
 *  direct children (files + subfolders); `items` is the first few (folders-first,
 *  then alpha — the same order the canvas shows when you enter the folder),
 *  capped so a giant folder never bloats the canvas payload. Computed read-only
 *  in listCanvas; never persisted. */
export interface CanvasFolderPreview {
  readonly total: number;
  readonly items: readonly CanvasFolderPreviewItem[];
}
/** One direct child of the folder, as the canvas renders it: the badge's
 *  semantic layer (description + reference graph) merged with its visual layer
 *  (the card position/size from the folder's canvas.yaml, absent → the renderer
 *  auto-lays-it-out), plus — for a folder — a derived `preview` of its contents.
 *  `references` / `referenced_by` are normalized to present arrays so the
 *  renderer never branches on undefined. */
export interface CanvasChildBadge {
  readonly path: string;
  readonly kind: 'file' | 'folder';
  readonly description?: string;
  readonly references: readonly string[];
  readonly referenced_by: readonly string[];
  readonly orphan?: boolean;
  /** The card's saved position/size from canvas.yaml. Absent when the child has
   *  never been placed (the renderer falls back to auto-layout). */
  readonly card?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly preview?: CanvasFolderPreview;
}

export interface WorkspaceListCanvasResult {
  /** Echoes the requested folder (null = workspace root). */
  readonly folder: string | null;
  /** The folder canvas's overall size, when the user has sized it. */
  readonly size?: CanvasSize;
  readonly children: readonly CanvasChildBadge[];
  /** Connections between this folder's children (from canvas.yaml), filtered to
   *  edges whose both endpoints are present children. */
  readonly edges: readonly CanvasEdge[];
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

/** Move a user file WITHIN the current workspace (the in-document title rename:
 * retitle a note → its filename follows). Both paths are workspace-relative
 * POSIX. A `to` that already exists is suffixed `-2`/`-3`… (same convention as
 * importFile / workspace-name collisions); `to` in the result is where it
 * actually landed. */
export interface WorkspaceRenameFileArgs {
  readonly from: string;
  readonly to: string;
}
export interface WorkspaceRenameFileResult {
  readonly from: string;
  /** Where the file actually landed (may differ from the requested `to` after
   *  collision-suffixing). */
  readonly to: string;
  readonly renamed: boolean;
}

/** Create an EMPTY (or seeded) user file inside the current workspace — the
 * context-menu / inline "New File" door. Never clobbers: a name collision picks
 * `-2`/`-3` (same convention as importFile); parent folders are auto-created.
 * `path` in the result is where it actually landed. */
export interface WorkspaceCreateFileArgs {
  readonly path: string;
  /** Initial contents; defaults to empty. */
  readonly content?: string;
}
export interface WorkspaceCreateFileResult {
  /** Workspace-relative POSIX path the file was created at (collision-suffixed). */
  readonly path: string;
}

/** Create a folder inside the current workspace — the "New Folder" door. Never
 * clobbers (collision-suffixed like createFile). `path` is where it landed. */
export interface WorkspaceCreateFolderArgs {
  readonly path: string;
}
export interface WorkspaceCreateFolderResult {
  readonly path: string;
}

/** Delete a user file OR folder from the current workspace — the context-menu
 * "Delete" door. The desktop host wires `fs.trash` (recoverable, OS trash); the
 * pure-node host falls back to a permanent `fs.rm`. Cascades the whole mirror
 * node: the entry's badge + canvas/focus/adhd YAML (and, for a folder, every
 * descendant) is purged and the current_focus symlink self-heals. An explicit
 * user action — exempt from the observer-only rule that governs background
 * writes. */
export interface WorkspaceDeleteEntryArgs {
  readonly path: string;
  readonly kind: 'file' | 'folder';
}
export interface WorkspaceDeleteEntryResult {
  readonly deleted: boolean;
}

/** Rename/move a user file OR folder within the current workspace, cascading the
 * whole mirror node — badge refs + embedded referenced_by, the canvas card/edges,
 * the focus.yaml viewport (+ current_focus), the adhd reading aids, and (for a
 * folder) every descendant — via a tolerant `badge.rename`. The complete rename
 * the file-only `workspace.renameFile` deliberately leaves to the watcher; the
 * context menu drives THIS for deterministic, folder-correct cascades. `to` in
 * the result is the actual landing path (collision-suffixed). */
export interface WorkspaceRenameEntryArgs {
  readonly from: string;
  readonly to: string;
  readonly kind: 'file' | 'folder';
}
export interface WorkspaceRenameEntryResult {
  readonly from: string;
  readonly to: string;
  readonly renamed: boolean;
}

/** Copy an EXTERNAL file into the current workspace (the drag-a-file-onto-
 * the-canvas door). Always a copy — the source is never moved or touched;
 * the destination lands in the user's own folder where the file manager,
 * git, and agents all see it. Never clobbers: a name collision picks a
 * `-2`/`-3` suffix (same convention as workspace-name collisions). */
export interface WorkspaceImportFileArgs {
  /** Absolute path of the source file (from the OS drag payload). */
  readonly from: string;
  /** Workspace-relative destination folder; null/omitted = workspace root. */
  readonly to?: string | null;
}
export interface WorkspaceImportFileResult {
  /** Workspace-relative POSIX path the file lives at after the call. */
  readonly path: string;
  /** Final basename (collision suffix included when one was needed). */
  readonly name: string;
  /** False when the source already lived inside the workspace — no copy was
   *  made; `path` points at the existing file. */
  readonly imported: boolean;
  /** Whether the file's type gets a canvas card (callers use this to decide
   *  whether placing a canvas position makes sense). */
  readonly supported: boolean;
}

export interface WorkspaceSetViewportArgs {
  readonly viewport: ViewportState;
}
export type WorkspaceSetViewportResult = Record<string, never>;
