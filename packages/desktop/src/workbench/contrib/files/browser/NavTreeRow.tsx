import { type CSSProperties, type JSX, type KeyboardEvent, type MouseEvent, useState } from 'react';
import type { WorkspaceListFilesEntry } from '../../../../platform/workspaces/common/workspaces.js';
import { FileGlyph, badgeType } from '../../../browser/labels/FileGlyph.js';
import { color, font, radius, shadow, space, transition } from '../../../browser/style/design.js';
import { InlineEditInput } from '../../../browser/ui/primitives/InlineEditInput.js';
import {
  type GitDecoPalette,
  fileDecoration,
  statusTooltip,
} from '../../scm/browser/gitStatusModel.js';
import { useGitStatusStore } from '../../scm/browser/gitStatusStore.js';
import { ROW_HEIGHT, isAgentHintFile } from './navTreeModel.js';

// File-tree git-status colors (VS Code conventions): added / untracked green,
// modified amber, deleted red, conflict red, renamed accent.
const GIT_PALETTE: GitDecoPalette = {
  added: color.success,
  modified: color.warning,
  deleted: color.danger,
  conflict: color.danger,
  renamed: color.accent,
  untracked: color.success,
};

interface NavTreeRowProps {
  depth: number;
  entry: WorkspaceListFilesEntry;
  /** Workspace-relative POSIX path, for the git-status coloring lookup. */
  rel: string;
  isExpanded: boolean;
  isSelected: boolean;
  isFocused: boolean;
  tabIndex: number;
  onClick: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  onDoubleClick?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  onFocus?: () => void;
  rowRef?: (el: HTMLDivElement | null) => void;
  /** When true, the name is replaced by an inline edit field (rename / name-new). */
  renaming?: boolean;
  onRenameCommit?: (name: string) => void;
  onRenameCancel?: () => void;
}

export const NavTreeRow = ({
  depth,
  entry,
  rel,
  isExpanded,
  isSelected,
  isFocused,
  tabIndex,
  onClick,
  onKeyDown,
  onDoubleClick,
  onContextMenu,
  onFocus,
  rowRef,
  renaming = false,
  onRenameCommit,
  onRenameCancel,
}: NavTreeRowProps): JSX.Element => {
  const [hover, setHover] = useState(false);
  const isDir = entry.type === 'dir';
  const indent = space[2] + depth * 14;
  const agentHint = isAgentHintFile(depth, entry);
  // git status for this path (a file, or an untracked dir reported as "rel/").
  const direct = useGitStatusStore((s) => s.byPath.get(rel) ?? s.byPath.get(`${rel}/`));
  // A tracked folder with no direct entry inherits a propagated mark if a
  // descendant changed — so a collapsed folder with edits inside still reads.
  const folderAgg = useGitStatusStore((s) => (isDir ? s.folderStatus.get(rel) : undefined));
  const git = direct ?? folderAgg;
  const propagated = direct === undefined && folderAgg !== undefined;
  const deco = git ? fileDecoration(git, GIT_PALETTE) : null;

  const glyph = (
    <span
      aria-hidden
      style={{
        width: 14,
        color: color.textTertiary,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {isDir ? (
        <ChevronIcon open={isExpanded} />
      ) : (
        <FileGlyph
          type={badgeType(entry.name, false)}
          tone={isSelected ? color.accent : color.textTertiary}
          size={13}
        />
      )}
    </span>
  );

  // Inline rename / name-a-new-entry: a non-button row (an <input> can't live
  // inside a <button>) laid out identically, reusing the shared commit machine.
  if (renaming) {
    return (
      <div
        className="bh-nav-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[1],
          height: ROW_HEIGHT,
          paddingLeft: indent,
          paddingRight: space[2],
          background: color.divider,
        }}
      >
        {glyph}
        <InlineEditInput
          initialValue={entry.name}
          onCommit={(name) => onRenameCommit?.(name)}
          onCancel={() => onRenameCancel?.()}
          ariaLabel="New name"
          testId="nav-rename-input"
          style={{
            flex: 1,
            minWidth: 0,
            border: `1px solid ${color.accent}`,
            borderRadius: radius.sm,
            background: color.bg,
            color: color.textPrimary,
            fontSize: font.size.caption,
            fontFamily: font.sans,
            padding: `0 ${space[1]}px`,
            height: ROW_HEIGHT - 4,
            outline: 'none',
          }}
        />
      </div>
    );
  }

  const bg = isSelected ? color.accentSofter : hover || isFocused ? color.divider : 'transparent';
  const fg = isSelected
    ? color.accent
    : agentHint
      ? color.textGhost
      : isDir
        ? color.textPrimary
        : color.textSecondary;
  const weight = isSelected ? font.weight.medium : font.weight.regular;
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onClick();
  };

  const style: CSSProperties = {
    width: '100%',
    textAlign: 'left',
    border: 'none',
    background: bg,
    padding: 0,
    paddingLeft: indent,
    paddingRight: space[2],
    height: ROW_HEIGHT,
    fontSize: font.size.caption,
    fontFamily: font.sans,
    color: fg,
    display: 'flex',
    alignItems: 'center',
    gap: space[1],
    cursor: 'pointer',
    fontWeight: weight,
    transition: transition(['background', 'color']),
    position: 'relative',
    boxShadow: isFocused ? shadow.focus : 'none',
    outline: 'none',
  };
  return (
    <div
      ref={rowRef}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={isDir ? isExpanded : undefined}
      aria-selected={isSelected}
      tabIndex={tabIndex}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onFocus={onFocus}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={
        agentHint
          ? `${entry.name} — instructions AI agents read when working in this folder (installed by BaseHalf)`
          : entry.name
      }
      data-selected={isSelected ? 'true' : 'false'}
      className="bh-nav-row"
      style={style}
    >
      {/* Indent guides: a 1px vertical per ancestor depth (VS Code's tree guides),
          aligned under each ancestor's twisty. */}
      {Array.from({ length: depth }, (_, i) => space[2] + i * 14 + 7).map((x) => (
        <span
          key={x}
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: x,
            width: 1,
            background: color.border,
            pointerEvents: 'none',
          }}
        />
      ))}
      {glyph}
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          ...(deco && !isSelected && { color: deco.color }),
          ...(deco?.strikeThrough && { textDecoration: 'line-through' }),
        }}
      >
        {entry.name}
      </span>
      {deco && git && (
        <span
          aria-hidden
          title={propagated ? 'This folder contains changes' : statusTooltip(git)}
          style={{
            marginLeft: 'auto',
            flexShrink: 0,
            fontFamily: font.mono,
            fontSize: font.size.micro,
            fontWeight: font.weight.semibold,
            color: deco.color,
          }}
        >
          {/* A propagated folder shows a dot (a letter on a folder reads oddly). */}
          {propagated ? '●' : deco.letter}
        </span>
      )}
      {agentHint && (
        <span
          aria-hidden
          style={{
            marginLeft: 'auto',
            flexShrink: 0,
            fontSize: 9,
            fontWeight: font.weight.medium,
            letterSpacing: font.trackedCaps,
            color: color.textGhost,
            border: `1px solid ${color.border}`,
            borderRadius: radius.pill,
            padding: '0px 5px',
            lineHeight: '12px',
          }}
        >
          AI
        </span>
      )}
    </div>
  );
};

const ChevronIcon = ({ open }: { open: boolean }): JSX.Element => (
  <svg
    width={9}
    height={9}
    viewBox="0 0 9 9"
    aria-hidden
    style={{
      transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: transition(['transform']),
    }}
  >
    <path
      d="M3 2l2.5 2.5L3 7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
