import { describe, expect, it } from 'vitest';
import { clampContextMenuPosition } from '../src/platform/contextview/browser/contextMenuPosition.js';

describe('context menu host', () => {
  it('clamps menus inside the visible viewport', () => {
    expect(clampContextMenuPosition(500, 400, 120, 80, 640, 480)).toEqual({
      left: 500,
      top: 394,
    });
  });

  it('keeps oversized menus anchored to the viewport margin', () => {
    expect(clampContextMenuPosition(50, 50, 400, 300, 240, 180)).toEqual({
      left: 6,
      top: 6,
    });
  });
});
