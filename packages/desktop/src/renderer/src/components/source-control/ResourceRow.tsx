import type { JSX, MouseEvent as ReactMouseEvent } from 'react';
import { useState } from 'react';
import { color, font, space, transition } from '../../design.js';
import { type GitRow, statusColor } from '../../lib/gitStatus.js';
import { FileGlyph, badgeType } from '../FileGlyph.js';
import { ScmIconButton as IconBtn } from './ScmIconButton.js';
import { rowStatusText } from './resourceModel.js';
import { STATUS_PALETTE, scm } from './styles.js';
import type { RowAction, ScmGroupId } from './types.js';

export const ResourceRow = ({
  rowKey: key,
  groupId,
  row,
  selected,
  busy,
  onClick,
  onContextMenu,
  onKeyboardContextMenu,
  actions,
}: {
  rowKey: string;
  groupId: ScmGroupId;
  row: GitRow;
  selected: boolean;
  busy: boolean;
  onClick: (event: ReactMouseEvent) => void;
  onContextMenu: (event: ReactMouseEvent) => void;
  onKeyboardContextMenu: (button: HTMLButtonElement) => void;
  actions: RowAction[];
}): JSX.Element => {
  // `active` = hovered OR keyboard-focused, so the inline actions show for both.
  const [active, setActive] = useState(false);
  // Untracked DIRECTORIES come back as "dir/" (git collapses them with a trailing
  // slash) — strip it for the basename, then re-add so it still reads as a folder.
  const isDir = row.path.endsWith('/');
  const clean = isDir ? row.path.slice(0, -1) : row.path;
  const lastSlash = clean.lastIndexOf('/');
  const name = `${clean.slice(lastSlash + 1)}${isDir ? '/' : ''}`;
  const dir = lastSlash === -1 ? '' : clean.slice(0, lastSlash); // '' for a top-level file
  const ariaLabel = `${name}, ${rowStatusText(row)}${dir ? `, ${dir}` : ''}`;
  return (
    <div
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setActive(false);
      }}
      onContextMenu={onContextMenu}
      style={{
        // VS Code SCM list rows are line-height: 22px (scm.css .monaco-list-row).
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        height: scm.rowHeight,
        padding: `0 ${space[2]}px 0 ${space[3]}px`,
        background: selected
          ? active
            ? scm.activeSelectedBg
            : scm.selectedBg
          : active
            ? scm.hoverBg
            : 'transparent',
        fontFamily: font.sans,
        fontSize: font.size.ui,
      }}
    >
      {/* The name is a real button: focusable + Enter-activatable natively, and it
          carries the row's full aria-label so a screen reader announces the status,
          not just the filename. Actions are siblings (a button can't nest buttons). */}
      <button
        type="button"
        data-scm-row
        data-scm-key={key}
        data-scm-group={groupId}
        aria-label={ariaLabel}
        aria-selected={selected}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
            e.preventDefault();
            onKeyboardContextMenu(e.currentTarget);
          }
        }}
        title={row.path}
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
          color: color.textPrimary,
          fontFamily: font.sans,
          fontSize: font.size.ui,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          ...(row.status === 'D' && { textDecoration: 'line-through' }),
        }}
      >
        <span
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            width: 22,
            justifyContent: 'center',
            marginRight: 4,
          }}
        >
          <FileGlyph type={badgeType(clean, isDir)} tone={color.textSecondary} size={16} />
        </span>
        <span
          style={{
            flexShrink: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </span>
        {/* VS Code's resource `.description`: the dimmed parent directory, after
            the name, so two files with the same basename are distinguishable. */}
        {dir !== '' && (
          <span
            style={{
              marginLeft: space[2],
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: color.textGhost,
              fontSize: font.size.caption,
            }}
          >
            {dir}
          </span>
        )}
      </button>
      {/* Inline actions stay in the DOM (so they're keyboard-reachable); only their
          visibility + tab-stops toggle with hover/focus. */}
      <span
        style={{
          display: 'flex',
          gap: space[1],
          opacity: active ? 1 : 0,
          transition: transition(['opacity']),
        }}
      >
        {actions.map((a) => (
          <IconBtn
            key={a.label}
            title={a.label}
            glyph={a.glyph}
            onClick={a.onClick}
            danger={a.danger}
            disabled={busy}
            tabIndex={active ? 0 : -1}
          />
        ))}
      </span>
      {/* VS Code's resource `.decoration-icon`: 16px, margin-left 5px, on the right. */}
      <span
        aria-hidden
        style={{
          width: 16,
          marginLeft: 5,
          textAlign: 'center',
          fontFamily: font.sans,
          fontSize: font.size.ui,
          fontWeight: font.weight.semibold,
          color: statusColor(row, STATUS_PALETTE),
        }}
      >
        {row.status}
      </span>
    </div>
  );
};
