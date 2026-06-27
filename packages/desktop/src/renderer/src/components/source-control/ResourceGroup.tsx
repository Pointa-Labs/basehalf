import { type JSX, type MouseEvent as ReactMouseEvent, useState } from 'react';
import { color, font, space, transition } from '../../design.js';
import type { GitRow } from '../../lib/gitStatus.js';
import { Codicon } from '../Codicon.js';
import { CountBadge } from '../primitives/CountBadge.js';
import { ResourceRow } from './ResourceRow.js';
import { ScmIconButton as IconBtn } from './ScmIconButton.js';
import { scm } from './styles.js';
import { type RowAction, type ScmGroupId, rowKey } from './types.js';

export const ResourceGroup = ({
  groupId,
  title,
  rows,
  show,
  open,
  onToggle,
  busy,
  selectedKeys,
  onRowClick,
  onRowContextMenu,
  onKeyboardContextMenu,
  actions,
  groupAction,
}: {
  groupId: ScmGroupId;
  title: string;
  rows: readonly GitRow[];
  show: boolean;
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  selectedKeys: readonly string[];
  onRowClick: (event: ReactMouseEvent, key: string, row: GitRow) => void;
  onRowContextMenu: (event: ReactMouseEvent, key: string, groupId: ScmGroupId, row: GitRow) => void;
  onKeyboardContextMenu: (
    button: HTMLButtonElement,
    key: string,
    groupId: ScmGroupId,
    row: GitRow,
  ) => void;
  actions: (r: GitRow) => RowAction[];
  groupAction?: RowAction;
}): JSX.Element | null => {
  const [active, setActive] = useState(false);
  if (!show) return null;
  return (
    <div role="group" aria-label={title}>
      <div
        onMouseEnter={() => setActive(true)}
        onMouseLeave={() => setActive(false)}
        onFocus={() => setActive(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setActive(false);
        }}
        style={{
          // VS Code resource-group header: a 22px list row, label + count
          // (margin-left 6px), actions pushed right. Not uppercase.
          display: 'flex',
          alignItems: 'center',
          height: scm.rowHeight,
          padding: `0 ${space[2]}px`,
          fontSize: font.size.ui,
          fontWeight: font.weight.semibold,
          color: color.textSecondary,
          userSelect: 'none',
        }}
      >
        <button
          type="button"
          data-scm-row
          onClick={onToggle}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' && open) {
              e.preventDefault();
              onToggle();
            } else if (e.key === 'ArrowRight' && !open) {
              e.preventDefault();
              onToggle();
            }
          }}
          aria-expanded={open}
          style={{
            flex: 1,
            minWidth: 0,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 0,
            background: 'none',
            border: 'none',
            padding: 0,
            color: color.textSecondary,
            cursor: 'pointer',
            textAlign: 'left',
            fontFamily: font.sans,
            fontSize: font.size.ui,
            fontWeight: font.weight.semibold,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 14,
              display: 'inline-flex',
              justifyContent: 'center',
              transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: transition(['transform']),
              color: color.textTertiary,
              marginRight: 1,
            }}
          >
            <Codicon name="chevron-right" size={14} />
          </span>
          <span>{title}</span>
          <span style={{ marginLeft: 6, display: 'flex' }}>
            <CountBadge count={rows.length} />
          </span>
        </button>
        {groupAction && (
          <span style={{ marginLeft: 'auto', display: active ? 'flex' : 'none' }}>
            <IconBtn
              title={groupAction.label}
              glyph={groupAction.glyph}
              onClick={groupAction.onClick}
              disabled={busy}
            />
          </span>
        )}
      </div>
      {open &&
        rows.map((r) => {
          const key = rowKey(groupId, r);
          return (
            <ResourceRow
              key={`${title}:${r.path}`}
              rowKey={key}
              groupId={groupId}
              row={r}
              selected={selectedKeys.includes(key)}
              busy={busy}
              onClick={(event) => onRowClick(event, key, r)}
              onContextMenu={(event) => onRowContextMenu(event, key, groupId, r)}
              onKeyboardContextMenu={(button) => onKeyboardContextMenu(button, key, groupId, r)}
              actions={actions(r)}
            />
          );
        })}
    </div>
  );
};
