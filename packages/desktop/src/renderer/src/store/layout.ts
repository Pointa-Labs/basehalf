import { create } from 'zustand';

// Sidebar layout — open/closed + width, persisted so it survives reloads.
// A primary side panel: drag the right edge to resize, fully hide it with the
// title-bar toggle (no always-visible thin strip / vertical icon rail).
const OPEN_KEY = 'bh:sidebar-open';
const WIDTH_KEY = 'bh:sidebar-width';
const VIEW_KEY = 'bh:sidebar-view';
/** Which view the left sidebar shows — the file tree, Source Control (git), or
 *  full-text Search — switched from the activity-bar icon strip at the top. */
export type SidebarView = 'files' | 'scm' | 'search';
export const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_MIN_WIDTH = 170; // resize floor
export const SIDEBAR_MAX_WIDTH = 640;
// Drag the sash narrower than this and the panel snaps fully CLOSED instead of
// clamping at the floor — half the floor width, so you have to pull well past
// the minimum to dismiss it.
export const SIDEBAR_SNAP_WIDTH = Math.floor(SIDEBAR_MIN_WIDTH / 2);

const clampWidth = (n: number): number =>
  Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(n)));

// Keep at least this much CANVAS region beside a docked right region (the
// terminal). The editor is no longer a docked region — it's a full-canvas
// overlay, so it has no width to clamp.
const MIN_CANVAS_WIDTH = 240;

// Terminal dock width — the RIGHT-most region, a fixed home for the embedded
// terminal (the agent runner). Persisted like the sidebar. Clamped so a
// minimum canvas region always survives beside it.
const TERMINAL_WIDTH_KEY = 'bh:terminal-width';
export const TERMINAL_DEFAULT_WIDTH = 520;
export const TERMINAL_MIN_WIDTH = 280;

// The document Badge panel's expand/collapse, persisted so it stays how the user
// last left it (collapsed by default — the writing surface stays clean).
const BADGE_PANEL_KEY = 'bh:badge-panel-open';

const clampTerminalWidth = (n: number): number => {
  const viewport = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const max = Math.max(TERMINAL_MIN_WIDTH, viewport - MIN_CANVAS_WIDTH);
  return Math.max(TERMINAL_MIN_WIDTH, Math.min(max, Math.round(n)));
};

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function readNum(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key);
    const n = v === null ? Number.NaN : Number(v);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}
function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage unavailable — keep in-memory only.
  }
}

interface LayoutState {
  sidebarOpen: boolean;
  sidebarWidth: number;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  /** Which view the sidebar shows: the file tree or Source Control (git). */
  sidebarView: SidebarView;
  setSidebarView: (view: SidebarView) => void;
  /** Width of the right-most terminal dock (the embedded agent runner). */
  terminalWidth: number;
  setTerminalWidth: (width: number) => void;
  /** The document Badge panel's expand/collapse (remembered across reloads). */
  badgePanelOpen: boolean;
  toggleBadgePanel: () => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => {
  const sidebarOpen0 = readBool(OPEN_KEY, true);
  const sidebarWidth0 = clampWidth(readNum(WIDTH_KEY, SIDEBAR_DEFAULT_WIDTH));
  const sidebarView0: SidebarView = ((): SidebarView => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'scm' ? 'scm' : 'files';
    } catch {
      return 'files';
    }
  })();
  // The sidebar floats OVER the canvas, so its open/width state is independent of
  // every docked region. Each concern owns its own field.
  return {
    sidebarOpen: sidebarOpen0,
    sidebarWidth: sidebarWidth0,
    toggleSidebar: () => {
      const open = !get().sidebarOpen;
      persist(OPEN_KEY, open ? '1' : '0');
      set({ sidebarOpen: open });
    },
    setSidebarOpen: (open) => {
      persist(OPEN_KEY, open ? '1' : '0');
      set({ sidebarOpen: open });
    },
    setSidebarWidth: (width) => {
      const w = clampWidth(width);
      persist(WIDTH_KEY, String(w));
      set({ sidebarWidth: w });
    },
    sidebarView: sidebarView0,
    setSidebarView: (view) => {
      persist(VIEW_KEY, view);
      set({ sidebarView: view });
    },
    terminalWidth: clampTerminalWidth(readNum(TERMINAL_WIDTH_KEY, TERMINAL_DEFAULT_WIDTH)),
    setTerminalWidth: (width) => {
      const w = clampTerminalWidth(width);
      persist(TERMINAL_WIDTH_KEY, String(w));
      set({ terminalWidth: w });
    },
    badgePanelOpen: readBool(BADGE_PANEL_KEY, false),
    toggleBadgePanel: () => {
      const open = !get().badgePanelOpen;
      persist(BADGE_PANEL_KEY, open ? '1' : '0');
      set({ badgePanelOpen: open });
    },
  };
});
