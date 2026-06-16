import {
  type FsLike,
  listMirror,
  mirrorPath,
  mirrorRevision,
  readMirror,
  removeMirror,
  writeMirror,
} from '../../kernel/index.js';
import { BadgeCorrupt, type BadgeFile } from './types.js';

/**
 * Badge persistence over the kernel `.bh/mirror/` YAML store. A badge — file OR
 * folder — lives at `<workspace>/.bh/mirror/<rel>/badge.yaml`; the kind is a
 * field inside the file, not part of the path (a path can't be both a file and
 * a folder on disk, so routing both kinds to `<rel>/badge.yaml` is collision-
 * free). Path containment, O_NOFOLLOW guards, and the field-scoped write lock
 * all live in the mirror store — this layer just maps badge ⇄ mirror node.
 */

/** `<workspace>/.bh/mirror/<rel>/badge.yaml`. */
export function badgePath(workspaceRoot: string, file: string): string {
  return mirrorPath(workspaceRoot, file, 'badge');
}

export async function readBadge(
  fs: FsLike,
  workspaceRoot: string,
  file: string,
): Promise<BadgeFile | null> {
  try {
    return await readMirror<BadgeFile>(fs, workspaceRoot, file, 'badge');
  } catch (cause) {
    // Re-skin MirrorCorrupt as BadgeCorrupt so existing badge callers keep
    // catching by the name/shape they expect.
    if (cause instanceof Error && cause.name === 'MirrorCorrupt') {
      throw new BadgeCorrupt(file, { cause });
    }
    throw cause;
  }
}

export async function writeBadge(
  fs: FsLike,
  workspaceRoot: string,
  badge: BadgeFile,
): Promise<void> {
  await writeMirror(fs, workspaceRoot, badge.path, 'badge', badge);
}

export async function removeBadge(
  fs: FsLike,
  workspaceRoot: string,
  file: string,
): Promise<boolean> {
  return removeMirror(fs, workspaceRoot, file, 'badge');
}

/**
 * Walk `.bh/mirror/` and return every badge.yaml. Corrupt files are skipped
 * with a warning (inherited from the mirror store's list), so a single bad
 * badge never crashes the listing. Sorted by file path.
 */
export async function listBadges(fs: FsLike, workspaceRoot: string): Promise<readonly BadgeFile[]> {
  const nodes = await listMirror<BadgeFile>(fs, workspaceRoot, 'badge');
  return nodes.map((n) => n.data).sort((a, b) => a.path.localeCompare(b.path));
}

/** Cheap signature (count + newest mtime) of the badge store for an
 *  external-edit poll. */
export async function badgesRevision(
  fs: FsLike,
  workspaceRoot: string,
): Promise<{ count: number; maxMtimeMs: number }> {
  return mirrorRevision(fs, workspaceRoot, 'badge');
}
