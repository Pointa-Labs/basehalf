import { type JSX, type MouseEvent as ReactMouseEvent, useState } from 'react';
import { color, font, radius, shadow, space, transition } from '../design.js';
import { SIDEBAR_SNAP_WIDTH, type SidebarView, useLayoutStore } from '../store/layout.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { NavTree } from './NavTree.js';
import { SourceControl } from './SourceControl.js';

export const Sidebar = (): JSX.Element | null => {
  const current = useWorkspaceStore((s) => s.current);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const sidebarOpen = useLayoutStore((s) => s.sidebarOpen);
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth);
  const sidebarView = useLayoutStore((s) => s.sidebarView);
  const setSidebarView = useLayoutStore((s) => s.setSidebarView);
  const currentWs = workspaces.find((w) => w.name === current);

  // Fully closed — render nothing (the title-bar toggle brings it back), like
  // hiding a primary side panel; no leftover thin strip / vertical icon rail.
  if (!sidebarOpen) return null;

  return (
    <aside
      style={{
        // The LEFT region FLOATS over the canvas (absolute, not a flex sibling),
        // so showing / hiding / resizing it never reflows or shifts the canvas —
        // the canvas is a full-width backdrop the sidebar sits on top of, mirroring
        // how the right editor never pushes the canvas content. Pinned to the
        // canvas region's left edge; clipped to it by the region's overflow.
        position: 'absolute',
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 6,
        width: sidebarWidth,
        borderRight: `1px solid ${color.border}`,
        background: color.surfaceMuted,
        boxShadow: shadow.raised,
        fontFamily: font.sans,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Activity bar — the top icon strip; switches the panel below between the
          file tree and Source Control (git). Room for more entries (search, …)
          as those features land. */}
      <ActivityBar view={sidebarView} onSelect={setSidebarView} />
      {sidebarView === 'scm' && currentWs ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <SourceControl key={currentWs.path} />
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {currentWs ? (
            // NavTree owns its own VS Code-style Explorer header (folder name + New
            // File/Folder/Refresh/Collapse actions) + scroll. No unreachable branch:
            // App's selectRegion routes folder-missing to a full-region
            // <WorkspaceMissing/>, so the Sidebar always shows a reachable workspace.
            <NavTree rootPath={currentWs.path} />
          ) : (
            <div
              style={{
                padding: `${space[5]}px ${space[4]}px`,
                color: color.textTertiary,
                fontSize: font.size.caption,
                lineHeight: 1.5,
              }}
            >
              Open a folder to get started — press <code>⌘O</code>, or <code>⌘K</code> for
              everything.
            </div>
          )}
        </div>
      )}
      <SidebarSash />
    </aside>
  );
};

// The top icon strip. Each entry switches the panel below; the active one is
// tinted. Built for the two views with destinations today (Files, Source
// Control) — search / agent entries slot in beside them later.
const ActivityBar = ({
  view,
  onSelect,
}: {
  view: SidebarView;
  onSelect: (v: SidebarView) => void;
}): JSX.Element => (
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
      <FilesGlyph />
    </ActivityIcon>
    <ActivityIcon active={view === 'scm'} title="Source Control" onClick={() => onSelect('scm')}>
      <GitGlyph />
    </ActivityIcon>
  </div>
);

const ActivityIcon = ({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: JSX.Element;
}): JSX.Element => (
  <button
    type="button"
    title={title}
    aria-label={title}
    onClick={onClick}
    style={{
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
  </button>
);

const FilesGlyph = (): JSX.Element => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.3}
    aria-hidden
  >
    <path
      d="M2.5 3a1 1 0 0 1 1-1H7l1.5 1.6H12.5a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V3z"
      strokeLinejoin="round"
    />
  </svg>
);

const GitGlyph = (): JSX.Element => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.3}
    aria-hidden
  >
    <circle cx={4.5} cy={4} r={1.8} />
    <circle cx={4.5} cy={12} r={1.8} />
    <circle cx={11.5} cy={6} r={1.8} />
    <path d="M4.5 5.8v4.4M11.5 7.8c0 2.7-2.6 2.5-4.6 3.8" strokeLinecap="round" />
  </svg>
);

// A "sash": a thin grab strip on the right edge; drag to resize. A 6px hit
// area with a 2px accent line that lights on hover / while dragging.
const SidebarSash = (): JSX.Element => {
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth);
  const setSidebarWidth = useLayoutStore((s) => s.setSidebarWidth);
  const setSidebarOpen = useLayoutStore((s) => s.setSidebarOpen);
  const [active, setActive] = useState(false);
  const [hover, setHover] = useState(false);

  const onMouseDown = (e: ReactMouseEvent): void => {
    e.preventDefault();
    setActive(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    // Track snap state so we only flip open/closed when crossing the threshold.
    let snappedClosed = false;
    const onMove = (ev: MouseEvent): void => {
      const proposed = startWidth + (ev.clientX - startX);
      if (proposed < SIDEBAR_SNAP_WIDTH) {
        // Pulled well past the floor → snap the whole panel closed.
        if (!snappedClosed) {
          snappedClosed = true;
          setSidebarOpen(false);
        }
        return;
      }
      // Back inside the floor → re-open (if we'd snapped) and track the width.
      if (snappedClosed) {
        snappedClosed = false;
        setSidebarOpen(true);
      }
      setSidebarWidth(proposed);
    };
    const onUp = (): void => {
      setActive(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    // Keep the resize cursor + suppress text selection for the whole drag.
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Drag to resize"
      data-testid="sidebar-sash"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: 6,
        height: '100%',
        cursor: 'col-resize',
        zIndex: 5,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 2,
          height: '100%',
          background: active ? color.accent : hover ? color.borderStrong : 'transparent',
          transition: active ? 'none' : transition(['background']),
        }}
      />
    </div>
  );
};
