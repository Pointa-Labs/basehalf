import type { Core } from '../../src/index.js';

/**
 * Wrap a core so every `run()` defaults to a fixed `workspaceRoot` — the
 * test-side stand-in for the desktop's per-window service channels (main
 * resolves the sender window's bound root and passes `{ workspaceRoot }` into
 * the core adapter behind that channel).
 *
 * After the per-window refactor there is no global "current workspace": a
 * handler reads its root from `ctx.workspaceRoot`, so a test that operates on
 * one workspace binds the core to that root once here instead of calling
 * `workspace.use`. An explicit `opts` arg on a call still overrides the default
 * (so a multi-workspace test can target another root per call). `register` /
 * `has` are forwarded unchanged.
 *
 * The handle is interchangeable with a raw `Core`; the underlying core is shared
 * (same registry), so a test can keep the raw `createCore()` result around for
 * unbound-call assertions and bind a view of it for the rest.
 */
export function boundCore(core: Core, root: string): Core {
  return {
    register: core.register,
    has: core.has,
    run: ((name: string, args: unknown, opts?: { workspaceRoot?: string | null }) =>
      core.run(name, args, opts ?? { workspaceRoot: root })) as Core['run'],
  };
}
