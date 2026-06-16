/**
 * Focus = the user's CURRENT viewport, mirrored for the agent. Per
 * private-docs/focus_mode_spec, focus FLIPPED from a hand-curated active-file
 * list (`.bh/focus.md`) to a real-time viewport mirror: whatever node the user is
 * looking at IS the focus. Each node owns a `focus.yaml`:
 *
 *   # file
 *   path: docs/chapter-01.md
 *   kind: file
 *   visible_lines: { start: 12 }
 *   cursor: { line: 28, column: 6 }
 *
 *   # folder
 *   path: docs
 *   kind: folder
 *   viewport_center: { x: 800, y: 420 }
 *   zoom: 1.2
 *
 * The agent's single entry point is `.bh/current_focus.yaml` — a SYMLINK to the
 * active node's focus.yaml. The desktop repoints it as the user switches nodes.
 *
 * focus.set is a FIELD-SCOPED merge (see store.patchFocusNode): the desktop wires
 * the live state fields to real events — a file's `visible_lines.start` to editor
 * scroll, a folder's `viewport_center`/`zoom` to canvas pan/zoom — and each arrives
 * as its own focus.set, so the write must preserve the sibling fields rather than
 * overwrite the whole node. All state fields stay OPTIONAL: a bare node-switch may
 * write just `path` + `kind` (and then keeps the node's last-known viewport).
 * (`cursor` on a read-only/line-less viewer has no clean source yet — see the
 * desktop focus-sync wiring for which fields each viewer actually emits.)
 */

export type FocusKind = 'file' | 'folder';

export interface FileFocus {
  readonly path: string;
  readonly kind: 'file';
  /** First line currently visible in the editor viewport (1-based). */
  readonly visible_lines?: { readonly start: number };
  /** Text cursor position (1-based line, 0/1-based column per the editor). */
  readonly cursor?: { readonly line: number; readonly column: number };
}

export interface FolderFocus {
  readonly path: string;
  readonly kind: 'folder';
  /** Canvas pan center, in canvas coordinates. */
  readonly viewport_center?: { readonly x: number; readonly y: number };
  readonly zoom?: number;
}

export type FocusNode = FileFocus | FolderFocus;

// ── Command args / results ──────────────────────────────────────────────────

export interface FocusSetArgs {
  /** Workspace-relative node path; `''` is the workspace-root folder. */
  readonly path: string;
  readonly kind: FocusKind;
  readonly visible_lines?: { readonly start: number };
  readonly cursor?: { readonly line: number; readonly column: number };
  readonly viewport_center?: { readonly x: number; readonly y: number };
  readonly zoom?: number;
  /** The workspace NAME the `path` belongs to, captured by the caller. The
   *  desktop fires focus.set un-awaited; if the user switches workspaces while it
   *  is in flight, the late root resolution could otherwise plant this (A-relative)
   *  path under workspace B. When provided and no longer the current workspace,
   *  the set is SKIPPED (the node is returned, nothing is written). Omit for
   *  same-process callers that can't race a switch. */
  readonly workspace?: string;
}
export type FocusSetResult = FocusNode;

export type FocusGetArgs = Record<string, never>;
/** The node `.bh/current_focus.yaml` points at, or null when nothing is focused
 *  (no symlink, a dangling/escaping target, or it isn't a symlink). */
export type FocusGetResult = FocusNode | null;

export type FocusClearArgs = Record<string, never>;
export interface FocusClearResult {
  /** True when a current_focus symlink existed and was removed. */
  readonly cleared: boolean;
}

export type FocusPruneDanglingArgs = Record<string, never>;
export interface FocusPruneDanglingResult {
  /** True when the current focus pointed at a node whose file/folder is gone on
   *  disk and the symlink was therefore cleared. */
  readonly cleared: boolean;
}

/** Rename cascade: move the subtree's focus.yaml + repoint current_focus. */
export interface FocusRelocateArgs {
  readonly from: string;
  readonly to: string;
}
export interface FocusRelocateResult {
  /** Number of focus.yaml files relocated. */
  readonly moved: number;
  /** True when current_focus pointed inside the moved subtree and was repointed at
   *  the relocated node (so the agent keeps tracking it across the rename). */
  readonly repointed: boolean;
}

/** Delete cascade: reap the subtree's focus.yaml + clear current_focus if inside. */
export interface FocusPurgeNodeArgs {
  readonly path: string;
}
export interface FocusPurgeNodeResult {
  readonly removed: number;
  readonly cleared: boolean;
}

/** Thrown when a focus.yaml (or the current_focus target) won't parse. */
export class FocusCorrupt extends Error {
  override readonly name = 'FocusCorrupt';
  constructor(
    public readonly path: string,
    opts?: { cause?: unknown },
  ) {
    super(`Corrupt focus.yaml for "${path || '<root>'}"`, opts);
  }
}
