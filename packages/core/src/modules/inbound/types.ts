/**
 * Inbound reverse index — given a file, "who points at me?".
 * Mirrors badge.references, but indexed in the other direction so the
 * GUI / agent can answer "what depends on chapter-03.md?" in O(1).
 *
 * On disk at <workspace>/.bh/index/inbound.json (SR-v0 §3.2).
 * Maintained both incrementally (via badges.addRef/removeRef → ctx.run)
 * and via full rebuild (inbound.rebuild).
 */

export interface InboundEntry {
  readonly from: string;
  readonly note?: string;
}

export interface InboundIndex {
  readonly bhVersion: 1;
  readonly entries: Record<string, readonly InboundEntry[]>;
  readonly rebuildAt: string;
}

// ── Command args / results ──────────────────────────────────────────────────

export interface InboundGetArgs {
  readonly file: string;
}
export interface InboundGetResult {
  readonly entries: readonly InboundEntry[];
}

export type InboundRebuildArgs = Record<string, never>;
export interface InboundRebuildResult {
  readonly rebuildAt: string;
  readonly entryCount: number;
}

export interface InboundAddRefArgs {
  readonly from: string;
  readonly to: string;
  readonly note?: string;
}

export interface InboundRemoveRefArgs {
  readonly from: string;
  readonly to: string;
}
