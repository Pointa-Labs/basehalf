export type CanvasSnapRect = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type CanvasSnapGuide =
  | {
      readonly orientation: 'vertical';
      readonly x: number;
      readonly y1: number;
      readonly y2: number;
    }
  | {
      readonly orientation: 'horizontal';
      readonly y: number;
      readonly x1: number;
      readonly x2: number;
    };

export type CanvasSnapResult = {
  readonly rect: CanvasSnapRect;
  readonly guides: readonly CanvasSnapGuide[];
};

type Axis = 'x' | 'y';
type SnapKind = 'start' | 'center' | 'end';

type SnapPoint = {
  readonly value: number;
  readonly kind: SnapKind;
  readonly rect: CanvasSnapRect;
};

type AxisSnap = {
  readonly nudge: number;
  readonly match: { readonly line: number; readonly target: CanvasSnapRect };
};

const EPSILON = 0.5;

function right(rect: CanvasSnapRect): number {
  return rect.x + rect.width;
}

function bottom(rect: CanvasSnapRect): number {
  return rect.y + rect.height;
}

function centerX(rect: CanvasSnapRect): number {
  return rect.x + rect.width / 2;
}

function centerY(rect: CanvasSnapRect): number {
  return rect.y + rect.height / 2;
}

function moved(rect: CanvasSnapRect, dx: number, dy: number): CanvasSnapRect {
  return { ...rect, x: rect.x + dx, y: rect.y + dy };
}

