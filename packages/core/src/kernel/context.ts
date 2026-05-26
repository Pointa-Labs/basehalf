import type { Context } from './types.js';

/**
 * Build the Context handed to every command handler.
 *
 * v0: returns a frozen marker object. As modules land they'll need real
 * capabilities (FS, workspace roots, logger). When that happens, grow the
 * `Context` interface in `types.ts` and have this builder wire the impls —
 * don't let modules construct context themselves.
 */
export function createContext(): Context {
  return Object.freeze({ _kernel: true } as const);
}
