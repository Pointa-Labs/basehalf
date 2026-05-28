import { dirname, join, relative } from 'node:path';
import { type FsLike, assertWorkspaceRelative } from '../../kernel/index.js';
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
  const path = badgePath(workspaceRoot, file, kind);
  const raw = await fs.readFile(path);
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
  const path = badgePath(workspaceRoot, badge.file, badge.kind);
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(badge, null, 2)}\n`);
}

export async function removeBadge(
  fs: FsLike,
  workspaceRoot: string,
  file: string,
  kind: BadgeKind,
): Promise<boolean> {
  const path = badgePath(workspaceRoot, file, kind);
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
  const root = join(workspaceRoot, BADGES_DIR);
  const out: BadgeFile[] = [];
  await walk(fs, root, async (absPath) => {
    if (!absPath.endsWith('.json')) return;
    const raw = await fs.readFile(absPath);
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

async function walk(
  fs: FsLike,
  dir: string,
  visit: (absPath: string) => Promise<void>,
): Promise<void> {
  const stat = await fs.stat(dir);
  if (!stat?.isDirectory) return;
  const names = await fs.readdir(dir);
  for (const name of names) {
    const child = join(dir, name);
    const childStat = await fs.stat(child);
    if (!childStat) continue;
    if (childStat.isDirectory) {
      await walk(fs, child, visit);
    } else {
      await visit(child);
    }
  }
}
