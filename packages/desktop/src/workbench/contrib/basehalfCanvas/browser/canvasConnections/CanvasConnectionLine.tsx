import { type ConnectionLineComponentProps, useReactFlow } from '@xyflow/react';
import type { JSX } from 'react';
import { color } from '../../../../browser/style/design.js';
import { arrowheadPath } from './arrowhead.js';
import { flowRootForNodeId, snappedNodeSideForClientPoint } from './domAnchors.js';
import { CANVAS_CONNECTION_POSITION_SIDE, type CanvasConnectionSide } from './geometry.js';
import { curvedReferencePath } from './referenceCurve.js';

type SnappedConnectionTarget = {
  readonly x: number;
  readonly y: number;
  readonly side: CanvasConnectionSide;
};

function snappedTargetForFlowPoint({
  flowPoint,
  flowRoot,
  flowToScreenPosition,
  sourceNodeId,
  screenToFlowPosition,
}: {
  readonly flowPoint: { x: number; y: number };
  readonly flowRoot: HTMLElement;
  readonly flowToScreenPosition: (point: { x: number; y: number }) => { x: number; y: number };
  readonly sourceNodeId: string;
  readonly screenToFlowPosition: (point: { x: number; y: number }) => { x: number; y: number };
}): SnappedConnectionTarget | null {
  const { x: clientX, y: clientY } = flowToScreenPosition(flowPoint);
  const snapped = snappedNodeSideForClientPoint({
    clientX,
    clientY,
    excludedNodeIds: [sourceNodeId],
    flowRoot,
  });
  if (!snapped) return null;
  const target = screenToFlowPosition(snapped.clientPoint);
  return { x: target.x, y: target.y, side: snapped.side };
}

export function CanvasConnectionLine({
  connectionLineStyle,
  fromNode,
  fromPosition,
  fromX,
  fromY,
  toX,
  toY,
}: ConnectionLineComponentProps): JSX.Element {
  const { flowToScreenPosition, screenToFlowPosition } = useReactFlow();
  const flowRoot = flowRootForNodeId(fromNode.id);
  const snappedTarget = flowRoot
    ? snappedTargetForFlowPoint({
        flowPoint: { x: toX, y: toY },
        flowRoot,
        flowToScreenPosition,
        sourceNodeId: fromNode.id,
        screenToFlowPosition,
      })
    : null;
  const targetX = snappedTarget?.x ?? toX;
  const targetY = snappedTarget?.y ?? toY;
  // Same side-anchored spline + line-following arrowhead the committed edge
  // draws: it leaves the source's handle side perpendicular and (once snapped)
  // arrives perpendicular to the target side, so the preview reads identically
  // to the edge it will become.
  const curve = curvedReferencePath(fromX, fromY, targetX, targetY, {
    sourceSide: CANVAS_CONNECTION_POSITION_SIDE[fromPosition],
    targetSide: snappedTarget?.side,
  });
  const head = arrowheadPath({ x: targetX, y: targetY }, curve.endDir);

  return (
    <g className="bh-connection-preview" pointerEvents="none">
      <path
        className="bh-connection-preview-path"
        d={curve.path}
        fill="none"
        style={{
          stroke: color.accent,
          strokeWidth: 2,
          ...connectionLineStyle,
        }}
      />
      {head && <path d={head} fill={color.accent} stroke="none" />}
    </g>
  );
}
