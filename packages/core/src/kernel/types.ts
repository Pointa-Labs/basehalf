/**
 * Kernel type contracts. Modules use these to register handlers and to type
 * the `context` they receive. Kept deliberately minimal — this is the
 * "future plugin API" we keep free to evolve until external plugins arrive.
 */

/**
 * Minimal file-system surface modules use through `Context`. Tests inject a
 * mock; production wires `node:fs/promises`. Kept lean on purpose — grow as
 * modules need more, not preemptively.
 *
 * Conventions:
 * - `readFile` returns `null` if the file doesn't exist (avoids try/catch
 *   noise in handlers for "config doesn't exist yet" cases).
 * - `stat` returns `null` if the path doesn't exist.
 * - `mkdir` with `recursive: true` is idempotent.
 * - `readdir` returns just the basenames (no path prefix); empty array if
 *   the dir exists but is empty; throws on a missing dir.
 */
export interface FsLike {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  stat(path: string): Promise<{ isFile: boolean; isDirectory: boolean } | null>;
  readdir(path: string): Promise<string[]>;
  /** Removes a file; no-op if missing. Used by badge/view delete commands. */
  unlink(path: string): Promise<void>;
  /**
   * Canonical absolute path with every symlink resolved (`node:fs` realpath).
   * The kernel containment guards (`kernel/contain.ts`) use it to prove a
   * path stays inside the workspace root even when a planted symlink's name is
   * innocuous. OPTIONAL: production `defaultFs` always provides it (the real
   * security boundary); legacy in-memory mocks may omit it, and the guards
   * then fall back to the lexical (string-guarded) path. Throws ENOENT if the
   * path doesn't exist.
   */
  realpath?(path: string): Promise<string>;
  /**
   * `lstat` that does NOT follow a final-component symlink — used by the write
   * guard to refuse writing THROUGH a planted symlink leaf. Returns null if
   * the path is missing. OPTIONAL for the same back-compat reason as
   * `realpath`.
   */
  lstat?(path: string): Promise<{ isSymbolicLink: boolean } | null>;
}

/**
 * The function modules use to call other commands. Same signature as
 * `Core.run` — modules compose through this rather than importing each
 * other's internals (preserves the "one door" + "deps point inward" rules).
 */
export type Run = <TArgs = unknown, TResult = unknown>(
  name: string,
  args: TArgs,
) => Promise<TResult>;

/**
 * The Context passed to every command handler. The kernel's "what a module
 * may touch" surface — modules MUST NOT reach around it into kernel internals
 * or import `node:fs` directly (use `ctx.fs` so tests can swap it).
 *
 * Grows as modules need it. Today:
 * - `fs` — file access.
 * - `configDir` — where BaseHalf keeps user-global config (`~/.config/basehalf`
 *   on Linux/XDG, `~/Library/Application Support/basehalf` on macOS).
 * - `run` — call another command (module-to-module composition).
 */
export interface Context {
  readonly fs: FsLike;
  readonly configDir: string;
  readonly run: Run;
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

/** Options accepted by `createCore()`. Override defaults for tests / non-prod hosts. */
export interface CoreOptions {
  /** Inject a different FS (mock for tests). Defaults to `node:fs/promises`. */
  readonly fs?: FsLike;
  /** Override the global config directory. Defaults to XDG / OS conventions. */
  readonly configDir?: string;
}

/**
 * The shape returned by `createCore()`. Frozen at construction.
 * - `register(name, handler)` — modules call this at startup to add commands.
 * - `run(name, args)` — the one door; throws `UnknownCommand` if unregistered.
 * - `has(name)` — introspection.
 */
export interface Core {
  register<TArgs, TResult>(name: string, handler: Handler<TArgs, TResult>): void;
  run: Run;
  has(name: string): boolean;
}

/** Thrown by `run()` when no module has registered the requested command. */
export class UnknownCommand extends Error {
  override readonly name = 'UnknownCommand';
  constructor(public readonly command: string) {
    super(`Unknown command: ${command}`);
  }
}
