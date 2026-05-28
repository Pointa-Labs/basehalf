import type {
  BadgeFile,
  BadgeListResult,
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

function badgeToNode(badge: BadgeFile, fallbackIndex: number): Node<BadgeNodeData> {
  const x = badge.canvas?.x ?? 60 + (fallbackIndex % 6) * 220;
  const y = badge.canvas?.y ?? 60 + Math.floor(fallbackIndex / 6) * 140;
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
  const [nodes, setNodes] = useState<Node<BadgeNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [error, setError] = useState<string>('');
  const initialViewportRef = useRef<ViewportState | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = (await window.bh.run('badge.list')) as BadgeListResult;
      setNodes(result.badges.map(badgeToNode));
      setEdges(badgesToEdges(result.badges));
      const vp = (await window.bh.run('workspace.getViewport', {})) as WorkspaceGetViewportResult;
      initialViewportRef.current = vp;
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (current && currentReachable) {
      void refresh();
    } else {
      setNodes([]);
      setEdges([]);
    }
  }, [current, currentReachable, refresh]);

  const persistPosition = useMemo(
    () =>
      debounce((file: string, x: number, y: number) => {
        void window.bh
          .run('badge.set', {
            file,
            patch: { canvas: { x, y, collapsed: false } },
          })
          .catch(() => {
            // Best-effort; surface via next refresh's load.
          });
      }, DRAG_DEBOUNCE),
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
      if (!additive) setCurrentFile(node.id);
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
      <div style={{ padding: 16, color: '#888', fontFamily: 'system-ui, sans-serif' }}>
        Pick a workspace folder above to begin.
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
      </ReactFlow>
    </div>
  );
};

// Re-export useReactFlow so children can re-center programmatically later.
export { useReactFlow };
