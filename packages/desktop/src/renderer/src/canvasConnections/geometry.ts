import type { BadgeSide } from '@basehalf/core';
import { Position } from '@xyflow/react';

export type CanvasConnectionSide = BadgeSide;
export type CanvasConnectionAffordance = CanvasConnectionSide;

export const CANVAS_CONNECTION_SIDES: readonly CanvasConnectionSide[] = [
  'top',
  'right',
  'bottom',
  'left',
];

export const CANVAS_CONNECTION_SIDE_POSITION: Record<CanvasConnectionSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

export const CANVAS_CONNECTION_POINT_SIZE = 15;
export const CANVAS_CONNECTION_TARGET_HIT_DEPTH = 48;

const CANVAS_CONNECTION_EDGE_THRESHOLD = 22;
const CANVAS_CONNECTION_CORNER_GUARD = 18;

export function sameConnectionAffordance(
  a: CanvasConnectionAffordance | null,
  b: CanvasConnectionAffordance | null,
): boolean {
  return a === b;
}

export function sourceAffordanceForPointer({
  target,
  card,
  clientX,
  clientY,
}: {
  target: EventTarget | null;
  card: HTMLElement;
  clientX: number;
  clientY: number;
}): CanvasConnectionAffordance | null {
  const targetElement = target instanceof HTMLElement ? target : null;
  if (targetElement?.closest('button, input, textarea')) {
    return null;
  }

  const rect = card.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (
    (x < CANVAS_CONNECTION_CORNER_GUARD || x > rect.width - CANVAS_CONNECTION_CORNER_GUARD) &&
    (y < CANVAS_CONNECTION_CORNER_GUARD || y > rect.height - CANVAS_CONNECTION_CORNER_GUARD)
  ) {
    return null;
  }

  const distances: Array<{ side: CanvasConnectionSide; distance: number }> = [
    { side: 'top', distance: y },
    { side: 'right', distance: rect.width - x },
    { side: 'bottom', distance: rect.height - y },
    { side: 'left', distance: x },
  ];
  const nearest = distances.reduce((best, next) => (next.distance < best.distance ? next : best));
  if (nearest.distance > CANVAS_CONNECTION_EDGE_THRESHOLD) return null;

  return nearest.side;
}

export function targetAffordanceForPoint(
  rect: DOMRect,
  clientX: number,
  clientY: number,
): CanvasConnectionAffordance | null {
  const margin = CANVAS_CONNECTION_TARGET_HIT_DEPTH / 2;
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (x < -margin || x > rect.width + margin || y < -margin || y > rect.height + margin) {
    return null;
  }

  if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) {
    const distances: Array<{ side: CanvasConnectionSide; distance: number }> = [
      { side: 'top', distance: y },
      { side: 'right', distance: rect.width - x },
      { side: 'bottom', distance: rect.height - y },
      { side: 'left', distance: x },
    ];
    return distances.reduce((best, next) => (next.distance < best.distance ? next : best)).side;
  }

  if (y <= CANVAS_CONNECTION_TARGET_HIT_DEPTH) return 'top';
  if (y >= rect.height - CANVAS_CONNECTION_TARGET_HIT_DEPTH) return 'bottom';
  if (x <= CANVAS_CONNECTION_TARGET_HIT_DEPTH) return 'left';
  if (x >= rect.width - CANVAS_CONNECTION_TARGET_HIT_DEPTH) return 'right';
  return null;
}

export function connectionPointForRectSide(
  rect: DOMRect,
  side: CanvasConnectionSide,
): { x: number; y: number } {
  return connectionPointForBoxSide(
    { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    side,
  );
}

export function connectionPointForBoxSide(
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  side: CanvasConnectionSide,
): { x: number; y: number } {
  if (side === 'top') return { x: box.x + box.width / 2, y: box.y };
  if (side === 'right') return { x: box.x + box.width, y: box.y + box.height / 2 };
  if (side === 'bottom') return { x: box.x + box.width / 2, y: box.y + box.height };
  return { x: box.x, y: box.y + box.height / 2 };
}

export function distanceToRect(rect: DOMRect, clientX: number, clientY: number): number {
  const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
  const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
  return Math.hypot(dx, dy);
}
