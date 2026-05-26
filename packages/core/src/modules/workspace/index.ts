import type { Core } from '../../kernel/index.js';
import { commands } from './commands.js';

/**
 * Registers all `workspace.*` commands. Called once at `createCore()` time.
 * v0 is statically composed; when external plugins land they'll do the same
 * dance dynamically through the same `core.register` surface.
 */
export function registerWorkspaceModule(core: Core): void {
  for (const [name, handler] of commands()) {
    core.register(name, handler);
  }
}

export type * from './types.js';
