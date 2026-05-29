import type {
  BadgeFile,
  BadgeListResult,
  SavedView,
  ViewportState,
  WorkspaceGetViewportResult,
} from '@basehalf/core';
import {
  Background,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  type Viewport,
  applyNodeChanges,
  useNodesInitialized,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { color, font, motion, radius, shadow, space } from '../design.js';
import { createDemoAtDefault, promptForNewNote } from '../lib/actions.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { BadgeNode, type BadgeNodeData } from './BadgeNode.js';
import { CanvasControls } from './CanvasControls.js';
import { Onboarding } from './Onboarding.js';
import { ViewFilePicker } from './ViewFilePicker.js';
import { Button } from './primitives/Button.js';

const NODE_TYPES: NodeTypes = { badge: BadgeNode };
const DRAG_DEBOUNCE = 300;
const VIEWPORT_DEBOUNCE = 1000;

function badgeToNode(
  badge: BadgeFile,
  fallbackIndex: number,
  override?: { x?: number; y?: number },
): Node<BadgeNodeData> {
  // Auto-layout grid for badges without a saved position. Content TILES are
  // taller than the old bare labels, so rows need more vertical room — but keep
  // the column pitch tight so badges stay within the viewport (React-flow can't
  // scroll an off-screen node into view). Saved positions win.
  const x = override?.x ?? badge.canvas?.x ?? 60 + (fallbackIndex % 6) * 220;
  const y = override?.y ?? badge.canvas?.y ?? 60 + Math.floor(fallbackIndex / 6) * 250;
  return {
    id: badge.file,
    type: 'badge',
    position: { x, y },
    data: {
      label: badge.file,
      kind: badge.kind,
      ...(badge.orphan === true && { orphan: true }),
      ...(badge.prompt !== undefined && { prompt: badge.prompt }),
    },
  };
}

function badgesToEdges(badges: readonly BadgeFile[]): Edge[] {
  const out: Edge[] = [];
  const known = new Set(badges.map((b) => b.file));
  for (const badge of badges) {
    for (const ref of badge.references) {
      // Only draw edges to badges we can render — silently skip orphan refs
      // until view-level "broken ref" surfacing lands.
      if (!known.has(ref.to)) continue;
      out.push({
        id: `${badge.file}__${ref.to}`,
        source: badge.file,
        target: ref.to,
        animated: false,
        ...(ref.note !== undefined && { label: ref.note }),
      });
    }
  }
  return out;
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

export const Canvas = (): JSX.Element => {
  const current = useWorkspaceStore((s) => s.current);
  const currentReachable = useWorkspaceStore((s) => s.currentReachable);
  const setCurrentFile = useWorkspaceStore((s) => s.setCurrentFile);
  const currentView = useWorkspaceStore((s) => s.currentView);
  const folderScope = useWorkspaceStore((s) => s.folderScope);
  const setFolderScope = useWorkspaceStore((s) => s.setFolderScope);
  const [nodes, setNodes] = useState<Node<BadgeNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [error, setError] = useState<string>('');
  // Add-files-to-view picker (the missing "door" into a saved view).
  const [pickerOpen, setPickerOpen] = useState(false);
  // Persisted viewport for the current workspace, lifted into state so
  // CanvasFramer (rendered inside <ReactFlow>) frames the canvas after each
  // async refresh: it RESTORES the saved viewport when one exists, or FITS to
  // all badges when none does (fresh workspace / demo) so nothing is hidden
  // off-screen. react-flow's defaultViewport is read ONCE on mount, before
  // refresh resolves — relying on it alone snapped users back to (0,0,1) and
  // left first-run badges spilling past the right edge. `seq` bumps per
  // refresh so the framer re-runs; `vp` is the viewport already resolved for
  // THAT refresh, so a saved viewport is never mistaken for "none" mid-load.
  const [frame, setFrame] = useState<{ seq: number; vp: ViewportState | null } | null>(null);
  // The current focus set (what the agent reads from .bh/focus.md). Surfaced
  // on the canvas so the curation payoff is visible, not invisible.
  const [focused, setFocused] = useState<ReadonlySet<string>>(() => new Set());

  const refresh = useCallback(async () => {
    try {
      const result = (await window.bh.run('badge.list')) as BadgeListResult;
      let badges = result.badges;
      const memberPositions = new Map<string, { x?: number; y?: number }>();

      if (currentView !== null) {
        const view = (await window.bh.run('view.get', { id: currentView })) as SavedView | null;
        if (view) {
          const memberFiles = new Set(view.members.map((m) => m.file));
          badges = badges.filter((b) => memberFiles.has(b.file));
          for (const m of view.members) {
            memberPositions.set(m.file, {
              ...(m.x !== undefined && { x: m.x }),
              ...(m.y !== undefined && { y: m.y }),
            });
          }
        } else {
          badges = [];
        }
      } else if (folderScope !== null) {
        const prefix = `${folderScope}/`;
        badges = badges.filter((b) => b.file === folderScope || b.file.startsWith(prefix));
      }

      const focusResult = (await window.bh.run('focus.get', {})) as { active: string[] };
      const focusedSet = new Set(focusResult.active);
      setFocused(focusedSet);
      setNodes(
        badges.map((b, i) => {
          const override = memberPositions.get(b.file);
          const node = badgeToNode(b, i, override);
          node.data.focused = focusedSet.has(b.file);
          return node;
        }),
      );
      setEdges(badgesToEdges(badges));
      const vp = (await window.bh.run('workspace.getViewport', {})) as WorkspaceGetViewportResult;
      setFrame((prev) => ({ seq: (prev?.seq ?? 0) + 1, vp }));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [currentView, folderScope]);

  useEffect(() => {
    if (current && currentReachable) {
      void refresh();
    } else {
      setNodes([]);
      setEdges([]);
    }
  }, [current, currentReachable, refresh]);

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

  const onNodeDoubleClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      const data = node.data as unknown as BadgeNodeData;
      if (data.kind === 'folder') {
        // Folder scoping is a main-canvas concept. Inside a saved view it
        // would create an inconsistent state — the toolbar shows "/folder"
        // scope chrome while the canvas still renders the view (currentView
        // wins in refresh) — so a folder badge double-click is a no-op there.
        if (currentView !== null) return;
        setFolderScope(node.id);
        return;
      }
      // File badge → open the full editor overlay. Single-click only sets
      // focus (keeps the canvas + focus viz visible so you can assemble a
      // focus set by clicking around); opening the big editor is the
      // deliberate double-click, matching the desktop select-vs-open idiom.
      setCurrentFile(node.id);
    },
    [currentView, setFolderScope, setCurrentFile],
  );

  const persistPosition = useMemo(
    () =>
      debounce((file: string, x: number, y: number) => {
        // In view mode, position is per-view (view.addMember stores per-file
        // x/y on the SavedView, leaving the main-canvas badge.canvas alone).
        // In main canvas / folder scope, drag updates the badge's canonical
        // position via badge.set.
        if (currentView !== null) {
          void window.bh
            .run('view.addMember', { id: currentView, file, position: { x, y } })
            .catch(() => undefined);
        } else {
          void window.bh
            .run('badge.set', { file, patch: { canvas: { x, y, collapsed: false } } })
            .catch(() => undefined);
        }
      }, DRAG_DEBOUNCE),
    [currentView],
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
      setNodes((prev) => applyNodeChanges(changes, prev));
      for (const change of changes) {
        if (change.type === 'position' && change.dragging === false && change.position) {
          persistPosition(change.id, change.position.x, change.position.y);
        }
      }
    },
    [persistPosition],
  );

  const onConnect = useCallback(async (conn: Connection) => {
    if (!conn.source || !conn.target) return;
    try {
      await window.bh.run('badge.addRef', { file: conn.source, to: conn.target });
      // Refresh so the new edge shows + inbound index updates ripple to other views.
      const result = (await window.bh.run('badge.list')) as BadgeListResult;
      setEdges(badgesToEdges(result.badges));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Edge deletion: react-flow selects-then-Delete-key flow gives us the
  // removed edges here. Each edge's id is `${source}__${target}` (see
  // badgesToEdges) so we can derive the badge.removeRef args from id alone.
  const onEdgesDelete = useCallback(async (deleted: Edge[]) => {
    try {
      for (const e of deleted) {
        await window.bh.run('badge.removeRef', { file: e.source, to: e.target });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Node deletion: in view mode, Delete removes the badge from the *view*
  // (not from disk — that would lose the file). On the main canvas, Delete
  // is a no-op for safety: a v0 user shouldn't be able to delete a file via
  // an accidental keystroke, and removing the badge JSON alone would just
  // get re-materialized on next refresh.
  const onNodesDelete = useCallback(
    async (deleted: Node[]) => {
      if (currentView === null) return;
      try {
        for (const n of deleted) {
          await window.bh.run('view.removeMember', { id: currentView, file: n.id });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [currentView],
  );

  const onNodeClick = useCallback<NodeMouseHandler>(
    (event, node) => {
      const additive = event.shiftKey;
      // Single-click manages FOCUS only — it never opens the editor. Opening
      // is the double-click (onNodeDoubleClick). This keeps the canvas and the
      // focus viz visible while you assemble a focus set by clicking badges.
      void (async () => {
        try {
          if (additive) {
            const cur = (await window.bh.run('focus.get', {})) as { active: string[] };
            const next = cur.active.includes(node.id) ? cur.active : [...cur.active, node.id];
            await window.bh.run('focus.set', { files: next });
          } else {
            await window.bh.run('focus.set', { files: [node.id] });
          }
          // Re-read the authoritative focus set and reflect it on the canvas so
          // the human SEES exactly what the agent now reads.
          const after = (await window.bh.run('focus.get', {})) as { active: string[] };
          const set = new Set(after.active);
          setFocused(set);
          setNodes((prev) =>
            prev.map((n) => ({ ...n, data: { ...n.data, focused: set.has(n.id) } })),
          );
        } catch {
          // Best-effort.
        }
      })();
    },
    // setFocused / setNodes are stable; nothing else external is referenced.
    [],
  );

  const clearFocus = useCallback(() => {
    void window.bh.run('focus.clear', {}).catch(() => undefined);
    setFocused(new Set());
    setNodes((prev) =>
      prev.map((n) => (n.data.focused ? { ...n, data: { ...n.data, focused: false } } : n)),
    );
  }, []);

  const onMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => {
      persistViewport({ offsetX: viewport.x, offsetY: viewport.y, scale: viewport.zoom });
    },
    [persistViewport],
  );

  if (!current || currentReachable === false) {
    return (
      <Onboarding
        onAddFolder={() => void useWorkspaceStore.getState().pickAndAdd()}
        onTryDemo={() => void createDemoAtDefault()}
      />
    );
  }

  // Pick the empty-canvas hint based on why nothing's showing:
  // a freshly-opened workspace with no supported files vs an active
  // saved view with no members yet vs a folder scope with no children.
  // (We don't show the hint if a badge exists; the canvas speaks for itself.)
  // The main-canvas case also surfaces a "Create a note" CTA so the user
  // has a single-click path out of the empty state instead of having to
  // discover Cmd+N or the topbar.
  type EmptyHint = { readonly text: string; readonly cta?: 'new-note' | 'add-to-view' };
  const emptyHint: EmptyHint | null =
    nodes.length === 0
      ? currentView !== null
        ? {
            text: 'This view is empty. Add files to gather them here — their positions are saved per-view, so a view can pull together files from different folders.',
            cta: 'add-to-view',
          }
        : folderScope !== null
          ? {
              text: `No badges inside ${folderScope}/ yet. Drop files into this folder; they'll appear automatically.`,
            }
          : {
              text: "This workspace has no files yet. Drop files in the folder and they'll appear as badges — or create one now:",
              cta: 'new-note',
            }
      : null;

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {focused.size > 0 && (
        // Witnessed payoff: name the context the human handed the agent. The
        // focus set was previously a write-only side effect with no visible
        // trace — now the human can SEE (and clear) what their agent reads.
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
          <span style={{ display: 'flex', alignItems: 'center', gap: space[1.5] }}>
            <span
              aria-hidden
              style={{ width: 8, height: 8, borderRadius: '50%', background: color.accent }}
            />
            <strong style={{ color: color.textPrimary, fontWeight: font.weight.semibold }}>
              {focused.size}
            </strong>
            {focused.size === 1 ? 'file' : 'files'} in focus — your agent reads{' '}
            {focused.size === 1 ? 'this' : 'these'}
          </span>
          <button
            type="button"
            onClick={clearFocus}
            title="Clear focus"
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
        </div>
      )}
      {error && (
        <div
          style={{
            position: 'absolute',
            top: space[3],
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
          {emptyHint.cta === 'add-to-view' && (
            <div style={{ marginTop: space[3] }}>
              <Button
                variant="primary"
                onClick={() => setPickerOpen(true)}
                data-testid="view-add-files-cta"
              >
                Add files
              </Button>
            </div>
          )}
        </div>
      )}
      {/* In a non-empty view, a quiet affordance to add more files (the
          empty-view card is gone once members exist). */}
      {currentView !== null && nodes.length > 0 && (
        <div style={{ position: 'absolute', top: space[3], left: space[3], zIndex: 6 }}>
          <Button
            variant="default"
            onClick={() => setPickerOpen(true)}
            data-testid="view-add-files"
          >
            + Add files
          </Button>
        </div>
      )}
      {pickerOpen && currentView !== null && (
        <ViewFilePicker
          viewId={currentView}
          existing={new Set(nodes.map((n) => n.id))}
          onClose={() => setPickerOpen(false)}
          onAdded={() => void refresh()}
        />
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onNodesDelete={onNodesDelete}
        deleteKeyCode={['Delete', 'Backspace']}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onMoveEnd={onMoveEnd}
        defaultEdgeOptions={{
          style: { stroke: color.textGhost, strokeWidth: 1.5 },
          // Animated edges feel jittery on a busy canvas; keep them static
          // and let selection style do the talking.
          // Label styling — reference notes render here. The default is a
          // hard-edged white rectangle; tokenize it so it reads like the
          // rest of the chrome (surface + subtle border + secondary text).
          labelStyle: {
            fontSize: font.size.micro,
            fontFamily: font.sans,
            fill: color.textSecondary,
            fontWeight: font.weight.medium,
          },
          labelShowBg: true,
          labelBgStyle: {
            fill: color.surface,
            fillOpacity: 0.95,
            stroke: color.border,
            strokeWidth: 1,
          },
          labelBgPadding: [4, 8],
          labelBgBorderRadius: radius.sm,
        }}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={0.2}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color={color.border} />
        <CanvasControls />
        <CanvasFramer frame={frame} />
      </ReactFlow>
    </div>
  );
};

// Re-export useReactFlow so children can re-center programmatically later.
export { useReactFlow };

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
}: { frame: { seq: number; vp: ViewportState | null } | null }): null => {
  const { setViewport, fitView, getNodes } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const appliedSeq = useRef(-1);
  useEffect(() => {
    if (!frame || !nodesInitialized) return;
    if (appliedSeq.current === frame.seq) return;
    appliedSeq.current = frame.seq;
    if (frame.vp) {
      setViewport({ x: frame.vp.offsetX, y: frame.vp.offsetY, zoom: frame.vp.scale });
    } else if (getNodes().length > 0) {
      void fitView({ padding: 0.2, maxZoom: 1, duration: 0 });
    }
  }, [frame, nodesInitialized, setViewport, fitView, getNodes]);
  return null;
};
