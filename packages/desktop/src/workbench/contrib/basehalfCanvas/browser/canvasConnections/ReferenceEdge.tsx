import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  type Node,
  useReactFlow,
} from '@xyflow/react';
import { type JSX, type PointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import { color, font, motion, radius, shadow, space } from '../../../../browser/style/design.js';
import { isImeComposing } from '../../../../browser/ui/imeGuard.js';
import { arrowheadPath } from './arrowhead.js';
import {
  type SnappedCanvasNodeSide,
  flowRootForNodeId,
  snappedNodeSideForClientPoint,
} from './domAnchors.js';
import { type ReferenceEdgeRemoval, type ReferenceEdgeUpdate, sideFromHandle } from './edges.js';
import { type CanvasConnectionSide, connectionPointForBoxSide } from './geometry.js';
import { curvedReferencePath } from './referenceCurve.js';

const RECONNECT_DRAG_THRESHOLD = 4;
const EDGE_RECONNECTING_CURSOR_CLASS = 'bh-edge-reconnecting';

let edgeReconnectCursorLocks = 0;

type EdgeReconnectEnd = 'source' | 'target';

type EdgeReconnectState = {
  readonly end: EdgeReconnectEnd;
  readonly pointerId: number;
  readonly started: boolean;
  readonly startClient: { readonly x: number; readonly y: number };
  readonly currentClient: { readonly x: number; readonly y: number };
  readonly snapped: SnappedCanvasNodeSide | null;
};

type ReferenceEdgeInteractionData = {
  readonly onReferenceEdgeUpdate?: (update: ReferenceEdgeUpdate) => void;
  readonly onReferenceEdgeRemove?: (removal: ReferenceEdgeRemoval) => void;
};

function lockEdgeReconnectCursor(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  edgeReconnectCursorLocks += 1;
  if (edgeReconnectCursorLocks === 1) {
    document.body.classList.add(EDGE_RECONNECTING_CURSOR_CLASS);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    edgeReconnectCursorLocks = Math.max(0, edgeReconnectCursorLocks - 1);
    if (edgeReconnectCursorLocks === 0) {
      document.body.classList.remove(EDGE_RECONNECTING_CURSOR_CLASS);
    }
  };
}

function dimension(value: Node['width'] | NonNullable<Node['style']>['width']): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function connectionPointForNode(
  node: Node | undefined,
  side: CanvasConnectionSide | undefined,
  fallback: { readonly x: number; readonly y: number },
): { x: number; y: number } {
  const width = dimension(node?.width) ?? dimension(node?.style?.width);
  const height = dimension(node?.height) ?? dimension(node?.style?.height);
  if (!node || !side || width === null || height === null) return fallback;
  return connectionPointForBoxSide({ x: node.position.x, y: node.position.y, width, height }, side);
}

function nearestPathRatio(path: SVGPathElement, clientX: number, clientY: number): number {
  const ctm = path.getScreenCTM();
  const total = path.getTotalLength();
  if (!ctm || total <= 0) return 1;

  let bestLength = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  const samples = 80;
  for (let i = 0; i <= samples; i += 1) {
    const length = (total * i) / samples;
    const point = path.getPointAtLength(length);
    const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(ctm);
    const distance = Math.hypot(screenPoint.x - clientX, screenPoint.y - clientY);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestLength = length;
    }
  }

  return bestLength / total;
}

