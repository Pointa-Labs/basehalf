import type { Core } from '../../kernel/index.js';
import { commands } from './commands.js';

export function registerWatcherModule(core: Core): void {
  for (const [name, handler] of commands()) {
    core.register(name, handler);
  }
}

export type * from './types.js';
export { _resetForTests as _resetWatcherForTests, watcherEvents } from './commands.js';
