import type { BadgeFile } from '@basehalf/core';
import type { Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import {
  applyReferenceEdgeUpdate,
  badgesToConnectionEdges,
  inferConnectionSides,
  removeReferenceEdgeUpdate,
  sideFromHandle,
} from '../src/renderer/src/canvasConnections/edges.js';
import {
  connectionPointForBoxSide,
  connectionPointForRectSide,
  distanceToRect,
  targetAffordanceForPoint,
} from '../src/renderer/src/canvasConnections/geometry.js';

const edgeOptions = { defaultWidth: 300, defaultHeight: 220 };

const rect = (width: number, height: number): DOMRect =>
  ({
    left: 100,
    top: 200,
    right: 100 + width,
    bottom: 200 + height,
    width,
    height,
    x: 100,
    y: 200,
    toJSON: () => ({}),
  }) as DOMRect;

const badge = (file: string, references: BadgeFile['references'] = []): BadgeFile => ({
  bhVersion: 1,
  file,
  kind: 'file',
  references,
  createdAt: '2026-01-01T00:00:00.000Z',
  modifiedAt: '2026-01-01T00:00:00.000Z',
});

describe('canvas connections', () => {
  it('prioritizes the top target side over the left side near the top-left edge', () => {
    expect(targetAffordanceForPoint(rect(300, 220), 136, 218)).toBe('top');
  });

  it('keeps left and right target zones for the middle band', () => {
    expect(targetAffordanceForPoint(rect(300, 220), 124, 310)).toBe('left');
    expect(targetAffordanceForPoint(rect(300, 220), 386, 310)).toBe('right');
  });

  it('snaps to the nearest side anywhere inside a target card', () => {
    const box = rect(300, 220);
    expect(targetAffordanceForPoint(box, 250, 235)).toBe('top');
    expect(targetAffordanceForPoint(box, 370, 310)).toBe('right');
    expect(targetAffordanceForPoint(box, 250, 395)).toBe('bottom');
    expect(targetAffordanceForPoint(box, 130, 310)).toBe('left');
  });

  it('places snapped connection endpoints on card side midpoints', () => {
    const box = rect(300, 220);
    expect(connectionPointForRectSide(box, 'top')).toEqual({ x: 250, y: 200 });
    expect(connectionPointForRectSide(box, 'right')).toEqual({ x: 400, y: 310 });
    expect(connectionPointForRectSide(box, 'bottom')).toEqual({ x: 250, y: 420 });
    expect(connectionPointForRectSide(box, 'left')).toEqual({ x: 100, y: 310 });
    expect(connectionPointForBoxSide({ x: 10, y: 20, width: 300, height: 220 }, 'bottom')).toEqual({
      x: 160,
      y: 240,
    });
  });

  it('measures pointer distance to a card without pulling inside points away from zero', () => {
    const box = rect(300, 220);
    expect(distanceToRect(box, 250, 310)).toBe(0);
    expect(distanceToRect(box, 90, 190)).toBeCloseTo(Math.hypot(10, 10));
  });

  it('guards handle ids before persisting side metadata', () => {
    expect(sideFromHandle('top')).toBe('top');
    expect(sideFromHandle('center')).toBeUndefined();
  });

  it('infers sides from card centers when reference metadata is missing', () => {
    const source = { id: 'a.md', position: { x: 0, y: 0 }, style: { width: 300, height: 220 } };
    const target = { id: 'b.md', position: { x: 80, y: 340 }, style: { width: 300, height: 220 } };
    expect(inferConnectionSides(source as Node, target as Node, edgeOptions)).toEqual({
      fromSide: 'bottom',
      toSide: 'top',
    });
  });

  it('builds React Flow edges with explicit stored sides when available', () => {
    const edges = badgesToConnectionEdges(
      [
        badge('a.md', [{ to: 'b.md', fromSide: 'right', toSide: 'top', note: 'read first' }]),
        badge('b.md'),
      ],
      [
        { id: 'a.md', position: { x: 0, y: 0 }, style: { width: 300, height: 220 } },
        { id: 'b.md', position: { x: 420, y: 0 }, style: { width: 300, height: 220 } },
      ] as Node[],
      edgeOptions,
    );
    expect(edges).toContainEqual(
      expect.objectContaining({
        id: 'a.md__b.md',
        source: 'a.md',
        target: 'b.md',
        sourceHandle: 'right',
        targetHandle: 'top',
        label: 'read first',
      }),
    );
  });

  it('updates a controlled edge in-place before persistence catches up', () => {
    const edges = applyReferenceEdgeUpdate(
      [
        {
          id: 'a.md__b.md',
          type: 'reference',
          source: 'a.md',
          target: 'b.md',
          sourceHandle: 'right',
          targetHandle: 'left',
          label: 'keep',
        },
      ],
      {
        previousId: 'a.md__b.md',
        previousSource: 'a.md',
        previousTarget: 'b.md',
        source: 'a.md',
        target: 'c.md',
        sourceHandle: 'right',
        targetHandle: 'top',
        note: 'keep',
      },
    );

    expect(edges).toEqual([
      expect.objectContaining({
        id: 'a.md__c.md',
        source: 'a.md',
        target: 'c.md',
        sourceHandle: 'right',
        targetHandle: 'top',
        label: 'keep',
      }),
    ]);
  });

  it('coalesces an edge update into an existing directed pair', () => {
    const edges = applyReferenceEdgeUpdate(
      [
        { id: 'a.md__b.md', source: 'a.md', target: 'b.md' },
        { id: 'a.md__c.md', source: 'a.md', target: 'c.md', label: 'old' },
      ],
      {
        previousId: 'a.md__b.md',
        previousSource: 'a.md',
        previousTarget: 'b.md',
        source: 'a.md',
        target: 'c.md',
        sourceHandle: 'bottom',
        targetHandle: 'top',
        note: 'new',
      },
    );

    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual(
      expect.objectContaining({
        id: 'a.md__c.md',
        sourceHandle: 'bottom',
        targetHandle: 'top',
        label: 'new',
      }),
    );
  });

  it('removes a controlled edge immediately on blank release', () => {
    expect(
      removeReferenceEdgeUpdate(
        [
          { id: 'a.md__b.md', source: 'a.md', target: 'b.md' },
          { id: 'a.md__c.md', source: 'a.md', target: 'c.md' },
        ],
        'a.md__b.md',
      ).map((edge) => edge.id),
    ).toEqual(['a.md__c.md']);
  });
});
