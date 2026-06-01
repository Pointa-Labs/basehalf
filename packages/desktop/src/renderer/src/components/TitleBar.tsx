import { type CSSProperties, type JSX, useEffect, useState } from 'react';
import { color, font, radius, space, transition } from '../design.js';
import { useLayoutStore } from '../store/layout.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { openCommandPalette } from './CommandPalette.js';

// macOS draws the traffic lights (close/min/zoom) natively in the top-left of
// our custom title strip; reserve room for them (a constant gutter held across
// windowed / fullscreen — see `reserve` below).
const isMac = (window.bh?.platform ?? '') === 'darwin';
const TRAFFIC_LIGHTS_WIDTH = 78;
const BAR_HEIGHT = 36; // a compact custom title-bar height

// `-webkit-app-region` (Electron window-drag) isn't in csstype's CSSProperties.
type DraggableCSS = CSSProperties & { WebkitAppRegion?: 'drag' | 'no-drag' };

/**
 * The window title bar — a "command center": a thin draggable strip with a
 * centered faux-search box that opens the ⌘S palette (search +
 * workspace switch + files + actions), plus a sidebar toggle just right of the
 * traffic lights. Three flex zones (left toggle / centered box / spacer) keep
 * the box at the true window center regardless of the toggle's width.
 */
