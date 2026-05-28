/**
 * Badge = a workspace file/folder plus the "backpack" (prompt, references,
 * canvas position) bh tracks for it. Per IR-v2-04 "展示牌 = 文件 + 背包".
 *
 * Schema is SR-v0 §3.1; on disk at:
 *   file:   <workspace>/.bh/badges/<relative-path>.json
 *   folder: <workspace>/.bh/badges/<folder-path>/.badge.json
 */

export type BadgeKind = 'file' | 'folder';

export interface BadgePosition {
  readonly x: number;
  readonly y: number;
  readonly collapsed: boolean;
}

export interface BadgeReference {
  readonly to: string;
  readonly note?: string;
}

export interface BadgeFile {
  readonly bhVersion: 1;
  readonly file: string;
  readonly kind: BadgeKind;
  readonly prompt?: string;
  readonly references: readonly BadgeReference[];
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

/**
 * AR-PR11-7: thrown when a badge JSON on disk fails to parse. UI / list
 * callers should catch and skip; never crash on a single bad file.
 */
export class BadgeCorrupt extends Error {
  readonly code = 'BADGE_CORRUPT';
  readonly file: string;
  constructor(file: string, options?: { cause?: unknown }) {
    super(`Badge JSON corrupt: ${file}`, options);
    this.name = 'BadgeCorrupt';
    this.file = file;
  }
}
