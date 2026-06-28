import type { JSX, MouseEvent } from 'react';
import { color, font, space } from '../../../browser/style/design.js';
import type { GitCommit, GitStashEntry } from '../common/git.js';
import { FullGraphCommitRow } from './FullGraphCommitRow.js';
import { FullGraphGraphSvg } from './FullGraphGraphSvg.js';
import type { GraphRow } from './gitGraphLayout.js';
import {
  FULL_GRAPH_ROW_HEIGHT,
  type FullGraphDateMode,
  type FullGraphPath,
  type FullGraphRefKind,
} from './gitGraphViewModel.js';

export const FullGraphHistoryTable = ({
  error,
  commits,
  rows,
  loading,
  done,
  graphWidth,
  gridColumns,
  dateMode,
  onToggleDateMode,
  hasUncommitted,
  uncommitted,
  paths,
  stashByHash,
  localBranches,
  trackingLocalBranches,
  selected,
  isHighlighted,
  onOpenUncommitted,
  onSelectCommit,
  onCommitContextMenu,
  onRefContextMenu,
  onLoadMore,
}: {
  error: string | null;
  commits: readonly GitCommit[];
  rows: readonly GraphRow[];
  loading: boolean;
  done: boolean;
  graphWidth: number;
  gridColumns: string;
  dateMode: FullGraphDateMode;
  onToggleDateMode: () => void;
  hasUncommitted: boolean;
  uncommitted: number;
  paths: readonly FullGraphPath[];
  stashByHash: ReadonlyMap<string, GitStashEntry>;
  localBranches: ReadonlySet<string>;
  trackingLocalBranches: ReadonlyMap<string, string>;
  selected: string | null;
  isHighlighted: (commit: GitCommit) => boolean;
  onOpenUncommitted: () => void;
  onSelectCommit: (hash: string) => void;
  onCommitContextMenu: (event: MouseEvent, commit: GitCommit, stashRef: string | undefined) => void;
  onRefContextMenu: (
    event: MouseEvent,
    name: string,
    kind: FullGraphRefKind,
    targetRef: string,
    trackingLocal: string | undefined,
  ) => void;
  onLoadMore: () => void;
}): JSX.Element => (
  <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
    <FullGraphTableHeader
      gridColumns={gridColumns}
      dateMode={dateMode}
      onToggleDateMode={onToggleDateMode}
    />

    {error !== null ? (
      <div style={{ padding: space[4], color: color.danger }}>{error}</div>
    ) : commits.length === 0 ? (
      <div style={{ padding: space[4], color: color.textTertiary }}>
        {loading ? 'Loading commit history…' : 'No commits yet.'}
      </div>
    ) : (
      <div style={{ position: 'relative' }}>
        <FullGraphGraphSvg
          graphWidth={graphWidth}
          rows={rows}
          rowOffset={hasUncommitted ? 1 : 0}
          paths={paths}
          hasUncommitted={hasUncommitted}
          stashByHash={stashByHash}
        />
        {hasUncommitted && (
          <FullGraphUncommittedRow
            gridColumns={gridColumns}
            uncommitted={uncommitted}
            onOpen={onOpenUncommitted}
          />
        )}
        {rows.map((row) => {
          const stashRef = stashByHash.get(row.commit.hash)?.ref;
          return (
            <FullGraphCommitRow
              key={row.commit.hash}
              commit={row.commit}
              gridCols={gridColumns}
              localBranches={localBranches}
              trackingLocalBranches={trackingLocalBranches}
              dateMode={dateMode}
              stashRef={stashRef}
              selected={selected === row.commit.hash}
              highlighted={isHighlighted(row.commit)}
              onSelect={() => onSelectCommit(row.commit.hash)}
              onContextMenu={(event) => onCommitContextMenu(event, row.commit, stashRef)}
              onRefMenu={onRefContextMenu}
            />
          );
        })}
      </div>
    )}

    {!done && commits.length > 0 && (
      <button
        type="button"
        disabled={loading}
        onClick={onLoadMore}
        style={{
          width: '100%',
          padding: space[2],
          background: 'none',
          border: 'none',
          borderTop: `1px solid ${color.divider}`,
          color: color.textTertiary,
          fontFamily: font.sans,
          fontSize: font.size.caption,
          cursor: loading ? 'default' : 'pointer',
        }}
      >
        {loading ? 'Loading…' : 'Load More'}
      </button>
    )}
  </div>
);

const FullGraphTableHeader = ({
  gridColumns,
  dateMode,
  onToggleDateMode,
}: {
  gridColumns: string;
  dateMode: FullGraphDateMode;
  onToggleDateMode: () => void;
}): JSX.Element => (
  <div
    style={{
      position: 'sticky',
      top: 0,
      zIndex: 2,
      display: 'grid',
      gridTemplateColumns: gridColumns,
      alignItems: 'center',
      height: FULL_GRAPH_ROW_HEIGHT,
      padding: `0 ${space[2]}px`,
      background: color.surfaceMuted,
      borderBottom: `1px solid ${color.border}`,
      color: color.textTertiary,
      fontFamily: font.sans,
      fontSize: font.size.micro,
      fontWeight: font.weight.semibold,
      letterSpacing: font.trackedCaps,
      textTransform: 'uppercase',
      userSelect: 'none',
    }}
  >
    <span>Graph</span>
    <span>Description</span>
    <button
      type="button"
      onClick={onToggleDateMode}
      title={dateMode === 'absolute' ? 'Switch to relative time' : 'Switch to absolute date'}
      style={{
        all: 'unset',
        cursor: 'pointer',
        color: 'inherit',
        font: 'inherit',
        letterSpacing: 'inherit',
        textTransform: 'inherit',
      }}
    >
      Date{dateMode === 'relative' ? ' ▾' : ''}
    </button>
    <span>Author</span>
    <span>Commit</span>
  </div>
);

const FullGraphUncommittedRow = ({
  gridColumns,
  uncommitted,
  onOpen,
}: {
  gridColumns: string;
  uncommitted: number;
  onOpen: () => void;
}): JSX.Element => (
  <button
    type="button"
    onClick={onOpen}
    style={{
      display: 'grid',
      gridTemplateColumns: gridColumns,
      alignItems: 'center',
      width: '100%',
      height: FULL_GRAPH_ROW_HEIGHT,
      padding: `0 ${space[2]}px`,
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      textAlign: 'left',
      fontFamily: font.sans,
      fontSize: font.size.caption,
    }}
  >
    <span />
    <span style={{ color: color.warning, fontStyle: 'italic' }}>
      ● Uncommitted Changes ({uncommitted})
    </span>
    <span />
    <span />
    <span
      style={{
        color: color.textGhost,
        fontFamily: font.mono,
        fontSize: font.size.micro,
      }}
    >
      *
    </span>
  </button>
);
