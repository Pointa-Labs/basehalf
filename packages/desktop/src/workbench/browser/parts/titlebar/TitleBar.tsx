import { type CSSProperties, type JSX, useEffect, useState } from 'react';
import { nativeHostService } from '../../../../platform/native/browser/nativeHostService.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import { useLayoutStore } from '../../layout/layoutStore.js';
import { openCommandPalette } from '../../quickaccess/CommandPalette.js';
import { color, font, radius, space, transition } from '../../style/design.js';
import { selectRegion } from '../../workbenchRegion.js';
import { UpdateChip } from './UpdateChip.js';

// macOS draws the traffic lights (close/min/zoom) natively in the top-left of
// our custom title strip; reserve room for them (a constant gutter held across
// windowed / fullscreen — see `reserve` below).
const isMac = nativeHostService.platform === 'darwin';
const TRAFFIC_LIGHTS_WIDTH = 78;
const BAR_HEIGHT = 36; // a compact custom title-bar height

// `-webkit-app-region` (Electron window-drag) isn't in csstype's CSSProperties.
type DraggableCSS = CSSProperties & { WebkitAppRegion?: 'drag' | 'no-drag' };

/**
 * The window title bar — a "command center": a thin draggable strip with a
 * centered faux-search box that opens the ⌘K palette (search +
 * workspace switch + files + actions), plus a sidebar toggle just right of the
 * traffic lights. Three flex zones (left toggle / centered box / spacer) keep
 * the box at the true window center regardless of the toggle's width.
 */
export const TitleBar = (): JSX.Element | null => {
  const current = useWorkspaceStore((s) => s.current);
  const currentReachable = useWorkspaceStore((s) => s.currentReachable);
  const sidebarOpen = useLayoutStore((s) => s.sidebarOpen);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  // The sidebar exists only in the 'canvas' region (a reachable workspace) — so
  // its toggle belongs in the title bar only there. On the welcome / recovery
  // surfaces there's no sidebar to toggle, and a control that does nothing (and
  // whose glyph would falsely show "panel open") is worse than no control.
  const hasSidebar = selectRegion(current, currentReachable) === 'canvas';
  const [boxHover, setBoxHover] = useState(false);
  const [toggleHover, setToggleHover] = useState(false);
  // Window zoom factor (1 = 100%). The native macOS traffic lights do NOT scale
  // with the window's page zoom, so the title bar must stay native-sized or its
  // buttons collide with the lights. We counter-zoom the whole strip by 1/factor
  // (mirrors a mature editor's `counter-zoom` on its title bar).
  const [zoomFactor, setZoomFactor] = useState(1);

  // The OS window title — shown in the macOS fullscreen title-bar reveal and the
  // ⌘-Tab / Window list. Now that each window is bound to one workspace
  // (multi-window), the title is the workspace name so windows are
  // distinguishable; the welcome/empty window keeps the product name.
  useEffect(() => {
    document.title = current ?? 'BaseHalf';
  }, [current]);

  // Track the window zoom factor for the counter-zoom above. Subscribe to changes
  // (main broadcasts on every View-menu zoom + on load), and read the current
  // value once on mount so we don't miss a factor applied before we subscribed.
  useEffect(() => {
    const unsub = nativeHostService.onZoomFactor((f) => setZoomFactor(f > 0 ? f : 1));
    const now = nativeHostService.getZoomFactor();
    if (typeof now === 'number' && now > 0) setZoomFactor(now);
    return unsub;
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
    // Counter the window's page zoom so the strip renders at its native size —
    // keeping every button clear of the (unscaled) native traffic lights.
    zoom: 1 / zoomFactor,
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
      {/* leftZone always renders (flex:1) so the centered box stays window-centered;
          only the toggle inside it is conditional. */}
      <div style={leftZone}>
        {hasSidebar && (
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
        )}
      </div>
      <div style={centerZone}>
        <button
          type="button"
          onClick={() => openCommandPalette()}
          onMouseEnter={() => setBoxHover(true)}
          onMouseLeave={() => setBoxHover(false)}
          aria-label="Search and commands"
          title={`Search & commands (${isMac ? '⌘K' : 'Ctrl+K'})`}
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
            {isMac ? '⌘K' : 'Ctrl+K'}
          </kbd>
        </button>
      </div>
      {/* The right zone balances the flex-centered search box and hosts the
          update indicator — the chrome home for the self-update state machine
          (it stays invisible until there's news; see UpdateChip). */}
      <div style={rightZone}>
        <UpdateChip />
      </div>
    </div>
  );
};