export const TitleBar = (): JSX.Element | null => {
  const current = useWorkspaceStore((s) => s.current);
  const sidebarOpen = useLayoutStore((s) => s.sidebarOpen);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  // The right panel's show/hide lives in the workspace store (alongside its tabs).
  const rightPanelOpen = useWorkspaceStore((s) => s.rightPanelOpen);
  const toggleRightPanel = useWorkspaceStore((s) => s.toggleRightPanel);
  const [boxHover, setBoxHover] = useState(false);
  const [toggleHover, setToggleHover] = useState(false);
  const [rightToggleHover, setRightToggleHover] = useState(false);

  // The OS window title — shown in the macOS fullscreen title-bar reveal and the
  // ⌘-Tab / Window list. The PRODUCT name, not the workspace folder name (which
  // reads like a stray file name in the reveal).
  useEffect(() => {
    document.title = 'BaseHalf';
  }, []);

  // Reserve the traffic-light gutter on macOS, CONSTANT across windowed /
  // fullscreen so the toggle (and the centered box) never shift when the window
  // maximizes. macOS hides the lights in fullscreen, but the gutter holds their
  // spot (they reveal there on hover). Symmetric reserve keeps the flex-centered
  // box at the true window center.
  const reserve = isMac ? TRAFFIC_LIGHTS_WIDTH : space[3];

  // The whole strip drags the window; zones inherit that and the interactive
  // buttons opt out with `no-drag`.
  const barStyle: DraggableCSS = {
    height: BAR_HEIGHT,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    background: color.surfaceMuted,
    borderBottom: `1px solid ${color.border}`,
    WebkitAppRegion: 'drag',
  };

  // Left + right zones are equal-weight (flex:1) so the center box is truly
  // window-centered. The toggle sits at the start of the left zone, just past
  // the traffic-light reserve.
  const leftZone: DraggableCSS = {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    paddingLeft: reserve,
    WebkitAppRegion: 'drag',
  };
  const rightZone: DraggableCSS = {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: reserve,
    WebkitAppRegion: 'drag',
  };
  const centerZone: DraggableCSS = {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    WebkitAppRegion: 'drag',
  };

  const toggleStyle: DraggableCSS = {
    WebkitAppRegion: 'no-drag',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    // Nudge it clear of the traffic lights, and make it a bigger hit target.
    marginLeft: space[3],
    width: 32,
    height: 28,
    padding: 0,
    border: 'none',
    borderRadius: radius.md,
    background: toggleHover ? color.border : 'transparent',
    color: sidebarOpen ? color.textSecondary : color.textTertiary,
    cursor: 'pointer',
    transition: transition(['background', 'color']),
  };

  // Mirror of the sidebar toggle, on the right: shows/hides the editor panel.
  const rightToggleStyle: DraggableCSS = {
    WebkitAppRegion: 'no-drag',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space[3],
    width: 32,
    height: 28,
    padding: 0,
    border: 'none',
    borderRadius: radius.md,
    background: rightToggleHover ? color.border : 'transparent',
    color: rightPanelOpen ? color.textSecondary : color.textTertiary,
    cursor: 'pointer',
    transition: transition(['background', 'color']),
  };

  const boxStyle: DraggableCSS = {
    // The box itself is clickable, not a drag handle.
    WebkitAppRegion: 'no-drag',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    width: '40vw',
    maxWidth: 480,
    minWidth: 240,
    height: 26,
    padding: `0 ${space[3]}px`,
    border: `1px solid ${boxHover ? color.borderStrong : color.border}`,
    borderRadius: radius.md,
    background: boxHover ? color.surface : color.bg,
    color: color.textSecondary,
    fontFamily: font.sans,
    fontSize: font.size.ui,
    cursor: 'pointer',
    transition: transition(['background', 'border-color']),
    overflow: 'hidden',
  };

  return (
    <div style={barStyle}>
      <div style={leftZone}>
        <button
          type="button"
          onClick={() => toggleSidebar()}
          onMouseEnter={() => setToggleHover(true)}
          onMouseLeave={() => setToggleHover(false)}
          title={`${sidebarOpen ? 'Hide' : 'Show'} sidebar (⌘B)`}
          aria-label={`${sidebarOpen ? 'Hide' : 'Show'} sidebar`}
          aria-pressed={sidebarOpen}
          data-testid="sidebar-toggle"
          style={toggleStyle}
        >
          {/* "layout sidebar" glyph: a window with the left panel filled when
              the sidebar is showing, hollow when hidden. */}
          <svg width={18} height={18} viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect
              x={1.75}
              y={3}
              width={12.5}
              height={10}
              rx={1.5}
              stroke="currentColor"
              strokeWidth={1.1}
            />
            <line x1={6} y1={3} x2={6} y2={13} stroke="currentColor" strokeWidth={1.1} />
            {sidebarOpen && (
              <rect x={2.4} y={3.6} width={3} height={8.8} rx={0.5} fill="currentColor" />
            )}
          </svg>
        </button>
      </div>
      <div style={centerZone}>
        <button
          type="button"
          onClick={() => openCommandPalette()}
          onMouseEnter={() => setBoxHover(true)}
          onMouseLeave={() => setBoxHover(false)}
          title={`Search & commands (${isMac ? '⌘S' : 'Ctrl+S'})`}
          data-testid="command-center"
          style={boxStyle}
        >
          <svg
            width={13}
            height={13}
            viewBox="0 0 16 16"
            aria-hidden
            style={{ opacity: 0.85, flexShrink: 0 }}
          >
            <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M11 11l3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <span
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {current ? `Search in ${current}` : 'Search'}
          </span>
          {/* Keybinding chip — a soft filled key that telegraphs the shortcut.
              Sits right next to the label so the cluster stays centered. */}
          <kbd
            style={{
              flexShrink: 0,
              fontFamily: font.sans,
              fontSize: 11,
              fontWeight: font.weight.medium,
              lineHeight: 1.6,
              color: color.textTertiary,
              background: 'rgba(255, 255, 255, 0.07)',
              borderRadius: radius.sm,
              padding: '1px 6px',
            }}
          >
            {isMac ? '⌘S' : 'Ctrl+S'}
          </kbd>
        </button>
      </div>
      <div style={rightZone}>
        <button
          type="button"
          onClick={() => toggleRightPanel()}
          onMouseEnter={() => setRightToggleHover(true)}
          onMouseLeave={() => setRightToggleHover(false)}
          title={`${rightPanelOpen ? 'Hide' : 'Show'} editor panel`}
          aria-label={`${rightPanelOpen ? 'Hide' : 'Show'} editor panel`}
          aria-pressed={rightPanelOpen}
          data-testid="right-panel-toggle"
          style={rightToggleStyle}
        >
          {/* "layout panel-right" glyph: a window with the RIGHT panel filled when
              the editor panel is showing, hollow when hidden (mirrors the sidebar
              toggle on the left). */}
          <svg width={18} height={18} viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect
              x={1.75}
              y={3}
              width={12.5}
              height={10}
              rx={1.5}
              stroke="currentColor"
              strokeWidth={1.1}
            />
            <line x1={10} y1={3} x2={10} y2={13} stroke="currentColor" strokeWidth={1.1} />
            {rightPanelOpen && (
              <rect x={10.6} y={3.6} width={3} height={8.8} rx={0.5} fill="currentColor" />
            )}
          </svg>
        </button>
      </div>
    </div>
  );
};
