/**
 * @basehalf/core — the one door.
 *
 * `createCore()` builds the kernel: a registry of commands + the context every
 * handler receives. Modules call `register()` at startup to add commands;
 * everything else (CLI, MCP, desktop UI) talks to core exclusively via `run()`.
 *
 * v0 scaffold: no modules registered yet. `run()` throws `UnknownCommand` for
 * every name. PR 2+ wires the first real module (recommended: workspace root
 * management — wedge-independent, all features depend on it).
 */
import { Registry, UnknownCommand, createContext } from './kernel/index.js';
import type { Core, CoreOptions, Handler } from './kernel/index.js';

export function createCore(_opts: CoreOptions = {}): Core {
  const registry = new Registry();
  const ctx = createContext();

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

  return core;
}

// Re-export public types/error so consumers don't reach into `./kernel`.
export type { Context, Handler, CoreOptions, Core } from './kernel/index.js';
export { UnknownCommand } from './kernel/index.js';
