import type { GitCommit } from '@basehalf/core';

/**
 * Git Graph lane layout — the pure algorithm behind the commit-graph gutter.
 * Assigns each commit (a row) a lane (column) and the line segments that enter,
 * pass through, and leave its row, so a renderer can draw the branching DAG the
 * way `git log --graph` / VS Code's Source Control Graph do.
 *
 * Kept a pure, side-effect-free function (no React, no DOM) so the trickiest part
 * — lane bookkeeping across branches and merges — is unit-testable in isolation,
 * the same discipline as lib/unifiedDiff and core's parseLog.
 *
 * Model: walk commits newest-first (the order `git.log` returns). A `lanes` array
 * tracks, per column, the hash that column is currently "waiting for" (a commit's
 * descendant edge descending toward it), or null when free. Lanes are STABLE — a
 * branch keeps its column for its whole life, so its line is a straight vertical;
 * a freed lane is only reused by a later, unrelated branch tip. That trades a
 * slightly wider graph for far simpler, jitter-free rendering.
 */

export interface GraphRow {
  readonly commit: GitCommit;
  /** Column the commit's node sits in. */
  readonly lane: number;
  /** Top-edge lanes whose line descends INTO this node (its children's edges). */
  readonly incoming: readonly number[];
  /** Lanes that pass straight through this row (top→bottom), untouched by the node. */
  readonly passThrough: readonly number[];
  /** Bottom-edge lanes the node connects DOWN to (one per parent; merges fan out). */
  readonly outgoing: readonly number[];
  /** Hashes occupying each lane at the top edge (debug / width). */
  readonly lanesBefore: readonly (string | null)[];
  /** Hashes occupying each lane at the bottom edge. */
  readonly lanesAfter: readonly (string | null)[];
}

export interface GraphLayout {
  readonly rows: readonly GraphRow[];
  /** The widest lane count across all rows — how many columns the gutter needs. */
  readonly width: number;
}

export function layoutGraph(commits: readonly GitCommit[]): GraphLayout {
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];
  let width = 0;

  const firstFree = (): number => lanes.indexOf(null);

  for (const commit of commits) {
    // Lanes already waiting for this commit = its children's descending edges.
    const incoming: number[] = [];
    for (let k = 0; k < lanes.length; k++) {
      if (lanes[k] === commit.hash) incoming.push(k);
    }

    let lane: number;
    if (incoming.length > 0) {
      lane = incoming[0] as number; // collapse multiple children into the leftmost
    } else {
      // A tip (no child in the window): take a free column or append one.
      const free = firstFree();
      if (free !== -1) {
        lane = free;
      } else {
        lane = lanes.length;
        lanes.push(null);
      }
    }

    const lanesBefore = lanes.slice();

    // All incoming child edges terminate at this node — free their lanes; the
    // node's own lane is re-filled with the first parent below.
    for (const k of incoming) lanes[k] = null;

    const parents = commit.parents;
    if (parents.length === 0) {
      lanes[lane] = null; // root commit — the lane ends here.
    } else {
      const p0 = parents[0] as string;
      const existing = lanes.indexOf(p0);
      if (existing !== -1 && existing !== lane) {
        // First parent is already tracked in another lane → this lane converges
        // into it (a branch merging back); the node's edge will point there.
        lanes[lane] = null;
      } else {
        lanes[lane] = p0;
      }
      // Extra parents (a merge commit) each occupy their own lane — reusing one
      // already tracking that hash, else the first free column, else a new one.
      for (let pi = 1; pi < parents.length; pi++) {
        const p = parents[pi] as string;
        if (lanes.indexOf(p) !== -1) continue;
        const free = firstFree();
        if (free !== -1) lanes[free] = p;
        else lanes.push(p);
      }
    }

    // Trim trailing free columns so the graph doesn't grow monotonically wide.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    const lanesAfter = lanes.slice();

    // Outgoing: the bottom lane each parent now lives in (deduped) — the node's
    // downward edges. A merge fans to several; a convergence points at an
    // already-occupied lane (which is also a pass-through — both lines render).
    const outgoing: number[] = [];
    for (const p of parents) {
      const k = lanesAfter.indexOf(p);
      if (k !== -1 && !outgoing.includes(k)) outgoing.push(k);
    }

    // Pass-through: a lane carrying the same hash top→bottom that isn't this node.
    const passThrough: number[] = [];
    const span = Math.max(lanesBefore.length, lanesAfter.length);
    for (let k = 0; k < span; k++) {
      const before = lanesBefore[k] ?? null;
      if (before !== null && before !== commit.hash && lanesAfter[k] === before) {
        passThrough.push(k);
      }
    }

    width = Math.max(width, lanesBefore.length, lanesAfter.length);
    rows.push({ commit, lane, incoming, passThrough, outgoing, lanesBefore, lanesAfter });
  }

  return { rows, width: Math.max(width, 1) };
}

/** Stable color index for a lane (the renderer maps this onto its palette). */
export function laneColor(lane: number, paletteSize: number): number {
  return ((lane % paletteSize) + paletteSize) % paletteSize;
}
