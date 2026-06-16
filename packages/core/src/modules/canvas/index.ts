import type { Core } from '../../index.js';
import { commands } from './commands.js';

/**
 * The canvas module owns `.bh/mirror/<folder>/canvas.yaml` — the visual layer of
 * a folder (card positions/sizes, connection anchors + labels). Its connect /
 * disconnect / reconnect commands keep the canvas edge in lockstep with the
 * semantic `badge.references` graph via ctx.run (never importing badges'
 * internals — deps point inward through the one door).
 */
export function registerCanvasModule(core: Core): void {
  for (const [name, handler] of commands()) {
    core.register(name, handler);
  }
}
