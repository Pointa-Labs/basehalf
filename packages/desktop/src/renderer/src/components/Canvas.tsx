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
  Controls,
  type Edge,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type NodeTypes,
  ReactFlow,
  type Viewport,
  applyNodeChanges,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspaceStore } from '../store/workspace.js';
import { BadgeNode, type BadgeNodeData } from './BadgeNode.js';

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
  const initialViewportRef = useRef<ViewportState | null>(null);

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
      initialViewportRef.current = vp;
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          fontFamily: 'system-ui, sans-serif',
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 520,
            background: '#fff',
            border: '1px solid #e8e8e8',
            borderRadius: 8,
            padding: '24px 28px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 600, color: '#222', marginBottom: 6 }}>
            Welcome to BaseHalf
          </div>
          <div style={{ fontSize: 13, color: '#666', marginBottom: 18, lineHeight: 1.5 }}>
            A local-first canvas for putting any file — PDFs, Markdown notes, images — onto a free
            board, tagging each one with a description for AI, and connecting them however you
            think.
          </div>

          <div
            style={{
              fontSize: 11,
              color: '#888',
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              marginBottom: 8,
            }}
          >
            Get started
          </div>
          <ol
            style={{
              margin: 0,
              padding: '0 0 0 18px',
              fontSize: 13,
              color: '#444',
              lineHeight: 1.7,
            }}
          >
            <li>
              Click <strong>+ Add folder</strong> in the top bar — pick any folder; your files stay
              where they are.
            </li>
            <li>Every file gets a badge on the canvas. Drag them around to organize.</li>
            <li>
              Open a file in the side panel; under <strong>Badge</strong>, add a prompt describing
              it for AI (e.g. <em>"chapter 3 — focus on theorem 2"</em>).
            </li>
            <li>
              Drag from one badge to another to connect them. Notes on a connection explain the
              relationship.
            </li>
          </ol>

          <div
            style={{
              marginTop: 16,
              padding: '8px 12px',
              background: '#fafafa',
              borderRadius: 4,
              fontSize: 11,
              color: '#777',
              lineHeight: 1.5,
            }}
          >
            BaseHalf works standalone, and is designed to sit on the right half of your screen with
            an AI agent on the left. Everything you set here gets published to{' '}
            <code style={{ fontFamily: 'ui-monospace, monospace' }}>.bh/</code> so any AI tool
            reading the folder can pick it up.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {error && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            background: '#fff0f0',
            border: '1px solid #fcc',
            padding: '4px 8px',
            fontSize: 12,
            color: '#a00',
            borderRadius: 4,
            zIndex: 10,
          }}
        >
          {error}
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
        defaultViewport={
          initialViewportRef.current
            ? {
                x: initialViewportRef.current.offsetX,
                y: initialViewportRef.current.offsetY,
                zoom: initialViewportRef.current.scale,
              }
            : { x: 0, y: 0, zoom: 1 }
        }
        minZoom={0.2}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} color="#eee" />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  );
};

// Re-export useReactFlow so children can re-center programmatically later.
export { useReactFlow };
