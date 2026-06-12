/**
 * Focus signal — the file the agent reads on every message to know what
 * the user is currently focused on. Published to <workspace>/.bh/focus.md
 * (Markdown, not JSON, so agents paste it into context without translation).
 *
 * Schema: SR-v0 §3.3.
 */

export interface FocusSetArgs {
  /** Explicit file list. Empty array clears focus. */
  readonly files?: readonly string[];
  /** Or, point at a FOLDER (workspace-relative path): all supported files under
   *  it become the active list and the folder badge's prompt becomes the intent
   *  (unless `intent` overrides). The folder IS the grouping — its files are
   *  gathered automatically, no manual selection. A folder's path encodes its
   *  parent/child structure, which the agent reads straight from the paths. */
  readonly folder?: string;
  /** Optional turn intent — "what I'm trying to do this turn". Inlined into
   *  focus.md as an `intent:` block. When a folder is given, the folder badge's
   *  prompt is used as the intent unless this overrides it. */
  readonly intent?: string;
}

/**
 * Where a focus's `intent:` was DERIVED from — a folder's prompt. Recorded as a
 * `# source-folder:` provenance comment in focus.md so editing that folder's
 * prompt can refresh the brief by EXACT identity (never inferred from
 * members/text). Absent for a files-sourced focus or a manual intent override.
 */
export interface FocusSource {
  readonly kind: 'folder';
  readonly id: string;
}
export interface FocusSetResult {
  readonly active: readonly string[];
}

/**
 * One active item in the focus brief, with the human's curated MEANING
 * inlined so the agent reads it in a single pass instead of re-fetching N
 * badge JSONs. This is the compound-thinking payload: the prompt is "what
 * the agent should know about this file", the ref notes are "why this link".
 */
export interface FocusItem {
  readonly file: string;
  readonly prompt?: string;
  /** Freshness calibration: present when the file changed on disk AFTER the
   *  prompt was last written, so the brief can tell the agent how much to
   *  trust the note (dates only — the agent calibrates, bh never judges).
   *  Computable only for badges that carry `promptModifiedAt` AND when the
   *  fs reports mtimes; absent otherwise (no guessing). */
  readonly promptStale?: { readonly notedAt: string; readonly fileChangedAt: string };
  readonly refs?: readonly { readonly to: string; readonly note?: string }[];
}

export type FocusGetArgs = Record<string, never>;
export interface FocusGetResult {
  readonly active: readonly string[];
  /** The turn intent (from `intent:` in focus.md), if any. Surfaced so a caller
   *  re-setting focus can preserve it instead of dropping the block. */
  readonly intent?: string;
  /** When the turn brief was last SERVED (ISO) — stamped by focus.brief, read here
   *  so the desktop chip can show "agent read your context Ns ago". Confirms a
   *  read occurred, not comprehension. Undefined until the first brief read. */
  readonly lastBriefServedAt?: string;
}

export type FocusClearArgs = Record<string, never>;
export interface FocusClearResult {
  readonly cleared: true;
}

export interface FocusRefreshFolderIntentArgs {
  /** The folder whose badge prompt just changed. focus.md's `intent:` is
   *  refreshed ONLY when its `# source-folder:` provenance equals this path —
   *  exact identity, never inferred from members/text. */
  readonly folder: string;
}
export interface FocusRefreshFolderIntentResult {
  /** True when focus.md was re-rendered (this folder is the unmodified source
   *  of the current brief); false when left untouched. */
  readonly refreshed: boolean;
}

export interface FocusRenameActiveFileArgs {
  /** Old workspace-relative path being renamed. */
  readonly from: string;
  /** New path. */
  readonly to: string;
}
export interface FocusRenameActiveFileResult {
  /** True when `from` was active and got remapped to `to` (intent + source-folder
   *  provenance preserved); false when `from` wasn't focused. */
  readonly renamed: boolean;
}

