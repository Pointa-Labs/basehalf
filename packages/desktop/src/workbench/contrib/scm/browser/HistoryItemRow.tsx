import { type JSX, useState } from 'react';
import { color, font, space, transition } from '../../../browser/style/design.js';
import { Codicon } from '../../../browser/ui/Codicon.js';
import type { GitCommit } from '../common/git.js';
import type { GraphRow } from '../common/gitGraphLayout.js';
import { HistoryGraphGutter } from './HistoryGraphGutter.js';
import { HistoryItemDetails } from './HistoryItemDetails.js';
import {
  HISTORY_REF_COLORS,
  type HistoryRefTone,
  SWIMLANE_HEIGHT,
  historyRefTone,
  historyTimeAgo,
} from './historyGraphModel.js';
import { scm } from './styles.js';

export const HistoryItemRow = ({
  row,
  gutterWidth,
  expanded,
  onToggle,
  localBranches,
  onMutate,
}: {
  row: GraphRow;
  gutterWidth: number;
  expanded: boolean;
  onToggle: () => void;
  localBranches: ReadonlySet<string>;
  onMutate: () => Promise<void> | void;
}): JSX.Element => {
  const { commit } = row;
  const [hover, setHover] = useState(false);
  const label = historyItemLabel(commit);

  return (
    <div data-commit={commit.hash}>
      <button
        type="button"
        onClick={onToggle}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        aria-expanded={expanded}
        title={label}
        style={{
          width: '100%',
          height: scm.rowHeight,
          display: 'flex',
          alignItems: 'center',
          padding: 0,
          background: expanded ? scm.selectedBg : hover ? scm.hoverBg : 'transparent',
          border: 'none',
          color: color.textPrimary,
          cursor: 'pointer',
          textAlign: 'left',
          transition: transition(['background']),
        }}
      >
        <HistoryGraphGutter row={row} width={gutterWidth} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            height: SWIMLANE_HEIGHT,
            display: 'flex',
            alignItems: 'center',
            gap: space[1],
            paddingRight: space[2],
            overflow: 'hidden',
          }}
        >
          {commit.head && <HistoryRefPill text="HEAD" tone="head" />}
          {commit.refs.map((ref) => (
            <HistoryRefPill key={ref} text={ref} tone={historyRefTone(ref, localBranches)} />
          ))}
          {commit.tags.map((tag) => (
            <HistoryRefPill key={`tag:${tag}`} text={tag} tone="tag" icon="tag" />
          ))}
          <span
            style={{
              minWidth: 0,
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: font.sans,
              fontSize: font.size.caption,
              lineHeight: `${SWIMLANE_HEIGHT}px`,
            }}
          >
            {commit.subject}
          </span>
          <span
            style={{
              flexShrink: 0,
              color: color.textTertiary,
              fontFamily: font.mono,
              fontSize: font.size.micro,
              lineHeight: `${SWIMLANE_HEIGHT}px`,
            }}
          >
            {commit.shortHash}
          </span>
        </span>
      </button>
      {expanded && <HistoryItemDetails commit={commit} onMutate={onMutate} />}
    </div>
  );
};

const HistoryRefPill = ({
  text,
  tone,
  icon,
}: {
  text: string;
  tone: HistoryRefTone;
  icon?: 'tag';
}): JSX.Element => {
  const colors = refPillColors(tone);
  return (
    <span
      style={{
        maxWidth: 112,
        height: 16,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        flexShrink: 0,
        padding: `0 ${space[1]}px`,
        border: `1px solid ${colors.border}`,
        borderRadius: 3,
        background: colors.background,
        color: colors.foreground,
        fontFamily: font.sans,
        fontSize: font.size.micro,
        lineHeight: '14px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {icon === 'tag' && <Codicon name="tag" size={11} style={{ flexShrink: 0 }} />}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {text}
      </span>
    </span>
  );
};

function refPillColors(tone: HistoryRefTone): {
  readonly background: string;
  readonly foreground: string;
  readonly border: string;
} {
  if (tone === 'head') {
    return { background: color.accent, foreground: color.onAccent, border: color.accent };
  }
  if (tone === 'remote') {
    return { background: 'transparent', foreground: HISTORY_REF_COLORS.remote, border: '#4b345f' };
  }
  if (tone === 'tag') {
    return { background: 'transparent', foreground: HISTORY_REF_COLORS.tag, border: '#5b4a16' };
  }
  return { background: 'transparent', foreground: HISTORY_REF_COLORS.local, border: '#254d75' };
}

function historyItemLabel(commit: GitCommit): string {
  const time = historyTimeAgo(commit.author.date);
  return [commit.subject, commit.author.name, time].filter((part) => part !== '').join(' - ');
}
