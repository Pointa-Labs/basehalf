/**
 * @basehalf/core — the one door.
 *
 * `createCore()` builds the kernel: a registry of commands + the context every
 * handler receives. First-party modules register themselves at construction;
 * everything else (CLI, MCP, desktop UI) talks to core exclusively via `run()`.
 */
import { Registry, UnknownCommand, createContext } from './kernel/index.js';
import type { Core, CoreOptions, Handler } from './kernel/index.js';
import { registerWorkspaceModule } from './modules/workspace/index.js';

export function createCore(opts: CoreOptions = {}): Core {
  const registry = new Registry();
  const ctx = createContext({
    ...(opts.fs !== undefined && { fs: opts.fs }),
    ...(opts.configDir !== undefined && { configDir: opts.configDir }),
  });

  const core: Core = Object.freeze({
    register<TArgs, TResult>(name: string, handler: Handler<TArgs, TResult>): void {
      registry.register(name, handler as Handler);
    },

    async run<TArgs = unknown, TResult = unknown>(name: string, args: TArgs): Promise<TResult> {
      const handler = registry.get(name);
      if (!handler) {
        throw new UnknownCommand(name);
      }
      return (await handler(args, ctx)) as TResult;
    },

    has(name: string): boolean {
      return registry.has(name);
    },
  });

  // First-party modules: registered here, statically composed. When external
  // plugins arrive they'll go through the same registry — just dynamic.
  registerWorkspaceModule(core);

  return core;
}

// Re-export public types/error so consumers don't reach into `./kernel`.
export type { Context, FsLike, Handler, CoreOptions, Core } from './kernel/index.js';
export { UnknownCommand } from './kernel/index.js';
