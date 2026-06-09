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

// Editor-space width — the RIGHT region (canvas ⇄ editor outer divider). The
// canvas keeps the rest of the middle; drag the editor's left sash to rebalance.
// Default ≈ a comfortable document reading column (the editor caps its prose at
// ~760 too). Persisted like the sidebar; remembered across reloads. (Stage 5
// moves this to per-workspace .bh/cache — for now a single remembered width.)
const EDITOR_WIDTH_KEY = 'bh:editor-width';
export const EDITOR_DEFAULT_WIDTH = 760;
export const EDITOR_MIN_WIDTH = 420; // narrow enough to pair with the canvas, wide enough to read
// Keep at least this much CANVAS region beside the editor (the layout's promise).
const MIN_CANVAS_WIDTH = 240;

// Cap the editor so a minimum canvas region always remains: viewport − MIN_CANVAS.
// The sidebar is NOT in this sum — it floats OVER the canvas rather than docking
// beside it, so it never eats canvas width. That keeps this clamp a pure function
// of the editor width + viewport, with no coupling to sidebar state.
const clampEditorWidth = (n: number): number => {
  // window may be unavailable at module init in some test envs — fall back to a
  // generous static ceiling so the clamp never returns NaN.
  const viewport = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const max = Math.max(EDITOR_MIN_WIDTH, viewport - MIN_CANVAS_WIDTH);
  return Math.max(EDITOR_MIN_WIDTH, Math.min(max, Math.round(n)));
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
  /** Width of the right-docked editor space (canvas keeps the rest). */
  editorWidth: number;
  setEditorWidth: (width: number) => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => {
  const sidebarOpen0 = readBool(OPEN_KEY, true);
  const sidebarWidth0 = clampWidth(readNum(WIDTH_KEY, SIDEBAR_DEFAULT_WIDTH));
  // The sidebar floats OVER the canvas, so its open/width state is independent of
  // the editor: toggling or resizing it never re-clamps editorWidth. Each concern
  // owns its own field.
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
    editorWidth: clampEditorWidth(readNum(EDITOR_WIDTH_KEY, EDITOR_DEFAULT_WIDTH)),
    setEditorWidth: (width) => {
      const w = clampEditorWidth(width);
      persist(EDITOR_WIDTH_KEY, String(w));
      set({ editorWidth: w });
    },
  };
});
