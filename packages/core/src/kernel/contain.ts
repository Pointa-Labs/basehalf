import { basename, dirname, join, normalize, sep } from 'node:path';
import type { FsLike } from './types.js';

/**
 * Realpath-based workspace containment — the guard a *string* check
 * (`assertWorkspaceRelative`) structurally cannot provide.
 *
 * Threat model: a BaseHalf workspace is "a folder you drop in" — it may be
 * cloned, synced, or attacker-crafted, and the whole `.bh/` tree travels with
 * it in git. A planted symlink whose NAME is innocuous (no `..`, not absolute)
 * still escapes the workspace root once `node:fs` follows it: a read leaks an
 * outside file, a write clobbers/plants one, a directory walk enumerates (or
 * loops over) the filesystem. `assertWorkspaceRelative` only inspects the
 * request string; the `..` lives in the symlink's on-disk TARGET, which it
 * never sees.
 *
 * So every core file op that joins a path under a workspace root canonicalizes
 * with `fs.realpath` and requires the real target to be the real root or
 * strictly beneath it. This mirrors `desktop/src/main/workspacePath.ts`
 * `resolveInsideWorkspace` (the fix already shipped for `shell:open-path`),
 * lifted into the kernel so badges / focus / views / inbound / workspace
 * read+write+walk all enforce one identical rule.
 *
 * `realpath`/`lstat` are OPTIONAL on `FsLike`: production `defaultFs` always
 * provides them (the real security boundary), while legacy in-memory test
 * mocks may omit them — in which case the guards fall back to the lexical
 * (already string-guarded) path, preserving today's behavior with no symlinks
 * in play.
 *
 * Threat scope. These guards fully close the STATIC class: a symlink (file,
 * dir, dangling, cyclic) planted in a workspace you open/clone/sync. A
 * stronger, live attacker — a concurrent process racing the filesystem during
 * your read/write — meets two layers: (1) the leaf TOCTOU (swap the final
 * component for a symlink between this check and the op) is closed across
 * EVERY contained read/write — user files AND the `.bh/` JSON stores — by
 * O_NOFOLLOW reads/writes (`readMaybeNoFollow` / `writeMaybeNoFollow` over
 * `FsLike.readFileNoFollow` / `writeFileNoFollow`), which refuse a symlink leaf
 * at OPEN time rather than re-following a re-resolved path string; (2) an
 * INTERMEDIATE-component swap (race a DIRECTORY in the path into an escaping
 * symlink) remains an accepted residual for v0 — closing it needs
 * `openat2(RESOLVE_BENEATH)` / per-component `O_NOFOLLOW` traversal, which
 * Node's stdlib doesn't expose. It requires an active local attacker process
 * with write access inside the workspace and precise timing, and is uniform
 * across all paths.
 */

/** Thrown when a canonicalized path escapes (or routes through a symlink out
 *  of) the workspace root. Carries `name='PathEscape'` so robust callers
 *  (workspace-open materialize, list walks) can skip-and-continue by name
 *  without importing this class. */
export class PathEscape extends Error {
  override readonly name = 'PathEscape';
  constructor(public readonly rel: string) {
    super(`Refusing to access a path outside the workspace: ${rel}`);
  }
}

function isENOENT(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  );
}

/**
 * Canonicalize `p` by `realpath`-resolving its DEEPEST EXISTING ANCESTOR and
 * recomposing the not-yet-existing remainder. Returns a normalized absolute
 * path even when `p` (or all of it) is missing — so it works for write targets
 * that don't exist yet. Any symlink in an existing component is collapsed to
 * its true on-disk location (the whole point: a planted symlink resolves to
 * where it really points, which the caller's containment check then rejects).
 *
 * Only ENOENT is swallowed (keep walking up); other realpath errors propagate.
 * Falls back to a lexical `normalize(p)` when the fs has no `realpath`.
 */
