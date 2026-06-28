import type { Edge, Node } from '@xyflow/react';
import type { CanvasEdge } from '../../../../services/mirror/common/canvas.js';
import { ANCHOR_TO_SIDE, CANVAS_CONNECTION_SIDES, type CanvasSide } from './geometry.js';

const CANVAS_SIDE_SET = new Set<CanvasSide>(CANVAS_CONNECTION_SIDES);

type EdgeSizeOptions = {
  readonly defaultWidth: number;
  readonly defaultHeight: number;
};

export type ReferenceEdgeUpdate = {
  readonly previousId: string;
  readonly previousSource: string;
  readonly previousTarget: string;
  readonly source: string;
  readonly target: string;
  readonly sourceHandle: CanvasSide | undefined;
  readonly targetHandle: CanvasSide | undefined;
  /** The edge's connection label (was the per-reference `note`). */
  readonly label: string | undefined;
};

export type ReferenceEdgeRemoval = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
};

export function referenceEdgeId(source: string, target: string): string {
  return `${source}__${target}`;
}

export function sideFromHandle(handle: string | null | undefined): CanvasSide | undefined {
  return CANVAS_SIDE_SET.has(handle as CanvasSide) ? (handle as CanvasSide) : undefined;
}

function nodeWidth(node: Node | undefined): number | undefined {
  if (typeof node?.width === 'number') return node.width;
  const width = node?.style?.width;
  return typeof width === 'number' ? width : undefined;
}

function nodeHeight(node: Node | undefined): number | undefined {
  if (typeof node?.height === 'number') return node.height;
  const height = node?.style?.height;
  return typeof height === 'number' ? height : undefined;
}

function centerOfNode(node: Node, options: EdgeSizeOptions): { x: number; y: number } {
  const width = nodeWidth(node) ?? options.defaultWidth;
  const height = nodeHeight(node) ?? options.defaultHeight;
  return { x: node.position.x + width / 2, y: node.position.y + height / 2 };
}

export function inferConnectionSides(
  source: Node | undefined,
  target: Node | undefined,
  options: EdgeSizeOptions,
): { fromSide: CanvasSide; toSide: CanvasSide } {
  if (!source || !target) return { fromSide: 'right', toSide: 'left' };
  const from = centerOfNode(source, options);
  const to = centerOfNode(target, options);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { fromSide: 'right', toSide: 'left' } : { fromSide: 'left', toSide: 'right' };
  }
  return dy >= 0 ? { fromSide: 'bottom', toSide: 'top' } : { fromSide: 'top', toSide: 'bottom' };
}

// Build React-Flow edges from the canvas.yaml CanvasEdge[] (the new spatial
// layer). Each edge already carries its compass anchors + label, so we just
// translate anchors->sides; `inferConnectionSides` survives ONLY as a fallback
// for an edge somehow missing an anchor (the new edges always carry both). Edges
// whose endpoints aren't both on the current canvas are dropped (the source list
// is one folder level).
export function canvasEdgesToConnectionEdges(
  canvasEdges: readonly CanvasEdge[],
  nodes: readonly Node[],
  options: EdgeSizeOptions,
): Edge[] {
  const out: Edge[] = [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of canvasEdges) {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) continue;
    const inferred = inferConnectionSides(nodeById.get(edge.from), nodeById.get(edge.to), options);
    const fromSide = edge.from_anchor ? ANCHOR_TO_SIDE[edge.from_anchor] : inferred.fromSide;
    const toSide = edge.to_anchor ? ANCHOR_TO_SIDE[edge.to_anchor] : inferred.toSide;
    out.push({
      id: referenceEdgeId(edge.from, edge.to),
      source: edge.from,
      target: edge.to,
      sourceHandle: fromSide,
      targetHandle: toSide,
      animated: false,
      ...(edge.label !== undefined && { label: edge.label }),
    });
  }
  return out;
}

export function applyReferenceEdgeUpdate(
  edges: readonly Edge[],
  update: ReferenceEdgeUpdate,
): Edge[] {
  if (update.source === update.target) return [...edges];
  const nextId = referenceEdgeId(update.source, update.target);
  const base = edges.find((edge) => edge.id === update.previousId || edge.id === nextId);
  const nextEdge: Edge = {
    ...(base ?? {}),
    id: nextId,
    type: base?.type ?? 'reference',
    source: update.source,
    target: update.target,
    sourceHandle: update.sourceHandle ?? null,
    targetHandle: update.targetHandle ?? null,
    animated: base?.animated ?? false,
    label: update.label,
  };

  let inserted = false;
  const next: Edge[] = [];
  for (const edge of edges) {
    if (edge.id !== update.previousId && edge.id !== nextId) {
      next.push(edge);
      continue;
    }
    if (!inserted) {
      next.push(nextEdge);
      inserted = true;
    }
  }
  if (!inserted) next.push(nextEdge);
  return next;
}

export function removeReferenceEdgeUpdate(edges: readonly Edge[], edgeId: string): Edge[] {
  return edges.filter((edge) => edge.id !== edgeId);
}
