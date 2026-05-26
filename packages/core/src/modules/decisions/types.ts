/**
 * Decisions = the first content-bearing module. A decision is a small,
 * source-grounded note: "we decided X because Y, evidence Z". Stored as one
 * JSON file per decision under <workspace>/.bh/decisions/<slug>.json so each
 * decision is a git-trackable atom.
 */

export type DecisionStatus = 'active' | 'deprecated' | 'superseded';

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
export type DecisionShowResult = Decision;

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
