import { type JSX, useState } from 'react';
import { color, font, radius, space } from '../../../browser/style/design.js';
import type { GitCommit } from '../common/git.js';
import {
  FULL_GRAPH_ROW_HEIGHT,
  type FullGraphDateMode,
  type FullGraphRefKind,
  fullGraphDisplayRef,
  fullGraphFormatDate,
  fullGraphFormatWhen,
  fullGraphRefKind,
} from './gitGraphViewModel.js';

export const FullGraphCommitRow = ({
  commit,
  gridCols,
  localBranches,
  dateMode,
  stashRef,
  selected,
  highlighted,
  onSelect,
  onContextMenu,
  onRefMenu,
}: {
  commit: GitCommit;
  gridCols: string;
  localBranches: ReadonlySet<string>;
  dateMode: FullGraphDateMode;
  stashRef: string | undefined;
  selected: boolean;
  highlighted: boolean;
  onSelect: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onRefMenu: (
    event: React.MouseEvent,
    name: string,
    kind: FullGraphRefKind,
    targetRef: string,
  ) => void;
}): JSX.Element => {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role="button"
      tabIndex={0}
      style={{
        display: 'grid',
        gridTemplateColumns: gridCols,
        alignItems: 'center',
        height: FULL_GRAPH_ROW_HEIGHT,
        padding: `0 ${space[2]}px`,
        background: selected
          ? color.accentSofter
          : highlighted
            ? `${color.warning}26`
            : hover
              ? color.divider
              : 'transparent',
        cursor: 'pointer',
        fontFamily: font.sans,
        fontSize: font.size.caption,
      }}
    >
      <span />
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[1],
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {commit.head && <FullGraphPill text="HEAD" kind="head" />}
        {stashRef !== undefined && <FullGraphPill text={stashRef} kind="stash" />}
        {commit.refs.map((ref) => {
          const kind = fullGraphRefKind(ref, localBranches);
          return (
            <FullGraphPill
              key={ref}
              text={fullGraphDisplayRef(ref)}
              kind={kind}
              onContextMenu={(event) => onRefMenu(event, fullGraphDisplayRef(ref), kind, ref)}
            />
          );
        })}
        {commit.tags.map((tag) => (
          <FullGraphPill
            key={`tag:${tag}`}
            text={tag}
            kind="tag"
            onContextMenu={(event) => onRefMenu(event, tag, 'tag', `refs/tags/${tag}`)}
          />
        ))}
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: color.textPrimary,
          }}
        >
          {commit.subject}
        </span>
      </span>
      <span
        style={{ color: color.textTertiary, fontSize: font.size.micro }}
        title={dateMode === 'relative' ? fullGraphFormatDate(commit.author.date) : undefined}
      >
        {fullGraphFormatWhen(commit.author.date, dateMode)}
      </span>
      <span
        style={{
          color: color.textSecondary,
          fontSize: font.size.micro,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {commit.author.name}
      </span>
      <span style={{ color: color.textTertiary, fontFamily: font.mono, fontSize: font.size.micro }}>
        {commit.shortHash}
      </span>
    </div>
  );
};

const FullGraphPill = ({
  text,
  kind,
  onContextMenu,
}: {
  text: string;
  kind: 'head' | 'branch' | 'remote' | 'tag' | 'stash';
  onContextMenu?: (event: React.MouseEvent) => void;
}): JSX.Element => {
  const label = kind === 'tag' ? text.replace(/^tag:\s*/, '') : text;
  const bg =
    kind === 'head'
      ? color.accent
      : kind === 'tag'
        ? `${color.warning}33`
        : kind === 'stash'
          ? color.surfaceMuted
          : kind === 'remote'
            ? color.surface
            : color.accentSofter;
  const fg =
    kind === 'head'
      ? color.onAccent
      : kind === 'tag'
        ? color.warning
        : kind === 'stash'
          ? color.textSecondary
          : kind === 'remote'
            ? color.textTertiary
            : color.accent;
  return (
    <span
      onContextMenu={onContextMenu}
      style={{
        flexShrink: 0,
        padding: `0 ${space[1]}px`,
        background: bg,
        color: fg,
        border: kind === 'remote' || kind === 'stash' ? `1px solid ${color.border}` : 'none',
        borderRadius: radius.sm,
        fontFamily: font.mono,
        fontSize: font.size.micro,
        lineHeight: '16px',
        maxWidth: 160,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        cursor: onContextMenu && kind !== 'head' ? 'context-menu' : undefined,
      }}
    >
      {kind === 'tag' ? `🏷 ${label}` : kind === 'stash' ? `📦 ${label}` : label}
    </span>
  );
};
