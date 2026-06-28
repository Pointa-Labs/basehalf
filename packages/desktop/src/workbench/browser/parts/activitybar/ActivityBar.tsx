import type { JSX } from 'react';
import { useGitStatusStore } from '../../../contrib/scm/browser/gitStatusStore.js';
import type { SidebarView } from '../../layout/layoutStore.js';
import { color, font, radius, space, transition } from '../../style/design.js';
import { Codicon } from '../../ui/Codicon.js';

// The top icon strip. Each entry switches the panel below; the active one is
// tinted. Mirrors VS Code's Activity Bar as a workbench part.
export const ActivityBar = ({
  view,
  onSelect,
}: {
  view: SidebarView;
  onSelect: (v: SidebarView) => void;
}): JSX.Element => {
  // VS Code shows the changed-resource count as a badge on the Source Control
  // activity icon — read it straight from the live git status.
  const changeCount = useGitStatusStore((s) => (s.status?.isRepo ? s.status.files.length : 0));
  return (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: space[1],
        height: 38,
        padding: `0 ${space[2]}px`,
        borderBottom: `1px solid ${color.border}`,
      }}
    >
      <ActivityIcon active={view === 'files'} title="Files" onClick={() => onSelect('files')}>
        <Codicon name="files" size={18} />
      </ActivityIcon>
      <ActivityIcon active={view === 'search'} title="Search" onClick={() => onSelect('search')}>
        <Codicon name="search" size={18} />
      </ActivityIcon>
      <ActivityIcon
        active={view === 'scm'}
        title="Source Control"
        onClick={() => onSelect('scm')}
        badge={changeCount}
      >
        <Codicon name="source-control" size={18} />
      </ActivityIcon>
    </div>
  );
};

const ActivityIcon = ({
  active,
  title,
  onClick,
  children,
  badge,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: JSX.Element;
  /** A small count badge on the icon (VS Code's activity-bar badge); hidden at 0. */
  badge?: number;
}): JSX.Element => (
  <button
    type="button"
    title={title}
    aria-label={title}
    onClick={onClick}
    style={{
      position: 'relative',
      width: 30,
      height: 30,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: active ? color.divider : 'transparent',
      border: 'none',
      borderRadius: radius.md,
      cursor: 'pointer',
      color: active ? color.textPrimary : color.textTertiary,
      transition: transition(['background', 'color']),
    }}
  >
    {children}
    {badge !== undefined && badge > 0 && (
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 1,
          right: 1,
          minWidth: 15,
          height: 15,
          padding: '0 3px',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: color.accent,
          color: color.onAccent,
          borderRadius: 8,
          fontFamily: font.sans,
          fontSize: 9,
          fontWeight: font.weight.semibold,
          lineHeight: 1,
        }}
      >
        {badge > 99 ? '99+' : badge}
      </span>
    )}
  </button>
);