export interface FocusToggleActiveFileArgs {
  /** File to add (if absent) or remove (if present) from the active set. The
   *  turn intent + source-folder provenance are PRESERVED — so refining a
   *  folder-sourced focus by shift+click doesn't sever the folder→brief refresh
   *  link or drop the curated intent (which a bare focus.set({files}) would). */
  readonly file: string;
}
export interface FocusToggleActiveFileResult {
  /** The active set after the toggle. */
  readonly active: readonly string[];
}

export interface FocusSetIntentArgs {
  /** The turn intent — "what I'm trying to do/ask this turn" — to write into the
   *  `intent:` line. Empty/whitespace clears it. The active set + per-file
   *  prompts/refs are PRESERVED; a manually-typed intent is the user's own, so
   *  it CLEARS any `# source-folder:` provenance (the intent is no longer
   *  folder-derived — editing that folder's prompt should no longer overwrite it). */
  readonly intent?: string;
  /** If given, the write is SKIPPED unless the current active set still equals
   *  this (exact order). Binds an intent to the focus it was authored for, so a
   *  late save (e.g. one auto-flushed as the editor was dismissed by a click that
   *  changed/cleared focus) never writes the old question into the new focus. */
  readonly expectedActive?: readonly string[];
}
export interface FocusSetIntentResult {
  /** The intent after the call (null when cleared/absent). */
  readonly intent: string | null;
  /** True when the write was skipped because the active set no longer matched
   *  `expectedActive` (focus changed underneath the edit). */
  readonly skipped?: boolean;
}

export interface FocusBriefArgs {
  /** When false, READ the brief WITHOUT stamping the served receipt — the in-app
   *  preview's peek must not masquerade as an agent pull. Defaults to true: a CLI
   *  `bh focus brief`, the desktop Copy-brief, or a future MCP get_brief are
   *  genuine hand-offs and DO stamp. */
  readonly stamp?: boolean;
}
export interface FocusBriefResult {
  /** The current `.bh/focus.md` content VERBATIM — the exact turn brief the
   *  agent reads each message. Surfaced so the desktop can offer a one-click
   *  "copy what my agent sees" for pasting into any AI chat (not just a
   *  Claude-Code-in-repo auto-read flow). Empty string when no focus.md exists
   *  or nothing is focused. */
  readonly brief: string;
}

export type FocusInitArgs = Record<string, never>;
export interface FocusInitResult {
  /** True when this call wrote the empty template; false when it was already
   *  present and we left it alone. */
  readonly created: boolean;
}

export interface FocusResyncArgs {
  /** When given, resync is a no-op unless this file is in the active list —
   *  so a badge edit on an UNfocused file doesn't rewrite focus.md. Omit to
   *  force a resync of the whole active list. */
  readonly file?: string;
}
export interface FocusResyncResult {
  /** True when focus.md was re-rendered (the file was active); false when the
   *  active list was empty or didn't include `file`. */
  readonly resynced: boolean;
}

export interface FocusReconcileNewFileArgs {
  /** A newly-created file (workspace-relative). When the active focus is
   *  folder-SOURCED and this file is under that folder, it's pulled into the
   *  brief (so "Focus this folder = read all its files" stays true for files
   *  added after focusing). No-op otherwise. */
  readonly file: string;
}
export interface FocusReconcileNewFileResult {
  /** True when the file was under the active focus's source folder and added. */
  readonly added: boolean;
}

export interface FocusRenameActiveFolderArgs {
  /** Old folder path (workspace-relative) being renamed. */
  readonly from: string;
  /** New folder path. */
  readonly to: string;
}
export interface FocusRenameActiveFolderResult {
  /** True when focus.md was rewritten — either active child paths under `from`
   *  were remapped to `to`, or the `# source-folder:` provenance pointed at
   *  `from` and was re-stamped to `to` (so the folder→brief refresh link
   *  survives the rename). False when nothing referenced `from`. */
  readonly renamed: boolean;
}

export type FocusPruneDanglingArgs = Record<string, never>;
export interface FocusPruneDanglingResult {
  /** How many active files were dropped because they no longer exist on disk. */
  readonly pruned: number;
}
