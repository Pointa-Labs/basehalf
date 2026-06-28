import {
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useState,
} from 'react';
import { openContextMenu } from '../../../../platform/contextview/browser/contextMenuService.js';
import type { ContextMenuItem } from '../../../../platform/contextview/common/contextMenu.js';
import { color, font, space, transition } from '../../../browser/style/design.js';
import { Disclosure } from '../../../browser/ui/primitives/Disclosure.js';
import type { GitStashEntry } from '../common/git.js';
import { ScmIconButton as IconBtn } from './ScmIconButton.js';
import { scm } from './styles.js';
import type { ScmCommands } from './useScmCommands.js';

export const StashSection = ({
  entries,
  open,
  onToggle,
  busy,
  commands,
}: {
  entries: readonly GitStashEntry[];
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  commands: Pick<ScmCommands, 'applyStash' | 'popStash' | 'dropStash'>;
}): JSX.Element | null => {
  if (entries.length === 0) return null;
  return (
    <Disclosure title="Stashes" count={entries.length} open={open} onToggle={onToggle}>
      {entries.map((entry) => (
        <StashRow
          key={entry.ref}
          entry={entry}
          busy={busy}
          onApply={() => commands.applyStash(entry.ref)}
          onPop={() => commands.popStash(entry.ref)}
          onDrop={() => commands.dropStash(entry.ref)}
        />
      ))}
    </Disclosure>
  );
};

const StashRow = ({
  entry,
  busy,
  onApply,
  onPop,
  onDrop,
}: {
  entry: GitStashEntry;
  busy: boolean;
  onApply: () => void;
  onPop: () => void;
  onDrop: () => void;
}): JSX.Element => {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const active = hovered || focused;

  const menuItems = (): ContextMenuItem[] => [
    {
      id: 'apply',
      label: 'Apply Stash',
      disabled: busy,
      run: onApply,
    },
    {
      id: 'pop',
      label: 'Pop Stash',
      disabled: busy,
      run: onPop,
    },
    { separator: true },
    {
      id: 'drop',
      label: 'Drop Stash',
      disabled: busy,
      danger: true,
      run: onDrop,
    },
  ];

  const showMenu = (x: number, y: number, returnFocusElement?: HTMLElement | null): void => {
    openContextMenu(x, y, menuItems(), returnFocusElement);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      showMenu(rect.left + 18, rect.top + 18, event.currentTarget);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!busy) onApply();
    }
  };

  const onContextMenu = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    showMenu(event.clientX, event.clientY, event.currentTarget);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-scm-row
      aria-label={`${entry.message}, ${entry.ref}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
      style={{
        // VS Code SCM list rows are line-height: 22px (scm.css .monaco-list-row).
        display: 'flex',
        alignItems: 'center',
        gap: space[2],
        height: scm.rowHeight,
        padding: `0 ${space[2]}px 0 ${space[3]}px`,
        background: active ? scm.hoverBg : 'transparent',
        fontFamily: font.sans,
        fontSize: font.size.ui,
      }}
    >
      <span
        title={`${entry.ref} — ${entry.message}`}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: color.textSecondary,
        }}
      >
        {entry.message}
      </span>
      <span
        style={{
          display: 'flex',
          gap: space[1],
          opacity: active ? 1 : 0,
          transition: transition(['opacity']),
        }}
      >
        <IconBtn
          title="Apply Stash"
          glyph="cloud-download"
          onClick={onApply}
          disabled={busy}
          tabIndex={active ? 0 : -1}
        />
        <IconBtn
          title="Pop Stash"
          glyph="cloud-upload"
          onClick={onPop}
          disabled={busy}
          tabIndex={active ? 0 : -1}
        />
        <IconBtn
          title="Drop Stash"
          glyph="trash"
          onClick={onDrop}
          disabled={busy}
          danger
          tabIndex={active ? 0 : -1}
        />
      </span>
    </div>
  );
};
