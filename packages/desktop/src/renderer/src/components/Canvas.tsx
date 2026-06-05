import type {
  BadgeFile,
  BadgeKind,
  BadgeListResult,
  ViewportState,
  WorkspaceGetViewportResult,
} from '@basehalf/core';
import {
  Background,
  type Connection,
  ConnectionMode,
  type Edge,
  type EdgeTypes,
  MarkerType,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type NodeTypes,
  type OnNodeDrag,
  type OnSelectionChangeFunc,
  ReactFlow,
  type Viewport,
  applyNodeChanges,
  useNodesInitialized,
  useReactFlow,
  useViewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  CanvasConnectionLine,
  ReferenceEdge,
  type ReferenceEdgeRemoval,
  type ReferenceEdgeUpdate,
  applyReferenceEdgeUpdate,
  badgesToConnectionEdges,
  removeReferenceEdgeUpdate,
  sideFromHandle,
} from '../canvasConnections/index.js';
import { color, font, motion, radius, shadow, space, transition } from '../design.js';
import { createDemoAtDefault, promptForNewNote } from '../lib/actions.js';
import { subscribeBadgeChange } from '../lib/badgeBus.js';
import {
  SNAP_GUIDE_SCREEN_THRESHOLD,
  sameSnapGuides,
  snapFlowNodeChanges,
} from '../lib/canvasFlowSnap.js';
import type { CanvasSnapGuide } from '../lib/canvasSnap.js';
import { briefForClipboard } from '../lib/focusBrief.js';
import { regionFor } from '../lib/paneDrop.js';
import { type DropRegion, useWorkspaceStore } from '../store/workspace.js';
import {
  BadgeNode,
  type BadgeNodeData,
  CARD_MIN_HEIGHT,
  CARD_MIN_WIDTH,
  DEFAULT_FILE_CARD_HEIGHT,
  DEFAULT_FILE_CARD_WIDTH,
  DEFAULT_FOLDER_CARD_HEIGHT,
  DEFAULT_FOLDER_CARD_WIDTH,
} from './BadgeNode.js';
import { BriefPreview } from './BriefPreview.js';
import { CanvasControls } from './CanvasControls.js';
import { CanvasSnapGuides } from './CanvasSnapGuides.js';
import { prompt } from './Dialog.js';
import { Onboarding } from './Onboarding.js';
import { Button } from './primitives/Button.js';
import { usePopover } from './primitives/Popover.js';

const NODE_TYPES: NodeTypes = { badge: BadgeNode };
const EDGE_TYPES: EdgeTypes = { reference: ReferenceEdge };
const DRAG_DEBOUNCE = 300;
const RESIZE_DEBOUNCE = 300;
const VIEWPORT_DEBOUNCE = 1000;
// Settle a canvas multi-selection before mirroring it into focus.md, so a marquee
// drag (which fires onSelectionChange repeatedly) writes once on release.
const FOCUS_MIRROR_DEBOUNCE = 250;
// "agent read your context Ns ago" for the focus chip — a true logged fact
// (focus.brief stamped it), shown ONLY positively. It confirms a READ happened,
// not that the agent used the brief.
function relativeServed(iso: string | undefined): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
const CONNECTION_EDGE_SIZE_DEFAULTS = {
  defaultWidth: DEFAULT_FILE_CARD_WIDTH,
  defaultHeight: DEFAULT_FILE_CARD_HEIGHT,
};

function badgesInScope(
  badges: readonly BadgeFile[],
  folderScope: string | null,
): readonly BadgeFile[] {
  if (folderScope === null) return badges;
  const prefix = `${folderScope}/`;
  return badges.filter((badge) => badge.file.startsWith(prefix));
}

function nodeBadgeKind(nodes: readonly Node<BadgeNodeData>[], id: string): BadgeKind {
  return nodes.find((node) => node.id === id)?.data.kind ?? 'file';
}

function connectionEdgesForScope(
  badges: readonly BadgeFile[],
  nodes: readonly Node<BadgeNodeData>[],
  folderScope: string | null,
): Edge[] {
  return badgesToConnectionEdges(
    badgesInScope(badges, folderScope),
    nodes,
    CONNECTION_EDGE_SIZE_DEFAULTS,
  );
}

function badgeToNode(
  badge: BadgeFile,
  fallbackIndex: number,
  total: number,
  override?: { x?: number; y?: number },
): Node<BadgeNodeData> {
  // Auto-layout grid for badges without a saved position. Content TILES are
  // taller than bare labels, so rows need vertical room. Column count ADAPTS to
  // the badge count: a fixed 6 columns stays a tidy few rows for a small folder
  // but grows into a 25-row ribbon for a 150-file one — too tall to frame in a
  // landscape window, so fit-to-view clamps to minZoom and strands rows
  // off-screen. Target a grid whose pixel aspect (~220x250 cells) matches the
  // landscape viewport (~1.54 = viewport-aspect x cell h/w) so the whole
  // workspace frames itself. max(6, …) preserves the tuned small/medium look
  // (<=~23 badges keep 6 columns) and only widens for big folders. Saved
  // positions always win.
  const cols = Math.max(5, Math.ceil(Math.sqrt(1.34 * Math.max(1, total))));
  const x = override?.x ?? badge.canvas?.x ?? 60 + (fallbackIndex % cols) * 340;
  const y = override?.y ?? badge.canvas?.y ?? 60 + Math.floor(fallbackIndex / cols) * 280;
  const width =
    badge.canvas?.width ??
    (badge.kind === 'folder' ? DEFAULT_FOLDER_CARD_WIDTH : DEFAULT_FILE_CARD_WIDTH);
  const height =
    badge.canvas?.height ??
    (badge.kind === 'folder' ? DEFAULT_FOLDER_CARD_HEIGHT : DEFAULT_FILE_CARD_HEIGHT);
  return {
    id: badge.file,
    type: 'badge',
    position: { x, y },
    style: {
      width: Math.max(width, CARD_MIN_WIDTH),
      height: Math.max(height, CARD_MIN_HEIGHT),
    },
    data: {
      label: badge.file,
      kind: badge.kind,
      ...(badge.orphan === true && { orphan: true }),
      ...(badge.prompt !== undefined && { prompt: badge.prompt }),
    },
  };
}

