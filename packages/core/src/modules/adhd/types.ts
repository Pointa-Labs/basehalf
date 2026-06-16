/**
 * ADHD = per-FILE reading aids. Per private-docs/focus_mode_spec, each file may
 * own an `adhd.yaml` at `<workspace>/.bh/mirror/<file>/adhd.yaml`:
 *
 *   path: docs/chapter-01.md
 *   kind: file
 *   highlight_keywords:
 *     - "供需均衡"
 *     - "边际成本"
 *   read_paragraphs:
 *     - [12, 24]
 *     - [31, 38]
 *
 * `highlight_keywords` are keywords the editor highlights in the file.
 * `read_paragraphs` are inclusive 1-based LINE-NUMBER ranges the user has read;
 * a line not inside any range is "unread" (no paragraph IDs are maintained — the
 * ranges are derived from line numbers). Ranges are kept sorted, non-overlapping,
 * and gap-coalesced by the markRead/markUnread commands.
 *
 * THIS ROUND (structural-first): the core read/write commands only — the editor
 * highlight + read/unread UI is a later round.
 */

/** An inclusive 1-based line range `[start, end]` (start ≤ end). */
export type LineRange = readonly [start: number, end: number];

export interface AdhdFile {
  readonly path: string;
  readonly kind: 'file';
  /** Keywords to highlight. Absent/empty when none. */
  readonly highlight_keywords?: readonly string[];
  /** Read line ranges (sorted, non-overlapping). Absent/empty when none. */
  readonly read_paragraphs?: readonly LineRange[];
}

// ── Command args / results ──────────────────────────────────────────────────

export interface AdhdGetArgs {
  readonly file: string;
}
export type AdhdGetResult = AdhdFile | null;

/** Replace the whole adhd.yaml (the door an agent uses to GENERATE it from file
 *  content). Omitted fields clear that field; the ranges are normalized
 *  (validated, sorted, coalesced) and keywords de-duplicated. */
export interface AdhdSetArgs {
  readonly file: string;
  readonly highlight_keywords?: readonly string[];
  readonly read_paragraphs?: readonly LineRange[];
}
export type AdhdSetResult = AdhdFile;

export interface AdhdAddKeywordArgs {
  readonly file: string;
  readonly keyword: string;
}
export type AdhdAddKeywordResult = AdhdFile;

export interface AdhdRemoveKeywordArgs {
  readonly file: string;
  readonly keyword: string;
}
export type AdhdRemoveKeywordResult = AdhdFile | null;

export interface AdhdMarkReadArgs {
  readonly file: string;
  /** Inclusive 1-based line range to mark read (merged into read_paragraphs). */
  readonly start: number;
  readonly end: number;
}
export type AdhdMarkReadResult = AdhdFile;

export interface AdhdMarkUnreadArgs {
  readonly file: string;
  /** Inclusive 1-based line range to mark unread (subtracted from read_paragraphs). */
  readonly start: number;
  readonly end: number;
}
export type AdhdMarkUnreadResult = AdhdFile | null;

export interface AdhdRevisionArgs {
  readonly _?: never;
}
export interface AdhdRevisionResult {
  readonly count: number;
  readonly maxMtimeMs: number;
}

/** Rename cascade: move the subtree's adhd.yaml to the new location. */
export interface AdhdRelocateArgs {
  readonly from: string;
  readonly to: string;
}
export interface AdhdRelocateResult {
  readonly moved: number;
}

/** Delete cascade: reap the subtree's adhd.yaml. */
export interface AdhdPurgeNodeArgs {
  readonly path: string;
}
export interface AdhdPurgeNodeResult {
  readonly removed: number;
}

/** Thrown when an adhd.yaml on disk won't parse. */
export class AdhdCorrupt extends Error {
  override readonly name = 'AdhdCorrupt';
  constructor(
    public readonly file: string,
    opts?: { cause?: unknown },
  ) {
    super(`Corrupt adhd.yaml for "${file}"`, opts);
  }
}
