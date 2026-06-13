/**
 * @basehalf/core — the one door.
 *
 * `createCore()` builds the kernel: a registry of commands + the context every
 * handler receives. First-party modules register themselves at construction;
 * everything else (CLI, MCP, desktop UI) talks to core exclusively via `run()`.
 *
 * The context's `run` is late-bound through a closure so modules can compose
 * (e.g. one module asking `workspace.current` for the active root) without
 * importing each other — preserves the "one door" + "deps point inward" rules.
 */
import { Registry, UnknownCommand, createContext } from './kernel/index.js';
import type { Context, Core, CoreOptions, Handler, Run } from './kernel/index.js';
import { registerBadgesModule } from './modules/badges/index.js';
import { registerFocusModule } from './modules/focus/index.js';
import { registerInboundModule } from './modules/inbound/index.js';
import { registerProposalsModule } from './modules/proposals/index.js';
import { registerSearchModule } from './modules/search/index.js';
import { registerWatcherModule } from './modules/watcher/index.js';
import { registerWorkspaceModule } from './modules/workspace/index.js';

export function createCore(opts: CoreOptions = {}): Core {
  const registry = new Registry();

  // Late-bound ctx: declared first so `run`'s closure can capture it,
  // assigned right after so `ctx.run = run` round-trip closes. Safe because
  // `run` is only invoked after createCore() returns — by then ctx is set.
  // biome-ignore lint/style/useConst: forward declaration; assignment happens after `run` is defined
  let ctx: Context;
  const run: Run = async (name, args) => {
    const handler = registry.get(name);
    if (!handler) {
      throw new UnknownCommand(name);
    }
    return (await handler(args, ctx)) as never;
  };

  ctx = createContext({
    run,
    ...(opts.fs !== undefined && { fs: opts.fs }),
    ...(opts.configDir !== undefined && { configDir: opts.configDir }),
  });

  const core: Core = Object.freeze({
    register<TArgs, TResult>(name: string, handler: Handler<TArgs, TResult>): void {
      registry.register(name, handler as Handler);
    },
    run,
    has(name: string): boolean {
      return registry.has(name);
    },
  });

  // First-party modules: registered here, statically composed. When external
  // plugins arrive they'll go through the same registry — just dynamic.
  registerWorkspaceModule(core);
  registerBadgesModule(core);
  registerInboundModule(core);
  registerFocusModule(core);
  registerWatcherModule(core);
  registerSearchModule(core);
  registerProposalsModule(core);

  return core;
}

// Re-export public types/error so consumers don't reach into `./kernel`.
export type { Context, FsLike, Handler, CoreOptions, Core, Run } from './kernel/index.js';
export { UnknownCommand, defaultConfigDir } from './kernel/index.js';

// Module result/args types — UI shells need these to narrow window.bh.run results.
export type * from './modules/workspace/types.js';
export type * from './modules/badges/types.js';
export { BadgeCorrupt } from './modules/badges/types.js';
export type * from './modules/inbound/types.js';
export type * from './modules/focus/types.js';
export type * from './modules/watcher/types.js';
export type * from './modules/search/types.js';
export type * from './modules/proposals/types.js';
export { _resetWatcherForTests, watcherEvents } from './modules/watcher/index.js';