export function boundsForRects(rects: readonly CanvasSnapRect[]): CanvasSnapRect | null {
  if (rects.length === 0) return null;
  let x1 = Number.POSITIVE_INFINITY;
  let y1 = Number.POSITIVE_INFINITY;
  let x2 = Number.NEGATIVE_INFINITY;
  let y2 = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    x1 = Math.min(x1, rect.x);
    y1 = Math.min(y1, rect.y);
    x2 = Math.max(x2, right(rect));
    y2 = Math.max(y2, bottom(rect));
  }
  return { id: '__selection__', x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function axisPoints(rect: CanvasSnapRect, axis: Axis): readonly SnapPoint[] {
  return axis === 'x'
    ? [
        { value: rect.x, kind: 'start', rect },
        { value: centerX(rect), kind: 'center', rect },
        { value: right(rect), kind: 'end', rect },
      ]
    : [
        { value: rect.y, kind: 'start', rect },
        { value: centerY(rect), kind: 'center', rect },
        { value: bottom(rect), kind: 'end', rect },
      ];
}

function guideFor(
  axis: Axis,
  line: number,
  active: CanvasSnapRect,
  target: CanvasSnapRect,
): CanvasSnapGuide {
  if (axis === 'x') {
    return {
      orientation: 'vertical',
      x: line,
      y1: Math.min(active.y, target.y),
      y2: Math.max(bottom(active), bottom(target)),
    };
  }
  return {
    orientation: 'horizontal',
    y: line,
    x1: Math.min(active.x, target.x),
    x2: Math.max(right(active), right(target)),
  };
}

function snapAxis(
  axis: Axis,
  active: CanvasSnapRect,
  targets: readonly CanvasSnapRect[],
  threshold: number,
): AxisSnap | null {
  let best: {
    readonly diff: number;
    readonly nudge: number;
    readonly line: number;
    readonly target: CanvasSnapRect;
  } | null = null;

  const activePoints = axisPoints(active, axis);
  for (const target of targets) {
    for (const targetPoint of axisPoints(target, axis)) {
      for (const activePoint of activePoints) {
        const nudge = targetPoint.value - activePoint.value;
        const diff = Math.abs(nudge);
        if (diff > threshold) continue;
        if (!best || diff < best.diff) {
          best = { diff, nudge, line: targetPoint.value, target };
        }
      }
    }
  }

  if (!best) return null;

  return { nudge: best.nudge, match: { line: best.line, target: best.target } };
}

function mergeGuides(guides: readonly CanvasSnapGuide[]): readonly CanvasSnapGuide[] {
  const out: CanvasSnapGuide[] = [];
  for (const guide of guides) {
    const existing = out.find((candidate) => {
      if (guide.orientation === 'vertical') {
        return candidate.orientation === 'vertical' && Math.abs(candidate.x - guide.x) <= EPSILON;
      }
      return candidate.orientation === 'horizontal' && Math.abs(candidate.y - guide.y) <= EPSILON;
    });
    if (!existing) {
      out.push(guide);
      continue;
    }
    const idx = out.indexOf(existing);
    out[idx] =
      guide.orientation === 'vertical' && existing.orientation === 'vertical'
        ? {
            orientation: 'vertical',
            x: existing.x,
            y1: Math.min(existing.y1, guide.y1),
            y2: Math.max(existing.y2, guide.y2),
          }
        : guide.orientation === 'horizontal' && existing.orientation === 'horizontal'
          ? {
              orientation: 'horizontal',
              y: existing.y,
              x1: Math.min(existing.x1, guide.x1),
              x2: Math.max(existing.x2, guide.x2),
            }
          : existing;
  }
  return out;
}

export function snapTranslateRect(
  rect: CanvasSnapRect,
  targets: readonly CanvasSnapRect[],
  threshold: number,
): CanvasSnapResult {
  const xSnap = snapAxis('x', rect, targets, threshold);
  const ySnap = snapAxis('y', rect, targets, threshold);
  const snapped = moved(rect, xSnap?.nudge ?? 0, ySnap?.nudge ?? 0);
  const guides = mergeGuides([
    ...(xSnap ? [guideFor('x', xSnap.match.line, snapped, xSnap.match.target)] : []),
    ...(ySnap ? [guideFor('y', ySnap.match.line, snapped, ySnap.match.target)] : []),
  ]);
  return {
    rect: snapped,
    guides,
  };
}

type ResizeLimits = {
  readonly minWidth: number;
  readonly minHeight: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
};

function edgeMoved(a: number, b: number): boolean {
  return Math.abs(a - b) > EPSILON;
}

function resizedOnAxis(
  axis: Axis,
  rect: CanvasSnapRect,
  side: 'start' | 'end',
  value: number,
): CanvasSnapRect {
  if (axis === 'x') {
    const r = right(rect);
    if (side === 'start') return { ...rect, x: value, width: r - value };
    return { ...rect, width: value - rect.x };
  }
  const b = bottom(rect);
  if (side === 'start') return { ...rect, y: value, height: b - value };
  return { ...rect, height: value - rect.y };
}

function resizeWithinLimits(rect: CanvasSnapRect, limits: ResizeLimits): boolean {
  return (
    rect.width >= limits.minWidth &&
    (limits.maxWidth === undefined || rect.width <= limits.maxWidth) &&
    rect.height >= limits.minHeight &&
    (limits.maxHeight === undefined || rect.height <= limits.maxHeight)
  );
}

export function snapResizeRect(
  before: CanvasSnapRect,
  draft: CanvasSnapRect,
  targets: readonly CanvasSnapRect[],
  threshold: number,
  limits: ResizeLimits,
): CanvasSnapResult {
  let next = draft;
  const guides: CanvasSnapGuide[] = [];

  const xSnap = snapResizeAxisWithThreshold('x', before, next, targets, threshold, limits);
  if (xSnap) {
    next = resizedOnAxis('x', next, edgeMoved(before.x, draft.x) ? 'start' : 'end', xSnap.line);
    guides.push(...xSnap.guides);
  }

  const ySnap = snapResizeAxisWithThreshold('y', before, next, targets, threshold, limits);
  if (ySnap) {
    next = resizedOnAxis('y', next, edgeMoved(before.y, draft.y) ? 'start' : 'end', ySnap.line);
    guides.push(...ySnap.guides);
  }

  return { rect: next, guides: mergeGuides(guides) };
}

function snapResizeAxisWithThreshold(
  axis: Axis,
  before: CanvasSnapRect,
  draft: CanvasSnapRect,
  targets: readonly CanvasSnapRect[],
  threshold: number,
  limits: ResizeLimits,
): {
  readonly line: number;
  readonly guides: readonly CanvasSnapGuide[];
} | null {
  const beforeStart = axis === 'x' ? before.x : before.y;
  const beforeEnd = axis === 'x' ? right(before) : bottom(before);
  const draftStart = axis === 'x' ? draft.x : draft.y;
  const draftEnd = axis === 'x' ? right(draft) : bottom(draft);
  const startMoved = edgeMoved(beforeStart, draftStart);
  const endMoved = edgeMoved(beforeEnd, draftEnd);

  if (startMoved === endMoved) return null;

  let best: {
    readonly diff: number;
    readonly line: number;
    readonly target: CanvasSnapRect;
  } | null = null;
  const activeValue = startMoved ? draftStart : draftEnd;
  const side = startMoved ? 'start' : 'end';

  for (const target of targets) {
    for (const targetPoint of axisPoints(target, axis)) {
      const diff = Math.abs(targetPoint.value - activeValue);
      if (diff > threshold) continue;
      const candidate = resizedOnAxis(axis, draft, side, targetPoint.value);
      if (!resizeWithinLimits(candidate, limits)) continue;
      if (!best || diff < best.diff) {
        best = { diff, line: targetPoint.value, target };
      }
    }
  }

  if (!best) return null;
  const snapped = resizedOnAxis(axis, draft, side, best.line);
  return { line: best.line, guides: [guideFor(axis, best.line, snapped, best.target)] };
}
