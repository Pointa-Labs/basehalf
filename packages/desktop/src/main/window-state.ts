import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Display, Rectangle } from 'electron';

const FILE_NAME = 'window-state.json';
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;

/** The welcome / no-workspace window's slot in the per-workspace map. No
 *  absolute path is the empty string, so this sentinel can't collide with a
 *  real workspace key. */
export const WELCOME_KEY = '';

/** Remembered geometry + zoom for ONE window. The workspace it belongs to is the
 *  MAP KEY now (was an inline `workspaceRoot` field), so reopening a workspace
 *  restores its own window independent of the others. */
export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
  /** Window UI zoom level (Electron zoomFactor = 1.2^level), remembered across
   *  restarts like a mature editor's window zoom. 0 = 100%. */
  zoomLevel?: number;
}

/**
 * Persisted window layout, keyed PER workspace so N windows (Phase 3) each
 * restore their own geometry instead of clobbering one shared record.
 *
 * - `windows`: remembered geometry/zoom by workspace path (`''` = welcome).
 *   A workspace keeps its slot even while closed, so reopening it restores the
 *   size/position it had last time.
 * - `open`: the workspace keys that had a LIVE window at last quit — the
 *   session-restore list. Phase 2 runs a single window so it holds one key;
 *   Phase 3 reopens every key in it.
 */
export interface WindowStatesFile {
  version: 1;
  windows: Record<string, WindowState>;
  open: string[];
}

const defaultGeometry = (): WindowState => ({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });

const emptyFile = (): WindowStatesFile => ({ version: 1, windows: {}, open: [] });

/** Coerce an untrusted parsed object into a clean WindowState (drop NaN/Infinity/
 *  garbage), or null if it lacks a usable FINITE size. Every numeric field is
 *  finite-checked, not just `typeof number`, so a non-finite value can never reach
 *  `new BrowserWindow({ width: Infinity })`. */
function coerceGeometry(raw: unknown): WindowState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<WindowState>;
  if (!Number.isFinite(r.width) || !Number.isFinite(r.height)) return null;
  return {
    ...(Number.isFinite(r.x) && { x: r.x }),
    ...(Number.isFinite(r.y) && { y: r.y }),
    width: r.width as number,
    height: r.height as number,
    ...(typeof r.isMaximized === 'boolean' && { isMaximized: r.isMaximized }),
    ...(Number.isFinite(r.zoomLevel) && { zoomLevel: r.zoomLevel }),
  };
}

/**
 * Normalize an untrusted parsed JSON value into a clean WindowStatesFile,
 * tolerating both the new map shape and the OLD single-record shape
 * (`{ width, height, …, workspaceRoot }`) an earlier build wrote — migrating the
 * latter so a user's window geometry + which workspace was open survive the upgrade.
 */
function normalizeWindowStates(parsed: {
  windows?: unknown;
  open?: unknown;
  workspaceRoot?: unknown;
}): WindowStatesFile {
  // New format: a `windows` map.
  if (parsed.windows && typeof parsed.windows === 'object') {
    const windows: Record<string, WindowState> = {};
    for (const [key, raw] of Object.entries(parsed.windows as Record<string, unknown>)) {
      const geom = coerceGeometry(raw);
      if (geom) windows[key] = geom;
    }
    const open = Array.isArray(parsed.open)
      ? parsed.open.filter((k): k is string => typeof k === 'string')
      : [];
    return { version: 1, windows, open };
  }
  // Old single-record format → migrate to the map.
  const geom = coerceGeometry(parsed);
  if (!geom) return emptyFile();
  const key = typeof parsed.workspaceRoot === 'string' ? parsed.workspaceRoot : WELCOME_KEY;
  return { version: 1, windows: { [key]: geom }, open: [key] };
}

/** Read + normalize the per-workspace window-state file (async, for launch). */
export async function readWindowStates(configDir: string): Promise<WindowStatesFile> {
  try {
    return normalizeWindowStates(JSON.parse(await readFile(join(configDir, FILE_NAME), 'utf8')));
  } catch {
    return emptyFile();
  }
}

