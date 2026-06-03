import { type ConnectionLineComponentProps, getBezierPath, useReactFlow } from '@xyflow/react';
import type { JSX } from 'react';
import { color } from '../design.js';
import { flowRootForNodeId, snappedNodeSideForClientPoint } from './domAnchors.js';
import { CANVAS_CONNECTION_SIDE_POSITION, type CanvasConnectionSide } from './geometry.js';

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
  toPosition,
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
  const targetPosition = snappedTarget
    ? CANVAS_CONNECTION_SIDE_POSITION[snappedTarget.side]
    : toPosition;
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <g className="bh-connection-preview" pointerEvents="none">
      <path
        className="bh-connection-preview-path"
        d={path}
        fill="none"
        style={{
          stroke: color.accent,
          strokeWidth: 2,
          ...connectionLineStyle,
        }}
      />
      {snappedTarget && (
        <circle
          className="bh-connection-preview-endpoint"
          cx={targetX}
          cy={targetY}
          r={5}
          fill={color.surface}
          stroke={color.accent}
          strokeWidth={2}
        />
      )}
    </g>
  );
}
