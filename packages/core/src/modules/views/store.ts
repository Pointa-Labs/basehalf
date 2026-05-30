import { dirname, join } from 'node:path';
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
import type { SavedView } from './types.js';

const VIEWS_DIR = '.bh/views';

export function viewPath(workspaceRoot: string, id: string): string {
  // Guard the id like a badge <file>: a view JSON can carry an embedded id of
  // `../../../etc/x`, and the renderer then calls view.get/view.delete with it
  // — without this, the join would traverse out of .bh/views/ even WITHOUT a
  // symlink (view.delete's unlink could remove an arbitrary file).
  assertWorkspaceRelative(id);
  return join(workspaceRoot, VIEWS_DIR, `${id}.json`);
}

export async function readView(
  fs: FsLike,
  workspaceRoot: string,
  id: string,
): Promise<SavedView | null> {
  const raw = await readMaybeNoFollow(
    fs,
    await assertReadContained(fs, workspaceRoot, viewPath(workspaceRoot, id)),
  );
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as SavedView;
  } catch {
    return null;
  }
}

export async function writeView(fs: FsLike, workspaceRoot: string, view: SavedView): Promise<void> {
  const path = await assertWriteContained(fs, workspaceRoot, viewPath(workspaceRoot, view.id));
  await fs.mkdir(dirname(path), { recursive: true });
  await writeMaybeNoFollow(fs, path, `${JSON.stringify(view, null, 2)}\n`);
}

export async function removeView(fs: FsLike, workspaceRoot: string, id: string): Promise<boolean> {
  const path = await assertWriteContained(fs, workspaceRoot, viewPath(workspaceRoot, id));
  const stat = await fs.stat(path);
  if (!stat) return false;
  await fs.unlink(path);
  return true;
}

export async function listViews(fs: FsLike, workspaceRoot: string): Promise<readonly SavedView[]> {
  const dir = join(workspaceRoot, VIEWS_DIR);
  // Anchor to the WORKSPACE root (not .bh/views/) so a planted symlink at
  // .bh/views itself can't relocate the anchor onto its target — same fix as
  // listBadges.
  // Guard the anchor canonicalize too: an ELOOP symlink cycle at .bh/views
  // would otherwise throw PathEscape out of view.list (and badge.rename's
  // cascade). Treat an unresolvable/escaping anchor as "no views".
  let realRoot: string;
  let realDir: string;
  try {
    realRoot = await canonicalize(fs, workspaceRoot);
    realDir = await canonicalize(fs, dir);
  } catch {
    return [];
  }
  if (!isContained(realRoot, realDir)) return [];
  const dirStat = await fs.stat(dir);
  if (!dirStat?.isDirectory) return [];
  const names = await fs.readdir(dir);
  const views: SavedView[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const child = join(dir, name);
    // Resolve canonical path under a try: a hostile/broken symlink (ELOOP on a
    // mutual cycle, EACCES) skips this entry rather than crashing view.list
    // (which would also brick badge.rename's cascade). Skip entries that
    // escape the workspace root.
    let realChild: string;
    try {
      realChild = await canonicalize(fs, child);
    } catch {
      continue;
    }
    if (!isContained(realRoot, realChild)) continue;
    const raw = await readMaybeNoFollow(fs, realChild);
    if (raw === null) continue;
    try {
      views.push(JSON.parse(raw) as SavedView);
    } catch {
      // Skip corrupt view files (same robustness as badges).
    }
  }
  return views.sort((a, b) => a.id.localeCompare(b.id));
}

/** Slugify a human name into a filesystem-safe id. */
export function slugifyId(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'view';
}
