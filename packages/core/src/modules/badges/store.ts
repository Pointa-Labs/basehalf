import { dirname, join, relative } from 'node:path';
import {
  type FsLike,
  assertReadContained,
  assertWorkspaceRelative,
  assertWriteContained,
  canonicalize,
  isContained,
  readMaybeNoFollow,
  writeMaybeNoFollow,
} from '../../kernel/index.js';
import { BadgeCorrupt, type BadgeFile, type BadgeKind } from './types.js';

const BADGES_DIR = '.bh/badges';
const FOLDER_BADGE_FILENAME = '.badge.json';

/**
 * Resolve the on-disk JSON path for a badge.
 * - file kind: <workspace>/.bh/badges/<rel>.json
 * - folder kind: <workspace>/.bh/badges/<rel>/.badge.json
 *   (.badge.json filename is fixed so a folder badge doesn't collide with
 *    a sibling file's badge — see SR-v0 §3.6)
 */
export function badgePath(workspaceRoot: string, file: string, kind: BadgeKind): string {
  // Single choke point for every badge read/write/delete. Validate here so
  // a traversal path (e.g. `../../../etc/passwd`) can't escape .bh/badges/
  // through path.join — badge.set used to write `/etc/passwd.json`.
  assertWorkspaceRelative(file);
  if (kind === 'folder') {
    return join(workspaceRoot, BADGES_DIR, file, FOLDER_BADGE_FILENAME);
  }
  return join(workspaceRoot, BADGES_DIR, `${file}.json`);
}

export async function readBadge(
  fs: FsLike,
  workspaceRoot: string,
  file: string,
  kind: BadgeKind,
): Promise<BadgeFile | null> {
  const path = await assertReadContained(fs, workspaceRoot, badgePath(workspaceRoot, file, kind));
  const raw = await readMaybeNoFollow(fs, path);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as BadgeFile;
  } catch (cause) {
    throw new BadgeCorrupt(file, { cause });
  }
}

export async function writeBadge(
  fs: FsLike,
  workspaceRoot: string,
  badge: BadgeFile,
): Promise<void> {
  const path = await assertWriteContained(
    fs,
    workspaceRoot,
    badgePath(workspaceRoot, badge.file, badge.kind),
  );
  await fs.mkdir(dirname(path), { recursive: true });
  await writeMaybeNoFollow(fs, path, `${JSON.stringify(badge, null, 2)}\n`);
}

export async function removeBadge(
  fs: FsLike,
  workspaceRoot: string,
  file: string,
  kind: BadgeKind,
): Promise<boolean> {
  const path = await assertWriteContained(fs, workspaceRoot, badgePath(workspaceRoot, file, kind));
  const stat = await fs.stat(path);
  if (!stat) return false;
  await fs.unlink(path);
  return true;
}

/**
 * Walk <workspace>/.bh/badges/ recursively and yield every badge.
 * Corrupt JSON files are *skipped* with a console warning, not thrown —
 * callers want listing to be robust against a single bad file.
 */
