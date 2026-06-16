/**
 * Badge = a workspace file/folder plus the "backpack" (prompt, references,
 * reverse-references, canvas position) bh tracks for it. Per IR-v2-04
 * "展示牌 = 文件 + 背包".
 *
 * Per private-docs/focus_mode_spec, a badge lives in the mirror tree at
 *   <workspace>/.bh/mirror/<relative-path>/badge.yaml
 * for BOTH file and folder kinds (the kind is a field, not the path — a real
 * filesystem can't hold a file and a folder at the same path, so routing both
 * to <rel>/badge.yaml is collision-free). The reverse index that used to live
 * in .bh/index/inbound.json is now EMBEDDED here as `referenced_by`, so "who
 * points at me?" is one read of this file.
 */

export type BadgeKind = 'file' | 'folder';
export type BadgeSide = 'top' | 'right' | 'bottom' | 'left';

export interface BadgePosition {
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  readonly collapsed: boolean;
}

export interface BadgeReference {
  readonly to: string;
  readonly note?: string;
  readonly fromSide?: BadgeSide;
  readonly toSide?: BadgeSide;
}

/** One inbound link: another badge `from` points at this one (with an optional
 *  note). The embedded replacement for an inbound-index entry. */
export interface BadgeBacklink {
  readonly from: string;
  readonly note?: string;
}

export interface BadgeFile {
  readonly bhVersion: 1;
  readonly file: string;
  readonly kind: BadgeKind;
  readonly prompt?: string;
  /** When the PROMPT TEXT last changed. Distinct from `modifiedAt`, which is
   * bumped by every write (canvas drags included) and therefore can't anchor a
   * freshness comparison. Set only when a badge.set patch actually CHANGES the
   * prompt value; absent on badges whose prompt predates this field — consumers
   * must then skip the comparison, never guess. */
  readonly promptModifiedAt?: string;
  readonly references: readonly BadgeReference[];
  /** Reverse links — who points AT this file. Embedded here (replacing the old
   *  .bh/index/inbound.json) and maintained by badge.addRef/removeRef/rename on
   *  the TARGET badge. Absent/empty when nothing points here. */
  readonly referenced_by?: readonly BadgeBacklink[];
  readonly canvas?: BadgePosition;
  readonly createdAt: string;
  readonly modifiedAt: string;
  /** Set by watcher when the underlying file is deleted from disk.
   * Badge is preserved (prompt / references / inbound stay intact) so the
   * user can resurrect or cleanly delete. */
  readonly orphan?: boolean;
}

// ── Command args / results ──────────────────────────────────────────────────

export interface BadgeGetArgs {
  readonly file: string;
  /** Defaults to 'file'. Pass 'folder' for directory badges. */
  readonly kind?: BadgeKind;
}
export type BadgeGetResult = BadgeFile | null;

/** Patch shape passed to badge.set. Cannot change identity fields (file/kind/created/version). */
export type BadgePatch = Partial<Pick<BadgeFile, 'prompt' | 'references' | 'canvas'>> & {
  /** Required only on the very first set() that creates the badge from scratch. */
  readonly kind?: BadgeKind;
  /** Explicit orphan transition. OMITTED on ordinary edits — badge.set then
   *  PRESERVES the existing orphan flag (a prompt/ref edit on a deleted file must
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
  /** Substring match across file path + prompt, case-insensitive. */
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
  readonly note?: string;
  readonly fromSide?: BadgeSide;
  readonly toSide?: BadgeSide;
  readonly kind?: BadgeKind;
}

export interface BadgeRemoveRefArgs {
  readonly file: string;
  readonly to: string;
  readonly kind?: BadgeKind;
}

export interface BadgeReconnectRefEndpoint {
  readonly file: string;
  readonly to: string;
  readonly kind?: BadgeKind;
}

export interface BadgeReconnectRefNextEndpoint extends BadgeReconnectRefEndpoint {
  readonly note?: string;
  readonly fromSide?: BadgeSide;
  readonly toSide?: BadgeSide;
}

export interface BadgeReconnectRefArgs {
  readonly previous: BadgeReconnectRefEndpoint;
  readonly next: BadgeReconnectRefNextEndpoint;
}
export type BadgeReconnectRefResult = BadgeListResult;

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
  /** Files whose badges had an outbound reference to `from` and were
   *  updated to point at `to` instead. Useful for the watcher / desktop
   *  to know which neighbours moved. */
  readonly updatedRefs: readonly string[];
  /** True if focus.md had `from` in its active list and was rewritten. */
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
  /** Files whose underlying disk file/folder is gone and whose badge was
   *  freshly marked orphan by this sweep (already-orphan badges aren't counted). */
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
