/**
 * The `.bh/mirror/` YAML store — the shared seam every Focus-Mode content
 * module (badge / canvas / focus / adhd) writes through.
 *
 * Per `private-docs/focus_mode_spec`, each file/folder node owns a directory
 * under `.bh/mirror/<relpath>/` holding up to four YAML files:
 *   .bh/mirror/<relpath>/badge.yaml   (file + folder)
 *   .bh/mirror/<folderpath>/canvas.yaml (folder only)
 *   .bh/mirror/<relpath>/focus.yaml   (file + folder)
 *   .bh/mirror/<filepath>/adhd.yaml   (file only)
 * The workspace ROOT folder is `rel === ''` → `.bh/mirror/<kind>.yaml`.
 *
 * NOTE the routing maps a FILE path onto a DIRECTORY: the badge for
 * `docs/ch1.md` lives at `.bh/mirror/docs/ch1.md/badge.yaml` (a dir literally
 * named `ch1.md`). A user file named exactly `badge.yaml` (etc.) inside an
 * annotated folder is the one ambiguous case the spec's layout admits; it is a
 * rare edge and left as a known limitation rather than deviating from the spec.
 *
 * Lives in the kernel (not a module) because it is cross-cutting infrastructure
 * — like `contain`, `paths`, `mutex`. The four content modules depend on it
 * without importing each other while the registry backend remains in place.
 * It centralizes: path routing, YAML (de)serialization, the same realpath
 * containment + O_NOFOLLOW guards the badge store used, and a process-wide
 * keyed mutex so a field-scoped read-modify-write can't lose a concurrent
 * write to the same file (the race the spec calls out — user-edits-in-app vs
 * agent-edits-.bh).
 */
import { dirname, join, relative, sep } from 'node:path';
import { parse, stringify } from 'yaml';
import {
  assertReadContained,
  assertWriteContained,
  canonicalize,
  isContained,
  readMaybeNoFollow,
  writeMaybeNoFollow,
} from './contain.js';
import { createKeyedMutex } from './mutex.js';
import { assertWorkspaceRelative } from './paths.js';
import type { FsLike } from './types.js';

export type MirrorKind = 'badge' | 'canvas' | 'focus' | 'adhd';

const MIRROR_DIR = '.bh/mirror';

/** Thrown when a mirror YAML file exists but does not parse. Carries
 *  `name='MirrorCorrupt'` so robust callers (list walks) skip-and-continue by
 *  name without importing this class. */
export class MirrorCorrupt extends Error {
  override readonly name = 'MirrorCorrupt';
  constructor(
    public readonly rel: string,
    public readonly kind: MirrorKind,
    opts?: { cause?: unknown },
  ) {
    super(`Corrupt ${kind}.yaml for "${rel || '<root>'}"`, opts);
  }
}

/**
 * `''`/`'.'` denote the workspace ROOT node (folder). Any other rel must be
 * workspace-relative (no `..`, not absolute) — the same guard the badge store
 * runs so a traversal path can't escape `.bh/mirror/` through `path.join`.
 */
