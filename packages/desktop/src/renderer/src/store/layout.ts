import { create } from 'zustand';

// Sidebar layout — open/closed + width, persisted so it survives reloads.
// A primary side panel: drag the right edge to resize, fully hide it with the
// title-bar toggle (no always-visible thin strip / vertical icon rail).
const OPEN_KEY = 'bh:sidebar-open';
const WIDTH_KEY = 'bh:sidebar-width';
export const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_MIN_WIDTH = 170; // resize floor
export const SIDEBAR_MAX_WIDTH = 640;
// Drag the sash narrower than this and the panel snaps fully CLOSED instead of
// clamping at the floor — half the floor width, so you have to pull well past
// the minimum to dismiss it.
export const SIDEBAR_SNAP_WIDTH = Math.floor(SIDEBAR_MIN_WIDTH / 2);

const clampWidth = (n: number): number =>
  Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(n)));

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
}

export const useLayoutStore = create<LayoutState>((set) => ({
  sidebarOpen: readBool(OPEN_KEY, true),
  sidebarWidth: clampWidth(readNum(WIDTH_KEY, SIDEBAR_DEFAULT_WIDTH)),
  toggleSidebar: () =>
    set((s) => {
      const open = !s.sidebarOpen;
      persist(OPEN_KEY, open ? '1' : '0');
      return { sidebarOpen: open };
    }),
  setSidebarOpen: (open) => {
    persist(OPEN_KEY, open ? '1' : '0');
    set({ sidebarOpen: open });
  },
  setSidebarWidth: (width) => {
    const w = clampWidth(width);
    persist(WIDTH_KEY, String(w));
    set({ sidebarWidth: w });
  },
}));