export async function canonicalize(fs: FsLike, p: string): Promise<string> {
  const norm = normalize(p);
  if (!fs.realpath) return norm;
  const suffix: string[] = [];
  let cur = norm;
  for (;;) {
    try {
      const real = await fs.realpath(cur);
      return suffix.length > 0 ? join(real, ...suffix) : real;
    } catch (err) {
      // A path we cannot resolve is not safely containable. ENOENT only means
      // "doesn't exist YET" — keep walking up to the deepest existing ancestor
      // so not-yet-created write targets still work. ANY OTHER realpath failure
      // (ELOOP on a symlink cycle, EACCES, ENOTDIR) means we cannot prove where
      // this path really points → refuse. Mapping it to PathEscape lets the
      // robust callers (materialize, the list walks) skip it by name instead of
      // aborting workspace open with a raw ELOOP.
      if (!isENOENT(err)) throw new PathEscape(cur);
      // ENOENT — but is `cur` a DANGLING SYMLINK rather than a truly-absent
      // component? realpath ENOENTs both, yet lstat still sees the symlink. A
      // dangling symlink must NOT be recomposed into its own contained-looking
      // path: readFile/writeFile would re-follow it at op time, so an attacker
      // who races the target into existence escapes (TOCTOU on the read path),
      // and a dangling symlinked DIRECTORY in a write path would plant a file
      // outside once mkdir -p follows it. Refuse.
      if (fs.lstat) {
        const ls = await fs.lstat(cur);
        if (ls?.isSymbolicLink) throw new PathEscape(cur);
      }
      const parent = dirname(cur);
      if (parent === cur) {
        // Walked to the filesystem root and it still ENOENTs — nothing on this
        // path exists, so there is no symlink to follow. Lexical is safe
        // because the caller already string-guarded the relative part.
        return suffix.length > 0 ? join(cur, ...suffix) : cur;
      }
      suffix.unshift(basename(cur));
      cur = parent;
    }
  }
}

/** True if `real` is `realRoot` itself or strictly beneath it. */
export function isContained(realRoot: string, real: string): boolean {
  return real === realRoot || real.startsWith(realRoot + sep);
}

/**
 * READ policy: canonicalize the full target and require it inside `root`.
 * Returns the canonical path to read (so the check and the open agree — no
 * lexical-vs-real gap). A symlink pointing at an existing outside file is
 * rejected here; a symlink whose target is MISSING canonicalizes to a
 * contained-looking path and then simply reads as "not found" (null) — no leak.
 */
export async function assertReadContained(
  fs: FsLike,
  root: string,
  lexicalPath: string,
): Promise<string> {
  if (!fs.realpath) return lexicalPath;
  const realRoot = await canonicalize(fs, root);
  const real = await canonicalize(fs, lexicalPath);
  if (!isContained(realRoot, real)) {
    throw new PathEscape(relLabel(root, lexicalPath));
  }
  return real;
}

/**
 * WRITE/DELETE policy: contain the PARENT directory (catches a symlinked
 * directory component, e.g. `drafts -> /outside`), then REFUSE if the final
 * component is itself a symlink — writing/unlinking THROUGH a symlink leaf is
 * never something bh legitimately does, and refusing it closes both the
 * existing-symlink-to-outside and the dangling-symlink-to-outside holes that a
 * realpath-of-the-leaf check cannot (a dangling link ENOENTs and would look
 * contained). Returns the canonical leaf path (under the real parent) to
 * operate on.
 */
export async function assertWriteContained(
  fs: FsLike,
  root: string,
  lexicalPath: string,
): Promise<string> {
  if (!fs.realpath) return lexicalPath;
  const realRoot = await canonicalize(fs, root);
  const realParent = await canonicalize(fs, dirname(lexicalPath));
  if (!isContained(realRoot, realParent)) {
    throw new PathEscape(relLabel(root, lexicalPath));
  }
  const leaf = join(realParent, basename(lexicalPath));
  if (fs.lstat) {
    const ls = await fs.lstat(leaf);
    if (ls?.isSymbolicLink) {
      throw new PathEscape(relLabel(root, lexicalPath));
    }
  }
  return leaf;
}

/**
 * Read `abs` with O_NOFOLLOW when the fs supports it (production), else plain
 * read (legacy mocks). Pair with `assertReadContained` so EVERY contained read
 * — user files AND the `.bh/` JSON stores — gets the same leaf-swing TOCTOU
 * close, not just workspace.readFile.
 */
export async function readMaybeNoFollow(fs: FsLike, abs: string): Promise<string | null> {
  return fs.readFileNoFollow ? fs.readFileNoFollow(abs) : fs.readFile(abs);
}

/** Write `abs` with O_NOFOLLOW when supported, else plain write. */
export async function writeMaybeNoFollow(fs: FsLike, abs: string, content: string): Promise<void> {
  if (fs.writeFileNoFollow) await fs.writeFileNoFollow(abs, content);
  else await fs.writeFile(abs, content);
}

/** Best-effort short label for error messages (the rel part under root). */
function relLabel(root: string, lexicalPath: string): string {
  const r = normalize(root);
  const p = normalize(lexicalPath);
  return p.startsWith(r + sep) ? p.slice(r.length + 1) : p;
}