function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  ms: number,
): (...args: TArgs) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function cardWidth(node: Node<BadgeNodeData> | undefined): number | undefined {
  if (typeof node?.width === 'number') return node.width;
  const width = node?.style?.width;
  return typeof width === 'number' ? width : undefined;
}

function cardHeight(node: Node<BadgeNodeData> | undefined): number | undefined {
  if (typeof node?.height === 'number') return node.height;
  const height = node?.style?.height;
  return typeof height === 'number' ? height : undefined;
}

// Which right-panel pane (+ drop region) the cursor is over, or null when it's
// over the canvas. Geometry-based: panes carry `data-pane-id` and their rects
// tile the panel without overlap, so this is robust to z-order (elementFromPoint
// would hit the react-flow drag node, which is clipped at the canvas edge anyway).
// Drives the canvas→panel badge dock — crossing into the panel switches the drag
// from "reposition on canvas" to "dock into the panel".
function dockTargetAt(
  clientX: number,
  clientY: number,
): { paneId: string; region: DropRegion } | null {
  for (const el of document.querySelectorAll<HTMLElement>('[data-pane-id]')) {
    const r = el.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      const paneId = el.dataset.paneId;
      if (paneId)
        return { paneId, region: regionFor(clientX - r.left, clientY - r.top, r.width, r.height) };
    }
  }
  return null;
}

