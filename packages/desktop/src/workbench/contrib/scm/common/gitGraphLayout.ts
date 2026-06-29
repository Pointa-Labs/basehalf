import type { GitCommit } from './git.js';
import {
  SCM_INCOMING_HISTORY_ITEM_ID,
  SCM_OUTGOING_HISTORY_ITEM_ID,
  type ScmHistoryItem,
  type ScmHistoryItemGraphNode,
  type ScmHistoryItemRef,
  type ScmHistoryItemViewModel,
} from './history.js';

/**
 * Git Graph lane layout — the pure algorithm behind the commit-graph gutter.
 * Assigns each commit (a row) a lane (column) and the line segments that enter,
 * pass through, and leave its row, so a renderer can draw the branching DAG the
 * way `git log --graph` / VS Code's Source Control Graph do.
 *
 * Kept a pure, side-effect-free function (no React, no DOM) so the trickiest part
 * — lane bookkeeping across branches and merges — is unit-testable in isolation,
 * the same discipline as lib/unifiedDiff and the git log parser.
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

export const SCM_HISTORY_ITEM_REF_COLOR = '#59a4f9';
export const SCM_HISTORY_ITEM_REMOTE_REF_COLOR = '#B180D7';
export const SCM_HISTORY_ITEM_BASE_REF_COLOR = '#EA5C00';

export const SCM_HISTORY_GRAPH_COLORS = [
  '#FFB000',
  '#DC267F',
  '#994F00',
  '#40B0A6',
  '#B66DFF',
] as const;

export interface ScmHistoryGraphOptions {
  readonly colorMap?: ReadonlyMap<string, string | undefined>;
  readonly currentHistoryItemRef?: ScmHistoryItemRef;
  readonly currentHistoryItemRemoteRef?: ScmHistoryItemRef;
  readonly currentHistoryItemBaseRef?: ScmHistoryItemRef;
  readonly addIncomingChanges?: boolean;
  readonly addOutgoingChanges?: boolean;
  readonly mergeBase?: string;
}

export function toScmHistoryItemViewModels(
  historyItems: readonly ScmHistoryItem[],
  options: ScmHistoryGraphOptions = {},
): readonly ScmHistoryItemViewModel[] {
  let colorIndex = -1;
  const viewModels: ScmHistoryItemViewModel[] = [];
  const colorMap = options.colorMap ?? new Map<string, string | undefined>();

  for (const historyItem of historyItems) {
    const kind = historyItem.id === options.currentHistoryItemRef?.revision ? 'HEAD' : 'node';
    const inputSwimlanes = (viewModels.at(-1)?.outputSwimlanes ?? []).map(cloneGraphNode);
    const outputSwimlanes: ScmHistoryItemGraphNode[] = [];

    let firstParentAdded = false;

    if (historyItem.parentIds.length > 0) {
      for (const node of inputSwimlanes) {
        if (node.id === historyItem.id) {
          if (!firstParentAdded) {
            outputSwimlanes.push({
              id: historyItem.parentIds[0] ?? '',
              color: labelColorForHistoryItem(historyItem, colorMap) ?? node.color,
            });
            firstParentAdded = true;
          }
          continue;
        }

        outputSwimlanes.push(cloneGraphNode(node));
      }
    }

    for (let index = firstParentAdded ? 1 : 0; index < historyItem.parentIds.length; index += 1) {
      let color = index === 0 ? labelColorForHistoryItem(historyItem, colorMap) : undefined;
      if (index > 0) {
        const parent = historyItems.find((item) => item.id === historyItem.parentIds[index]);
        color = parent === undefined ? undefined : labelColorForHistoryItem(parent, colorMap);
      }

      if (color === undefined) {
        colorIndex = laneColor(colorIndex + 1, SCM_HISTORY_GRAPH_COLORS.length);
        color = SCM_HISTORY_GRAPH_COLORS[colorIndex] ?? SCM_HISTORY_GRAPH_COLORS[0];
      }

      outputSwimlanes.push({ id: historyItem.parentIds[index] ?? '', color });
    }

    const references = (historyItem.references ?? [])
      .map((ref) => {
        let color = colorMap.get(ref.id);
        if (colorMap.has(ref.id) && color === undefined) {
          const lane = getScmHistoryItemLaneIndex({ historyItem, inputSwimlanes });
          color =
            outputSwimlanes[lane]?.color ??
            inputSwimlanes[lane]?.color ??
            SCM_HISTORY_ITEM_REF_COLOR;
        }

        return { ...ref, ...(color !== undefined && { color }) };
      })
      .sort((a, b) =>
        compareScmHistoryItemRefs(
          a,
          b,
          options.currentHistoryItemRef,
          options.currentHistoryItemRemoteRef,
          options.currentHistoryItemBaseRef,
        ),
      );

    viewModels.push({
      historyItem: { ...historyItem, references },
      inputSwimlanes,
      outputSwimlanes,
      kind,
    });
  }

  addIncomingOutgoingHistoryItems(viewModels, options);

  return viewModels;
}

export function getScmHistoryItemLaneIndex({
  historyItem,
  inputSwimlanes,
}: {
  readonly historyItem: ScmHistoryItem;
  readonly inputSwimlanes: readonly ScmHistoryItemGraphNode[];
}): number {
  const inputIndex = inputSwimlanes.findIndex((node) => node.id === historyItem.id);
  return inputIndex !== -1 ? inputIndex : inputSwimlanes.length;
}

export function compareScmHistoryItemRefs(
  a: ScmHistoryItemRef,
  b: ScmHistoryItemRef,
  currentHistoryItemRef?: ScmHistoryItemRef,
  currentHistoryItemRemoteRef?: ScmHistoryItemRef,
  currentHistoryItemBaseRef?: ScmHistoryItemRef,
): number {
  const order = (ref: ScmHistoryItemRef): number => {
    if (ref.id === currentHistoryItemRef?.id) return 1;
    if (ref.id === currentHistoryItemRemoteRef?.id) return 2;
    if (ref.id === currentHistoryItemBaseRef?.id) return 3;
    if (ref.color !== undefined) return 4;
    return 99;
  };

  const orderDelta = order(a) - order(b);
  return orderDelta === 0 ? a.name.localeCompare(b.name) : orderDelta;
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

function labelColorForHistoryItem(
  historyItem: ScmHistoryItem,
  colorMap: ReadonlyMap<string, string | undefined>,
): string | undefined {
  if (historyItem.id === SCM_INCOMING_HISTORY_ITEM_ID) return SCM_HISTORY_ITEM_REMOTE_REF_COLOR;
  if (historyItem.id === SCM_OUTGOING_HISTORY_ITEM_ID) return SCM_HISTORY_ITEM_REF_COLOR;

  for (const ref of historyItem.references ?? []) {
    const color = colorMap.get(ref.id);
    if (color !== undefined) return color;
  }

  return undefined;
}

function cloneGraphNode(node: ScmHistoryItemGraphNode): ScmHistoryItemGraphNode {
  return { id: node.id, color: node.color };
}

function addIncomingOutgoingHistoryItems(
  viewModels: ScmHistoryItemViewModel[],
  {
    currentHistoryItemRef,
    currentHistoryItemRemoteRef,
    addIncomingChanges,
    addOutgoingChanges,
    mergeBase,
  }: ScmHistoryGraphOptions,
): void {
  if (
    currentHistoryItemRef?.revision === undefined ||
    currentHistoryItemRef.revision === currentHistoryItemRemoteRef?.revision ||
    mergeBase === undefined
  ) {
    return;
  }

  if (
    addIncomingChanges === true &&
    currentHistoryItemRemoteRef?.revision !== undefined &&
    currentHistoryItemRemoteRef.revision !== mergeBase
  ) {
    addIncomingChangesHistoryItem(viewModels, currentHistoryItemRemoteRef, mergeBase);
  }

  if (addOutgoingChanges === true && currentHistoryItemRef.revision !== mergeBase) {
    addOutgoingChangesHistoryItem(viewModels, currentHistoryItemRef);
  }
}

function addIncomingChangesHistoryItem(
  viewModels: ScmHistoryItemViewModel[],
  currentHistoryItemRemoteRef: ScmHistoryItemRef,
  mergeBase: string,
): void {
  const beforeIndex = findLastIndex(viewModels, (viewModel) =>
    viewModel.outputSwimlanes.some((node) => node.id === mergeBase),
  );
  const afterIndex = viewModels.findIndex((viewModel) => viewModel.historyItem.id === mergeBase);
  if (beforeIndex === -1 || afterIndex === -1) return;

  const beforeViewModel = viewModels[beforeIndex];
  if (beforeViewModel === undefined) return;
  if (
    beforeViewModel.historyItem.parentIds.length === 2 &&
    beforeViewModel.historyItem.parentIds.includes(mergeBase)
  ) {
    return;
  }

  viewModels[beforeIndex] = {
    ...beforeViewModel,
    inputSwimlanes: beforeViewModel.inputSwimlanes.map((node) =>
      node.id === mergeBase && node.color === SCM_HISTORY_ITEM_REMOTE_REF_COLOR
        ? { ...node, id: SCM_INCOMING_HISTORY_ITEM_ID }
        : node,
    ),
    outputSwimlanes: beforeViewModel.outputSwimlanes.map((node) =>
      node.id === mergeBase && node.color === SCM_HISTORY_ITEM_REMOTE_REF_COLOR
        ? { ...node, id: SCM_INCOMING_HISTORY_ITEM_ID }
        : node,
    ),
  };

  const afterViewModel = viewModels[afterIndex];
  if (afterViewModel === undefined) return;

  viewModels.splice(afterIndex, 0, {
    historyItem: {
      id: SCM_INCOMING_HISTORY_ITEM_ID,
      displayId: '0'.repeat(viewModels[0]?.historyItem.displayId?.length ?? 0),
      parentIds: [mergeBase],
      author: currentHistoryItemRemoteRef.name,
      subject: 'Incoming Changes',
      message: '',
    },
    kind: 'incoming-changes',
    inputSwimlanes: viewModels[beforeIndex]?.outputSwimlanes.map(cloneGraphNode) ?? [],
    outputSwimlanes: afterViewModel.inputSwimlanes.map(cloneGraphNode),
  });
}

function addOutgoingChangesHistoryItem(
  viewModels: ScmHistoryItemViewModel[],
  currentHistoryItemRef: ScmHistoryItemRef,
): void {
  const currentIndex = viewModels.findIndex(
    (viewModel) =>
      viewModel.kind === 'HEAD' && viewModel.historyItem.id === currentHistoryItemRef.revision,
  );
  if (currentIndex === -1 || currentHistoryItemRef.revision === undefined) return;

  const currentViewModel = viewModels[currentIndex];
  if (currentViewModel === undefined) return;

  const inputSwimlanes = currentViewModel.inputSwimlanes.map(cloneGraphNode);
  const displayId = viewModels[0]?.historyItem.displayId;
  viewModels.splice(currentIndex, 0, {
    historyItem: {
      id: SCM_OUTGOING_HISTORY_ITEM_ID,
      ...(displayId !== undefined && { displayId: '0'.repeat(displayId.length) }),
      parentIds: [currentHistoryItemRef.revision],
      author: currentHistoryItemRef.name,
      subject: 'Outgoing Changes',
      message: '',
    },
    kind: 'outgoing-changes',
    inputSwimlanes,
    outputSwimlanes: [
      ...inputSwimlanes,
      { id: currentHistoryItemRef.revision, color: SCM_HISTORY_ITEM_REF_COLOR },
    ],
  });

  viewModels[currentIndex + 1] = {
    ...currentViewModel,
    inputSwimlanes: [
      ...currentViewModel.inputSwimlanes,
      { id: currentHistoryItemRef.revision, color: SCM_HISTORY_ITEM_REF_COLOR },
    ],
  };
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && predicate(item)) return index;
  }
  return -1;
}