export async function listBadges(fs: FsLike, workspaceRoot: string): Promise<readonly BadgeFile[]> {
  const badgesDir = join(workspaceRoot, BADGES_DIR);
  const out: BadgeFile[] = [];
  // Anchor containment to the WORKSPACE root, not to .bh/badges/: if
  // .bh/badges itself is a planted directory symlink (the whole .bh/ tree
  // ships in git), anchoring to canonicalize(.bh/badges) would relocate the
  // anchor onto the symlink TARGET and happily enumerate everything outside.
  // Anchoring to the workspace root and bailing when .bh/badges escapes it
  // closes that. Files inside a legit .bh/badges stay contained under the root.
  // The anchor canonicalize must itself be guarded: a symlink CYCLE at
  // .bh/badges (git-shippable) makes canonicalize throw PathEscape (it maps
  // ELOOP/EACCES → refuse), and an uncaught throw here would brick badge.list
  // (and the canvas it draws). Treat any unresolvable/escaping anchor as
  // "no badges" — robust like the per-entry skip below.
  let realRoot: string;
  let realBadgesDir: string;
  try {
    realRoot = await canonicalize(fs, workspaceRoot);
    realBadgesDir = await canonicalize(fs, badgesDir);
  } catch {
    return out;
  }
  if (!isContained(realRoot, realBadgesDir)) return out;
  const visited = new Set<string>();
  await walk(fs, realRoot, badgesDir, realBadgesDir, visited, async (absPath) => {
    if (!absPath.endsWith('.json')) return;
    const raw = await readMaybeNoFollow(fs, absPath);
    if (raw === null) return;
    try {
      out.push(JSON.parse(raw) as BadgeFile);
    } catch {
      // AR-PR11-7: skip-and-warn for corrupt badges; never crash listing.
      console.warn(`[bh] skipping corrupt badge: ${relative(workspaceRoot, absPath)}`);
    }
  });
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * A CHEAP signature of the badge store — file count + newest mtime — without
 * parsing any JSON. Lets a UI poll detect that an EXTERNAL writer (the `bh` CLI,
 * an agent) touched `.bh/badges/` (which the watcher ignores) and reload only
 * then, instead of re-walking + re-parsing every badge every poll. A content
 * edit bumps a file's mtime; an add/remove changes the count — both move the
 * signature. Robust to a hostile/symlinked badges dir (returns the zero
 * signature), same as listBadges.
 */
export async function badgesRevision(
  fs: FsLike,
  workspaceRoot: string,
): Promise<{ count: number; maxMtimeMs: number }> {
  const badgesDir = join(workspaceRoot, BADGES_DIR);
  let realRoot: string;
  let realBadgesDir: string;
  try {
    realRoot = await canonicalize(fs, workspaceRoot);
    realBadgesDir = await canonicalize(fs, badgesDir);
  } catch {
    return { count: 0, maxMtimeMs: 0 };
  }
  if (!isContained(realRoot, realBadgesDir)) return { count: 0, maxMtimeMs: 0 };
  let count = 0;
  let maxMtimeMs = 0;
  const visited = new Set<string>();
  await walk(fs, realRoot, badgesDir, realBadgesDir, visited, async (absPath) => {
    if (!absPath.endsWith('.json')) return;
    count++;
    const st = await fs.stat(absPath);
    if (st?.mtimeMs !== undefined && st.mtimeMs > maxMtimeMs) maxMtimeMs = st.mtimeMs;
  });
  return { count, maxMtimeMs };
}

async function walk(
  fs: FsLike,
  realRoot: string,
  dir: string,
  realDir: string,
  visited: Set<string>,
  visit: (absPath: string) => Promise<void>,
): Promise<void> {
  if (visited.has(realDir)) return; // symlink-loop guard
  visited.add(realDir);
  const stat = await fs.stat(dir);
  if (!stat?.isDirectory) return;
  const names = await fs.readdir(dir);
  for (const name of names) {
    const child = join(dir, name);
    // Resolve canonical path + stat under a try: a hostile/broken symlink
    // (ELOOP on a mutual cycle, EACCES, …) skips this child rather than
    // crashing the listing — same robustness as the corrupt-badge skip below.
    let realChild: string;
    let childStat: Awaited<ReturnType<FsLike['stat']>>;
    try {
      realChild = await canonicalize(fs, child);
      childStat = await fs.stat(child);
    } catch {
      continue;
    }
    // Skip any child whose canonical path escapes the real .bh/badges/ root —
    // i.e. a planted symlink pointing outside the workspace.
    if (!childStat || !isContained(realRoot, realChild)) continue;
    if (childStat.isDirectory) {
      await walk(fs, realRoot, child, realChild, visited, visit);
    } else {
      await visit(realChild);
    }
  }
}
