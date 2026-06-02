import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Display, Rectangle } from 'electron';

const FILE_NAME = 'window-state.json';
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;

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

const defaults = (): WindowState => ({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });

export async function readWindowState(configDir: string): Promise<WindowState> {
  try {
    const raw = await readFile(join(configDir, FILE_NAME), 'utf8');
    const parsed = JSON.parse(raw) as Partial<WindowState>;
    if (typeof parsed.width !== 'number' || typeof parsed.height !== 'number') {
      return defaults();
    }
    return {
      ...(typeof parsed.x === 'number' && { x: parsed.x }),
      ...(typeof parsed.y === 'number' && { y: parsed.y }),
      width: parsed.width,
      height: parsed.height,
      ...(typeof parsed.isMaximized === 'boolean' && { isMaximized: parsed.isMaximized }),
      ...(typeof parsed.zoomLevel === 'number' &&
        Number.isFinite(parsed.zoomLevel) && { zoomLevel: parsed.zoomLevel }),
    };
  } catch {
    return defaults();
  }
}

export async function writeWindowState(configDir: string, state: WindowState): Promise<void> {
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, FILE_NAME), JSON.stringify(state, null, 2), 'utf8');
}

/** Sync variant for app-quit hooks; debounced async writes may not flush
 * before exit. */
export function writeWindowStateSync(configDir: string, state: WindowState): void {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, FILE_NAME), JSON.stringify(state, null, 2), 'utf8');
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
