import { describe, expect, it } from 'vitest';
import {
  type CanvasSnapRect,
  boundsForRects,
  snapResizeRect,
  snapTranslateRect,
} from '../src/workbench/contrib/basehalfCanvas/browser/canvasSnap.js';

const limits = { minWidth: 40, minHeight: 40, maxWidth: 400, maxHeight: 400 };
const openEndedLimits = { minWidth: 40, minHeight: 40 };

describe('canvas snapping', () => {
  it('snaps dragged bounds to nearby card edges and emits guide lines', () => {
    const moving: CanvasSnapRect = { id: 'a.md', x: 117, y: 22, width: 80, height: 60 };
    const target: CanvasSnapRect = { id: 'b.md', x: 200, y: 20, width: 90, height: 60 };
    const result = snapTranslateRect(moving, [target], 8);
    expect(result.rect.x).toBe(120);
    expect(result.rect.y).toBe(20);
    expect(result.guides).toContainEqual({
      orientation: 'vertical',
      x: 200,
      y1: 20,
      y2: 80,
    });
    expect(result.guides).toContainEqual({
      orientation: 'horizontal',
      y: 20,
      x1: 120,
      x2: 290,
    });
  });

  it('snaps a multi-card selection as one stable group', () => {
    const bounds = boundsForRects([
      { id: 'a.md', x: 96, y: 100, width: 50, height: 40 },
      { id: 'b.md', x: 166, y: 100, width: 50, height: 40 },
    ]);
    if (!bounds) throw new Error('expected selection bounds');
    const target: CanvasSnapRect = { id: 'c.md', x: 220, y: 100, width: 70, height: 50 };
    const result = snapTranslateRect(bounds, [target], 8);
    expect(result.rect.x).toBe(100);
    expect(result.rect.width).toBe(120);
  });

  it('emits only one guide per axis for the chosen snap', () => {
    const moving: CanvasSnapRect = { id: 'a.md', x: 100, y: 97, width: 100, height: 80 };
    const target: CanvasSnapRect = { id: 'b.md', x: 250, y: 100, width: 100, height: 80 };
    const result = snapTranslateRect(moving, [target], 8);
    expect(result.rect.y).toBe(100);
    expect(result.guides.filter((guide) => guide.orientation === 'horizontal')).toHaveLength(1);
  });

  it('snaps a resizing right edge without moving the left edge', () => {
    const before: CanvasSnapRect = { id: 'a.md', x: 40, y: 40, width: 100, height: 80 };
    const draft: CanvasSnapRect = { id: 'a.md', x: 40, y: 40, width: 156, height: 80 };
    const target: CanvasSnapRect = { id: 'b.md', x: 200, y: 36, width: 100, height: 80 };
    const result = snapResizeRect(before, draft, [target], 8, limits);
    expect(result.rect).toMatchObject({ x: 40, width: 160 });
    expect(result.guides).toContainEqual({
      orientation: 'vertical',
      x: 200,
      y1: 36,
      y2: 120,
    });
  });

  it('snaps a resizing left edge while preserving the opposite edge', () => {
    const before: CanvasSnapRect = { id: 'a.md', x: 100, y: 40, width: 100, height: 80 };
    const draft: CanvasSnapRect = { id: 'a.md', x: 43, y: 40, width: 157, height: 80 };
    const target: CanvasSnapRect = { id: 'b.md', x: 40, y: 36, width: 80, height: 80 };
    const result = snapResizeRect(before, draft, [target], 8, limits);
    expect(result.rect).toMatchObject({ x: 40, width: 160 });
    expect(result.rect.x + result.rect.width).toBe(200);
  });

  it('does not impose an arbitrary maximum card size during resize snapping', () => {
    const before: CanvasSnapRect = { id: 'a.md', x: 40, y: 40, width: 500, height: 360 };
    const draft: CanvasSnapRect = { id: 'a.md', x: 40, y: 40, width: 755, height: 360 };
    const target: CanvasSnapRect = { id: 'b.md', x: 800, y: 40, width: 100, height: 80 };
    const result = snapResizeRect(before, draft, [target], 8, openEndedLimits);
    expect(result.rect).toMatchObject({ x: 40, width: 760 });
    expect(result.guides).toContainEqual({
      orientation: 'vertical',
      x: 800,
      y1: 40,
      y2: 400,
    });
  });
});
