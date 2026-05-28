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
          color: '#888',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 13,
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <div style={{ fontSize: 15, color: '#444', marginBottom: 6 }}>No workspace open</div>
          <div>Pick a folder from the top bar — BaseHalf will set up a badge for every file.</div>
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
