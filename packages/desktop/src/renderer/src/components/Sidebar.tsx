import { type JSX, type MouseEvent as ReactMouseEvent, useState } from 'react';
import { color, font, space, transition } from '../design.js';
import { SIDEBAR_SNAP_WIDTH, useLayoutStore } from '../store/layout.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { NavTree } from './NavTree.js';
import { WorkspaceUnreachable } from './WorkspaceUnreachable.js';

export const Sidebar = (): JSX.Element | null => {
  const current = useWorkspaceStore((s) => s.current);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const currentReachable = useWorkspaceStore((s) => s.currentReachable);
  const sidebarOpen = useLayoutStore((s) => s.sidebarOpen);
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth);
  const currentWs = workspaces.find((w) => w.name === current);

  // Fully closed — render nothing (the title-bar toggle brings it back), like
  // hiding a primary side panel; no leftover thin strip / vertical icon rail.
  if (!sidebarOpen) return null;

  return (
    <aside
      style={{
        // Floating overlay over the canvas: docked to the left edge, full body
        // height. Showing / hiding is pure appear-disappear — the canvas behind
        // never reflows. zIndex sits above the editor backdrop (40) so the
        // sidebar stays lit + clickable while a file is open, but below the
        // error banner (50) and dialogs / command palette (100).
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: sidebarWidth,
        zIndex: 45,
        borderRight: `1px solid ${color.border}`,
        background: color.surfaceMuted,
        // A soft right-cast shadow reads the panel as floating on the canvas.
        boxShadow: '1px 0 10px rgba(0, 0, 0, 0.05)',
        fontFamily: font.sans,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* A single line at the very top = WHERE you are (the active workspace's
          name), the way a file explorer's header shows the open folder. No
          switcher / actions / path clutter — switch with ⌘K or File ▸ Open
          Folder (⌘O); the full path shows on hover. */}
      {current && (
        <div
          title={currentWs?.path}
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            height: 22,
            padding: `0 ${space[4]}px`,
            fontFamily: font.sans,
            fontSize: font.size.micro,
            fontWeight: font.weight.semibold,
            letterSpacing: font.trackedCaps,
            textTransform: 'uppercase',
            color: color.textSecondary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            userSelect: 'none',
          }}
        >
          {current}
        </div>
      )}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {currentWs ? (
          currentReachable === false ? (
            <WorkspaceUnreachable name={currentWs.name} missingPath={currentWs.path} />
          ) : (
            <NavTree rootPath={currentWs.path} />
          )
        ) : (
          <div
            style={{
              padding: `${space[5]}px ${space[4]}px`,
              color: color.textTertiary,
              fontSize: font.size.caption,
              lineHeight: 1.5,
            }}
          >
            Open a folder to get started — press <code>⌘O</code>, or <code>⌘K</code> for everything.
          </div>
        )}
      </div>
      <SidebarSash />
    </aside>
  );
};

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
