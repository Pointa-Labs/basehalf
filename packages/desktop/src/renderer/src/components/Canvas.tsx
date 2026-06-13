import type {
  BadgeFile,
  BadgeKind,
  CanvasBadge,
  ViewportState,
  WorkspaceListCanvasResult,
} from '@basehalf/core';
import {
  Background,
  type Connection,
  ConnectionMode,
  type Edge,
  type EdgeTypes,
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
import { copyAgentBrief, createDemoAtDefault } from '../lib/actions.js';
import { subscribeBadgeChange } from '../lib/badgeBus.js';
import { badgeMutations } from '../lib/badgeMutations.js';
import {
  SNAP_GUIDE_SCREEN_THRESHOLD,
  sameSnapGuides,
  snapFlowNodeChanges,
} from '../lib/canvasFlowSnap.js';
import type { CanvasSnapGuide } from '../lib/canvasSnap.js';
import { focusMutations } from '../lib/focusMutations.js';
import { droppedPaths, handleExternalDrop } from '../lib/importDrop.js';
import { useLayoutStore } from '../store/layout.js';
import { useWorkspaceStore } from '../store/workspace.js';
import {
  BadgeNode,
  type BadgeNodeData,
  CARD_MIN_HEIGHT,
  CARD_MIN_WIDTH,
  DEFAULT_FILE_CARD_HEIGHT,
  DEFAULT_FILE_CARD_WIDTH,
  DEFAULT_FOLDER_CARD_HEIGHT,
  DEFAULT_FOLDER_CARD_WIDTH,
  clearPreviewCache,
} from './BadgeNode.js';
import { BriefPreview } from './BriefPreview.js';
import { CanvasControls } from './CanvasControls.js';
import { CanvasSnapGuides } from './CanvasSnapGuides.js';
import { prompt } from './Dialog.js';
import { FileGlyph, badgeType } from './FileGlyph.js';
import { Onboarding } from './Onboarding.js';
import { ProposalsChip } from './ProposalsChip.js';
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
const CONNECTION_EDGE_SIZE_DEFAULTS = {
  defaultWidth: DEFAULT_FILE_CARD_WIDTH,
  defaultHeight: DEFAULT_FILE_CARD_HEIGHT,
};

// The parent folder of a scope (one level up), or null for a top-level folder
// (whose parent is the root canvas). Powers "back" navigation up the tree. Each
// canvas IS a folder — it shows only that folder's direct children (the one-level
// set comes straight from workspace.listCanvas), and double-clicking a folder
// badge opens it (the canvas becomes that folder's inside).
function parentScope(folderScope: string): string | null {
  const slash = folderScope.lastIndexOf('/');
  return slash === -1 ? null : folderScope.slice(0, slash);
}

function nodeBadgeKind(nodes: readonly Node<BadgeNodeData>[], id: string): BadgeKind {
  return nodes.find((node) => node.id === id)?.data.kind ?? 'file';
}

// Build reference edges for the badges currently on the canvas. They are already
// exactly one folder level (workspace.listCanvas), so no scope filter is needed —
// badgesToConnectionEdges drops refs whose target isn't in the visible set.
function connectionEdges(
  badges: readonly BadgeFile[],
  nodes: readonly Node<BadgeNodeData>[],
): Edge[] {
  return badgesToConnectionEdges(badges, nodes, CONNECTION_EDGE_SIZE_DEFAULTS);
}

function badgeToNode(
  badge: CanvasBadge,
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
  const w = Math.max(width, CARD_MIN_WIDTH);
  const h = Math.max(height, CARD_MIN_HEIGHT);
  return {
    id: badge.file,
    type: 'badge',
    position: { x, y },
    // A card maps to a file/folder on disk and its badge note — pressing
    // Delete/Backspace while a card is selected must never delete the node (and,
    // worse, cascade-delete its reference edges + their human-written notes, an
    // irreplaceable asset). Only EDGES are deletable from the keyboard; the card
    // is removed by deleting the underlying file, not a keystroke.
    deletable: false,
    // initialWidth/Height give onlyRenderVisibleElements (see <ReactFlow>) the
    // node bounds for viewport culling BEFORE the DOM is measured — without them
    // the first frame can't tell which nodes fall inside the viewport.
    initialWidth: w,
    initialHeight: h,
    style: { width: w, height: h },
    data: {
      label: badge.file,
      kind: badge.kind,
      ...(badge.orphan === true && { orphan: true }),
      ...(badge.prompt !== undefined && { prompt: badge.prompt }),
      ...(badge.preview !== undefined && { preview: badge.preview }),
      // How many of this badge's outbound references carry a human-written
      // note — the card's coverage indicator distinguishes "annotated with
      // connections explained" from "prompt only" (see BadgeNode).
      notedRefs: badge.references.filter((r) => r.note !== undefined && r.note.trim() !== '')
        .length,
      ...(coverage !== undefined && { coverage }),
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

export const Canvas = (): JSX.Element => {
  const current = useWorkspaceStore((s) => s.current);
  const currentReachable = useWorkspaceStore((s) => s.currentReachable);
  const folderScope = useWorkspaceStore((s) => s.folderScope);
  const setFolderScope = useWorkspaceStore((s) => s.setFolderScope);
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const setCanvasSelection = useWorkspaceStore((s) => s.setCanvasSelection);
  // While a card is being inline-edited, suspend viewport virtualization so a
  // pan/zoom can't cull the editing tile mid-edit (which would cancel its
  // unsaved autosave). Boolean selector → re-renders only on the 0↔1 transition.
  const cardEditing = useWorkspaceStore((s) => s.canvasEditingCardIds.size > 0);
  const [nodes, setNodes] = useState<Node<BadgeNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [snapGuides, setSnapGuides] = useState<readonly CanvasSnapGuide[]>([]);
  const [error, setError] = useState<string>('');
  const nodesRef = useRef<Node<BadgeNodeData>[]>([]);
  // The FULL workspace agent-context set (stored in focus.md / focus.get),
  // independent of ordinary canvas selection. Selection is object state
  // (resize/move/connect); this set is what external agents read.
  const [focusActive, setFocusActive] = useState<readonly string[]>([]);
  // When the agent last pulled the turn brief (focus.brief stamps it; the
  // receipt is cleared whenever the brief changes). The chip shows its ABSENCE
  // as a binary freshness signal: no receipt + a non-empty context = the
  // CURRENT brief was never handed off → an "updated" marker that clears on
  // the next copy / agent read. (The old "served 47s ago" string implied a
  // precision bh can't deliver — it confirms a hand-off, not comprehension —
  // and needed a live ticker just to avoid going stale.)
  const [briefServedAt, setBriefServedAt] = useState<string | undefined>(undefined);
  // True once ANY badge in the workspace carries a prompt — gates the
  // first-annotation hint card (derived each loadData; writing the first note
  // retires the card permanently, so no dismissal needs persisting).
  const [workspaceHasAnyPrompt, setWorkspaceHasAnyPrompt] = useState(true);
  const [annotateHintDismissed, setAnnotateHintDismissed] = useState(false);
  // Monotonic sequence for loadData staleness checks (see loadData).
  const loadSeqRef = useRef(0);
  // The canvas region's DOM node — drop-position math needs its screen rect.
  const canvasRootRef = useRef<HTMLDivElement | null>(null);
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
  // The focus the user had curated BEFORE a multi-select mirror overwrote it.
  // Captured on the first mirror of a "session" and restored when the selection
  // drops below 2 — so a navigation-grade gesture (shift-selecting cards to move
  // them) no longer silently, permanently replaces an explicit Agent Context.
  // null = no mirror session active. Cleared by any EXPLICIT focus change
  // (Clear / folder / panel toggle), which the user owns and deselect must not undo.
  const mirrorPrevFocus = useRef<readonly string[] | null>(null);
  // Live mirror of focusActive for the selection callback (avoids a stale closure).
  const focusActiveRef = useRef<readonly string[]>([]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    focusActiveRef.current = focusActive;
  }, [focusActive]);

  // Read focus state only (cheap: one file). Updates the agent-context chip
  // without re-walking every badge — folder navigation never needs this.
  const reloadFocus = useCallback(async () => {
    try {
      const r = (await window.bh.run('focus.get', {})) as {
        active: string[];
        lastBriefServedAt?: string;
      };
      setFocusActive(r.active); // chip reports the full set, not scope-filtered nodes
      setBriefServedAt(r.lastBriefServedAt);
    } catch {
      /* transient — keep the last known values */
    }
  }, []);

  // Load THIS folder's canvas. The filesystem IS the tree, so we read ONE level
  // on demand (workspace.listCanvas) — the direct children of folderScope (null =
  // root), each merged with its sparse badge overlay. Cheap (one readdir), so
  // folder navigation re-runs it (loadData depends on folderScope). Each folder
  // canvas fits its OWN contents on entry (vp:null → fit-to-view), so you always
  // land looking at the items in THIS folder, not a stale pan/zoom.
  const loadData = useCallback(async () => {
    // Staleness guard: loadData closes over (current, folderScope) but is fired
    // from many places (effects, file events, badge bus). A workspace/folder
    // switch mid-flight must not let the OLD load's late resolution clobber the
    // NEW context's nodes / hint-card state — same class as the palette's
    // `cancelled` gates. Each call bumps the sequence; only the latest commits.
    const seq = ++loadSeqRef.current;
    const fresh = (): boolean => seq === loadSeqRef.current;
    try {
      const { badges } = (await window.bh.run('workspace.listCanvas', {
        folder: folderScope,
      })) as WorkspaceListCanvasResult;
      // The annotation layer alongside the visible folder level: the sparse
      // badge overlay (cheap — only annotated files have one) derives the
      // first-annotation hint; the supported-file census (a full tree walk,
      // fetched only when folder cards are visible to price) derives each
      // folder card's coverage bar. Both are best-effort: a transient failure
      // degrades the indicators, never the canvas itself.
      let prompted = new Set<string>();
      let anyPrompt = true; // fail safe: never flash the hint card on a failed read
      let filesAll: string[] = [];
      try {
        const badgesAll = (await window.bh.run('badge.list', {})) as {
          badges: { file: string; kind: string; prompt?: string }[];
        };
        prompted = new Set(
          badgesAll.badges
            .filter((b) => b.kind === 'file' && b.prompt !== undefined && b.prompt.trim() !== '')
            .map((b) => b.file),
        );
        anyPrompt = badgesAll.badges.some((b) => b.prompt !== undefined && b.prompt.trim() !== '');
        if (badges.some((b) => b.kind === 'folder')) {
          const res = (await window.bh.run('workspace.listSupportedFiles', {
            folder: null,
          })) as { files: string[] };
          filesAll = res.files;
        }
      } catch {
        // Indicators degrade (no coverage bars, no hint card) — canvas renders.
      }
      if (!fresh()) return;
      const coverageFor = (folder: string): { annotated: number; total: number } | undefined => {
        if (filesAll.length === 0) return undefined;
        const prefix = `${folder}/`;
        let annotated = 0;
        let total = 0;
        for (const f of filesAll) {
          if (!f.startsWith(prefix)) continue;
          total++;
          if (prompted.has(f)) annotated++;
        }
        return { annotated, total };
      };
      const nextNodes = badges.map((b, i) =>
        badgeToNode(
          b,
          i,
          badges.length,
          undefined,
          b.kind === 'folder' ? coverageFor(b.file) : undefined,
        ),
      );
      setNodes(nextNodes);
      setEdges(badgesToConnectionEdges(badges, nextNodes, CONNECTION_EDGE_SIZE_DEFAULTS));
      setSnapGuides([]);
      setFrame({ key: `${current}|${folderScope ?? ''}`, vp: null });
      // The hint card invites the FIRST note: it shows only while the whole
      // workspace is annotation-free (any saved prompt — file or folder —
      // retires it for good, no dismissal state to persist).
      setWorkspaceHasAnyPrompt(anyPrompt);
      await reloadFocus();
      if (!fresh()) return;
      setError('');
    } catch (err) {
      if (!fresh()) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [current, folderScope, reloadFocus]);

  // Drop cached previews when the active workspace changes — the cache is keyed
  // by workspace-relative path, so a path present in two workspaces (README.md)
  // must not carry the prior workspace's content across a switch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `current` is the intentional re-run trigger; the body clears per-workspace caches and reads nothing.
  useEffect(() => {
    clearPreviewCache();
    // "Not now" on the first-annotation hint is a per-workspace answer — a
    // different (also unannotated) workspace gets to ask again.
    setAnnotateHintDismissed(false);
  }, [current]);

  useEffect(() => {
    if (current && currentReachable) {
      void loadData();
    } else {
      setNodes([]);
      setEdges([]);
      setSnapGuides([]);
    }
  }, [current, currentReachable, loadData]);

  // Poll the brief-served receipt so the chip's "updated" dot clears when an
  // agent pulls the brief out-of-band. The stamp lands in .bh/cache/
  // (watcher-ignored, no push), so a light 5s poll of focus.get is how the chip
  // reflects an agent reading the brief between refreshes.
  useEffect(() => {
    if (!current || !currentReachable) return;
    // Remember the badge-store signature so we reload the canvas only when an
    // EXTERNAL writer (the `bh` CLI, an agent) touched .bh/badges/ — which the
    // watcher ignores. Re-walking every badge each poll would be needless churn;
    // the cheap stat-only revision gates it.
    let lastBadgeRev = '';
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const r = (await window.bh.run('focus.get', {})) as {
            active: string[];
            lastBriefServedAt?: string;
          };
          setFocusActive(r.active);
          setBriefServedAt(r.lastBriefServedAt);
          const rev = (await window.bh.run('badge.revision', {})) as {
            count: number;
            maxMtimeMs: number;
          };
          const sig = `${rev.count}:${rev.maxMtimeMs}`;
          if (lastBadgeRev === '') {
            lastBadgeRev = sig; // first read establishes the baseline; no reload
          } else if (sig !== lastBadgeRev) {
            lastBadgeRev = sig;
            void loadData(); // an out-of-app badge edit landed — refresh the canvas
          }
        } catch {
          /* transient — keep the last known values */
        }
      })();
    }, 5000);
    return () => window.clearInterval(id);
  }, [current, currentReachable, loadData]);

  // Live-update the canvas when files are added / removed / renamed on disk
  // (the file manager, the `bh` CLI, an AI agent writing a file). Without
  // this the canvas went stale until a manual reload while the sidebar
  // already refreshed — the hero surface silently lagged reality. The
  // watcher already ignores `.bh/`, so these are real user-file events only.
  // Skip 'change' (content edits don't alter the badge set).
  //
  // Two timers, tuned for how the watcher settles (badges are SPARSE now —
  // listCanvas reads the filesystem directly, so a brand-new file is visible
  // the moment its add event lands; nothing waits on materialization):
  //  - FAST pass (150ms, coalescing): a plain `add` with no unlink in the
  //    recent window is a new file — show its card near-instantly. This is
  //    the save-in-the-file-manager → see-it-on-the-canvas latency the user
  //    actually feels.
  //  - SETTLE pass (1100ms, coalescing): every non-change event also queues
  //    a reload past the watcher's 600ms rename window, so badge cascades
  //    (badge.rename carrying position/refs, markOrphan) land in the final
  //    render. Unlinks take only this pass: reloading them fast would flash a
  //    rename as remove-then-re-add and yank the card's position.
  useEffect(() => {
    let fastTimer: ReturnType<typeof setTimeout> | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let lastUnlinkAt = 0;
    const unsub = window.bh.onFileEvent((event) => {
      if (event.type === 'change') return;
      if (event.type === 'unlink') lastUnlinkAt = Date.now();
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => void loadData(), 1100);
      // An add right after an unlink is likely a rename pair mid-flight —
      // leave that to the settle pass (the rename window is 600ms; 700ms of
      // quiet means this add stands alone).
      if (event.type === 'add' && Date.now() - lastUnlinkAt > 700) {
        if (fastTimer) clearTimeout(fastTimer);
        fastTimer = setTimeout(() => void loadData(), 150);
      }
    });
    return () => {
      if (fastTimer) clearTimeout(fastTimer);
      if (settleTimer) clearTimeout(settleTimer);
      unsub();
    };
  }, [loadData]);

  // Live-update when a badge's metadata (prompt / references) is edited in the
  // editor's badge panel. Those writes land in `.bh/`, which the watcher above
  // ignores, so the canvas would otherwise show a stale prompt or miss a
  // panel-added edge until reload. The panel emits on each successful mutation
  // (see lib/badgeBus); re-deriving nodes + edges keeps the hero surface honest.
  //
  // COALESCED: loadData() re-walks every badge JSON (badge.list) + focus over IPC,
  // so a burst of edits (rapid prompt saves / ref edits) must not trigger a full
  // re-walk each. A trailing timer collapses a burst into one load (canvas is
  // behind the editor overlay, so a small delay is invisible).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = subscribeBadgeChange((origin) => {
      // Our own writes already refreshed the canvas inline — only react to the
      // OTHER surface's edits (panel), so we don't double-load after a drag.
      if (origin === 'canvas') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void loadData(), 250);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [loadData]);

  const onNodeDoubleClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      const data = node.data as unknown as BadgeNodeData;
      if (data.kind === 'folder') {
        // Double-clicking a folder badge scopes INTO it — the canvas shows just
        // that folder's contents, and the toolbar offers an explicit context action.
        void setFolderScope(node.id);
        return;
      }
      // File card → open it in the full-canvas editor overlay. The card itself is
      // the canvas preview, so there is no intermediate floating viewer.
      openInPanel(node.id);
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

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<BadgeNodeData>>[]) => {
      setNodes((prev) => {
        const threshold = SNAP_GUIDE_SCREEN_THRESHOLD / Math.max(0.2, viewportRef.current.zoom);
        const snapped = snapFlowNodeChanges(prev, changes, {
          threshold,
          defaultWidth: DEFAULT_FILE_CARD_WIDTH,
          defaultHeight: DEFAULT_FILE_CARD_HEIGHT,
          minWidth: CARD_MIN_WIDTH,
          minHeight: CARD_MIN_HEIGHT,
        });
        setSnapGuides((currentGuides) =>
          sameSnapGuides(currentGuides, snapped.guides) ? currentGuides : snapped.guides,
        );
        const next = applyNodeChanges(snapped.changes, prev);
        for (const change of snapped.changes) {
          if (change.type === 'position' && change.dragging === false && change.position) {
            const node = next.find((n) => n.id === change.id);
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

  // A badge drag begins: clear any stale snap guides. (The editor is a
  // full-canvas overlay now — there's no docked panel to drag a card into, so a
  // drag is a pure reposition; its final position persists in onNodesChange.)
  const onNodeDragStart = useCallback<OnNodeDrag<Node<BadgeNodeData>>>(() => {
    setSnapGuides([]);
  }, []);

  // A drag ends: clear the live snap guides (the final position is persisted in
  // onNodesChange when react-flow reports dragging === false).
  const onNodeDragStop = useCallback<OnNodeDrag<Node<BadgeNodeData>>>(() => {
    setSnapGuides([]);
  }, []);

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
        await badgeMutations.addRef(
          {
            file: conn.source,
            to: conn.target,
            kind: sourceKind,
            ...(fromSide !== undefined && { fromSide }),
            ...(toSide !== undefined && { toSide }),
          },
          'canvas',
        );
        // Refresh so the new edge shows + inbound index updates ripple to other views.
        const { badges } = (await window.bh.run('workspace.listCanvas', {
          folder: folderScope,
        })) as WorkspaceListCanvasResult;
        setEdges(connectionEdges(badges, nodesRef.current));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [folderScope],
  );

  const resetReferenceEdgesFromCore = useCallback(async (): Promise<void> => {
    const { badges } = (await window.bh.run('workspace.listCanvas', {
      folder: folderScope,
    })) as WorkspaceListCanvasResult;
    setEdges(connectionEdges(badges, nodesRef.current));
    // Refresh each card's noted-refs count from the same fetch: an edge-note
    // edit commits with origin 'canvas', which the badge-bus listener ignores
    // (by design — no full reload for our own writes), so the corner dot would
    // otherwise lag until the next unrelated reload.
    const notedCounts = new Map(
      badges.map((b) => [
        b.file,
        b.references.filter((r) => r.note !== undefined && r.note.trim() !== '').length,
      ]),
    );
    setNodes((prev) =>
      prev.map((n) => {
        const c = notedCounts.get(n.id);
        if (c === undefined || n.data.notedRefs === c) return n;
        return { ...n, data: { ...n.data, notedRefs: c } };
      }),
    );
  }, [folderScope]);

  // Edge deletion: react-flow selects-then-Delete-key flow gives us the
  // removed edges here. Each edge's id is `${source}__${target}` (see the
  // canvasConnections module) so we can derive the badge.removeRef args from id alone.
  const onEdgesDelete = useCallback(
    async (deleted: Edge[]) => {
      const deletedIds = new Set(deleted.map((edge) => edge.id));
      setEdges((prev) => prev.filter((edge) => !deletedIds.has(edge.id)));
      try {
        for (const e of deleted) {
          await badgeMutations.removeRef(
            {
              file: e.source,
              to: e.target,
              kind: nodeBadgeKind(nodesRef.current, e.source),
            },
            'canvas',
          );
        }
        // Re-derive edges AND each card's noted-refs count from core: a removed
        // noted edge otherwise leaves the source card's "carries noted
        // connections" dot stale (the 'canvas'-origin write is ignored by the
        // bus listener) until an unrelated reload.
        await resetReferenceEdgesFromCore();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [resetReferenceEdgesFromCore],
  );

  const commitReferenceEdgeUpdate = useCallback(
    (update: ReferenceEdgeUpdate): void => {
      flushSync(() => {
        setEdges((prev) => applyReferenceEdgeUpdate(prev, update));
      });
      void (async () => {
        try {
          await badgeMutations.reconnectRef(
            {
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
            },
            'canvas',
          );
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

  const commitReferenceEdgeRemoval = useCallback(
    (removal: ReferenceEdgeRemoval): void => {
      flushSync(() => {
        setEdges((prev) => removeReferenceEdgeUpdate(prev, removal.id));
      });
      void (async () => {
        try {
          await badgeMutations.removeRef(
            {
              file: removal.source,
              to: removal.target,
              kind: nodeBadgeKind(nodesRef.current, removal.source),
            },
            'canvas',
          );
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
        // Explicit user action — end any mirror session so a later deselect
        // doesn't restore a focus the user just deliberately cleared.
        mirrorPrevFocus.current = null;
        await focusMutations.clear('canvas'); // emit → open badge panels refresh
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
        // The shared copy path (lib/actions): peek without stamping, clean the
        // bh-internal noise, copy, and stamp the served receipt only once the
        // clipboard write actually succeeded. False = nothing to copy (focus.md
        // absent under a still-visible chip) — no misleading "Copied ✓".
        if (!(await copyAgentBrief())) return;
        setBriefCopied(true);
        // The hand-off just happened — clear the "updated" dot immediately
        // rather than waiting for the next 5s receipt poll.
        setBriefServedAt(new Date().toISOString());
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

  // Cancel a pending selection→focus mirror when the workspace changes. <Canvas/>
  // stays mounted across workspace.use, so a debounce in flight from the OLD
  // workspace must NOT fire focus.set against the NEW workspace's focus.md — that
  // would write the previous workspace's selection into the wrong brief.
  // `current` is a pure TRIGGER: the body touches only the timer ref, but we want
  // the cleanup to run on every workspace change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: current is a deliberate trigger — re-run cleanup to cancel a pending mirror on workspace switch
  useEffect(
    () => () => {
      if (focusMirrorTimer.current !== null) {
        window.clearTimeout(focusMirrorTimer.current);
        focusMirrorTimer.current = null;
      }
    },
    [current],
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
    // Capture the user's curated focus the FIRST time a mirror overwrites it this
    // session, so dropping the selection can restore it (decision: keep the
    // selection-as-deixis convenience, lose the silent permanent overwrite).
    if (mirrorPrevFocus.current === null) {
      mirrorPrevFocus.current = [...focusActiveRef.current];
    }
    if (focusMirrorTimer.current !== null) window.clearTimeout(focusMirrorTimer.current);
    focusMirrorTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          await focusMutations.setFiles(files, 'canvas'); // emit → panels refresh
          setFocusActive(files); // chip reflects the new agent context immediately
          // focus.set cleared the on-disk served receipt (the new brief was never
          // served); drop the local stamp too so the chip doesn't show the new
          // selection as "served Ns ago" until the next poll catches up.
          setBriefServedAt(undefined);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
    }, FOCUS_MIRROR_DEBOUNCE);
  }, []);

  // Restore the pre-mirror focus when a mirror session ends (selection dropped
  // below the 2-file mirror threshold). Routed through focusMutations so open
  // panels re-sync too. No-op when no session is active.
  const endMirrorSession = useCallback(() => {
    const prev = mirrorPrevFocus.current;
    if (prev === null) return;
    mirrorPrevFocus.current = null;
    void (async () => {
      try {
        await focusMutations.setFiles(prev, 'canvas');
        setFocusActive(prev);
        setBriefServedAt(undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
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
      const files = selectedNodes
        .filter((node) => (node.data as unknown as BadgeNodeData).kind !== 'folder')
        .map((node) => node.id);
      // Selection dropped below the 2-file mirror threshold → end the session and
      // restore the focus the mirror overwrote (deselect / narrow to one card).
      if (files.length < 2) endMirrorSession();
      if (selectedNodes.length === 0) {
        setCanvasSelection(null);
        return;
      }
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
    [setCanvasSelection, mirrorSelectionToFocus, endMirrorSession],
  );

  if (!current || currentReachable === false) {
    return (
      <Onboarding
        onAddFolder={() => void useWorkspaceStore.getState().pickAndAdd()}
        onTryDemo={() => void createDemoAtDefault()}
      />
    );
  }

  // Empty canvas → the GHOST NOTE CARD: a dashed card shaped like the real
  // file cards, sitting where the first card would. It doesn't describe the
  // product, it demonstrates it — click and it becomes a real `untitled.md`
  // in the user's folder (no filename dialog), open for typing. The caption
  // names the other first move: drop files in (they're copied, originals
  // stay put). Inside a folder scope the note is created in THAT folder.
  const showGhostCard = nodes.length === 0;

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
      mirrorPrevFocus.current = null; // explicit action — no deselect restore after
      await focusMutations.setFolder(folderScope, 'canvas'); // emit → panels refresh
      void reloadFocus(); // re-read focus → agent-context chip
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
    <div
      ref={canvasRootRef}
      style={{ width: '100%', height: '100%' }}
      // OS file drops land ON the map: copy into the workspace folder and
      // place the new card under the cursor. preventDefault (without
      // stopPropagation) marks the drop handled — App's catch-all sees
      // defaultPrevented, clears its overlay, and skips re-routing.
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files') || e.defaultPrevented) return;
        e.preventDefault();
        const rect = canvasRootRef.current?.getBoundingClientRect();
        const vp = viewportRef.current;
        // Screen → flow coordinates (the inverse of the viewport transform);
        // offset by half a default card so the card CENTERS on the cursor.
        const canvasPoint = rect
          ? {
              x: (e.clientX - rect.left - vp.x) / vp.zoom - DEFAULT_FILE_CARD_WIDTH / 2,
              y: (e.clientY - rect.top - vp.y) / vp.zoom - DEFAULT_FILE_CARD_HEIGHT / 2,
            }
          : undefined;
        void handleExternalDrop(droppedPaths(e.dataTransfer), { canvasPoint, folderScope });
      }}
    >
      {/* New note — top-right of the canvas (the top bar was removed). A real
          `untitled-N.md` opens for typing immediately (no filename dialog);
          inside a folder scope it's created in that folder. The agent-proposals
          chip (when an agent wrote observations back) sits to its left. */}
      <div
        style={{
          position: 'absolute',
          top: space[3],
          right: space[3],
          zIndex: 8,
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
        }}
      >
        <ProposalsChip current={current} />
        <Button
          onClick={() => void useWorkspaceStore.getState().newNote({ folder: folderScope })}
          title="Create a new note here (⌘N)"
        >
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
          <Button
            variant="ghost"
            onClick={() => void setFolderScope(parentScope(folderScope))}
            title="Up one level"
          >
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
              Agent Context ·{' '}
              <strong style={{ color: color.textPrimary, fontWeight: font.weight.semibold }}>
                {focusedCount}
              </strong>{' '}
              {focusedCount === 1 ? 'file' : 'files'} ·{' '}
              <span style={{ color: color.textPrimary }}>{focusedLabel}</span>
              {briefServedAt === undefined && (
                // No served receipt for the CURRENT brief = it changed since it
                // was last delivered through a channel bh can OBSERVE (Copy brief,
                // or a shell agent's `bh focus brief`). A raw in-repo file read is
                // invisible by design (D14), so this never claims the agent didn't
                // read it — only that no observable delivery is on record since the
                // last change. Honest wording, not "you forgot to send".
                <span
                  data-testid="focus-chip-updated"
                  title="Changed since the last delivery bh can see (Copy brief, or a shell agent running `bh focus brief`). An in-repo agent that reads the file directly is invisible here."
                  style={{ color: color.warning, whiteSpace: 'nowrap' }}
                >
                  {' '}
                  · not yet delivered
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
      {/* First-annotation invitation: a workspace full of files but ZERO badges
          is the product's null state — the brief the agent would read is empty,
          and nothing on a quiet canvas says why that matters. A file's badge
          (its prompt) is the agent-facing annotation; a "note" here is the file
          itself, never this. One dismissible card teaches the single act
          everything else builds on. It retires itself permanently the moment any
          badge is saved (the condition flips), so no dismissal state needs
          persisting. Root canvas only. */}
      {folderScope === null &&
        !workspaceHasAnyPrompt &&
        !annotateHintDismissed &&
        !showGhostCard &&
        nodes.length > 0 && (
          <div
            data-testid="annotate-hint-card"
            role="status"
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              maxWidth: 400,
              padding: `${space[4]}px ${space[5]}px`,
              background: color.surface,
              border: `1px solid ${color.accentSoft}`,
              borderRadius: radius.lg,
              boxShadow: shadow.raised,
              fontFamily: font.sans,
              fontSize: font.size.body,
              color: color.textSecondary,
              textAlign: 'center',
              lineHeight: 1.55,
              zIndex: 5,
              animation: `bh-banner-in ${motion.normal}`,
            }}
          >
            These files don't have badges yet. A file's badge — one honest sentence — is what your
            agent reads.
            <div
              style={{
                marginTop: space[3],
                display: 'flex',
                gap: space[2],
                justifyContent: 'center',
              }}
            >
              <Button
                variant="primary"
                onClick={() => {
                  // Root has direct files → SELECT the first one's card so the
                  // user spots its badge toggle (the badge now lives in the card,
                  // not a panel). Folder-only root (files all nested) → step INTO
                  // the first folder; its chrome takes it from there.
                  const firstFile = nodes.find((n) => n.data.kind === 'file');
                  if (firstFile) {
                    setNodes((ns) =>
                      ns.map((n) => {
                        const sel = n.id === firstFile.id;
                        return n.selected === sel ? n : { ...n, selected: sel };
                      }),
                    );
                    setCanvasSelection({ kind: 'file', files: [firstFile.id], source: 'canvas' });
                    return;
                  }
                  const firstFolder = nodes.find((n) => n.data.kind === 'folder');
                  if (firstFolder) void setFolderScope(firstFolder.id);
                }}
              >
                Add a badge
              </Button>
              <Button variant="ghost" onClick={() => setAnnotateHintDismissed(true)}>
                Not now
              </Button>
            </div>
          </div>
        )}
      {showGhostCard && <GhostNoteCard folderScope={folderScope} />}
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
        onNodeDragStop={onNodeDragStop}
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
        // stroke + accent-on-interaction styling AND draws its own arrowhead as
        // part of the same stroke (no marker — see ReferenceEdge), so the line
        // and its tip are one continuous pen stroke, not a triangle glued on.
        defaultEdgeOptions={{
          type: 'reference',
          animated: false,
        }}
        // The live drag previews the same side-midpoint snap that will be
        // saved on drop, so the line never appears to float beside a card.
        connectionLineComponent={CanvasConnectionLine}
        connectionLineStyle={{ stroke: color.accent, strokeWidth: 2 }}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={0.2}
        maxZoom={4}
        // Only mount nodes inside the viewport. A folder with many direct children
        // can hold lots of badges; without this, every one mounts (and every
        // markdown card's editor with it) even far off-screen. Nodes carry
        // initialWidth/initialHeight (see badgeToNode) so culling has bounds before
        // measurement. SUSPENDED while a card is being inline-edited, so a pan/zoom
        // can't cull the editing tile and cancel its unsaved autosave.
        onlyRenderVisibleElements={!cardEditing}
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

/**
 * The empty-canvas invitation: a dashed card SHAPED like the real file cards,
 * sitting where the first card would. It demonstrates the model instead of
 * describing it — click and it becomes a real `untitled.md` in the user's
 * folder (no filename dialog), open for typing; the dashed frame is the only
 * "ghost" about it. The caption names the other first move (drop files in —
 * copies, originals stay put). Inside a folder scope both paths target that
 * folder.
 */
const GhostNoteCard = ({ folderScope }: { folderScope: string | null }): JSX.Element => {
  const [hover, setHover] = useState(false);
  const where = folderScope ? `${folderScope}/` : 'your folder';
  // The sidebar FLOATS over the canvas's left edge, so "50% of the region"
  // can land partly underneath it (where its surface eats the click). Center
  // in the VISIBLE remainder instead — the same inset CanvasFramer applies
  // to fitView.
  const sidebarInset = useLayoutStore((s) => (s.sidebarOpen ? s.sidebarWidth : 0));
  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: `calc(50% + ${sidebarInset / 2}px)`,
        transform: 'translate(-50%, -50%)',
        zIndex: 5,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: space[3],
        // The column wrapper must not block canvas panning around the card;
        // the button itself re-enables hits.
        pointerEvents: 'none',
      }}
    >
      <button
        type="button"
        data-testid="ghost-note-card"
        onClick={() => void useWorkspaceStore.getState().newNote({ folder: folderScope })}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title="Create a note — a real Markdown file, ready to type into"
        style={{
          width: DEFAULT_FILE_CARD_WIDTH,
          height: DEFAULT_FILE_CARD_HEIGHT,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space[2],
          pointerEvents: 'auto',
          background: hover ? color.accentSofter : color.surface,
          border: `1.5px dashed ${hover ? color.accent : color.borderStrong}`,
          borderRadius: radius.lg,
          cursor: 'pointer',
          fontFamily: font.sans,
          color: hover ? color.accent : color.textPrimary,
          transition: transition(['background', 'border-color', 'color']),
        }}
      >
        <FileGlyph
          type={badgeType('untitled.md', false)}
          tone={hover ? color.accent : color.textTertiary}
          size={22}
        />
        <span style={{ fontSize: font.size.body, fontWeight: font.weight.medium }}>
          Write your first note
        </span>
        <span style={{ fontSize: font.size.caption, color: color.textTertiary }}>
          a real .md file in {where}
        </span>
      </button>
      <div
        style={{
          maxWidth: 340,
          textAlign: 'center',
          fontFamily: font.sans,
          fontSize: font.size.caption,
          color: color.textTertiary,
          lineHeight: 1.5,
        }}
      >
        …or drop files here — they're copied into {where}; the originals stay where they are.
      </div>
    </div>
  );
};

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
  // The sidebar FLOATS over the canvas's left, so `main` (and thus fitView's
  // frame) spans the full width INCLUDING the area the sidebar covers. Inset the
  // fit by the sidebar's width so a fresh fit lands content in the VISIBLE region
  // instead of tucked behind it. The right editor needs no such inset — it's a
  // docked flex sibling that already shrinks `main`. Read at fit time only; a
  // later toggle/resize does NOT re-fit (framedKey guard), so nothing shifts.
  const sidebarInset = useLayoutStore((s) => (s.sidebarOpen ? s.sidebarWidth : 0));
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
      const padding =
        sidebarInset > 0
          ? { top: 0.2, right: 0.2, bottom: 0.2, left: `${sidebarInset + 32}px` as `${number}px` }
          : 0.2;
      void fitView({ padding, maxZoom: 1, duration: 0 });
    }
  }, [frame, nodesInitialized, setViewport, fitView, getNodes, sidebarInset]);
  return null;
};
