/**
 * Kernel type contracts. Modules use these to register handlers and to type
 * the `context` they receive. Kept deliberately minimal in v0 — this is the
 * "future plugin API" we keep free to evolve until external plugins arrive.
 */

/**
 * The Context passed to every command handler. The kernel's "what a module
 * may touch" surface — modules MUST NOT reach around it into kernel internals.
 *
 * v0 stub: the fields are placeholders. Real shape grows with modules:
 *  - file access (FS abstraction)
 *  - workspace root(s)
 *  - emitting events
 *  - logger
 *  - calling other commands (via `run`)
 */
export interface Context {
  /** Marker only in v0; concrete fields land as modules are added. */
  readonly _kernel: true;
}

/**
 * A command handler. Receives the typed args and the kernel context.
 * Returns a value (sync or async). The kernel never inspects what's returned —
 * it's the caller's contract with the module.
 */
export type Handler<TArgs = unknown, TResult = unknown> = (
  args: TArgs,
  ctx: Context,
) => TResult | Promise<TResult>;

/** Options accepted by `createCore()`. v0 has no fields — reserved for growth. */
export interface CoreOptions {
  /** Marker only; concrete options land later. */
  readonly _reserved?: never;
}

/**
 * The shape returned by `createCore()`. Frozen at construction.
 * - `register(name, handler)` — modules call this at startup to add commands.
 * - `run(name, args)` — the one door; throws `UnknownCommand` if unregistered.
 * - `has(name)` — introspection.
 */
export interface Core {
  register<TArgs, TResult>(name: string, handler: Handler<TArgs, TResult>): void;
  run<TArgs = unknown, TResult = unknown>(name: string, args: TArgs): Promise<TResult>;
  has(name: string): boolean;
}

/** Thrown by `run()` when no module has registered the requested command. */
export class UnknownCommand extends Error {
  override readonly name = 'UnknownCommand';
  constructor(public readonly command: string) {
    super(`Unknown command: ${command}`);
  }
}
