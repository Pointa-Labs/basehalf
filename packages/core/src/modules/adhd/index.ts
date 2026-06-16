import type { Core } from '../../index.js';
import { commands } from './commands.js';

/**
 * The adhd module owns `.bh/mirror/<file>/adhd.yaml` — per-file reading aids
 * (highlight keywords + read line-ranges). Standalone per-file metadata: no
 * cascades, the same kernel mirror-store seam as badge/canvas/focus.
 */
export function registerAdhdModule(core: Core): void {
  for (const [name, handler] of commands()) {
    core.register(name, handler);
  }
}
