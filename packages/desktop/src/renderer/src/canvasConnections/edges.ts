import type { BadgeFile, BadgeSide } from '@basehalf/core';
import type { Edge, Node } from '@xyflow/react';
import { CANVAS_CONNECTION_SIDES } from './geometry.js';

const BADGE_SIDE_SET = new Set<BadgeSide>(CANVAS_CONNECTION_SIDES);

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
  readonly sourceHandle: BadgeSide | undefined;
  readonly targetHandle: BadgeSide | undefined;
  readonly note: string | undefined;
};

export type ReferenceEdgeRemoval = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
};

export function referenceEdgeId(source: string, target: string): string {
  return `${source}__${target}`;
}

export function sideFromHandle(handle: string | null | undefined): BadgeSide | undefined {
  return BADGE_SIDE_SET.has(handle as BadgeSide) ? (handle as BadgeSide) : undefined;
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
): { fromSide: BadgeSide; toSide: BadgeSide } {
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

export function badgesToConnectionEdges(
  badges: readonly BadgeFile[],
  nodes: readonly Node[],
  options: EdgeSizeOptions,
): Edge[] {
  const out: Edge[] = [];
  const known = new Set(badges.map((badge) => badge.file));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const badge of badges) {
    for (const ref of badge.references) {
      if (!known.has(ref.to)) continue;
      const inferred = inferConnectionSides(
        nodeById.get(badge.file),
        nodeById.get(ref.to),
        options,
      );
      const fromSide = ref.fromSide ?? inferred.fromSide;
      const toSide = ref.toSide ?? inferred.toSide;
      out.push({
        id: referenceEdgeId(badge.file, ref.to),
        source: badge.file,
        target: ref.to,
        sourceHandle: fromSide,
        targetHandle: toSide,
        animated: false,
        ...(ref.note !== undefined && { label: ref.note }),
      });
    }
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
    label: update.note,
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