export const Canvas = (): JSX.Element => {
  const current = useWorkspaceStore((s) => s.current);
  const currentReachable = useWorkspaceStore((s) => s.currentReachable);
  const folderScope = useWorkspaceStore((s) => s.folderScope);
  const setFolderScope = useWorkspaceStore((s) => s.setFolderScope);
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const setCanvasSelection = useWorkspaceStore((s) => s.setCanvasSelection);
  const setCanvasDockDrag = useWorkspaceStore((s) => s.setCanvasDockDrag);
  const dockBadge = useWorkspaceStore((s) => s.dockBadge);
  // Subscribe to the BOOLEAN (not the target object) so region changes within the
  // panel don't re-render the canvas — only the on/off transition flips autopan.
  const docking = useWorkspaceStore((s) => s.canvasDockDrag !== null);
  const [nodes, setNodes] = useState<Node<BadgeNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [snapGuides, setSnapGuides] = useState<readonly CanvasSnapGuide[]>([]);
  const [error, setError] = useState<string>('');
  const nodesRef = useRef<Node<BadgeNodeData>[]>([]);
  // The FULL workspace agent-context set (stored in focus.md / focus.get),
  // independent of ordinary canvas selection. Selection is object state
  // (resize/move/connect); this set is what external agents read.
  const [focusActive, setFocusActive] = useState<readonly string[]>([]);
  // When the agent last pulled the turn brief (focus.brief stamps it) — surfaced
  // on the chip so curation has a visible "it's being read" signal. bumpServedClock
  // forces the relative-time label to re-render each poll even when the stamp is
  // unchanged, so "read Ns ago" ticks instead of freezing.
  const [briefServedAt, setBriefServedAt] = useState<string | undefined>(undefined);
  const [, bumpServedClock] = useState(0);
  // Persisted viewport for the current workspace, lifted into state so
  // CanvasFramer (rendered inside <ReactFlow>) frames the canvas once per
  // CONTEXT (workspace + view + folder-scope, captured in `key`): it RESTORES
  // the saved viewport on the main canvas, and FITS to the visible badges when
  // there's no saved viewport (fresh workspace / demo) OR we're inside a view /
  // folder scope (whose badges live in a different coordinate space than the
  // per-workspace saved viewport — applying it there would strand them
  // off-screen). Keying by context frames on ENTER but never yanks the canvas
  // out from under a within-context refresh (e.g. a watcher file event).
  // react-flow's defaultViewport is read ONCE on mount, before refresh
  // resolves; relying on it alone snapped users to (0,0,1) and left first-run
  // badges spilling past the right edge. `vp` is resolved for THAT refresh, so
  // a saved viewport is never mistaken for "none" mid-load.
  const [frame, setFrame] = useState<{ key: string; vp: ViewportState | null } | null>(null);
  const viewportRef = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
  // Canvas selection and agent context are mostly distinct: a SINGLE selection is
  // object state only (resize/move/connect) and never touches focus.md. A
  // MULTI-selection (>=2 badges) is an intentional "treat these as a group"
  // gesture, so it mirrors into focus.md as agent context (Phase 0:
  // selection-as-deixis). Explicit context actions (Add to Context / folder /
  // Clear) still own single-file and override flows.
  // Debounce timer for that mirror (see mirrorSelectionToFocus).
  const focusMirrorTimer = useRef<number | null>(null);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const refresh = useCallback(async () => {
    try {
      const result = (await window.bh.run('badge.list')) as BadgeListResult;
      const badges = badgesInScope(result.badges, folderScope);

      const focusResult = (await window.bh.run('focus.get', {})) as {
        active: string[];
        lastBriefServedAt?: string;
      };
      setFocusActive(focusResult.active); // chip reports the full set, not scope-filtered nodes
      setBriefServedAt(focusResult.lastBriefServedAt);
      const nextNodes = badges.map((b, i) => badgeToNode(b, i, badges.length));
      setNodes(nextNodes);
      setEdges(badgesToConnectionEdges(badges, nextNodes, CONNECTION_EDGE_SIZE_DEFAULTS));
      setSnapGuides([]);
      // Inside a folder scope, the per-workspace saved viewport doesn't frame
      // this filtered subset (the folder's badges may sit anywhere) — fit
      // instead (vp:null). On the main canvas, restore the saved viewport.
      const vp =
        folderScope !== null
          ? null
          : ((await window.bh.run('workspace.getViewport', {})) as WorkspaceGetViewportResult);
      setFrame({ key: `${current}|${folderScope ?? ''}`, vp });
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [current, folderScope]);

  useEffect(() => {
    if (current && currentReachable) {
      void refresh();
    } else {
      setNodes([]);
      setEdges([]);
      setSnapGuides([]);
    }
  }, [current, currentReachable, refresh]);

  // Poll the brief-served receipt so "agent read Ns ago" stays live. The stamp
  // lands in .bh/cache/ (watcher-ignored, no push), so a light 5s poll of focus.get
  // is how the chip reflects an agent reading the brief between refreshes.
  useEffect(() => {
    if (!current || !currentReachable) return;
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const r = (await window.bh.run('focus.get', {})) as {
            active: string[];
            lastBriefServedAt?: string;
          };
          setFocusActive(r.active);
          setBriefServedAt(r.lastBriefServedAt);
          bumpServedClock((n) => n + 1);
        } catch {
          /* transient — keep the last known values */
        }
      })();
    }, 5000);
    return () => window.clearInterval(id);
  }, [current, currentReachable]);

  // Live-update the canvas when files are added / removed / renamed on disk
  // (Finder, the `bh` CLI, an AI agent writing a file). Without this the
  // canvas went stale until a manual reload while the sidebar already
  // refreshed — the hero surface silently lagged reality. The watcher
  // already ignores `.bh/`, so these are real user-file events only. Skip
  // 'change' (content edits don't alter the badge set).
  //
  // The delay must clear the watcher's add path: it buffers ~600ms to detect
  // renames, THEN materializes the badge, so a refresh before ~800ms would
  // hit a badge.list that doesn't include the new file yet (and nothing
  // re-triggers it). A single trailing timer (cleared on each event to
  // coalesce bursts, and on unmount/reload) fires safely past that window.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = window.bh.onFileEvent((event) => {
      if (event.type === 'change') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 1100);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [refresh]);

  // Live-update when a badge's metadata (prompt / references) is edited in the
  // editor's badge panel. Those writes land in `.bh/`, which the watcher above
  // ignores, so the canvas would otherwise show a stale prompt or miss a
  // panel-added edge until reload. The panel emits on each successful mutation
  // (see lib/badgeBus); re-deriving nodes + edges keeps the hero surface honest.
  //
  // COALESCED: refresh() re-walks every badge JSON (badge.list) + focus.get +
  // viewport over IPC, so a burst of edits (rapid prompt saves / ref edits) must
  // not trigger a full re-walk each. A trailing timer collapses a burst into one
  // refresh (canvas is behind the editor overlay, so a small delay is invisible).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = subscribeBadgeChange(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 250);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [refresh]);

  const onNodeDoubleClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      const data = node.data as unknown as BadgeNodeData;
      if (data.kind === 'folder') {
        // Double-clicking a folder badge scopes INTO it — the canvas shows just
        // that folder's contents, and the toolbar offers an explicit context action.
        setFolderScope(node.id);
        return;
      }
      // File card → the formal editor surface. The card itself is the canvas
      // preview, so there is no intermediate floating viewer.
      openInPanel(node.id, { pinned: true });
    },
    [setFolderScope, openInPanel],
  );

  const persistCanvas = useMemo(
    () =>
      debounce(
        (file: string, kind: BadgeKind, x: number, y: number, width?: number, height?: number) => {
          // A drag updates the badge's canonical canvas position via badge.set
          // (on the main canvas and inside a folder scope alike).
          void window.bh
            .run('badge.set', {
              file,
              patch: {
                kind,
                canvas: {
                  x,
                  y,
                  ...(width !== undefined && { width }),
                  ...(height !== undefined && { height }),
                  collapsed: false,
                },
              },
            })
            .catch(() => undefined);
        },
        DRAG_DEBOUNCE,
      ),
    [],
  );

  const persistSize = useMemo(
    () =>
      debounce(
        (file: string, kind: BadgeKind, x: number, y: number, width: number, height: number) => {
          void window.bh
            .run('badge.set', {
              file,
              patch: { kind, canvas: { x, y, width, height, collapsed: false } },
            })
            .catch(() => undefined);
        },
        RESIZE_DEBOUNCE,
      ),
    [],
  );

  const persistViewport = useMemo(
    () =>
      debounce((viewport: ViewportState) => {
        void window.bh.run('workspace.setViewport', { viewport }).catch(() => undefined);
      }, VIEWPORT_DEBOUNCE),
    [],
  );

  // Canvas→panel badge drag state (refs, not state — read in the drag/change
  // handlers without re-subscribing): the dragged node's start position (to snap
  // it back if it docks) and whether the last drag tick was over the panel.
  const dragStartPos = useRef<{ id: string; x: number; y: number } | null>(null);
  const dockingRef = useRef(false);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<BadgeNodeData>>[]) => {
      setNodes((prev) => {
        const threshold = SNAP_GUIDE_SCREEN_THRESHOLD / Math.max(0.2, viewportRef.current.zoom);
        const snapped = snapFlowNodeChanges(prev, changes, {
          threshold,
          disabled: dockingRef.current,
          defaultWidth: DEFAULT_FILE_CARD_WIDTH,
          defaultHeight: DEFAULT_FILE_CARD_HEIGHT,
          minWidth: CARD_MIN_WIDTH,
          minHeight: CARD_MIN_HEIGHT,
        });
        setSnapGuides((currentGuides) =>
          sameSnapGuides(currentGuides, snapped.guides) ? currentGuides : snapped.guides,
        );
        let next = applyNodeChanges(snapped.changes, prev);
        for (const change of snapped.changes) {
          if (change.type === 'position' && change.dragging === false && change.position) {
            const node = next.find((n) => n.id === change.id);
            if (dockingRef.current) {
              // The drag ended over the panel → it docked there (onNodeDragStop opens
              // it). Snap the badge back to where the drag began instead of persisting
              // a stray position under the panel edge — it's a reference open, not a move.
              const start = dragStartPos.current;
              if (start && start.id === change.id) {
                const at = { x: start.x, y: start.y };
                next = next.map((n) => (n.id === change.id ? { ...n, position: at } : n));
              }
            } else {
              const kind = nodeBadgeKind(next, change.id);
              persistCanvas(
                change.id,
                kind,
                change.position.x,
                change.position.y,
                cardWidth(node),
                cardHeight(node),
              );
            }
          }
          if (change.type === 'dimensions' && change.resizing === false && change.dimensions) {
            const node = next.find((n) => n.id === change.id);
            const at = node?.position;
            if (at) {
              persistSize(
                change.id,
                nodeBadgeKind(next, change.id),
                at.x,
                at.y,
                change.dimensions.width,
                change.dimensions.height,
              );
            }
          }
        }
        return next;
      });
    },
    [persistCanvas, persistSize],
  );

  // A badge drag begins: remember its origin and clear any stale dock state. (Reset
  // dockingRef HERE — not on stop — so a docked drag's snap-back in onNodesChange
  // reads the right value regardless of stop-vs-change ordering.)
  const onNodeDragStart = useCallback<OnNodeDrag<Node<BadgeNodeData>>>(
    (_event, node) => {
      dockingRef.current = false;
      dragStartPos.current = { id: node.id, x: node.position.x, y: node.position.y };
      setCanvasDockDrag(null);
      setSnapGuides([]);
    },
    [setCanvasDockDrag],
  );

  // Each drag tick: if the cursor crossed into the right panel, publish the dock
  // target (pane + region) — which lights the panel highlight and (via the
  // canvasDockDrag flag) suppresses autopan. Folders scope on double-click; they
  // don't dock, so dragging one just repositions / autopans as before.
  const onNodeDrag = useCallback<OnNodeDrag<Node<BadgeNodeData>>>(
    (event, node) => {
      if ((node.data as BadgeNodeData).kind === 'folder') return;
      const target = dockTargetAt(event.clientX, event.clientY);
      dockingRef.current = target !== null;
      setCanvasDockDrag(target);
    },
    [setCanvasDockDrag],
  );

  // Drop: if it ended over the panel, open the file there (center=tab, edge=split);
  // the snap-back is handled in onNodesChange. Always clear the dock state.
  const onNodeDragStop = useCallback<OnNodeDrag<Node<BadgeNodeData>>>(
    (_event, node) => {
      const dock = useWorkspaceStore.getState().canvasDockDrag;
      if (dockingRef.current && dock && (node.data as BadgeNodeData).kind !== 'folder') {
        dockBadge(node.id, dock.paneId, dock.region);
      }
      setCanvasDockDrag(null);
      setSnapGuides([]);
    },
    [dockBadge, setCanvasDockDrag],
  );

  const onConnect = useCallback(
    async (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      // A self-drag (source handle back to the same badge's target) is a
      // meaningless no-op, not an error — core rejects self-refs, so without
      // this guard an accidental loop-back would flash a red error banner.
      // Silently ignore it; the gesture just doesn't draw anything.
      if (conn.source === conn.target) return;
      const fromSide = sideFromHandle(conn.sourceHandle);
      const toSide = sideFromHandle(conn.targetHandle);
      const sourceKind = nodeBadgeKind(nodesRef.current, conn.source);
      try {
        await window.bh.run('badge.addRef', {
          file: conn.source,
          to: conn.target,
          kind: sourceKind,
          ...(fromSide !== undefined && { fromSide }),
          ...(toSide !== undefined && { toSide }),
        });
        // Refresh so the new edge shows + inbound index updates ripple to other views.
        const result = (await window.bh.run('badge.list')) as BadgeListResult;
        setEdges(connectionEdgesForScope(result.badges, nodesRef.current, folderScope));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [folderScope],
  );

  // Edge deletion: react-flow selects-then-Delete-key flow gives us the
  // removed edges here. Each edge's id is `${source}__${target}` (see the
  // canvasConnections module) so we can derive the badge.removeRef args from id alone.
  const onEdgesDelete = useCallback(
    async (deleted: Edge[]) => {
      const deletedIds = new Set(deleted.map((edge) => edge.id));
      setEdges((prev) => prev.filter((edge) => !deletedIds.has(edge.id)));
      try {
        for (const e of deleted) {
          await window.bh.run('badge.removeRef', {
            file: e.source,
            to: e.target,
            kind: nodeBadgeKind(nodesRef.current, e.source),
          });
        }
        const result = (await window.bh.run('badge.list')) as BadgeListResult;
        setEdges(connectionEdgesForScope(result.badges, nodesRef.current, folderScope));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [folderScope],
  );

  const resetReferenceEdgesFromCore = useCallback(async (): Promise<void> => {
    const result = (await window.bh.run('badge.list')) as BadgeListResult;
    setEdges(connectionEdgesForScope(result.badges, nodesRef.current, folderScope));
  }, [folderScope]);

  const commitReferenceEdgeUpdate = useCallback(
    (update: ReferenceEdgeUpdate): void => {
      flushSync(() => {
        setEdges((prev) => applyReferenceEdgeUpdate(prev, update));
      });
      void (async () => {
        try {
          const result = (await window.bh.run('badge.reconnectRef', {
            previous: {
              file: update.previousSource,
              to: update.previousTarget,
              kind: nodeBadgeKind(nodesRef.current, update.previousSource),
            },
            next: {
              file: update.source,
              to: update.target,
              kind: nodeBadgeKind(nodesRef.current, update.source),
              ...(update.note !== undefined && { note: update.note }),
              ...(update.sourceHandle !== undefined && { fromSide: update.sourceHandle }),
              ...(update.targetHandle !== undefined && { toSide: update.targetHandle }),
            },
          })) as BadgeListResult;
          setEdges(connectionEdgesForScope(result.badges, nodesRef.current, folderScope));
          setError('');
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          await resetReferenceEdgesFromCore().catch(() => undefined);
        }
      })();
    },
    [folderScope, resetReferenceEdgesFromCore],
  );

  const commitReferenceEdgeRemoval = useCallback(
    (removal: ReferenceEdgeRemoval): void => {
      flushSync(() => {
        setEdges((prev) => removeReferenceEdgeUpdate(prev, removal.id));
      });
      void (async () => {
        try {
          await window.bh.run('badge.removeRef', {
            file: removal.source,
            to: removal.target,
            kind: nodeBadgeKind(nodesRef.current, removal.source),
          });
          await resetReferenceEdgesFromCore();
          setError('');
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          await resetReferenceEdgesFromCore().catch(() => undefined);
        }
      })();
    },
    [resetReferenceEdgesFromCore],
  );

  const renderedEdges = useMemo(
    () =>
      edges.map((edge) => {
        const data = edge.data && typeof edge.data === 'object' ? edge.data : {};
        return {
          ...edge,
          data: {
            ...data,
            onReferenceEdgeUpdate: commitReferenceEdgeUpdate,
            onReferenceEdgeRemove: commitReferenceEdgeRemoval,
          },
        };
      }),
    [commitReferenceEdgeRemoval, commitReferenceEdgeUpdate, edges],
  );

  const onNodeClick = useCallback<NodeMouseHandler>(
    (event, node) => {
      const data = node.data as unknown as BadgeNodeData;
      if (event.detail >= 2) return;
      if (data.kind === 'folder') {
        setCanvasSelection({ kind: 'folder', folder: node.id, source: 'canvas' });
        return;
      }
      setCanvasSelection({ kind: 'file', files: [node.id], source: 'canvas' });
    },
    [setCanvasSelection],
  );

  const clearFocus = useCallback(() => {
    void (async () => {
      try {
        await window.bh.run('focus.clear', {});
        setFocusActive([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  // Copy the turn brief (.bh/focus.md verbatim) to the clipboard so the user can
  // paste exactly what their agent reads into ANY chat — making the otherwise
  // invisible payoff of curation tangible and portable (not just the
  // Claude-Code-auto-read-in-repo path). Transient "Copied" confirmation.
  const [briefCopied, setBriefCopied] = useState(false);
  // The Agent Context chip's text expands into a read-only preview of the assembled
  // brief (BriefPreview) — so "your agent reads …" is something you can actually
  // SEE, not just a file count.
  const briefPopover = usePopover({ align: 'left', gap: 6 });
  const copyResetTimer = useRef<number | null>(null);
  const copyBrief = useCallback(() => {
    void (async () => {
      try {
        const { brief } = (await window.bh.run('focus.brief', {})) as { brief: string };
        // Strip bh-internal noise (provenance marker + the .bh/-pointing footer)
        // so what lands in a chat is just the self-contained brief.
        const clean = briefForClipboard(brief);
        // Nothing to copy (focus.md absent under a still-visible chip) — don't
        // write an empty string or flash a misleading "Copied ✓".
        if (clean.length === 0) return;
        await navigator.clipboard.writeText(clean);
        setBriefCopied(true);
        // Reset the confirmation; clear any prior timer so a rapid re-click
        // doesn't let an earlier timer flip the label back early.
        if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
        copyResetTimer.current = window.setTimeout(() => setBriefCopied(false), 1600);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);
  useEffect(
    () => () => {
      if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
      if (focusMirrorTimer.current !== null) window.clearTimeout(focusMirrorTimer.current);
    },
    [],
  );

  const onMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => {
      viewportRef.current = viewport;
      persistViewport({ offsetX: viewport.x, offsetY: viewport.y, scale: viewport.zoom });
    },
    [persistViewport],
  );

  const onMove = useCallback((_event: unknown, viewport: Viewport) => {
    viewportRef.current = viewport;
  }, []);

  const onViewport = useCallback((viewport: Viewport) => {
    viewportRef.current = viewport;
  }, []);

  // Mirror a canvas MULTI-selection into focus.md as agent context — debounced so
  // a marquee drag writes once on release. Single selections never call this (they
  // stay object-state only); explicit Add-to-Context / folder / Clear still own
  // single-file and override flows. focus.set({files}) is files-sourced, so it
  // carries no folder provenance and the user's chat message supplies the intent.
  const mirrorSelectionToFocus = useCallback((files: readonly string[]) => {
    if (focusMirrorTimer.current !== null) window.clearTimeout(focusMirrorTimer.current);
    focusMirrorTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          await window.bh.run('focus.set', { files });
          setFocusActive(files); // chip reflects the new agent context immediately
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
    }, FOCUS_MIRROR_DEBOUNCE);
  }, []);

  const onSelectionChange = useCallback<OnSelectionChangeFunc<Node<BadgeNodeData>, Edge>>(
    ({ nodes: selectedNodes }) => {
      // Any selection change cancels a pending mirror; only a >=2 set below
      // reschedules one. Without this, a debounced mirror could land AFTER the
      // user narrowed back to a single card (or cleared) within the debounce
      // window — writing a group they'd already abandoned into focus.md.
      if (focusMirrorTimer.current !== null) {
        window.clearTimeout(focusMirrorTimer.current);
        focusMirrorTimer.current = null;
      }
      if (selectedNodes.length === 0) {
        setCanvasSelection(null);
        return;
      }
      const files = selectedNodes
        .filter((node) => (node.data as unknown as BadgeNodeData).kind !== 'folder')
        .map((node) => node.id);
      if (files.length > 0) {
        setCanvasSelection({ kind: 'file', files, source: 'canvas' });
        // Phase 0 (selection-as-deixis): >=2 selected files is an intentional
        // "these as a group" gesture — mirror it into focus.md so the agent shares
        // the user's attention with zero extra action. A single file stays UI-only
        // ("operate on this one"): no focus write.
        if (files.length >= 2) mirrorSelectionToFocus(files);
        return;
      }
      const folder = selectedNodes[0]?.id;
      setCanvasSelection(folder ? { kind: 'folder', folder, source: 'canvas' } : null);
    },
    [setCanvasSelection, mirrorSelectionToFocus],
  );

  if (!current || currentReachable === false) {
    return (
      <Onboarding
        onAddFolder={() => void useWorkspaceStore.getState().pickAndAdd()}
        onTryDemo={() => void createDemoAtDefault()}
      />
    );
  }

  // Pick the empty-canvas hint based on why nothing's showing: a folder scope
  // with no children vs a freshly-opened workspace with no supported files.
  // (We don't show the hint if a badge exists; the canvas speaks for itself.)
  // The main-canvas case also surfaces a "Create a note" CTA so the user
  // has a single-click path out of the empty state instead of having to
  // discover Cmd+N or the topbar.
  type EmptyHint = { readonly text: string; readonly cta?: 'new-note' };
  const emptyHint: EmptyHint | null =
    nodes.length === 0
      ? folderScope !== null
        ? {
            text: `No badges inside ${folderScope}/ yet. Drop files into this folder; they'll appear automatically.`,
          }
        : {
            text: "This workspace has no files yet. Drop files in the folder and they'll appear as badges — or create one now:",
            cta: 'new-note',
          }
      : null;

  // Derived from the FULL agent-context set (focusActive), NOT the rendered
  // nodes — inside a folder scope the set can include files that aren't on
  // screen, and the chip must still name everything the agent reads.
  const focusedFiles = focusActive;
  const focusedCount = focusedFiles.length;
  const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1);
  const focusedNames = focusedFiles.map(baseName);
  const focusedLabel =
    focusedCount === 1
      ? (focusedNames[0] ?? '')
      : `${focusedNames.slice(0, 3).join(', ')}${
          focusedNames.length > 3 ? ` +${focusedNames.length - 3} more` : ''
        }`;

  // Folder-scope actions live on the canvas now (the top bar was removed).
  const handleFocusFolder = async (): Promise<void> => {
    if (!folderScope) return;
    try {
      await window.bh.run('focus.set', { folder: folderScope });
      void refresh(); // re-read focus.get → agent-context chip
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleEditFolderPrompt = async (): Promise<void> => {
    if (!folderScope) return;
    const existing = (await window.bh.run('badge.get', {
      file: folderScope,
      kind: 'folder',
    })) as { prompt?: string } | null;
    const next = await prompt({
      title: `Folder prompt — /${folderScope}`,
      body: "What the AI agent should know about this folder — it's read as the turn intent when you add the folder to Agent Context. Leave blank to clear.",
      label: 'Prompt',
      defaultValue: existing?.prompt ?? '',
      placeholder: 'e.g. Chapter 3 supporting material — read first',
    });
    if (next === null) return;
    try {
      await window.bh.run('badge.set', {
        file: folderScope,
        patch: { kind: 'folder', prompt: next.trim() },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {/* New note — top-right of the canvas (the top bar was removed). */}
      <div style={{ position: 'absolute', top: space[3], right: space[3], zIndex: 8 }}>
        <Button onClick={() => void promptForNewNote()} title="Create a new note (⌘N)">
          New note
        </Button>
      </div>
      {/* Folder-scope chrome — top-left, only while scoped into a folder. On
          its own row (below the New-note / context-chip row) so the actions never
          collide with the centered context chip. */}
      {folderScope && (
        <div
          style={{
            position: 'absolute',
            top: 56,
            left: space[3],
            zIndex: 8,
            display: 'flex',
            alignItems: 'center',
            gap: space[2],
          }}
        >
          <Button variant="ghost" onClick={() => setFolderScope(null)} title="Exit folder scope">
            ← /{folderScope}
          </Button>
          <Button
            onClick={() => void handleFocusFolder()}
            title="Add this folder to Agent Context — your agent reads all its files, with the folder prompt as the turn intent"
          >
            Add folder to Context
          </Button>
          <Button
            variant="ghost"
            onClick={() => void handleEditFolderPrompt()}
            title="Edit this folder's badge prompt (read as the intent when you add the folder to Agent Context)"
          >
            Edit folder prompt
          </Button>
        </div>
      )}
      {focusedCount > 0 && (
        // Witnessed payoff: name the context the human explicitly handed the
        // agent. Ordinary canvas selection never mutates this.
        <div
          data-testid="focus-chip"
          style={{
            position: 'absolute',
            top: space[3],
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 8,
            display: 'flex',
            alignItems: 'center',
            gap: space[2],
            background: color.surface,
            border: `1px solid ${color.accentSoft}`,
            borderRadius: radius.pill,
            padding: `${space[1]}px ${space[1]}px ${space[1]}px ${space[3]}px`,
            boxShadow: shadow.raised,
            fontFamily: font.sans,
            fontSize: font.size.caption,
            color: color.textSecondary,
            animation: `bh-banner-in ${motion.normal}`,
          }}
        >
          <button
            type="button"
            ref={briefPopover.triggerRef}
            onClick={briefPopover.toggle}
            title="See exactly what your agent reads"
            aria-expanded={briefPopover.open}
            data-testid="focus-chip-trigger"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: space[1.5],
              minWidth: 0,
              maxWidth: 460,
              border: 'none',
              background: 'transparent',
              padding: 0,
              margin: 0,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 'inherit',
              color: 'inherit',
              textAlign: 'left',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: color.accent,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              <strong style={{ color: color.textPrimary, fontWeight: font.weight.semibold }}>
                {focusedCount}
              </strong>{' '}
              Agent Context · {focusedCount} {focusedCount === 1 ? 'file' : 'files'} ·{' '}
              <span style={{ color: color.textPrimary }}>{focusedLabel}</span>
              {relativeServed(briefServedAt) && (
                <span style={{ color: color.textTertiary }}>
                  {' '}
                  · read {relativeServed(briefServedAt)}
                </span>
              )}
            </span>
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                color: color.textTertiary,
                fontSize: 10,
                transform: briefPopover.open ? 'rotate(180deg)' : 'none',
                transition: transition(['transform']),
              }}
            >
              ▾
            </span>
          </button>
          {/* Copy lives INSIDE the preview panel ("look, then send") — so a copy
              always reflects the brief you're looking at, including a just-typed
              intent. The chip is summary + open + clear. */}
          <button
            type="button"
            onClick={clearFocus}
            title="Clear Agent Context"
            data-testid="focus-clear"
            style={{
              border: 'none',
              background: 'transparent',
              color: color.textTertiary,
              fontFamily: font.sans,
              fontSize: font.size.caption,
              cursor: 'pointer',
              padding: `${space[0.5]}px ${space[2]}px`,
              borderRadius: radius.pill,
            }}
          >
            Clear
          </button>
          <BriefPreview controller={briefPopover} onCopy={copyBrief} copied={briefCopied} />
        </div>
      )}
      {error && (
        <div
          style={{
            position: 'absolute',
            // Stacks below the top-right "New note" button rather than over it.
            top: 56,
            right: space[3],
            background: color.surface,
            border: `1px solid ${color.danger}33`,
            padding: `${space[2]}px ${space[3]}px`,
            fontSize: font.size.caption,
            fontFamily: font.sans,
            color: color.danger,
            borderRadius: radius.md,
            boxShadow: shadow.raised,
            zIndex: 10,
            animation: `bh-banner-in ${motion.normal}`,
            maxWidth: 360,
          }}
        >
          {error}
        </div>
      )}
      {emptyHint && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            maxWidth: 380,
            padding: `${space[4]}px ${space[5]}px`,
            background: color.surface,
            border: `1px dashed ${color.borderStrong}`,
            borderRadius: radius.lg,
            fontFamily: font.sans,
            fontSize: font.size.body,
            color: color.textSecondary,
            textAlign: 'center',
            lineHeight: 1.55,
            zIndex: 5,
            // pointerEvents:'none' when there's no CTA so the dot grid
            // behind stays draggable for panning; flip to 'auto' when
            // the CTA button needs to be clickable.
            pointerEvents: emptyHint.cta ? 'auto' : 'none',
          }}
        >
          {emptyHint.text}
          {emptyHint.cta === 'new-note' && (
            <div style={{ marginTop: space[3] }}>
              <Button variant="primary" onClick={() => void promptForNewNote()}>
                New note
              </Button>
            </div>
          )}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={renderedEdges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onSelectionChange={onSelectionChange}
        onConnect={onConnect}
        connectionMode={ConnectionMode.Loose}
        onEdgesDelete={onEdgesDelete}
        deleteKeyCode={['Delete', 'Backspace']}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        // Autopan follows the badge toward the canvas edge — but the instant the
        // cursor crosses into the panel (docking), flip it off so the map stops
        // sliding and the gesture settles onto the panel. XYDrag's autopan loop
        // re-reads this each frame, so the toggle stops it mid-drag.
        autoPanOnNodeDrag={!docking}
        onMove={onMove}
        onMoveEnd={onMoveEnd}
        onPaneClick={() => setCanvasSelection(null)}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Shift"
        // All edges render through the canvasConnections ReferenceEdge (see EDGE_TYPES): the line is
        // always visible, the note reveals on hover/selection — no colliding
        // always-on midpoint labels. Animation off; the custom edge owns its
        // stroke + accent-on-interaction styling.
        defaultEdgeOptions={{
          type: 'reference',
          animated: false,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 18,
            height: 18,
            color: color.textGhost,
          },
        }}
        // The live drag previews the same side-midpoint snap that will be
        // saved on drop, so the line never appears to float beside a card.
        connectionLineComponent={CanvasConnectionLine}
        connectionLineStyle={{ stroke: color.accent, strokeWidth: 2 }}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={0.2}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color={color.border} />
        <CanvasViewportTracker onViewport={onViewport} />
        <CanvasSnapGuides guides={snapGuides} />
        <CanvasControls />
        <CanvasFramer frame={frame} />
      </ReactFlow>
    </div>
  );
};

// Re-export useReactFlow so children can re-center programmatically later.
export { useReactFlow };

const CanvasViewportTracker = ({
  onViewport,
}: { onViewport: (viewport: Viewport) => void }): null => {
  const viewport = useViewport();
  useEffect(() => {
    onViewport({ x: viewport.x, y: viewport.y, zoom: viewport.zoom });
  }, [onViewport, viewport.x, viewport.y, viewport.zoom]);
  return null;
};

/**
 * Frames the canvas after each refresh. Rendered inside <ReactFlow> so the
 * hooks have a provider. For every refresh (identified by `frame.seq`) it
 * applies exactly once, but only after `useNodesInitialized` reports the
 * current nodes have measured dimensions — `fitView` needs real node sizes
 * to compute the bounding box.
 *
 *   - saved viewport present → RESTORE it (reload / re-open keeps your place).
 *   - no saved viewport (fresh workspace / demo) → FIT to all badges so the
 *     whole graph is visible instead of spilling past the right edge.
 *
 * maxZoom:1 stops a lone badge from blowing up to fill the screen; the guard
 * on `appliedSeq` keeps node drags (which re-flip nodesInitialized) from
 * re-framing and yanking the canvas out from under the user.
 */
const CanvasFramer = ({
  frame,
}: { frame: { key: string; vp: ViewportState | null } | null }): null => {
  const { setViewport, fitView, getNodes } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const framedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!frame || !nodesInitialized) return;
    // Frame once per context. A same-key refresh (a watcher file event, a
    // context changes must NOT re-frame — that would yank the canvas out from
    // under the user mid-work.
    if (framedKey.current === frame.key) return;
    framedKey.current = frame.key;
    if (frame.vp) {
      setViewport({ x: frame.vp.offsetX, y: frame.vp.offsetY, zoom: frame.vp.scale });
    } else if (getNodes().length > 0) {
      void fitView({ padding: 0.2, maxZoom: 1, duration: 0 });
    }
  }, [frame, nodesInitialized, setViewport, fitView, getNodes]);
  return null;
};
