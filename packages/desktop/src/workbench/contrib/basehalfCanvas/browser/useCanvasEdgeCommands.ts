import type { Connection, Edge, Node } from '@xyflow/react';
import { useCallback, useMemo } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { flushSync } from 'react-dom';
import { workspaceService } from '../../../../platform/workspaces/browser/workspaceService.js';
import { badgeMutations } from '../../../services/mirror/browser/badgeMutations.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import type { BadgeNodeData } from './badge-node/badgeNodeModel.js';
import {
  CONNECTION_EDGE_SIZE_DEFAULTS,
  connectionEdges,
  nodeBadgeKind,
} from './canvas/canvasModel.js';
import {
  type ReferenceEdgeRemoval,
  type ReferenceEdgeUpdate,
  SIDE_TO_ANCHOR,
  applyReferenceEdgeUpdate,
  inferConnectionSides,
  removeReferenceEdgeUpdate,
  sideFromHandle,
} from './canvasConnections/index.js';

export interface CanvasEdgeCommands {
  readonly renderedEdges: Edge[];
  readonly onConnect: (connection: Connection) => Promise<void>;
  readonly onEdgesDelete: (deleted: Edge[]) => Promise<void>;
}

export function useCanvasEdgeCommands({
  edges,
  current,
  folderScope,
  nodesRef,
  setEdges,
  setError,
  setNodes,
}: {
  readonly edges: readonly Edge[];
  readonly current: string | null;
  readonly folderScope: string | null;
  readonly nodesRef: MutableRefObject<readonly Node<BadgeNodeData>[]>;
  readonly setEdges: Dispatch<SetStateAction<Edge[]>>;
  readonly setError: Dispatch<SetStateAction<string>>;
  readonly setNodes: Dispatch<SetStateAction<Node<BadgeNodeData>[]>>;
}): CanvasEdgeCommands {
  const stillShowingContext = useCallback(
    (workspace: string | null, folder: string | null): boolean => {
      const state = useWorkspaceStore.getState();
      return state.current === workspace && (state.folderScope ?? null) === folder;
    },
    [],
  );

  const resetReferenceEdgesFromCanvasListing = useCallback(
    async (workspace: string | null, folder: string | null): Promise<boolean> => {
      const { children, edges: canvasEdges } = await workspaceService.listCanvas(folder);
      if (!stillShowingContext(workspace, folder)) return false;
      setEdges(connectionEdges(canvasEdges, nodesRef.current));
      const refCounts = new Map(children.map((badge) => [badge.path, badge.references.length]));
      setNodes((prev) =>
        prev.map((node) => {
          const count = refCounts.get(node.id);
          if (count === undefined || node.data.notedRefs === count) return node;
          return { ...node, data: { ...node.data, notedRefs: count } };
        }),
      );
      return true;
    },
    [nodesRef, setEdges, setNodes, stillShowingContext],
  );

  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;
      const workspaceAtStart = current;
      const folderAtStart = folderScope;

      const fromSide = sideFromHandle(connection.sourceHandle);
      const toSide = sideFromHandle(connection.targetHandle);
      const sourceKind = nodeBadgeKind(nodesRef.current, connection.source);
      const inferred = inferConnectionSides(
        nodesRef.current.find((node) => node.id === connection.source),
        nodesRef.current.find((node) => node.id === connection.target),
        CONNECTION_EDGE_SIZE_DEFAULTS,
      );
      const fromSideFinal = fromSide ?? inferred.fromSide;
      const toSideFinal = toSide ?? inferred.toSide;

      flushSync(() => {
        setEdges((prev) =>
          applyReferenceEdgeUpdate(prev, {
            previousId: '',
            previousSource: connection.source as string,
            previousTarget: connection.target as string,
            source: connection.source as string,
            target: connection.target as string,
            sourceHandle: fromSideFinal,
            targetHandle: toSideFinal,
            label: undefined,
          }),
        );
      });

      try {
        await badgeMutations.connect(
          {
            folder: folderAtStart,
            from: connection.source,
            to: connection.target,
            from_anchor: SIDE_TO_ANCHOR[fromSideFinal],
            to_anchor: SIDE_TO_ANCHOR[toSideFinal],
            kind: sourceKind,
          },
          'canvas',
        );
        if (await resetReferenceEdgesFromCanvasListing(workspaceAtStart, folderAtStart)) {
          setError('');
        }
      } catch (err) {
        if (stillShowingContext(workspaceAtStart, folderAtStart)) {
          setError(err instanceof Error ? err.message : String(err));
          await resetReferenceEdgesFromCanvasListing(workspaceAtStart, folderAtStart).catch(
            () => undefined,
          );
        }
      }
    },
    [
      current,
      folderScope,
      nodesRef,
      resetReferenceEdgesFromCanvasListing,
      setEdges,
      setError,
      stillShowingContext,
    ],
  );

  const onEdgesDelete = useCallback(
    async (deleted: Edge[]) => {
      const workspaceAtStart = current;
      const folderAtStart = folderScope;
      const deletedIds = new Set(deleted.map((edge) => edge.id));
      setEdges((prev) => prev.filter((edge) => !deletedIds.has(edge.id)));
      try {
        for (const edge of deleted) {
          await badgeMutations.disconnect(
            { folder: folderAtStart, from: edge.source, to: edge.target },
            'canvas',
          );
        }
        await resetReferenceEdgesFromCanvasListing(workspaceAtStart, folderAtStart);
      } catch (err) {
        if (stillShowingContext(workspaceAtStart, folderAtStart)) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [
      current,
      folderScope,
      resetReferenceEdgesFromCanvasListing,
      setEdges,
      setError,
      stillShowingContext,
    ],
  );

  const commitReferenceEdgeUpdate = useCallback(
    (update: ReferenceEdgeUpdate): void => {
      const workspaceAtStart = current;
      const folderAtStart = folderScope;
      flushSync(() => {
        setEdges((prev) => applyReferenceEdgeUpdate(prev, update));
      });
      void (async () => {
        try {
          const inferred = inferConnectionSides(
            nodesRef.current.find((node) => node.id === update.source),
            nodesRef.current.find((node) => node.id === update.target),
            CONNECTION_EDGE_SIZE_DEFAULTS,
          );
          await badgeMutations.reconnect(
            {
              folder: folderAtStart,
              previous: { from: update.previousSource, to: update.previousTarget },
              next: {
                from: update.source,
                to: update.target,
                from_anchor: SIDE_TO_ANCHOR[update.sourceHandle ?? inferred.fromSide],
                to_anchor: SIDE_TO_ANCHOR[update.targetHandle ?? inferred.toSide],
                kind: nodeBadgeKind(nodesRef.current, update.source),
                ...(update.label !== undefined && { label: update.label }),
              },
            },
            'canvas',
          );
          if (await resetReferenceEdgesFromCanvasListing(workspaceAtStart, folderAtStart)) {
            setError('');
          }
        } catch (err) {
          if (stillShowingContext(workspaceAtStart, folderAtStart)) {
            setError(err instanceof Error ? err.message : String(err));
            await resetReferenceEdgesFromCanvasListing(workspaceAtStart, folderAtStart).catch(
              () => undefined,
            );
          }
        }
      })();
    },
    [
      current,
      folderScope,
      nodesRef,
      resetReferenceEdgesFromCanvasListing,
      setEdges,
      setError,
      stillShowingContext,
    ],
  );

  const commitReferenceEdgeRemoval = useCallback(
    (removal: ReferenceEdgeRemoval): void => {
      const workspaceAtStart = current;
      const folderAtStart = folderScope;
      flushSync(() => {
        setEdges((prev) => removeReferenceEdgeUpdate(prev, removal.id));
      });
      void (async () => {
        try {
          await badgeMutations.disconnect(
            { folder: folderAtStart, from: removal.source, to: removal.target },
            'canvas',
          );
          if (await resetReferenceEdgesFromCanvasListing(workspaceAtStart, folderAtStart)) {
            setError('');
          }
        } catch (err) {
          if (stillShowingContext(workspaceAtStart, folderAtStart)) {
            setError(err instanceof Error ? err.message : String(err));
            await resetReferenceEdgesFromCanvasListing(workspaceAtStart, folderAtStart).catch(
              () => undefined,
            );
          }
        }
      })();
    },
    [
      current,
      folderScope,
      resetReferenceEdgesFromCanvasListing,
      setEdges,
      setError,
      stillShowingContext,
    ],
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

  return { renderedEdges, onConnect, onEdgesDelete };
}
