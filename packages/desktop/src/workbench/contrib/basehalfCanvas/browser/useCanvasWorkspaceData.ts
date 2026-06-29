import type { Edge, Node } from '@xyflow/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { fileEventService } from '../../../../platform/files/browser/fileEventService.js';
import { subscribeBadgeChange } from '../../../services/mirror/browser/badgeBus.js';
import { badgeService } from '../../../services/mirror/browser/badgeService.js';
import {
  type WorkspaceCanvasViewportState,
  workspaceCanvasDataService,
} from '../../../services/workspace/browser/workspaceCanvasDataService.js';
import {
  subscribeEntryRemoved,
  subscribeEntryRenamed,
} from '../../../services/workspace/common/workspaceFileEvents.js';
import type { BadgeNodeData } from './badge-node/badgeNodeModel.js';
import { clearPreviewCache } from './badge-node/badgePreviewCache.js';
import {
  badgeToNode,
  connectionEdges,
  coverageForFolder,
  viewportForCanvasFrame,
} from './canvas/canvasModel.js';
import { referenceEdgeId } from './canvasConnections/index.js';
import type { CanvasSnapGuide } from './canvasSnap.js';

export interface CanvasWorkspaceDataState {
  readonly nodes: Node<BadgeNodeData>[];
  readonly edges: Edge[];
  readonly snapGuides: readonly CanvasSnapGuide[];
  readonly error: string;
  readonly truncated: number;
  readonly frame: { key: string; vp: WorkspaceCanvasViewportState | null } | null;
}

export interface CanvasWorkspaceDataModel extends CanvasWorkspaceDataState {
  readonly nodesRef: MutableRefObject<readonly Node<BadgeNodeData>[]>;
  readonly loadData: () => Promise<void>;
  readonly setNodes: Dispatch<SetStateAction<Node<BadgeNodeData>[]>>;
  readonly setEdges: Dispatch<SetStateAction<Edge[]>>;
  readonly setSnapGuides: Dispatch<SetStateAction<readonly CanvasSnapGuide[]>>;
  readonly setError: Dispatch<SetStateAction<string>>;
}