/** Synchronous read + normalize — the atomic read half of a sync read-modify-write
 *  (close/quit sync saves, and the async geometry save's last-moment re-read). */
function readWindowStatesSync(configDir: string): WindowStatesFile {
  try {
    return normalizeWindowStates(JSON.parse(readFileSync(join(configDir, FILE_NAME), 'utf8')));
  } catch {
    return emptyFile();
  }
}

/** The geometry remembered for a workspace key, or sensible defaults if the
 *  workspace has never been sized. */
export function geometryFor(file: WindowStatesFile, key: string): WindowState {
  return file.windows[key] ?? defaultGeometry();
}

// Read-modify-write of the single shared file must serialize, or two windows
// persisting at once (Phase 3) would each read-then-write and lose the other's
// slot. A main-process promise chain is enough — only main writes this file.
let writeChain: Promise<void> = Promise.resolve();

/**
 * Persist ONE window's geometry under `key`. The `open` session set is OWNED by
 * the sync writers (the close-handler reduces it; quit snapshots the full set) —
 * a geometry write only PRESERVES whatever they last wrote.
 *
 * Read-modify-write SYNCHRONOUSLY (after the async mkdir) so this can't interleave
 * with a sync close/quit write: an earlier design read async, then could resume
 * across its I/O and clobber a just-landed sync write — resurrecting a
 * deliberately-closed window in `open`. The sync RMW + last-moment re-read of `open`
 * closes that race; the async chain still serializes geometry writers against
 * each other.
 */
export function saveWindowState(configDir: string, key: string, state: WindowState): Promise<void> {
  const run = async (): Promise<void> => {
    await mkdir(configDir, { recursive: true });
    // Re-read at the last moment and write with NO await in between → atomic vs the
    // sync writers; `open` is taken from the freshest on-disk state, never overwritten.
    const file = readWindowStatesSync(configDir);
    file.windows[key] = state;
    writeFileSync(join(configDir, FILE_NAME), JSON.stringify(file, null, 2), 'utf8');
  };
  // Run after whatever's queued, SUCCEEDED OR FAILED (`.then(run, run)`) — so one
  // failed write (transient EACCES/ENOSPC) can't leave the chain permanently
  // rejected and silently skip every later save. The returned promise reflects
  // THIS write's real outcome (tests/callers can await it); the chain itself is
  // kept non-rejecting via the trailing `.catch`.
  const result = writeChain.then(run, run);
  writeChain = result.catch(() => undefined);
  return result;
}

/** Sync variant for the close / app-quit hooks (debounced async writes may not
 *  flush before exit). Reads + writes synchronously, so it can't interleave with
 *  the event loop — the authoritative writer of the `open` session set. */
export function saveWindowStateSync(
  configDir: string,
  key: string,
  state: WindowState,
  open: string[],
): void {
  const file = readWindowStatesSync(configDir);
  file.windows[key] = state;
  file.open = open;
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, FILE_NAME), JSON.stringify(file, null, 2), 'utf8');
}

/**
 * If saved x/y put the window entirely outside every display's workArea
 * (e.g. external monitor unplugged), drop the position so Electron centers
 * it. Size is preserved either way.
 */
export function clampToDisplays(state: WindowState, displays: Display[]): WindowState {
  if (state.x === undefined || state.y === undefined) return state;
  const windowRect: Rectangle = {
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
  };
  const visible = displays.some((d) => rectsOverlap(windowRect, d.workArea));
  if (visible) return state;
  const { x: _x, y: _y, ...rest } = state;
  return rest;
}

function rectsOverlap(a: Rectangle, b: Rectangle): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Trailing-edge debounce; call freely from move/resize events. */
export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  delayMs: number,
): (...args: TArgs) => void {
  let timer: NodeJS.Timeout | undefined;
  return (...args: TArgs) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}
