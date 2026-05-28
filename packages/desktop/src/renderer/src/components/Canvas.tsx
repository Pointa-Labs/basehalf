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
import { Button } from './primitives/Button.js';

const NODE_TYPES: NodeTypes = { badge: BadgeNode };
const DRAG_DEBOUNCE = 300;
const VIEWPORT_DEBOUNCE = 1000;

function badgeToNode(
  badge: BadgeFile,
  fallbackIndex: number,
  override?: { x?: number; y?: number },
): Node<BadgeNodeData> {
  const x = override?.x ?? badge.canvas?.x ?? 60 + (fallbackIndex % 6) * 220;
  const y = override?.y ?? badge.canvas?.y ?? 60 + Math.floor(fallbackIndex / 6) * 140;
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
  // Persisted viewport for the current workspace, lifted into state so
  // ViewportSyncer (rendered inside <ReactFlow>) can imperatively call
  // setViewport() after the async refresh completes. react-flow's
  // defaultViewport is read ONCE on mount, before refresh has populated
  // the viewport — relying on it alone snapped users back to (0,0,1)
  // every window reload.
  const [persistedViewport, setPersistedViewport] = useState<ViewportState | null>(null);

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

      setNodes(
        badges.map((b, i) => {
          const override = memberPositions.get(b.file);
          return badgeToNode(b, i, override);
        }),
      );
      setEdges(badgesToEdges(badges));
      const vp = (await window.bh.run('workspace.getViewport', {})) as WorkspaceGetViewportResult;
      setPersistedViewport(vp);
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

  const onNodeDoubleClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      // Folder badge double-click → scope canvas to that folder.
      const data = node.data as unknown as BadgeNodeData;
      if (data.kind === 'folder') {
        setFolderScope(node.id);
      }
    },
    [setFolderScope],
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
      const data = node.data as unknown as BadgeNodeData;
      // Folders aren't previewable — double-click scopes into them instead.
      // Without this guard, clicking a folder opens the "No built-in viewer
      // for this file type" pane, which is confusing.
      if (!additive && data.kind !== 'folder') setCurrentFile(node.id);
      void (async () => {
        try {
          if (additive) {
            const cur = (await window.bh.run('focus.get', {})) as { active: string[] };
            const next = cur.active.includes(node.id) ? cur.active : [...cur.active, node.id];
            await window.bh.run('focus.set', { files: next });
          } else {
            await window.bh.run('focus.set', { files: [node.id] });
          }
        } catch {
          // Best-effort.
        }
      })();
    },
    [setCurrentFile],
  );

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
  type EmptyHint = { readonly text: string; readonly cta?: 'new-note' };
  const emptyHint: EmptyHint | null =
    nodes.length === 0
      ? currentView !== null
        ? {
            text: 'This view has no badges yet. Drag a badge from the main canvas (clear the View dropdown above) into here — its position will be saved per-view.',
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
        </div>
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
        <ViewportSyncer vp={persistedViewport} />
      </ReactFlow>
    </div>
  );
};

// Re-export useReactFlow so children can re-center programmatically later.
export { useReactFlow };

/**
 * Imperatively applies the persisted viewport once it loads. Rendered
 * inside <ReactFlow> so useReactFlow() has a provider. Effect deps are
 * the primitive viewport fields so we only call setViewport when the
 * stored values actually change — same-value re-applies (on view /
 * folder-scope refresh) are no-ops since deps don't shift.
 */
const ViewportSyncer = ({ vp }: { vp: ViewportState | null }): null => {
  const { setViewport } = useReactFlow();
  // Pull primitive fields up so we can list them as deps individually;
  // biome's useExhaustiveDependencies flags optional-chain dependencies
  // as "more specific than the capture".
  const x = vp?.offsetX;
  const y = vp?.offsetY;
  const zoom = vp?.scale;
  useEffect(() => {
    if (x !== undefined && y !== undefined && zoom !== undefined) {
      setViewport({ x, y, zoom });
    }
  }, [x, y, zoom, setViewport]);
  return null;
};
