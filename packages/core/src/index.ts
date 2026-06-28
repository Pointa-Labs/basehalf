/**
 * @basehalf/core — legacy command registry backend.
 *
 * `createCore()` builds the current command registry + the context every handler
 * receives. Desktop code should depend on VS Code-style services/providers and
 * treat this package as one backend implementation while the architecture is
 * being split apart.
 *
 * The context's `run` is late-bound through a closure so modules can compose
 * (e.g. one module asking `workspace.current` for the active root) without
 * importing each other while this registry layer remains in place.
 */
import { Registry, UnknownCommand, createContext } from './kernel/index.js';
import type { Context, Core, CoreOptions, Handler, Run } from './kernel/index.js';
import { registerAdhdModule } from './modules/adhd/index.js';
import { registerBadgesModule } from './modules/badges/index.js';
import { registerCanvasModule } from './modules/canvas/index.js';
import { registerFocusModule } from './modules/focus/index.js';
import { registerGitModule } from './modules/git/index.js';
import { registerSearchModule } from './modules/search/index.js';
import { registerSettingsModule } from './modules/settings/index.js';
import { registerWatcherModule } from './modules/watcher/index.js';
import { registerWorkspaceModule } from './modules/workspace/index.js';

export function createCore(opts: CoreOptions = {}): Core {
  const registry = new Registry();

  // Base ctx carries the authoritative fs/configDir (its workspaceRoot is null
  // and its own `run` is unused for composition — every call builds its own).
  // Late-bound through a closure so it can be captured before assignment; safe
  // because `run` is only invoked after createCore() returns.
  // biome-ignore lint/style/useConst: forward declaration; assignment happens after `run` is defined
  let baseCtx: Context;
  const run: Run = async (name, args, runOpts) => {
    const handler = registry.get(name);
    if (!handler) {
      throw new UnknownCommand(name);
    }
    // Per-call Context: same fs/configDir, THIS call's workspaceRoot, and a
    // composing `run` whose nested calls DEFAULT to the same root (explicit
    // opts override). So `canvas.get`→`listFiles`, a watcher finalize→
    // `badge.markOrphan`, etc. all stay in one workspace with no global leakage.
    const workspaceRoot = runOpts?.workspaceRoot ?? null;
    const callCtx: Context = {
      fs: baseCtx.fs,
      configDir: baseCtx.configDir,
      workspaceRoot,
      run: (n, a, o) => run(n, a, o ?? { workspaceRoot }),
      git: baseCtx.git,
    };
    return (await handler(args, callCtx)) as never;
  };

  baseCtx = createContext({
    run,
    ...(opts.fs !== undefined && { fs: opts.fs }),
    ...(opts.configDir !== undefined && { configDir: opts.configDir }),
    ...(opts.git !== undefined && { git: opts.git }),
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
  registerCanvasModule(core);
  registerFocusModule(core);
  registerAdhdModule(core);
  registerWatcherModule(core);
  registerSearchModule(core);
  registerSettingsModule(core);
  registerGitModule(core);

  return core;
}

// Re-export public types/error so consumers don't reach into `./kernel`.
export type {
  Context,
  FsLike,
  GitRunner,
  GitRunOptions,
  GitRunResult,
  Handler,
  CoreOptions,
  Core,
  Run,
  RunOptions,
} from './kernel/index.js';
export {
  GitError,
  UnknownCommand,
  defaultConfigDir,
  defaultFs,
  defaultGit,
  requireWorkspaceRoot,
} from './kernel/index.js';

// Module result/args types — desktop service/channel adapters use these to keep
// the legacy registry backend typed while it is being split apart.
export type * from './modules/workspace/types.js';
export type * from './modules/badges/types.js';
export { BadgeCorrupt } from './modules/badges/types.js';
export type * from './modules/canvas/types.js';
export { CanvasCorrupt, CANVAS_ANCHORS } from './modules/canvas/types.js';
export type * from './modules/adhd/types.js';
export { AdhdCorrupt } from './modules/adhd/types.js';
export type * from './modules/focus/types.js';
export { FocusCorrupt } from './modules/focus/types.js';
export type * from './modules/git/types.js';
export type * from './modules/watcher/types.js';
export type * from './modules/search/types.js';
export type * from './modules/settings/types.js';
export { InvalidSettingValue, UnknownSetting } from './modules/settings/types.js';
export type {
  SettingDescriptor,
  SettingScope,
  SettingType,
  SettingValue,
} from './modules/settings/registry.js';
export { _resetWatcherForTests, watcherEvents } from './modules/watcher/index.js';
