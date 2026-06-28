import {
  type Node,
  type NodeChange,
  type OnNodeDrag,
  type Viewport,
  applyNodeChanges,
} from '@xyflow/react';
import { useCallback, useMemo } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { canvasMirrorService } from '../../../services/mirror/browser/canvasMirrorService.js';
import { mirrorWritesSuspended } from '../../../services/mirror/browser/mirrorWrites.js';
import type { BadgeKind } from '../../../services/mirror/common/badge.js';
import {
  type BadgeNodeData,
  CARD_MIN_HEIGHT,
  CARD_MIN_WIDTH,
  DEFAULT_FILE_CARD_HEIGHT,
  DEFAULT_FILE_CARD_WIDTH,
  DEFAULT_FOLDER_CARD_HEIGHT,
  DEFAULT_FOLDER_CARD_WIDTH,
} from './badge-node/badgeNodeModel.js';
import {
  DRAG_DEBOUNCE,
  RESIZE_DEBOUNCE,
  cardHeight,
  cardWidth,
  keyedDebounce,
  nodeBadgeKind,
} from './canvas/canvasModel.js';
import {
  SNAP_GUIDE_SCREEN_THRESHOLD,
  sameSnapGuides,
  snapFlowNodeChanges,
} from './canvasFlowSnap.js';
import type { CanvasSnapGuide } from './canvasSnap.js';

export interface CanvasNodeCommands {
  readonly onNodesChange: (changes: NodeChange<Node<BadgeNodeData>>[]) => void;
  readonly onNodeDragStart: OnNodeDrag<Node<BadgeNodeData>>;
  readonly onNodeDragStop: OnNodeDrag<Node<BadgeNodeData>>;
}

export function useCanvasNodeCommands({
  folderScopeRef,
  setNodes,
  setSnapGuides,
  viewportRef,
}: {
  readonly folderScopeRef: MutableRefObject<string | null>;
  readonly setNodes: Dispatch<SetStateAction<Node<BadgeNodeData>[]>>;
  readonly setSnapGuides: Dispatch<SetStateAction<readonly CanvasSnapGuide[]>>;
  readonly viewportRef: MutableRefObject<Viewport>;
}): CanvasNodeCommands {
  // `folder` is captured by the caller at drag/resize-end so a debounced flush
  // that lands after a fast folder switch still writes to the canvas where the
  // gesture happened, not the folder now on screen.
  const persistCanvas = useMemo(
    () =>
      keyedDebounce(
        (
          file: string,
          folder: string | null,
          kind: BadgeKind,
          x: number,
          y: number,
          width?: number,
          height?: number,
        ) => {
          const w =
            width ?? (kind === 'folder' ? DEFAULT_FOLDER_CARD_WIDTH : DEFAULT_FILE_CARD_WIDTH);
          const h =
            height ?? (kind === 'folder' ? DEFAULT_FOLDER_CARD_HEIGHT : DEFAULT_FILE_CARD_HEIGHT);
          if (mirrorWritesSuspended()) return;
          void canvasMirrorService
            .setCard(folder, { path: file, kind, x, y, width: w, height: h })
            .catch(() => undefined);
        },
        DRAG_DEBOUNCE,
      ),
    [],
  );

  const persistSize = useMemo(
    () =>
      keyedDebounce(
        (
          file: string,
          folder: string | null,
          kind: BadgeKind,
          x: number,
          y: number,
          width: number,
          height: number,
        ) => {
          if (mirrorWritesSuspended()) return;
          void canvasMirrorService
            .setCard(folder, { path: file, kind, x, y, width, height })
            .catch(() => undefined);
        },
        RESIZE_DEBOUNCE,
      ),
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
            const node = next.find((candidate) => candidate.id === change.id);
            const kind = nodeBadgeKind(next, change.id);
            persistCanvas(
              change.id,
              folderScopeRef.current,
              kind,
              change.position.x,
              change.position.y,
              cardWidth(node),
              cardHeight(node),
            );
          }
          if (change.type === 'dimensions' && change.resizing === false && change.dimensions) {
            const node = next.find((candidate) => candidate.id === change.id);
            const at = node?.position;
            if (at) {
              persistSize(
                change.id,
                folderScopeRef.current,
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
    [folderScopeRef, persistCanvas, persistSize, setNodes, setSnapGuides, viewportRef],
  );

  const onNodeDragStart = useCallback<OnNodeDrag<Node<BadgeNodeData>>>(() => {
    setSnapGuides([]);
  }, [setSnapGuides]);

  const onNodeDragStop = useCallback<OnNodeDrag<Node<BadgeNodeData>>>(() => {
    setSnapGuides([]);
  }, [setSnapGuides]);

  return { onNodesChange, onNodeDragStart, onNodeDragStop };
}
