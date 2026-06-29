import type { Edge, Node, Viewport } from '@xyflow/react';
import type { BadgeKind } from '../../../../services/mirror/common/badge.js';
import type { CanvasEdge } from '../../../../services/mirror/common/canvas.js';
import type {
  CanvasChildBadge,
  ViewportState,
} from '../../../../services/workspace/common/workspaceTypes.js';
import {
  type BadgeNodeData,
  CARD_MIN_HEIGHT,
  CARD_MIN_WIDTH,
  DEFAULT_FILE_CARD_HEIGHT,
  DEFAULT_FILE_CARD_WIDTH,
  DEFAULT_FOLDER_CARD_HEIGHT,
  DEFAULT_FOLDER_CARD_WIDTH,
} from '../badge-node/badgeNodeModel.js';
import { canvasEdgesToConnectionEdges } from '../canvasConnections/index.js';

export const DRAG_DEBOUNCE = 300;
export const RESIZE_DEBOUNCE = 300;
export const VIEWPORT_DEBOUNCE = 1000;

export const CONNECTION_EDGE_SIZE_DEFAULTS = {
  defaultWidth: DEFAULT_FILE_CARD_WIDTH,
  defaultHeight: DEFAULT_FILE_CARD_HEIGHT,
};

export function canvasPointForClient({
  clientX,
  clientY,
  rect,
  viewport,
  cardWidth = DEFAULT_FILE_CARD_WIDTH,
  cardHeight = DEFAULT_FILE_CARD_HEIGHT,
}: {
  clientX: number;
  clientY: number;
  rect?: Pick<DOMRectReadOnly, 'left' | 'top'> | null;
  viewport: Pick<Viewport, 'x' | 'y' | 'zoom'>;
  cardWidth?: number;
  cardHeight?: number;
}): { x: number; y: number } | undefined {
  if (!rect) return undefined;
  return {
    x: (clientX - rect.left - viewport.x) / viewport.zoom - cardWidth / 2,
    y: (clientY - rect.top - viewport.y) / viewport.zoom - cardHeight / 2,
  };
}

export function coverageForFolder(
  folder: string,
  supportedFiles: readonly string[],
  promptedFiles: ReadonlySet<string>,
): { annotated: number; total: number } | undefined {
  if (supportedFiles.length === 0) return undefined;
  const prefix = `${folder}/`;
  let annotated = 0;
  let total = 0;
  for (const file of supportedFiles) {
    if (!file.startsWith(prefix)) continue;
    total++;
    if (promptedFiles.has(file)) annotated++;
  }
  return { annotated, total };
}

export function nodeBadgeKind(nodes: readonly Node<BadgeNodeData>[], id: string): BadgeKind {
  return nodes.find((node) => node.id === id)?.data.kind ?? 'file';
}

// Build reference edges from the folder canvas's CanvasEdge[] (the spatial
// layer). They already belong to exactly one folder level (workspace.listCanvas),
// so no scope filter is needed — canvasEdgesToConnectionEdges drops any edge
// whose endpoints aren't both in the visible set.
export function connectionEdges(
  canvasEdges: readonly CanvasEdge[],
  nodes: readonly Node<BadgeNodeData>[],
): Edge[] {
  return canvasEdgesToConnectionEdges(canvasEdges, nodes, CONNECTION_EDGE_SIZE_DEFAULTS);
}

export function viewportForCanvasFrame(
  folderScope: string | null,
  workspaceViewport: ViewportState | null | undefined,
): ViewportState | null {
  return folderScope === null ? (workspaceViewport ?? null) : null;
}

export function shouldPersistWorkspaceViewport(folderScope: string | null): boolean {
  return folderScope === null;
}

export function badgeToNode(
  badge: CanvasChildBadge,
  fallbackIndex: number,
  total: number,
  override?: { x?: number; y?: number },
  coverage?: { annotated: number; total: number },
): Node<BadgeNodeData> {
  // Auto-layout grid for badges without a saved position. Content TILES are
  // taller than bare labels, so rows need vertical room. Column count ADAPTS to
  // the badge count: a fixed 6 columns stays a tidy few rows for a small folder
  // but grows into a 25-row ribbon for a 150-file one — too tall to frame in a
  // landscape window, so fit-to-view clamps to minZoom and strands rows
  // off-screen. Target a grid whose pixel aspect (~220x250 cells) matches the
  // landscape viewport (~1.54 = viewport-aspect x cell h/w) so the whole
  // workspace frames itself. Saved positions always win.
  const cols = Math.max(5, Math.ceil(Math.sqrt(1.34 * Math.max(1, total))));
  const x = override?.x ?? badge.card?.x ?? 60 + (fallbackIndex % cols) * 340;
  const y = override?.y ?? badge.card?.y ?? 60 + Math.floor(fallbackIndex / cols) * 280;
  const width =
    badge.card?.width ??
    (badge.kind === 'folder' ? DEFAULT_FOLDER_CARD_WIDTH : DEFAULT_FILE_CARD_WIDTH);
  const height =
    badge.card?.height ??
    (badge.kind === 'folder' ? DEFAULT_FOLDER_CARD_HEIGHT : DEFAULT_FILE_CARD_HEIGHT);
  const w = Math.max(width, CARD_MIN_WIDTH);
  const h = Math.max(height, CARD_MIN_HEIGHT);
  return {
    id: badge.path,
    type: 'badge',
    position: { x, y },
    // A card maps to a file/folder on disk and its badge note — pressing
    // Delete/Backspace while a card is selected must never delete the node.
    deletable: false,
    // initialWidth/Height give onlyRenderVisibleElements the node bounds for
    // viewport culling BEFORE the DOM is measured.
    initialWidth: w,
    initialHeight: h,
    style: { width: w, height: h },
    data: {
      label: badge.path,
      kind: badge.kind,
      ...(badge.orphan === true && { orphan: true }),
      ...(badge.description !== undefined && { prompt: badge.description }),
      ...(badge.preview !== undefined && { preview: badge.preview }),
      notedRefs: badge.references.length,
      ...(coverage !== undefined && { coverage }),
    },
  };
}

export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  ms: number,
): (...args: TArgs) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Per-key debounce: one independent timer PER key, not a single shared one.
// Position/size writes are debounced, but a plain debounce keeps only the LAST
// call's args — so moving card A then card B inside the window dropped A's write
// entirely and A snapped back to its stale on-disk position on the next reload.
export function keyedDebounce<TArgs extends unknown[]>(
  fn: (key: string, ...args: TArgs) => void,
  ms: number,
): (key: string, ...args: TArgs) => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return (key, ...args) => {
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        fn(key, ...args);
      }, ms),
    );
  };
}

export function cardWidth(node: Node<BadgeNodeData> | undefined): number | undefined {
  if (typeof node?.width === 'number') return node.width;
  const width = node?.style?.width;
  return typeof width === 'number' ? width : undefined;
}

export function cardHeight(node: Node<BadgeNodeData> | undefined): number | undefined {
  if (typeof node?.height === 'number') return node.height;
  const height = node?.style?.height;
  return typeof height === 'number' ? height : undefined;
}