function normalizeRel(rel: string): string {
  if (rel === '' || rel === '.' || rel === './') return '';
  const trimmed = rel.replace(/^\.\//, '');
  assertWorkspaceRelative(trimmed);
  return trimmed;
}

/** `<workspace>/.bh/mirror/<rel>` (the node's directory; root → `.bh/mirror`). */
export function mirrorNodeDir(workspaceRoot: string, rel: string): string {
  const norm = normalizeRel(rel);
  return norm ? join(workspaceRoot, MIRROR_DIR, norm) : join(workspaceRoot, MIRROR_DIR);
}

/** `<workspace>/.bh/mirror/<rel>/<kind>.yaml`. */
export function mirrorPath(workspaceRoot: string, rel: string, kind: MirrorKind): string {
  return join(mirrorNodeDir(workspaceRoot, rel), `${kind}.yaml`);
}

// `lineWidth: 0` disables YAML line folding so paths/descriptions stay on one
// line — stable git diffs and readable files. `yaml.stringify` already ends
// with a newline.
function serialize(data: unknown): string {
  return stringify(data, { lineWidth: 0 });
}

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

// Process-wide serialization keyed by the (lexical) mirror file path. A
// field-scoped RMW (`patchMirror`) holds the key across its read+write so a
// second writer to the SAME file can't read stale state and clobber the first.
// Distinct files (distinct keys) still run concurrently. Keys are absolute
// paths, so different workspaces / test temp dirs never falsely serialize.
const withMirrorLock = createKeyedMutex();

/** Read + parse a node's `<kind>.yaml`. `null` if the file doesn't exist;
 *  throws `MirrorCorrupt` if it exists but won't parse. */
export async function readMirror<T = unknown>(
  fs: FsLike,
  workspaceRoot: string,
  rel: string,
  kind: MirrorKind,
): Promise<T | null> {
  const path = await assertReadContained(fs, workspaceRoot, mirrorPath(workspaceRoot, rel, kind));
  const raw = await readMaybeNoFollow(fs, path);
  if (raw === null) return null;
  try {
    return (parse(raw) ?? null) as T | null;
  } catch (cause) {
    throw new MirrorCorrupt(normalizeRel(rel), kind, { cause });
  }
}

/** Serialize + write a node's `<kind>.yaml` (whole file), creating the node
 *  directory as needed. Serialized against concurrent writes to the same file. */
export async function writeMirror<T>(
  fs: FsLike,
  workspaceRoot: string,
  rel: string,
  kind: MirrorKind,
  data: T,
): Promise<void> {
  const lexical = mirrorPath(workspaceRoot, rel, kind);
  await withMirrorLock(lexical, async () => {
    const path = await assertWriteContained(fs, workspaceRoot, lexical);
    await fs.mkdir(dirname(path), { recursive: true });
    await writeMaybeNoFollow(fs, path, serialize(data));
  });
}

/**
 * Field-scoped read-modify-write: read the current value (or `null` if absent),
 * apply `patch`, write the result back — all under one lock so a concurrent
 * writer can't lose this update (the race the spec calls out). Returning `null`
 * from `patch` removes the file. Returns the value written (or `null`).
 */
export async function patchMirror<T>(
  fs: FsLike,
  workspaceRoot: string,
  rel: string,
  kind: MirrorKind,
  patch: (current: T | null) => T | null,
): Promise<T | null> {
  const lexical = mirrorPath(workspaceRoot, rel, kind);
  return withMirrorLock(lexical, async () => {
    const readPath = await assertReadContained(fs, workspaceRoot, lexical);
    const raw = await readMaybeNoFollow(fs, readPath);
    let current: T | null = null;
    if (raw !== null) {
      try {
        current = (parse(raw) ?? null) as T | null;
      } catch (cause) {
        throw new MirrorCorrupt(normalizeRel(rel), kind, { cause });
      }
    }
    const next = patch(current);
    const writePath = await assertWriteContained(fs, workspaceRoot, lexical);
    if (next === null) {
      const st = await fs.stat(writePath);
      if (st) await fs.unlink(writePath);
    } else {
      await fs.mkdir(dirname(writePath), { recursive: true });
      await writeMaybeNoFollow(fs, writePath, serialize(next));
    }
    return next;
  });
}

/** Remove a node's `<kind>.yaml`. Returns false if it wasn't there. */
export async function removeMirror(
  fs: FsLike,
  workspaceRoot: string,
  rel: string,
  kind: MirrorKind,
): Promise<boolean> {
  const lexical = mirrorPath(workspaceRoot, rel, kind);
  return withMirrorLock(lexical, async () => {
    const path = await assertWriteContained(fs, workspaceRoot, lexical);
    const st = await fs.stat(path);
    if (!st) return false;
    await fs.unlink(path);
    return true;
  });
}

/**
 * Walk `.bh/mirror/` and return every node that has a `<kind>.yaml`, paired
 * with its rel path (`''` for the root). Symlink-safe + corrupt-tolerant in the
 * same way as the badge store's `listBadges`: a hostile/looping symlink or a
 * single unparseable file is skipped, never crashes the listing. Sorted by rel.
 */
export async function listMirror<T = unknown>(
  fs: FsLike,
  workspaceRoot: string,
  kind: MirrorKind,
): Promise<Array<{ rel: string; data: T }>> {
  const mirrorRoot = join(workspaceRoot, MIRROR_DIR);
  const out: Array<{ rel: string; data: T }> = [];
  let realRoot: string;
  let realMirror: string;
  try {
    realRoot = await canonicalize(fs, workspaceRoot);
    realMirror = await canonicalize(fs, mirrorRoot);
  } catch {
    return out;
  }
  if (!isContained(realRoot, realMirror)) return out;
  const visited = new Set<string>();
  await walkDirs(fs, realRoot, mirrorRoot, realMirror, visited, async (lexicalDir) => {
    const rel = toPosix(relative(mirrorRoot, lexicalDir));
    let data: T | null;
    try {
      data = await readMirror<T>(fs, workspaceRoot, rel, kind);
    } catch {
      console.warn(`[bh] skipping corrupt ${kind}.yaml: ${rel || '<root>'}`);
      return;
    }
    if (data !== null) out.push({ rel, data });
  });
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** True when `rel` is the node `root` itself or a descendant of it (prefix on a
 *  path boundary, so `docs` matches `docs` and `docs/a` but not `docs-2`). */
export function isMirrorSubtree(rel: string, root: string): boolean {
  return rel === root || rel.startsWith(`${root}/`);
}

/** Re-root a subtree rel from under `from` to under `to` (`from` → `to`,
 *  `from/x` → `to/x`). Caller guarantees `isMirrorSubtree(rel, from)`. */
export function remapSubtreeRel(rel: string, from: string, to: string): string {
  return rel === from ? to : `${to}${rel.slice(from.length)}`;
}

/**
 * Move every `<kind>.yaml` in the subtree rooted at `from` to the matching
 * location under `to`, applying `remap` (default: just rewrite the top-level
 * `path` field to the new location-derived rel). Used by the rename cascade so a
 * node's canvas/focus/adhd mirror files follow the file/folder when it moves
 * (badge.yaml + the reference graph are moved separately by badge.rename). Returns
 * the {from,to} rel pairs actually moved. The old (now-empty) node directories are
 * left in place — harmless, since the mirror is sparse and read by walking for
 * yaml, not dirs.
 */
export async function relocateMirrorKind<T extends { path: string }>(
  fs: FsLike,
  workspaceRoot: string,
  kind: MirrorKind,
  from: string,
  to: string,
  remap?: (data: T, newRel: string) => T,
): Promise<Array<{ from: string; to: string }>> {
  if (from === to) return [];
  // Moving a node INTO its own subtree (`to` under `from`) would self-collide in
  // the write-before-remove walk below — iter 1 writes the new location, a later
  // iter removes it. It's also physically impossible on disk (fs.rename rejects
  // it), so callers never hit this; reject defensively rather than corrupt.
  if (isMirrorSubtree(to, from)) {
    throw new Error(`relocateMirrorKind: cannot move "${from}" into its own subtree "${to}"`);
  }
  const all = await listMirror<T>(fs, workspaceRoot, kind);
  const moved: Array<{ from: string; to: string }> = [];
  for (const { rel, data } of all) {
    if (!isMirrorSubtree(rel, from)) continue;
    const newRel = remapSubtreeRel(rel, from, to);
    const next = remap ? remap(data, newRel) : ({ ...data, path: newRel } as T);
    await writeMirror(fs, workspaceRoot, newRel, kind, next);
    await removeMirror(fs, workspaceRoot, rel, kind);
    moved.push({ from: rel, to: newRel });
  }
  return moved;
}

/** Remove every `<kind>.yaml` in the subtree rooted at `path` (a node + its
 *  descendants). Returns how many files were removed. */
export async function purgeMirrorKind(
  fs: FsLike,
  workspaceRoot: string,
  kind: MirrorKind,
  path: string,
): Promise<number> {
  const all = await listMirror<{ path: string }>(fs, workspaceRoot, kind);
  let removed = 0;
  for (const { rel } of all) {
    if (!isMirrorSubtree(rel, path)) continue;
    if (await removeMirror(fs, workspaceRoot, rel, kind)) removed++;
  }
  return removed;
}

/**
 * A CHEAP signature of a kind across the mirror tree — file count + newest
 * mtime — without parsing any YAML. Lets a UI poll detect that an external
 * writer (an agent) touched `.bh/mirror/` (which the watcher ignores) and
 * reload only then. Robust to a hostile/symlinked tree (returns the zero
 * signature), same as `listMirror`.
 */
export async function mirrorRevision(
  fs: FsLike,
  workspaceRoot: string,
  kind: MirrorKind,
): Promise<{ count: number; maxMtimeMs: number }> {
  const mirrorRoot = join(workspaceRoot, MIRROR_DIR);
  let realRoot: string;
  let realMirror: string;
  try {
    realRoot = await canonicalize(fs, workspaceRoot);
    realMirror = await canonicalize(fs, mirrorRoot);
  } catch {
    return { count: 0, maxMtimeMs: 0 };
  }
  if (!isContained(realRoot, realMirror)) return { count: 0, maxMtimeMs: 0 };
  let count = 0;
  let maxMtimeMs = 0;
  const visited = new Set<string>();
  await walkDirs(fs, realRoot, mirrorRoot, realMirror, visited, async (lexicalDir) => {
    const st = await fs.stat(join(lexicalDir, `${kind}.yaml`));
    if (!st?.isFile) return;
    count++;
    if (st.mtimeMs !== undefined && st.mtimeMs > maxMtimeMs) maxMtimeMs = st.mtimeMs;
  });
  return { count, maxMtimeMs };
}

/**
 * Recurse contained directories under the mirror root, invoking `visit` with
 * each directory's LEXICAL path (so callers can derive a rel that reflects the
 * requested layout, not a symlink's true location). Mirrors the badge store's
 * hardened walk: anchor containment to the workspace ROOT, skip any child whose
 * canonical path escapes it, and guard symlink cycles via `visited`.
 */
async function walkDirs(
  fs: FsLike,
  realRoot: string,
  dir: string,
  realDir: string,
  visited: Set<string>,
  visit: (lexicalDir: string) => Promise<void>,
): Promise<void> {
  if (visited.has(realDir)) return;
  visited.add(realDir);
  const st = await fs.stat(dir);
  if (!st?.isDirectory) return;
  await visit(dir);
  const names = await fs.readdir(dir);
  for (const name of names) {
    const child = join(dir, name);
    let realChild: string;
    let childStat: Awaited<ReturnType<FsLike['stat']>>;
    try {
      realChild = await canonicalize(fs, child);
      childStat = await fs.stat(child);
    } catch {
      continue;
    }
    if (!childStat || !isContained(realRoot, realChild)) continue;
    if (childStat.isDirectory) {
      await walkDirs(fs, realRoot, child, realChild, visited, visit);
    }
  }
}
