import type { Core } from '../../kernel/index.js';
import { commands } from './commands.js';

export function registerInboundModule(core: Core): void {
  for (const [name, handler] of commands()) {
    core.register(name, handler);
  }
}

export type * from './types.js';
