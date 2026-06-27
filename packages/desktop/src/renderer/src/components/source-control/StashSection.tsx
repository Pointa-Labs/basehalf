import type { GitStashEntry } from '@basehalf/core';
import { type JSX, useState } from 'react';
import { color, font, space, transition } from '../../design.js';
import { Disclosure } from '../primitives/Disclosure.js';
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
  const [active, setActive] = useState(false);
  return (
    <div
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
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
