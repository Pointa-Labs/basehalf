import type { JSX } from 'react';
import { color, space } from '../../../browser/style/design.js';
import type { GitStashEntry } from '../common/git.js';
import type { GraphRow } from './gitGraphLayout.js';
import {
  FULL_GRAPH_ROW_HEIGHT,
  type FullGraphPath,
  fullGraphLaneColor,
  fullGraphLaneX,
} from './gitGraphViewModel.js';

export const FullGraphGraphSvg = ({
  graphWidth,
  rows,
  rowOffset,
  paths,
  hasUncommitted,
  stashByHash,
}: {
  graphWidth: number;
  rows: readonly GraphRow[];
  rowOffset: number;
  paths: readonly FullGraphPath[];
  hasUncommitted: boolean;
  stashByHash: ReadonlyMap<string, GitStashEntry>;
}): JSX.Element => (
  <svg
    width={graphWidth}
    height={(rows.length + rowOffset) * FULL_GRAPH_ROW_HEIGHT}
    style={{ position: 'absolute', top: 0, left: space[2], pointerEvents: 'none' }}
    aria-hidden
  >
    <title>commit graph</title>
    {paths.map((path) => (
      <path key={path.d} d={path.d} fill="none" stroke={path.c} strokeWidth={2} />
    ))}
    {hasUncommitted && <UncommittedNode rows={rows} />}
    {rows.map((row, index) => (
      <GraphNode
        key={row.commit.hash}
        row={row}
        index={index}
        rowOffset={rowOffset}
        isStash={stashByHash.has(row.commit.hash)}
      />
    ))}
  </svg>
);

const UncommittedNode = ({ rows }: { rows: readonly GraphRow[] }): JSX.Element | null => {
  const headRow = rows.findIndex((row) => row.commit.head);
  const lane = headRow !== -1 ? (rows[headRow]?.lane ?? 0) : 0;

  return (
    <circle
      cx={fullGraphLaneX(lane)}
      cy={FULL_GRAPH_ROW_HEIGHT / 2}
      r={4}
      fill={color.bg}
      stroke="#808080"
      strokeWidth={2}
      strokeDasharray="2 1.5"
    />
  );
};

const GraphNode = ({
  row,
  index,
  rowOffset,
  isStash,
}: {
  row: GraphRow;
  index: number;
  rowOffset: number;
  isStash: boolean;
}): JSX.Element => {
  const cy = (index + rowOffset) * FULL_GRAPH_ROW_HEIGHT + FULL_GRAPH_ROW_HEIGHT / 2;
  const cx = fullGraphLaneX(row.lane);
  const laneColor = fullGraphLaneColor(row.lane);

  if (isStash) {
    const size = 4;
    return (
      <rect
        x={cx - size}
        y={cy - size}
        width={size * 2}
        height={size * 2}
        transform={`rotate(45 ${cx} ${cy})`}
        fill={color.bg}
        stroke={color.warning}
        strokeWidth={2}
      />
    );
  }

  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill={row.commit.head ? color.bg : laneColor}
      stroke={laneColor}
      strokeWidth={row.commit.head ? 2 : 0}
    />
  );
};
