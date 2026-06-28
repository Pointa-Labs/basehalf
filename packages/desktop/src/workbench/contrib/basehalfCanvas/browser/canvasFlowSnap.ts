import type { Node, NodeChange } from '@xyflow/react';
import {
  type CanvasSnapGuide,
  type CanvasSnapRect,
  boundsForRects,
  snapResizeRect,
  snapTranslateRect,
} from './canvasSnap.js';

export const SNAP_GUIDE_SCREEN_THRESHOLD = 5;

type PositionChange<TNode extends Node> = Extract<NodeChange<TNode>, { type: 'position' }>;
type DimensionChange<TNode extends Node> = Extract<NodeChange<TNode>, { type: 'dimensions' }>;

export type CanvasFlowSnapOptions = {
  readonly threshold: number;
  /** Skip snapping entirely (return the raw changes, no guides). Defaults to
   *  false — snapping is on unless a caller opts out. */
  readonly disabled?: boolean;
  readonly defaultWidth: number;
  readonly defaultHeight: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
};

export function sameSnapGuides(
  a: readonly CanvasSnapGuide[],
  b: readonly CanvasSnapGuide[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((guide, i) => {
    const other = b[i];
    if (!other || guide.orientation !== other.orientation) return false;
    if (guide.orientation === 'vertical' && other.orientation === 'vertical') {
      return (
        Math.abs(guide.x - other.x) < 0.1 &&
        Math.abs(guide.y1 - other.y1) < 0.1 &&
        Math.abs(guide.y2 - other.y2) < 0.1
      );
    }
    if (guide.orientation === 'horizontal' && other.orientation === 'horizontal') {
      return (
        Math.abs(guide.y - other.y) < 0.1 &&
        Math.abs(guide.x1 - other.x1) < 0.1 &&
        Math.abs(guide.x2 - other.x2) < 0.1
      );
    }
    return false;
  });
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

function nodeRect<TNode extends Node>(node: TNode, options: CanvasFlowSnapOptions): CanvasSnapRect {
  return {
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    width: nodeWidth(node) ?? options.defaultWidth,
    height: nodeHeight(node) ?? options.defaultHeight,
  };
}

function nodeRectFromDraft<TNode extends Node>(
  node: TNode,
  options: CanvasFlowSnapOptions,
  position?: { x: number; y: number },
  dimensions?: { width: number; height: number },
): CanvasSnapRect {
  return {
    id: node.id,
    x: position?.x ?? node.position.x,
    y: position?.y ?? node.position.y,
    width: dimensions?.width ?? nodeWidth(node) ?? options.defaultWidth,
    height: dimensions?.height ?? nodeHeight(node) ?? options.defaultHeight,
  };
}

function nudgePositionChange<TNode extends Node>(
  change: PositionChange<TNode>,
  dx: number,
  dy: number,
): PositionChange<TNode> {
  if (!change.position) return change;
  return {
    ...change,
    position: { x: change.position.x + dx, y: change.position.y + dy },
    ...(change.positionAbsolute && {
      positionAbsolute: {
        x: change.positionAbsolute.x + dx,
        y: change.positionAbsolute.y + dy,
      },
    }),
  };
}

function dragGuidesForMovedAxes(
  guides: readonly CanvasSnapGuide[],
  before: CanvasSnapRect | null,
  draft: CanvasSnapRect,
  snapped: CanvasSnapRect,
): readonly CanvasSnapGuide[] {
  const movedX = before ? Math.abs(draft.x - before.x) > 0.5 : true;
  const movedY = before ? Math.abs(draft.y - before.y) > 0.5 : true;
  const snappedX = Math.abs(snapped.x - draft.x) > 0.5;
  const snappedY = Math.abs(snapped.y - draft.y) > 0.5;
  return guides.filter((guide) =>
    guide.orientation === 'vertical' ? movedX || snappedX : movedY || snappedY,
  );
}

export function snapFlowNodeChanges<TNode extends Node>(
  prev: readonly TNode[],
  changes: readonly NodeChange<TNode>[],
  options: CanvasFlowSnapOptions,
): { changes: NodeChange<TNode>[]; guides: readonly CanvasSnapGuide[] } {
  const nextChanges = changes.map((change) => ({ ...change })) as NodeChange<TNode>[];
  if (options.disabled) return { changes: nextChanges, guides: [] };

  const nodeById = new Map(prev.map((node) => [node.id, node]));
  let guides: readonly CanvasSnapGuide[] = [];

  const dragChanges = nextChanges.filter(
    (change): change is PositionChange<TNode> =>
      change.type === 'position' && change.position !== undefined && change.dragging !== undefined,
  );
  if (dragChanges.length > 0) {
    const activeIds = new Set(dragChanges.map((change) => change.id));
    const activeRects = dragChanges
      .map((change) => {
        const node = nodeById.get(change.id);
        return node ? nodeRectFromDraft(node, options, change.position) : null;
      })
      .filter((rect): rect is CanvasSnapRect => rect !== null);
    const beforeRects = dragChanges
      .map((change) => {
        const node = nodeById.get(change.id);
        return node ? nodeRect(node, options) : null;
      })
      .filter((rect): rect is CanvasSnapRect => rect !== null);
    const selectionRect = boundsForRects(activeRects);
    const beforeSelectionRect = boundsForRects(beforeRects);
    const targets = prev
      .filter((node) => !activeIds.has(node.id))
      .map((node) => nodeRect(node, options));
    if (selectionRect && targets.length > 0) {
      const snapped = snapTranslateRect(selectionRect, targets, options.threshold);
      const dx = snapped.rect.x - selectionRect.x;
      const dy = snapped.rect.y - selectionRect.y;
      if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
        for (let i = 0; i < nextChanges.length; i += 1) {
          const change = nextChanges[i];
          if (!change) continue;
          if (change.type === 'position' && activeIds.has(change.id)) {
            nextChanges[i] = nudgePositionChange(change, dx, dy);
          }
        }
      }
      if (dragChanges.some((change) => change.dragging === true)) {
        guides = dragGuidesForMovedAxes(
          snapped.guides,
          beforeSelectionRect,
          selectionRect,
          snapped.rect,
        );
      }
    }
  }

  const dimensionChanges = nextChanges.filter(
    (change): change is DimensionChange<TNode> =>
      change.type === 'dimensions' &&
      change.dimensions !== undefined &&
      change.resizing !== undefined,
  );
  for (const dimensionChange of dimensionChanges) {
    const node = nodeById.get(dimensionChange.id);
    if (!node || !dimensionChange.dimensions) continue;
    const positionChange = nextChanges.find(
      (change): change is PositionChange<TNode> =>
        change.type === 'position' &&
        change.id === dimensionChange.id &&
        change.position !== undefined,
    );
    const before = nodeRect(node, options);
    const draft = nodeRectFromDraft(
      node,
      options,
      positionChange?.position,
      dimensionChange.dimensions,
    );
    const targets = prev
      .filter((candidate) => candidate.id !== dimensionChange.id)
      .map((candidate) => nodeRect(candidate, options));
    if (targets.length === 0) continue;
    const snapped = snapResizeRect(before, draft, targets, options.threshold, {
      minWidth: options.minWidth,
      minHeight: options.minHeight,
      maxWidth: options.maxWidth,
      maxHeight: options.maxHeight,
    });
    dimensionChange.dimensions = {
      width: snapped.rect.width,
      height: snapped.rect.height,
    };
    if (positionChange) {
      const dx = snapped.rect.x - draft.x;
      const dy = snapped.rect.y - draft.y;
      if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
        const index = nextChanges.indexOf(positionChange);
        nextChanges[index] = nudgePositionChange(positionChange, dx, dy);
      }
    } else if (snapped.rect.x !== draft.x || snapped.rect.y !== draft.y) {
      nextChanges.push({
        id: dimensionChange.id,
        type: 'position',
        position: { x: snapped.rect.x, y: snapped.rect.y },
        dragging: false,
      } as NodeChange<TNode>);
    }
    if (dimensionChange.resizing === true) {
      guides = snapped.guides;
    }
  }

  return { changes: nextChanges, guides };
}
