import { type JSX, type MouseEvent as ReactMouseEvent, useState } from 'react';
import { SIDEBAR_SNAP_WIDTH, useLayoutStore } from '../../layout/layoutStore.js';
import { color, transition } from '../../style/design.js';

// A "sash": a thin grab strip on the right edge; drag to resize. A 6px hit
// area with a 2px accent line that lights on hover / while dragging.
export const SidebarSash = (): JSX.Element => {
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
