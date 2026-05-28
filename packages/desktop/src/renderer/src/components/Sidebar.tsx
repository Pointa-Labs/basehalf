import { type JSX, useState } from 'react';
import { color, font, radius, space, transition } from '../design.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { NavTree } from './NavTree.js';
import { WorkspaceUnreachable } from './WorkspaceUnreachable.js';

const COLLAPSE_KEY = 'bh:sidebar-collapsed';

export const Sidebar = (): JSX.Element => {
  const current = useWorkspaceStore((s) => s.current);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const currentReachable = useWorkspaceStore((s) => s.currentReachable);
  const currentWs = workspaces.find((w) => w.name === current);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const toggle = (next: boolean): void => {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      // localStorage unavailable — keep the in-memory state but skip persistence.
    }
  };

  if (collapsed) {
    return (
      <aside
        style={{
          width: 28,
          borderRight: `1px solid ${color.border}`,
          background: color.bg,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: `${space[3]}px 0`,
        }}
      >
        <SidebarToggle direction="open" onClick={() => toggle(false)} />
      </aside>
    );
  }

  return (
    <aside
      style={{
        width: 264,
        borderRight: `1px solid ${color.border}`,
        background: color.bg,
        fontFamily: font.sans,
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {currentWs ? (
        <>
          <div
            style={{
              padding: `${space[3]}px ${space[4]}px ${space[3]}px`,
              borderBottom: `1px solid ${color.divider}`,
              display: 'flex',
              alignItems: 'flex-start',
              gap: space[2],
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: font.size.body,
                  fontWeight: font.weight.semibold,
                  color: color.textPrimary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  letterSpacing: -0.1,
                }}
                title={currentWs.name}
              >
                {currentWs.name}
              </div>
              <div
                style={{
                  fontFamily: font.mono,
                  fontSize: font.size.micro,
                  color: color.textTertiary,
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  letterSpacing: -0.2,
                }}
                title={currentWs.path}
              >
                {currentWs.path}
              </div>
            </div>
            <SidebarToggle direction="close" onClick={() => toggle(true)} />
          </div>
          {currentReachable === false ? (
            <WorkspaceUnreachable name={currentWs.name} missingPath={currentWs.path} />
          ) : (
            <NavTree rootPath={currentWs.path} />
          )}
        </>
      ) : (
        <div
          style={{
            padding: `${space[5]}px ${space[4]}px`,
            color: color.textTertiary,
            fontSize: font.size.caption,
            lineHeight: 1.5,
          }}
        >
          Pick a folder from the top bar to register it as a workspace.
        </div>
      )}
    </aside>
  );
};

const SidebarToggle = ({
  direction,
  onClick,
}: {
  direction: 'open' | 'close';
  onClick: () => void;
}): JSX.Element => {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={direction === 'open' ? 'Show file tree' : 'Hide file tree'}
      style={{
        width: 22,
        height: 22,
        padding: 0,
        border: 'none',
        background: hover ? color.divider : 'transparent',
        borderRadius: radius.sm,
        cursor: 'pointer',
        color: color.textTertiary,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        transition: transition(['background', 'color']),
      }}
    >
      <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden>
        <path
          d={direction === 'open' ? 'M3.5 2l3 3-3 3' : 'M6.5 2l-3 3 3 3'}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
};
