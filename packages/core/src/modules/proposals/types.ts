/**
 * Proposals — the agent → human WRITE-BACK leg of the protocol.
 *
 * While working, an agent appends one line per observation to
 * `.bh/cache/proposals.md`:  `[file] -> [target or fact]: [reason]`. This module
 * is the RECEIVING end the user triages from: list / dismiss / clear. (Adoption
 * — turning a proposal into a real badge note — stays a human action through the
 * normal badge.* commands; per D3 the badge pool is always human-authored, so
 * core never auto-writes a badge from a proposal.)
 */

/** One parsed line from proposals.md. */
export interface Proposal {
  /** 0-based index of this line among the file's non-empty proposal lines —
   *  the stable handle dismiss() takes (the raw file is the source of truth). */
  readonly line: number;
  /** The whole line verbatim (always present, even when it didn't parse into
   *  the `file -> target: reason` shape — a malformed observation is still
   *  signal the user should see). */
  readonly raw: string;
  /** Left of the `->`, when the line parsed. */
  readonly file?: string;
  /** Between `->` and `:`, when the line parsed. */
  readonly target?: string;
  /** After the `:`, when the line parsed. */
  readonly reason?: string;
}

export interface ProposalsListArgs {
  readonly _?: never;
}
export interface ProposalsListResult {
  readonly proposals: readonly Proposal[];
}

export interface ProposalsDismissArgs {
  /** The `line` index (from list) to remove. */
  readonly line: number;
}
export interface ProposalsDismissResult {
  /** True when a line was removed; false when the index was out of range. */
  readonly dismissed: boolean;
  /** The proposals remaining after the dismissal. */
  readonly proposals: readonly Proposal[];
}

export interface ProposalsClearArgs {
  readonly _?: never;
}
export interface ProposalsClearResult {
  /** How many proposal lines were cleared. */
  readonly cleared: number;
}
