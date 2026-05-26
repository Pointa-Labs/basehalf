import type { Core } from '../../kernel/index.js';
import { commands } from './commands.js';

/**
 * Registers all `decision.*` commands. Called once at `createCore()` time.
 * Same shape as workspace module — modules are static composition today,
 * dynamic plugins later through the same `core.register` surface.
 */
export function registerDecisionsModule(core: Core): void {
  for (const [name, handler] of commands()) {
    core.register(name, handler);
  }
}

export type * from './types.js';
