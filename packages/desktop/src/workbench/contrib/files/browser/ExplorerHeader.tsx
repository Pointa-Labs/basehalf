import { type FocusEvent, type JSX, useState } from 'react';
import { color, font, radius, space, transition } from '../../../browser/style/design.js';
import { Codicon } from '../../../browser/ui/Codicon.js';

// Explorer header (VS Code's view-title toolbar): folder name + hover actions.
export const ExplorerHeader = ({
  name,
  title,
  onNewFile,
  onNewFolder,
  onRefresh,
  onCollapseAll,
}: {
  name: string;
  title: string;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRefresh: () => void;
  onCollapseAll: () => void;
}): JSX.Element => {
  const [hover, setHover] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const showActions = hover || focusWithin;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocusWithin(true)}
      onBlur={(event: FocusEvent<HTMLDivElement>) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) setFocusWithin(false);
      }}
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        height: 22,
        padding: `0 ${space[2]}px 0 ${space[4]}px`,
        userSelect: 'none',
      }}
    >
      <span
        title={title}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: font.sans,
          fontSize: font.size.micro,
          fontWeight: font.weight.semibold,
          letterSpacing: font.trackedCaps,
          textTransform: 'uppercase',
          color: color.textSecondary,
        }}
      >
        {name}
      </span>
      {/* VS Code reveals these on header hover/focus. */}
      <span
        style={{
          display: 'flex',
          gap: space[1],
          opacity: showActions ? 1 : 0,
          transition: transition(['opacity']),
        }}
      >
        <HeaderButton title="New File" onClick={onNewFile} glyph="new-file" />
        <HeaderButton title="New Folder" onClick={onNewFolder} glyph="new-folder" />
        <HeaderButton title="Refresh" onClick={onRefresh} glyph="refresh" />
        <HeaderButton title="Collapse All" onClick={onCollapseAll} glyph="collapse-all" />
      </span>
    </div>
  );
};

const HeaderButton = ({
  glyph,
  title,
  onClick,
}: {
  glyph: string;
  title: string;
  onClick: () => void;
}): JSX.Element => (
  <button
    type="button"
    title={title}
    aria-label={title}
    onClick={onClick}
    style={{
      width: 20,
      height: 20,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'none',
      border: 'none',
      borderRadius: radius.sm,
      cursor: 'pointer',
      color: color.textTertiary,
      fontSize: font.size.caption,
      lineHeight: 1,
      transition: transition(['background', 'color']),
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = color.divider;
      e.currentTarget.style.color = color.textPrimary;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = 'none';
      e.currentTarget.style.color = color.textTertiary;
    }}
  >
    <Codicon name={glyph} size={16} />
  </button>
);
