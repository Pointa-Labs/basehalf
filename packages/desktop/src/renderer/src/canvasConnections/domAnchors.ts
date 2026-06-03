import {
  type CanvasConnectionSide,
  connectionPointForRectSide,
  distanceToRect,
  targetAffordanceForPoint,
} from './geometry.js';

export type SnappedCanvasNodeSide = {
  readonly nodeId: string;
  readonly side: CanvasConnectionSide;
  readonly clientPoint: { readonly x: number; readonly y: number };
  readonly distance: number;
};

export function flowRootForNodeId(nodeId: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  for (const node of document.querySelectorAll<HTMLElement>('.react-flow__node')) {
    if (node.dataset.id === nodeId) return node.closest<HTMLElement>('.react-flow');
  }
  return document.querySelector<HTMLElement>('.react-flow');
}

export function snappedNodeSideForClientPoint({
  clientX,
  clientY,
  excludedNodeIds = [],
  flowRoot,
}: {
  readonly clientX: number;
  readonly clientY: number;
  readonly excludedNodeIds?: readonly string[];
  readonly flowRoot: HTMLElement;
}): SnappedCanvasNodeSide | null {
  const excluded = new Set(excludedNodeIds);
  let best: SnappedCanvasNodeSide | null = null;

  for (const node of flowRoot.querySelectorAll<HTMLElement>('.react-flow__node-badge')) {
    const nodeId = node.dataset.id;
    if (!nodeId || excluded.has(nodeId)) continue;

    const rect = node.getBoundingClientRect();
    const side = targetAffordanceForPoint(rect, clientX, clientY);
    if (!side) continue;

    const point = connectionPointForRectSide(rect, side);
    const distance = distanceToRect(rect, clientX, clientY);
    const target = { nodeId, side, clientPoint: point, distance };
    if (!best || target.distance < best.distance) best = target;
  }

  return best;
}