export function useCanvasWorkspaceData({
  current,
  currentReachable,
  currentWorkspaceViewport,
  folderScope,
  rootViewportRef,
}: {
  readonly current: string | null;
  readonly currentReachable: boolean | null;
  readonly currentWorkspaceViewport: WorkspaceCanvasViewportState | null;
  readonly folderScope: string | null;
  readonly rootViewportRef: MutableRefObject<WorkspaceCanvasViewportState | null>;
}): CanvasWorkspaceDataModel {
  const [nodes, setNodes] = useState<Node<BadgeNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [snapGuides, setSnapGuides] = useState<readonly CanvasSnapGuide[]>([]);
  const [error, setError] = useState<string>('');
  const [truncated, setTruncated] = useState(0);
  const [frame, setFrame] = useState<{
    key: string;
    vp: WorkspaceCanvasViewportState | null;
  } | null>(null);
  const loadContextKey = `${current ?? ''}\0${currentReachable ?? ''}\0${folderScope ?? ''}`;
  const nodesRef = useRef<readonly Node<BadgeNodeData>[]>([]);
  const loadSeqRef = useRef(0);
  const loadContextKeyRef = useRef(loadContextKey);

  if (loadContextKeyRef.current !== loadContextKey) {
    loadContextKeyRef.current = loadContextKey;
    loadSeqRef.current += 1;
  }

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const loadData = useCallback(async () => {
    // Staleness guard: a workspace/folder switch mid-flight must not let the OLD
    // load's late resolution clobber the NEW context's nodes.
    const seq = ++loadSeqRef.current;
    const fresh = (): boolean => seq === loadSeqRef.current;
    try {
      const {
        children,
        edges: canvasEdges,
        truncated: held,
      } = await workspaceCanvasDataService.listCanvas(folderScope);
      if (!fresh()) return;
      const nextNodes = children.map((badge, index) => badgeToNode(badge, index, children.length));
      setNodes(nextNodes);
      setTruncated(held ?? 0);
      setEdges(connectionEdges(canvasEdges, nextNodes));
      setSnapGuides([]);
      setFrame({
        key: `${current}|${folderScope ?? ''}`,
        vp: viewportForCanvasFrame(
          folderScope,
          rootViewportRef.current ?? currentWorkspaceViewport,
        ),
      });
      setError('');
      if (!fresh()) return;

      try {
        const badgesAll = await badgeService.list();
        const prompted = new Set(
          badgesAll
            .filter(
              (badge) =>
                badge.kind === 'file' &&
                badge.description !== undefined &&
                badge.description.trim() !== '',
            )
            .map((badge) => badge.path),
        );
        let filesAll: string[] = [];
        if (children.some((badge) => badge.kind === 'folder')) {
          filesAll = [...(await workspaceCanvasDataService.listSupportedFiles(null))];
        }
        if (!fresh()) return;
        if (filesAll.length > 0) {
          setNodes((prev) =>
            prev.map((node) => {
              const data = node.data as unknown as BadgeNodeData;
              if (data.kind !== 'folder') return node;
              const coverage = coverageForFolder(node.id, filesAll, prompted);
              if (coverage === undefined) return node;
              return { ...node, data: { ...data, coverage } };
            }),
          );
        }
      } catch {
        // Indicators degrade (no coverage bars) — cards stay.
      }
    } catch (err) {
      if (!fresh()) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [current, currentWorkspaceViewport, folderScope, rootViewportRef]);

  // Drop cached previews when the active workspace changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `current` is the intentional re-run trigger; the body clears per-workspace caches and reads nothing.
  useEffect(() => {
    clearPreviewCache();
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

  // Reload when out-of-app badge edits touch the derived mirror.
  useEffect(() => {
    if (!current || !currentReachable) return;
    let lastBadgeRev = '';
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const rev = await badgeService.revision();
          const sig = `${rev.count}:${rev.maxMtimeMs}`;
          if (lastBadgeRev === '') {
            lastBadgeRev = sig;
          } else if (sig !== lastBadgeRev) {
            lastBadgeRev = sig;
            void loadData();
          }
        } catch {
          /* transient — keep the last known values */
        }
      })();
    }, 5000);
    return () => window.clearInterval(id);
  }, [current, currentReachable, loadData]);

  useEffect(() => {
    let fastTimer: ReturnType<typeof setTimeout> | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let lastUnlinkAt = 0;
    const unsub = fileEventService.onDidChangeFiles((event) => {
      if (event.type === 'change') return;
      if (event.type === 'unlink') lastUnlinkAt = Date.now();
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => void loadData(), 1100);
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

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = subscribeBadgeChange((origin) => {
      if (origin === 'canvas') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void loadData(), 250);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [loadData]);

  useEffect(() => {
    return subscribeEntryRemoved((path) => {
      setNodes((prev) => prev.filter((node) => node.id !== path));
      setEdges((prev) => prev.filter((edge) => edge.source !== path && edge.target !== path));
    });
  }, []);

  useEffect(() => {
    return subscribeEntryRenamed((from, to) => {
      setNodes((prev) =>
        prev.map((node) =>
          node.id === from ? { ...node, id: to, data: { ...node.data, label: to } } : node,
        ),
      );
      setEdges((prev) =>
        prev.map((edge) => {
          if (edge.source !== from && edge.target !== from) return edge;
          const source = edge.source === from ? to : edge.source;
          const target = edge.target === from ? to : edge.target;
          return { ...edge, source, target, id: referenceEdgeId(source, target) };
        }),
      );
    });
  }, []);

  return {
    nodes,
    edges,
    snapGuides,
    error,
    truncated,
    frame,
    nodesRef,
    loadData,
    setNodes,
    setEdges,
    setSnapGuides,
    setError,
  };
}
