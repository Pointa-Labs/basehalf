/**
 * Badge = a workspace file/folder plus the "backpack" bh tracks for it. Per
 * private-docs/focus_mode_spec, a badge holds ONLY the node's identity, a
 * one-line description, and the reference graph (outbound + inbound):
 *
 *   path: docs/chapter-01.md
 *   kind: file
 *   description: "第一章正文，介绍核心概念。"
 *   references:
 *     - docs/chapter-02.md
 *   referenced_by:
 *     - docs/summary.md
 *
 * Spatial state (card positions, sizes, edge anchors + labels) lives in the
 * sibling `canvas.yaml`, NOT here — a badge is the semantic layer, the canvas is
 * the visual layer. References are PLAIN PATHS (no per-edge note/side): the edge
 * label + anchors are a canvas concern.
 *
 * A badge lives in the mirror tree at
 *   <workspace>/.bh/mirror/<relative-path>/badge.yaml
 * for BOTH file and folder kinds (the kind is a field, not the path — a real
 * filesystem can't hold a file and a folder at the same path, so routing both to
 * <rel>/badge.yaml is collision-free). The reverse index that used to live in
 * .bh/index/inbound.json is EMBEDDED here as `referenced_by`, so "who points at
 * me?" is one read of this file.
 */

export type BadgeKind = 'file' | 'folder';

export interface BadgeFile {
  /** Workspace-relative POSIX path of the file/folder this badge annotates. */
  readonly path: string;
  readonly kind: BadgeKind;
  /** A one-line, human-authored description of the node. Absent when none. */
  readonly description?: string;
  /** Outbound semantic references — workspace-relative paths this node points
   *  at. Plain paths only; the visual edge (anchors + label) is canvas.yaml. */
  readonly references: readonly string[];
  /** Reverse links — workspace-relative paths that point AT this node. Embedded
   *  here (replacing the old .bh/index/inbound.json) and maintained by
   *  badge.addRef/removeRef/rename on the TARGET badge. Absent/empty when
   *  nothing points here. */
  readonly referenced_by?: readonly string[];
  /** Set by the watcher when the underlying file is deleted from disk. The badge
   *  is preserved (description / references / referenced_by stay intact) so the
   *  user can resurrect or cleanly delete. Not part of the spec prototype — a
   *  functional flag, never derivable, omitted unless true. */
  readonly orphan?: boolean;
}

// ── Command args / results ──────────────────────────────────────────────────

export interface BadgeGetArgs {
  readonly file: string;
  /** Defaults to 'file'. Pass 'folder' for directory badges. */
  readonly kind?: BadgeKind;
}
export type BadgeGetResult = BadgeFile | null;

/**
 * Patch shape passed to badge.set. Cannot change identity fields (path/kind) or
 * the reference graph. NOTE: `references` is deliberately NOT here — reference
 * edits go through badge.addRef/removeRef/rename, which cascade the embedded
 * `referenced_by` on the OTHER end. A bare references replacement via set() would
 * silently break that bidirectional invariant.
 */
export type BadgePatch = Partial<Pick<BadgeFile, 'description'>> & {
  /** Required only on the very first set() that creates the badge from scratch. */
  readonly kind?: BadgeKind;
  /** Explicit orphan transition. OMITTED on ordinary edits — badge.set then
   *  PRESERVES the existing orphan flag (a description edit on a deleted file must
   *  not silently un-orphan it). Set `false` by a presence-confirmer (the
   *  watcher's add when a file re-appears) to clear it; orphan is otherwise set
   *  only by badge.markOrphan. */
  readonly orphan?: boolean;
};

export interface BadgeSetArgs {
  readonly file: string;
  readonly patch?: BadgePatch;
}
export type BadgeSetResult = BadgeFile;

export interface BadgeListArgs {
  readonly kind?: BadgeKind;
  /** Substring match across path + description, case-insensitive. */
  readonly query?: string;
}
export interface BadgeListResult {
  readonly badges: readonly BadgeFile[];
}

export interface BadgeDeleteArgs {
  readonly file: string;
  readonly kind?: BadgeKind;
}
export interface BadgeDeleteResult {
  readonly deleted: boolean;
}

export interface BadgeAddRefArgs {
  readonly file: string;
  readonly to: string;
  readonly kind?: BadgeKind;
}

export interface BadgeRemoveRefArgs {
  readonly file: string;
  readonly to: string;
  readonly kind?: BadgeKind;
}

export interface BadgeMarkOrphanArgs {
  readonly file: string;
  readonly kind?: BadgeKind;
}
export type BadgeMarkOrphanResult = BadgeFile | null;

export interface BadgeRenameArgs {
  readonly from: string;
  readonly to: string;
  readonly kind?: BadgeKind;
  /** When true, a MISSING source badge is NOT an error — the call still carries
   *  any annotated descendants (folder rename) and remaps focus, then returns
   *  `badge: null`. Used by `workspace.renameEntry` so renaming an UNANNOTATED
   *  file/folder (the sparse-overlay common case) succeeds quietly. Callers that
   *  omit it (the watcher) keep the throw, which drives their sparse fallback. */
  readonly ifExists?: boolean;
}
export interface BadgeRenameResult {
  /** The moved badge, or `null` when the source had no badge and `ifExists` was set. */
  readonly badge: BadgeFile | null;
  /** Files whose badges had an outbound reference to `from` and were updated to
   *  point at `to` instead. Useful for the watcher / desktop to know which
   *  neighbours moved. */
  readonly updatedRefs: readonly string[];
  /** True if focus had `from` in its active list and was rewritten. */
  readonly focusUpdated: boolean;
}

export interface BadgeRevisionArgs {
  readonly _?: never;
}
export interface BadgeRevisionResult {
  /** Number of badge.yaml files. */
  readonly count: number;
  /** Newest badge mtime (epoch ms); 0 when there are none. Together with count,
   *  a cheap signature a UI poll compares to detect external `.bh/mirror/` edits
   *  (an agent) without re-parsing every badge. */
  readonly maxMtimeMs: number;
}

export interface BadgePruneDanglingArgs {
  // No args — sweeps the whole current workspace.
  readonly _?: never;
}
export interface BadgePruneDanglingResult {
  /** Files whose underlying disk file/folder is gone and whose badge was freshly
   *  marked orphan by this sweep (already-orphan badges aren't counted). */
  readonly orphaned: readonly string[];
}

/**
 * Thrown when a badge.yaml on disk fails to parse. UI / list callers should
 * catch and skip; never crash on a single bad file.
 */
export class BadgeCorrupt extends Error {
  readonly code = 'BADGE_CORRUPT';
  readonly file: string;
  constructor(file: string, options?: { cause?: unknown }) {
    super(`Badge corrupt: ${file}`, options);
    this.name = 'BadgeCorrupt';
    this.file = file;
  }
}
