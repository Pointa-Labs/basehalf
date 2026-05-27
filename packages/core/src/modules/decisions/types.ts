/**
 * Decisions = the first content-bearing module. A decision is a small,
 * source-grounded note: "we decided X because Y, evidence Z". Stored as one
 * JSON file per decision under <workspace>/.bh/decisions/<slug>.json so each
 * decision is a git-trackable atom.
 *
 * Decisions can link to each other (extends / relates / depends-on / etc).
 * Links are stored on the source decision (outbound only); inbound links are
 * computed at read time by scanning all decisions. Avoids two-file writes
 * and keeps each decision self-contained on disk.
 */

export type DecisionStatus = 'active' | 'deprecated' | 'superseded';

/** Outbound link from one decision to another. `kind` is freeform-ish; CLAUDE.md documents conventions. */
export interface DecisionLink {
  readonly slug: string;
  readonly kind: string;
  readonly note?: string;
}

export interface Decision {
  readonly version: 1;
  readonly slug: string;
  readonly title: string;
  readonly rationale: string;
  readonly sources: readonly string[];
  readonly tags: readonly string[];
  readonly status: DecisionStatus;
  readonly decidedAt: string;
  readonly decidedBy: string;
  readonly supersedes: string | null;
  readonly supersededBy: string | null;
  readonly links: readonly DecisionLink[];
}

/** Inbound link discovered by scanning: another decision points HERE with this kind. */
export interface InboundLink {
  readonly fromSlug: string;
  readonly kind: string;
  readonly note?: string;
}

// ── Command args / results ──────────────────────────────────────────────────

export interface DecisionAddArgs {
  readonly title: string;
  readonly because: string;
  readonly source?: readonly string[];
  readonly tag?: readonly string[];
  readonly slug?: string;
  readonly by?: string;
}
export interface DecisionAddResult {
  readonly decision: Decision;
  /** Path relative to workspace root, e.g. `.bh/decisions/use-postgres.json`. */
  readonly path: string;
}

export interface DecisionRecallArgs {
  readonly query?: string;
  readonly tag?: readonly string[];
  readonly status?: DecisionStatus;
  readonly limit?: number;
}
export interface DecisionRecallResult {
  readonly matches: readonly Decision[];
}

export interface DecisionListArgs {
  readonly tag?: readonly string[];
  readonly status?: DecisionStatus;
}
export interface DecisionListResult {
  readonly decisions: readonly Decision[];
}

export interface DecisionShowArgs {
  readonly slug: string;
}
/** Show enriches the on-disk Decision with computed inbound links. */
export interface DecisionShowResult {
  readonly decision: Decision;
  readonly inboundLinks: readonly InboundLink[];
}

export interface DecisionUpdateArgs {
  readonly slug: string;
  readonly status?: DecisionStatus;
  readonly addSource?: readonly string[];
  readonly addTag?: readonly string[];
  readonly supersededBy?: string;
}
export interface DecisionUpdateResult {
  readonly decision: Decision;
}

export interface DecisionLinkArgs {
  readonly slug: string;
  readonly to: string;
  readonly kind: string;
  readonly note?: string;
}
export interface DecisionLinkResult {
  readonly decision: Decision;
  readonly added: DecisionLink;
}

export interface DecisionUnlinkArgs {
  readonly slug: string;
  readonly from: string;
  /** Optional: only remove links of this kind. If omitted, removes ALL links from slug → from. */
  readonly kind?: string;
}
export interface DecisionUnlinkResult {
  readonly decision: Decision;
  readonly removed: readonly DecisionLink[];
}
