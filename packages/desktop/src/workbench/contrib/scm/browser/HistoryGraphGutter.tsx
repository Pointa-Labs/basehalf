import type { JSX } from 'react';
import { color } from '../../../browser/style/design.js';
import type { GraphRow } from '../common/gitGraphLayout.js';
import {
  CIRCLE_RADIUS,
  CIRCLE_STROKE_WIDTH,
  SWIMLANE_CURVE_RADIUS,
  SWIMLANE_HEIGHT,
  historyLaneColor,
  historyLaneX,
} from './historyGraphModel.js';

interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly lane: number;
}

export const HistoryGraphGutter = ({
  row,
  width,
}: {
  row: GraphRow;
  width: number;
}): JSX.Element => {
  const mid = SWIMLANE_HEIGHT / 2;
  const nodeLane = row.lane;
  const segments: Segment[] = [];

  row.lanesBefore.forEach((hash, lane) => {
    if (hash === null) return;
    const toLane = hash === row.commit.hash ? nodeLane : lane;
    segments.push({
      x1: historyLaneX(lane),
      y1: 0,
      x2: historyLaneX(toLane),
      y2: mid,
      lane: toLane,
    });
  });

  row.lanesAfter.forEach((hash, lane) => {
    if (hash === null) return;
    if (row.lanesBefore[lane] === hash && lane !== nodeLane) {
      segments.push({
        x1: historyLaneX(lane),
        y1: mid,
        x2: historyLaneX(lane),
        y2: SWIMLANE_HEIGHT,
        lane,
      });
    }
  });

  for (const lane of row.outgoing) {
    segments.push({
      x1: historyLaneX(nodeLane),
      y1: mid,
      x2: historyLaneX(lane),
      y2: SWIMLANE_HEIGHT,
      lane,
    });
  }

  const nodeColor = historyLaneColor(nodeLane);
  const isMerge = row.commit.parents.length > 1;

  return (
    <svg
      width={width}
      height={SWIMLANE_HEIGHT}
      style={{ flexShrink: 0, display: 'block' }}
      aria-hidden
    >
      {segments.map((segment, index) => (
        <path
          // biome-ignore lint/suspicious/noArrayIndexKey: graph segments are positional.
          key={index}
          d={segmentPath(segment)}
          fill="none"
          stroke={historyLaneColor(segment.lane)}
          strokeLinecap="round"
          strokeWidth={1}
        />
      ))}
      {row.commit.head ? (
        <>
          <circle
            cx={historyLaneX(nodeLane)}
            cy={mid}
            r={CIRCLE_RADIUS + 3}
            fill={nodeColor}
            stroke={nodeColor}
            strokeWidth={CIRCLE_STROKE_WIDTH}
          />
          <circle cx={historyLaneX(nodeLane)} cy={mid} r={CIRCLE_STROKE_WIDTH} fill={color.bg} />
        </>
      ) : isMerge ? (
        <>
          <circle
            cx={historyLaneX(nodeLane)}
            cy={mid}
            r={CIRCLE_RADIUS + 2}
            fill={nodeColor}
            stroke={color.bg}
            strokeWidth={CIRCLE_STROKE_WIDTH}
          />
          <circle cx={historyLaneX(nodeLane)} cy={mid} r={CIRCLE_RADIUS - 1} fill={color.bg} />
        </>
      ) : (
        <circle
          cx={historyLaneX(nodeLane)}
          cy={mid}
          r={CIRCLE_RADIUS + 1}
          fill={nodeColor}
          stroke={color.bg}
          strokeWidth={CIRCLE_STROKE_WIDTH}
        />
      )}
    </svg>
  );
};

function segmentPath({ x1, y1, x2, y2 }: Segment): string {
  if (x1 === x2) return `M ${x1} ${y1} V ${y2}`;

  const r = Math.min(SWIMLANE_CURVE_RADIUS, Math.abs(x2 - x1) / 2);
  const direction = x2 > x1 ? 1 : -1;
  const midY = (y1 + y2) / 2;

  return [
    `M ${x1} ${y1}`,
    `V ${Math.max(y1, midY - r)}`,
    `C ${x1} ${midY} ${x1 + direction * r} ${midY} ${x1 + direction * r} ${midY}`,
    `H ${x2 - direction * r}`,
    `C ${x2} ${midY} ${x2} ${midY + r} ${x2} ${y2}`,
  ].join(' ');
}
