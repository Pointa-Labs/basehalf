import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasChildBadge } from '../src/platform/workspaces/common/workspaces.js';
import {
  CARD_MIN_HEIGHT,
  CARD_MIN_WIDTH,
  DEFAULT_FILE_CARD_HEIGHT,
  DEFAULT_FILE_CARD_WIDTH,
  DEFAULT_FOLDER_CARD_HEIGHT,
  DEFAULT_FOLDER_CARD_WIDTH,
} from '../src/workbench/contrib/basehalfCanvas/browser/badge-node/badgeNodeModel.js';
import {
  badgeToNode,
  canvasPointForClient,
  cardHeight,
  cardWidth,
  connectionEdges,
  coverageForFolder,
  debounce,
  keyedDebounce,
  nodeBadgeKind,
  shouldPersistWorkspaceViewport,
  viewportForCanvasFrame,
} from '../src/workbench/contrib/basehalfCanvas/browser/canvas/canvasModel.js';
import type { CanvasEdge } from '../src/workbench/services/mirror/common/canvas.js';

const badge = (
  patch: Partial<CanvasChildBadge> & Pick<CanvasChildBadge, 'path'>,
): CanvasChildBadge => ({
  kind: 'file',
  references: [],
  referenced_by: [],
  ...patch,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('canvasModel', () => {
  it('maps badges to non-deletable React Flow nodes with layout defaults', () => {
    const node = badgeToNode(
      badge({
        path: 'src/app.ts',
        description: 'App entry',
        references: ['README.md'],
      }),
      0,
      1,
    );

    expect(node).toMatchObject({
      id: 'src/app.ts',
      type: 'badge',
      deletable: false,
      position: { x: 60, y: 60 },
      initialWidth: DEFAULT_FILE_CARD_WIDTH,
      initialHeight: DEFAULT_FILE_CARD_HEIGHT,
      style: { width: DEFAULT_FILE_CARD_WIDTH, height: DEFAULT_FILE_CARD_HEIGHT },
      data: {
        label: 'src/app.ts',
        kind: 'file',
        prompt: 'App entry',
        notedRefs: 1,
      },
    });
  });

  it('honors saved positions while enforcing card minimum sizes', () => {
    const file = badgeToNode(
      badge({
        path: 'tiny.md',
        card: { x: 7, y: 9, width: 1, height: 2 },
      }),
      3,
      20,
      { x: 11 },
      { annotated: 1, total: 2 },
    );
    expect(file.position).toEqual({ x: 11, y: 9 });
    expect(file.style).toEqual({ width: CARD_MIN_WIDTH, height: CARD_MIN_HEIGHT });
    expect(file.data.coverage).toEqual({ annotated: 1, total: 2 });

    const folder = badgeToNode(badge({ path: 'docs', kind: 'folder' }), 0, 1);
    expect(folder.style).toEqual({
      width: DEFAULT_FOLDER_CARD_WIDTH,
      height: DEFAULT_FOLDER_CARD_HEIGHT,
    });
  });

  it('derives node kind and measured card dimensions', () => {
    const folder = badgeToNode(badge({ path: 'docs', kind: 'folder' }), 0, 1);
    expect(nodeBadgeKind([folder], 'docs')).toBe('folder');
    expect(nodeBadgeKind([folder], 'missing')).toBe('file');

    expect(cardWidth({ ...folder, width: 333 })).toBe(333);
    expect(cardWidth(folder)).toBe(DEFAULT_FOLDER_CARD_WIDTH);
    expect(cardHeight({ ...folder, height: 222 })).toBe(222);
    expect(cardHeight(folder)).toBe(DEFAULT_FOLDER_CARD_HEIGHT);
  });

  it('translates canvas edges and drops edges whose endpoints are absent', () => {
    const nodes = [
      badgeToNode(badge({ path: 'a.md' }), 0, 2),
      badgeToNode(badge({ path: 'b.md' }), 1, 2),
    ];
    const edges: CanvasEdge[] = [
      { from: 'a.md', from_anchor: 'east', to: 'b.md', to_anchor: 'west', label: 'uses' },
      { from: 'a.md', from_anchor: 'east', to: 'missing.md', to_anchor: 'west' },
    ];

    expect(connectionEdges(edges, nodes)).toEqual([
      expect.objectContaining({
        id: 'a.md__b.md',
        source: 'a.md',
        target: 'b.md',
        sourceHandle: 'right',
        targetHandle: 'left',
        label: 'uses',
      }),
    ]);
  });

  it('derives drop placement and folder annotation coverage as pure view-model data', () => {
    expect(
      canvasPointForClient({
        clientX: 210,
        clientY: 170,
        rect: { left: 10, top: 20 },
        viewport: { x: -100, y: 50, zoom: 2 },
      }),
    ).toEqual({ x: 0, y: -60 });
    expect(
      canvasPointForClient({
        clientX: 210,
        clientY: 170,
        rect: null,
        viewport: { x: -100, y: 50, zoom: 2 },
      }),
    ).toBeUndefined();

    expect(
      coverageForFolder(
        'docs',
        ['docs/a.md', 'docs/nested/b.md', 'docs2/nope.md', 'other.md'],
        new Set(['docs/a.md', 'docs/missing.md']),
      ),
    ).toEqual({ annotated: 1, total: 2 });
    expect(coverageForFolder('docs', [], new Set())).toBeUndefined();
  });

  it('restores and persists only the root workspace viewport', () => {
    const viewport = { offsetX: -10, offsetY: 20, scale: 0.8 };
    expect(viewportForCanvasFrame(null, viewport)).toBe(viewport);
    expect(viewportForCanvasFrame(null, undefined)).toBeNull();
    expect(viewportForCanvasFrame('docs', viewport)).toBeNull();

    expect(shouldPersistWorkspaceViewport(null)).toBe(true);
    expect(shouldPersistWorkspaceViewport('docs')).toBe(false);
  });

  it('debounces globally or independently per key', () => {
    vi.useFakeTimers();
    const globalCalls: string[] = [];
    const globalDebounced = debounce((value: string) => globalCalls.push(value), 20);
    globalDebounced('a');
    globalDebounced('b');
    vi.advanceTimersByTime(20);
    expect(globalCalls).toEqual(['b']);

    const keyedCalls: string[] = [];
    const keyed = keyedDebounce(
      (key: string, value: string) => keyedCalls.push(`${key}:${value}`),
      20,
    );
    keyed('a.md', 'first');
    keyed('b.md', 'other');
    keyed('a.md', 'second');
    vi.advanceTimersByTime(20);
    expect(keyedCalls.sort()).toEqual(['a.md:second', 'b.md:other']);
  });
});