// A reference edge between two badges. The line is always visible; the note
// reveals on hover/selection so shared endpoints do not become a pile of labels.
export const ReferenceEdge = ({
  id,
  source,
  sourceHandleId,
  sourceX,
  sourceY,
  target,
  targetHandleId,
  targetX,
  targetY,
  label,
  selected,
  data,
}: EdgeProps): JSX.Element => {
  const { getNode, screenToFlowPosition } = useReactFlow();
  const [hover, setHover] = useState(false);
  const [reconnect, setReconnect] = useState<EdgeReconnectState | null>(null);
  // Inline label editing — double-click the line, type WHY these two connect,
  // Enter. The label is the edge's whole value to the brief (an arrow without
  // one ships structure but no meaning), so writing it must not cost a trip
  // through the badge panel. Commits through the same canvas.reconnect path a
  // reconnect drag uses (endpoints unchanged, label swapped).
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const noteInputRef = useRef<HTMLTextAreaElement>(null);
  const hitPathRef = useRef<SVGPathElement>(null);
  const releaseReconnectCursorRef = useRef<(() => void) | null>(null);
  const interactionData = data as ReferenceEdgeInteractionData | undefined;
  const sourcePoint = connectionPointForNode(getNode(source), sideFromHandle(sourceHandleId), {
    x: sourceX,
    y: sourceY,
  });
  const targetPoint = connectionPointForNode(getNode(target), sideFromHandle(targetHandleId), {
    x: targetX,
    y: targetY,
  });
  const sourceSide = sideFromHandle(sourceHandleId);
  const targetSide = sideFromHandle(targetHandleId);
  // A spline that leaves the source side and arrives at the target side both
  // perpendicular (see referenceCurve), so the line stays anchored to its card
  // edges; its end tangent IS that perpendicular approach, so the arrowhead
  // oriented to it sits dead-on the curve — no kink, no stub.
  const staticCurve = curvedReferencePath(
    sourcePoint.x,
    sourcePoint.y,
    targetPoint.x,
    targetPoint.y,
    { sourceSide, targetSide },
  );
  const edgePath = staticCurve.path;
  const active = hover || selected === true;
  const note = typeof label === 'string' && label.length > 0 ? label : undefined;
  const reconnecting = reconnect?.started === true;
  const reconnectPoint = reconnect?.started
    ? reconnect.snapped
      ? screenToFlowPosition(reconnect.snapped.clientPoint)
      : screenToFlowPosition({ x: reconnect.currentClient.x, y: reconnect.currentClient.y })
    : null;
  const previewSourcePoint =
    reconnect?.end === 'source' && reconnectPoint ? reconnectPoint : sourcePoint;
  const previewTargetPoint =
    reconnect?.end === 'target' && reconnectPoint ? reconnectPoint : targetPoint;
  const previewSourceSide = reconnect?.end === 'source' ? reconnect.snapped?.side : sourceSide;
  const previewTargetSide = reconnect?.end === 'target' ? reconnect.snapped?.side : targetSide;
  const displayCurve = reconnecting
    ? curvedReferencePath(
        previewSourcePoint.x,
        previewSourcePoint.y,
        previewTargetPoint.x,
        previewTargetPoint.y,
        { sourceSide: previewSourceSide, targetSide: previewTargetSide },
      )
    : staticCurve;
  const displayPath = displayCurve.path;
  const displayLabelX = displayCurve.labelX;
  const displayLabelY = displayCurve.labelY;
  const applyLocalReconnect = useCallback(
    (end: EdgeReconnectEnd, snapped: SnappedCanvasNodeSide | null): void => {
      if (!snapped) {
        interactionData?.onReferenceEdgeRemove?.({ id, source, target });
        return;
      }

      const fromSide = sideFromHandle(sourceHandleId);
      const toSide = sideFromHandle(targetHandleId);
      const nextSource = end === 'source' ? snapped.nodeId : source;
      const nextTarget = end === 'target' ? snapped.nodeId : target;
      if (nextSource === nextTarget) return;

      interactionData?.onReferenceEdgeUpdate?.({
        previousId: id,
        previousSource: source,
        previousTarget: target,
        source: nextSource,
        target: nextTarget,
        sourceHandle: end === 'source' ? snapped.side : fromSide,
        targetHandle: end === 'target' ? snapped.side : toSide,
        label: note,
      });
    },
    [id, interactionData, note, source, sourceHandleId, target, targetHandleId],
  );

  const beginNoteEdit = useCallback((): void => {
    setNoteDraft(note ?? '');
    setEditingNote(true);
    // Focus once the textarea mounts (the editor renders on the next commit).
    requestAnimationFrame(() => noteInputRef.current?.focus());
  }, [note]);

  const commitNoteEdit = useCallback((): void => {
    setEditingNote(false);
    const next = noteDraft.trim();
    if (next === (note ?? '')) return; // unchanged (including still-empty)
    interactionData?.onReferenceEdgeUpdate?.({
      previousId: id,
      previousSource: source,
      previousTarget: target,
      source,
      target,
      sourceHandle: sourceSide,
      targetHandle: targetSide,
      label: next === '' ? undefined : next,
    });
  }, [id, interactionData, note, noteDraft, source, sourceSide, target, targetSide]);

  const beginReconnect = (event: PointerEvent<SVGPathElement>): void => {
    if (event.button !== 0) return;
    if (editingNote) return;
    const path = hitPathRef.current;
    if (!path) return;

    event.preventDefault();
    event.stopPropagation();
    releaseReconnectCursorRef.current?.();
    releaseReconnectCursorRef.current = lockEdgeReconnectCursor();
    const ratio = nearestPathRatio(path, event.clientX, event.clientY);
    setReconnect({
      end: ratio < 0.5 ? 'source' : 'target',
      pointerId: event.pointerId,
      started: false,
      startClient: { x: event.clientX, y: event.clientY },
      currentClient: { x: event.clientX, y: event.clientY },
      snapped: null,
    });
  };

  const endReconnectGesture = useCallback((): void => {
    releaseReconnectCursorRef.current?.();
    releaseReconnectCursorRef.current = null;
    setReconnect(null);
  }, []);

  useEffect(
    () => () => {
      releaseReconnectCursorRef.current?.();
      releaseReconnectCursorRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!reconnect) return;

    const snappedForEvent = (event: globalThis.PointerEvent): SnappedCanvasNodeSide | null => {
      const flowRoot = flowRootForNodeId(source);
      return flowRoot
        ? snappedNodeSideForClientPoint({
            clientX: event.clientX,
            clientY: event.clientY,
            excludedNodeIds: reconnect.end === 'source' ? [target] : [source],
            flowRoot,
          })
        : null;
    };

    const onPointerMove = (event: globalThis.PointerEvent): void => {
      if (event.pointerId !== reconnect.pointerId) return;
      const moved =
        Math.hypot(
          event.clientX - reconnect.startClient.x,
          event.clientY - reconnect.startClient.y,
        ) >= RECONNECT_DRAG_THRESHOLD;
      const started = reconnect.started || moved;

      setReconnect({
        ...reconnect,
        started,
        currentClient: { x: event.clientX, y: event.clientY },
        snapped: started ? snappedForEvent(event) : null,
      });
    };

    const onPointerUp = (event: globalThis.PointerEvent): void => {
      if (event.pointerId !== reconnect.pointerId) return;
      const started =
        reconnect.started ||
        Math.hypot(
          event.clientX - reconnect.startClient.x,
          event.clientY - reconnect.startClient.y,
        ) >= RECONNECT_DRAG_THRESHOLD;
      const snapped = started ? snappedForEvent(event) : null;
      if (!started) {
        endReconnectGesture();
        return;
      }
      applyLocalReconnect(reconnect.end, snapped);
      endReconnectGesture();
    };

    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    return () => {
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
    };
  }, [applyLocalReconnect, endReconnectGesture, reconnect, source, target]);

  // Arrowhead oriented to the curve's exact end tangent, tip on the curve's end
  // point — line runs up its centre. (No round linecap: it would poke a hair
  // past the tip.)
  const lineColor = reconnecting || active ? color.accent : color.textGhost;
  const head = arrowheadPath(reconnecting ? previewTargetPoint : targetPoint, displayCurve.endDir);
  return (
    <>
      <BaseEdge
        id={id}
        path={reconnecting ? displayPath : edgePath}
        style={{
          stroke: lineColor,
          strokeWidth: reconnecting || active ? 2 : 1.5,
          transition: `stroke ${motion.fast}, stroke-width ${motion.fast}`,
        }}
      />
      {head && (
        <path
          d={head}
          fill={lineColor}
          stroke="none"
          style={{ transition: `fill ${motion.fast}` }}
        />
      )}
      <path
        ref={hitPathRef}
        className="bh-edge-hit"
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        tabIndex={0}
        role="button"
        aria-label={
          note
            ? `Reference from ${source} to ${target}: ${note}. Press Enter to edit this note.`
            : `Reference from ${source} to ${target}. Press Enter to add a note.`
        }
        style={{ pointerEvents: 'stroke', cursor: 'grab' }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        onPointerDown={beginReconnect}
        onKeyDown={(event) => {
          if (isImeComposing(event)) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            if (!reconnect) beginNoteEdit();
          } else if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            event.stopPropagation();
            interactionData?.onReferenceEdgeRemove?.({ id, source, target });
          }
        }}
        onDoubleClick={(event) => {
          // Double-click = annotate, right where the relationship is visible.
          // Stop the canvas's zoom-on-double-click from eating the gesture.
          event.preventDefault();
          event.stopPropagation();
          if (reconnect) return; // never open the editor mid-reconnect-drag
          beginNoteEdit();
        }}
      />
      {editingNote ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan nowheel"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${displayLabelX}px, ${displayLabelY}px)`,
              pointerEvents: 'all',
              zIndex: 10,
            }}
          >
            <textarea
              ref={noteInputRef}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onBlur={commitNoteEdit}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation(); // Delete/Backspace must edit text, not delete the edge
                if (isImeComposing(e)) return; // Enter/Esc belong to the IME mid-composition
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  commitNoteEdit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditingNote(false); // cancel — draft discarded
                }
              }}
              rows={2}
              placeholder="Say why these connect"
              aria-label="Reference note — why these files connect"
              data-testid={`edge-note-input-${id}`}
              style={{
                width: 220,
                resize: 'none',
                boxSizing: 'border-box',
                padding: `${space[1]}px ${space[2]}px`,
                borderRadius: radius.md,
                background: color.surface,
                border: `1px solid ${color.accent}`,
                boxShadow: shadow.raised,
                fontSize: font.size.micro,
                fontFamily: font.sans,
                color: color.textPrimary,
                lineHeight: 1.45,
                outline: 'none',
              }}
            />
          </div>
        </EdgeLabelRenderer>
      ) : (
        (active || hover) && (
          <EdgeLabelRenderer>
            <div
              title={note ? 'Double-click the line to edit this note' : undefined}
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${displayLabelX}px, ${displayLabelY}px)`,
                pointerEvents: 'none',
                padding: `${space[0.5]}px ${space[2]}px`,
                borderRadius: radius.sm,
                background: color.surface,
                border: `1px solid ${color.border}`,
                boxShadow: shadow.card,
                fontSize: font.size.micro,
                fontFamily: font.sans,
                fontWeight: font.weight.medium,
                color: note ? color.textSecondary : color.textTertiary,
                whiteSpace: 'nowrap',
                maxWidth: 240,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                ...(note ? {} : { fontStyle: 'italic' }),
              }}
            >
              {/* No note yet → the hover label itself teaches the gesture. */}
              {note ?? 'Double-click to say why'}
            </div>
          </EdgeLabelRenderer>
        )
      )}
    </>
  );
};
