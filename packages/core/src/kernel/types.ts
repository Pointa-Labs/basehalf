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
  /**
   * Raw-byte read, used when callers must distinguish invalid UTF-8 from text
   * that has already been decoded with replacement characters. Returns null if
   * missing. OPTIONAL so older mocks can fall back through `readFile`.
   */
  readFileBytes?(path: string): Promise<Uint8Array | null>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  /** `mtimeMs` is OPTIONAL (epoch ms of last content change) so older mocks
   *  stay valid; consumers that calibrate freshness (focus brief staleness)
   *  degrade gracefully when it's absent. */
  stat(path: string): Promise<{ isFile: boolean; isDirectory: boolean; mtimeMs?: number } | null>;
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
  /**
   * Read a file with O_NOFOLLOW on the final component — the open fails
   * (PathEscape) if the leaf is a symlink at OPEN time. Closes the check-then-
   * read TOCTOU that a path-string guard can't: after the realpath guard
   * returns a canonical path, an attacker racing a symlink onto the leaf would
   * otherwise be re-followed by a plain readFile. Returns null if missing.
   * OPTIONAL (legacy mocks fall back to plain readFile — no symlinks in play).
   */
  readFileNoFollow?(path: string): Promise<string | null>;
  /**
   * Raw-byte variant of `readFileNoFollow`. Production provides this so
   * content sniffing can validate bytes without losing the O_NOFOLLOW leaf
   * race protection.
   */
  readFileBytesNoFollow?(path: string): Promise<Uint8Array | null>;
  /**
   * Bounded-byte variant of `readFileBytesNoFollow`: read AT MOST `maxBytes`
   * from the start of the file (still O_NOFOLLOW on the leaf). Lets a capped
   * preview fetch a fixed prefix instead of slurping a multi-GB file into
   * memory before the cap/sniff runs. Returns null if missing. OPTIONAL —
   * callers fall back to read-whole-then-slice when absent (correct output,
   * just not memory-bounded; legacy mocks have no large files in play).
   */
  readFileBytesCappedNoFollow?(path: string, maxBytes: number): Promise<Uint8Array | null>;
  /**
   * Write a file with O_NOFOLLOW on the final component — refuses (PathEscape)
   * if the leaf is a symlink at OPEN time. The symmetric write-side close of
   * the check-then-write TOCTOU. With `excl: true` the open also adds O_EXCL
   * (and drops O_TRUNC) so the write REFUSES (EEXIST) if the leaf already
   * exists — the write-side twin of `copyFile({excl})`, letting a caller that
   * pre-picks a collision-free name close the pick-then-write race instead of
   * silently truncating a file that appeared in between. OPTIONAL (legacy mocks
   * fall back to writeFile).
   */
  writeFileNoFollow?(path: string, content: string, opts?: { excl?: boolean }): Promise<void>;
  /**
   * Byte-for-byte file copy. With `excl: true` the copy REFUSES (EEXIST) if
   * `dest` already exists — callers that pre-pick a collision-free name use it
   * to close the pick-then-copy race instead of clobbering. OPTIONAL: the
   * string-based writeFile fallback would corrupt binary content (PDFs,
   * images), so handlers that need a real copy degrade to read-string +
   * write-string ONLY for legacy mocks (which have no binary files in play).
   */
  copyFile?(src: string, dest: string, opts?: { excl?: boolean }): Promise<void>;
  /**
   * Atomically move/rename a file (node:fs `rename`) — a same-filesystem move.
   * Used by `workspace.renameFile` to retitle a note in place. OPTIONAL: legacy
   * mocks without it fall back to read-string + write + unlink, which is correct
   * for the text notes this serves (no atomicity, but no binary in play either).
   */
  rename?(from: string, to: string): Promise<void>;
  /**
   * Remove a file or directory (node:fs `rm`). `recursive: true` deletes a
   * non-empty directory and its contents; for a file it's ignored. This is the
   * PERMANENT-delete path behind `workspace.deleteEntry`: the desktop prefers
   * `trash` (recoverable) when present and only falls back here. OPTIONAL:
   * legacy mocks may omit it (the delete handler then falls back to `unlink`
   * for files and refuses a folder delete). Throws ENOENT if the path is
   * missing (no `force`).
   */
  rm?(path: string, opts?: { recursive?: boolean }): Promise<void>;
  /**
   * Move a file or directory to the OS trash / recycle bin — the RECOVERABLE
   * delete. Backed by Electron's `shell.trashItem` in the desktop host; pure
   * `node:fs` has no trash, so the CLI / default fs omit it and
   * `workspace.deleteEntry` falls back to `rm` (permanent). OPTIONAL by design:
   * its presence is exactly the "can we trash?" capability check.
   */
  trash?(path: string): Promise<void>;
  /**
   * Create a symbolic link at `path` pointing at `target`. Used for
   * `.bh/current_focus.yaml` — the Focus Mode entry point the agent reads each
   * turn is a symlink to the active node's `focus.yaml`. OPTIONAL: legacy mocks
   * may omit it; the focus module then falls back to a plain pointer file.
   * Throws EEXIST if `path` already exists (callers create-at-temp + rename for
   * an atomic retarget).
   */
  symlink?(target: string, path: string): Promise<void>;
  /**
   * Read a symlink's raw target string (node:fs `readlink`) WITHOUT resolving
   * it. Returns null if `path` is missing or is not a symlink. The current-focus
   * reader follows this, then re-canonicalizes + containment-checks the target
   * (a planted symlink could point outside the workspace). OPTIONAL: legacy
   * mocks fall back to reading a pointer file.
   */
  readlink?(path: string): Promise<string | null>;
}

/**
 * Per-call options threaded through `run`. `workspaceRoot` binds THIS call (and,
 * by default, every nested `ctx.run` it makes) to one workspace folder — the
 * replacement for the old global "current workspace" pointer. The host (desktop
 * `bh:run`) injects the sender window's bound root; a nested `ctx.run` with no
 * opts inherits the caller's root, so a whole command tree stays in one
 * workspace with zero global state. `null` means "no workspace bound".
 */
export interface RunOptions {
  readonly workspaceRoot?: string | null;
}

/**
 * The function modules use to call other commands. Same signature as
 * `Core.run` — modules compose through this rather than importing each
 * other's internals (preserves the "one door" + "deps point inward" rules).
 */
export type Run = <TArgs = unknown, TResult = unknown>(
  name: string,
  args: TArgs,
  opts?: RunOptions,
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
 * - `workspaceRoot` — the workspace folder THIS call is bound to (`null` if
 *   none). The per-call replacement for the old global current-workspace
 *   pointer: handlers anchor their root + path-containment here (via
 *   `requireWorkspaceRoot`) instead of asking a mutable global. Set from the
 *   `run({ workspaceRoot })` opt and inherited by nested `ctx.run` calls.
 * - `run` — call another command (module-to-module composition).
 */
export interface Context {
  readonly fs: FsLike;
  readonly configDir: string;
  readonly workspaceRoot: string | null;
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
