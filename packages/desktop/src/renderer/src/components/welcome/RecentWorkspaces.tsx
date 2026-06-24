import type { WorkspaceEntry } from '@basehalf/core';
import { type JSX, useState } from 'react';
import { color, font, space } from '../../design.js';
import { tildifyPath } from '../../lib/actions.js';
import { welcomeCopy } from './copy.js';

/** Cap the welcome list so the card never grows unbounded — ⌘K is the full list. */
const MAX_RECENT = 8;

interface RecentWorkspacesProps {
  /** Registered workspaces, most-recent-first (already sorted + filtered). */
  readonly recent: readonly WorkspaceEntry[];
  /** Workspace paths currently shown in another window — those rows get an "Open"
   *  marker so the user knows clicking focuses that window, not opens anew. */
  readonly openRoots: readonly string[];
  /** An open/add is in flight — rows disable+dim so a click isn't a silent dead
   *  press (store.use short-circuits while busy), matching the sibling CTAs. */
  readonly busy: boolean;
  /** Open-or-focus a registered workspace by name (reuses THIS welcome window). */
  readonly onOpen: (name: string) => void;
}

/** The returning-user "pick up where you left off" list — the star of the
 *  empty-window state. Presentational: the parent owns the store + sorting. */
export const RecentWorkspaces = ({
  recent,
  openRoots,
  busy,
  onOpen,
}: RecentWorkspacesProps): JSX.Element => {
  const openSet = new Set(openRoots.map((p) => p.toLowerCase()));
  return (
    <div>
      <div style={sectionLabelStyle}>{welcomeCopy.recentLabel}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {recent.slice(0, MAX_RECENT).map((w) => (
          <RecentRow
            key={w.path}
            name={w.name}
            path={w.path}
            isOpen={openSet.has(w.path.toLowerCase())}
            disabled={busy}
            onOpen={() => onOpen(w.name)}
          />
        ))}
      </div>
    </div>
  );
};

const sectionLabelStyle = {
  fontSize: font.size.micro,
  fontWeight: font.weight.semibold,
  color: color.textTertiary,
  textTransform: 'uppercase',
  letterSpacing: font.trackedCaps,
  marginBottom: space[2],
} as const;

const openPillStyle = {
  fontSize: 10,
  fontWeight: font.weight.semibold,
  color: color.accent,
  background: color.accentSofter,
  borderRadius: 4,
  padding: '1px 6px',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  flexShrink: 0,
} as const;

/** One recent-workspace row — name (+ an "Open" pill when a window already shows
 *  it) over its tildified path. Click opens-or-focuses it. */
const RecentRow = ({
  name,
  path,
  isOpen,
  disabled,
  onOpen,
}: {
  name: string;
  path: string;
  isOpen: boolean;
  disabled: boolean;
  onOpen: () => void;
}): JSX.Element => {
  const [hover, setHover] = useState(false);
  const showHover = hover && !disabled;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        alignItems: 'flex-start',
        width: '100%',
        textAlign: 'left',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        padding: `${space[2]}px ${space[3]}px`,
        background: showHover ? color.surfaceMuted : 'transparent',
        border: `1px solid ${showHover ? color.border : 'transparent'}`,
        borderRadius: 8,
        fontFamily: font.sans,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: space[2], maxWidth: '100%' }}>
        <span
          style={{
            fontSize: font.size.body,
            fontWeight: font.weight.medium,
            color: color.textPrimary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </span>
        {isOpen && <span style={openPillStyle}>{welcomeCopy.openMarker}</span>}
      </span>
      <span
        style={{
          fontSize: font.size.caption,
          color: color.textTertiary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
        }}
      >
        {tildifyPath(path)}
      </span>
    </button>
  );
};
