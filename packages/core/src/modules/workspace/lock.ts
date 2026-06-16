import { createKeyedMutex } from '../../kernel/index.js';

/**
 * Shared workspace-name + config-lock primitives.
 *
 * These live in their own leaf file (kernel-only import) so every workspace
 * sibling — the registry handlers in commands.ts, viewport.ts's setViewport,
 * demo.ts's createDemo — imports them DOWNWARD. Keeping them here instead of in
 * commands.ts avoids a static import cycle: commands.ts imports the moved
 * handlers (viewport/demo) to build its registration table, so if those
 * handlers imported the mutex/pattern back FROM commands.ts the cycle would
 * close around a module-eval-time singleton (createKeyedMutex()) — exactly the
 * fragile case.
 */

/** Allowed workspace names: alnum start, then a-z 0-9 . _ - , 1-64 chars. */
export const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

// Serialize read → mutate → write on the single workspaces.json config per
// configDir. add / use / remove / rename / repath / setViewport all do this
// dance; the desktop fires setViewport as a DEBOUNCED, un-awaited call that
// is NOT behind the renderer's busy guard, so it can race a workspace switch
// in-process — both read the pre-write config and the second write clobbers
// the first (lost workspace, or a reverted `current` pointer silently undoing
// the switch). Reproduced by test/workspace-config-concurrency.test.ts.
// Single-process scope like the mirror store's lock — see kernel/mutex.ts. The lock
// wraps only the config read-modify-write; slow materialization stays
// outside it. No config handler calls another while holding the lock, so
// there is no re-entrancy/deadlock (createDemo delegates to add/use, which
// take and release the lock themselves).
//
// MUST be a single shared instance across every workspaces.json mutator — it
// is declared here (one module = one eval) so add/use/remove/rename/repath
// (commands.ts) and setViewport (viewport.ts) all close over the SAME mutex.
// Do NOT create a second createKeyedMutex() in a sibling file or the
// setViewport-vs-switch lost-update race reopens.
export const withConfigLock = createKeyedMutex();
