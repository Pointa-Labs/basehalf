import { join, relative } from 'node:path';
import { type FsLike, type Run, canonicalize, isContained, toPosix } from '../../kernel/index.js';

// SR-v0 §4.5 default canvas whitelist (v0 hardcoded; v0.x will move to
// .bh/config.json). Files outside this list show in the NavTree but
// don't get badges materialized.
const SUPPORTED_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.md',
  '.pdf',
  '.txt',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.mp4',
  '.mov',
  '.webm',
  '.mp3',
  '.wav',
  '.m4a',
  '.docx',
  '.pptx',
  '.xlsx',
]);

// Tooling cruft never gets a badge or recursed into. Kept in sync with
// the renderer NavTree's HIDDEN_NAMES (manual sync acceptable while both
// are tiny; v0.x consolidates into .bh/config.json).
const SKIP_NAMES: ReadonlySet<string> = new Set([
  '.git',
  '.bh',
  '.DS_Store',
  'Thumbs.db',
  '.idea',
  '.vscode',
  '.turbo',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'node_modules',
  'dist',
  'build',
  'out',
  '__pycache__',
  '.pytest_cache',
  'target',
  'vendor',
]);

function hasSupportedExt(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  return SUPPORTED_FILE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

export interface MaterializeStats {
  created: number;
  skipped: number;
}

/**
 * Eager materialization (SR-v0 §3.1): walk the workspace root and ensure
 * every supported-type file and every subfolder has a default badge JSON.
 * Idempotent — calling on every workspace.use is cheap because existing
 * badges short-circuit via badge.get.
 *
 * Uses ctx.fs (not node:fs) so it works under mockFs in tests, and
 * ctx.run (not direct imports) to call into the badges module — keeps the
 * dep arrow pointing inward (workspace → badges via the registry).
 */
export async function materializeWorkspace(
  fs: FsLike,
  run: Run,
  workspaceRoot: string,
): Promise<MaterializeStats> {
  const stats: MaterializeStats = { created: 0, skipped: 0 };
  // Canonicalize the root once; every walked child must canonicalize to a path
  // inside it, or a planted symlink would make the walk follow node:fs OUT of
  // the workspace (materializing badges for arbitrary external files) or loop
  // forever (self/mutual symlink → ELOOP → workspace permanently unopenable).
  const realRoot = await canonicalize(fs, workspaceRoot);
  await walk(fs, workspaceRoot, realRoot, workspaceRoot, realRoot, new Set(), run, stats);
  return stats;
}

async function walk(
  fs: FsLike,
  root: string,
  realRoot: string,
  dir: string,
  realDir: string,
  visited: Set<string>,
  run: Run,
  stats: MaterializeStats,
): Promise<void> {
  if (visited.has(realDir)) return; // symlink-loop guard (breaks ELOOP DoS)
  visited.add(realDir);
  const dirStat = await fs.stat(dir);
  if (!dirStat?.isDirectory) return;
  const names = await fs.readdir(dir);
  for (const name of names) {
    if (SKIP_NAMES.has(name)) continue;
    const child = toPosix(join(dir, name));
    // Resolve the child's canonical path + stat. A hostile/broken symlink can
    // make either throw (ELOOP on a mutual a->b,b->a cycle; EACCES; etc.) —
    // skip that child rather than abort the whole workspace open, mirroring
    // the corrupt-badge skip policy below.
    let realChild: string;
    let childStat: Awaited<ReturnType<FsLike['stat']>>;
    try {
      realChild = await canonicalize(fs, child);
      childStat = await fs.stat(child);
    } catch {
      continue;
    }
    // Skip a child that escapes the workspace via a symlink (canonical path
    // outside the real root). Badge names stay LOGICAL (relative to root) for
    // the contained children so the on-disk .bh/badges layout is unchanged.
    if (!childStat || !isContained(realRoot, realChild)) continue;
    if (childStat.isDirectory) {
      await ensureBadge(run, toPosix(relative(root, child)), 'folder', stats);
      await walk(fs, root, realRoot, child, realChild, visited, run, stats);
    } else if (hasSupportedExt(name)) {
      await ensureBadge(run, toPosix(relative(root, child)), 'file', stats);
    }
  }
}

async function ensureBadge(
  run: Run,
  file: string,
  kind: 'file' | 'folder',
  stats: MaterializeStats,
): Promise<void> {
  let existing: unknown;
  try {
    existing = await run('badge.get', { file, kind });
  } catch (err) {
    // A corrupt badge file on disk (failed write, bad git merge, manual
    // edit) must NOT crash workspace open — without this catch, one bad
    // .bh/badges/*.json makes the entire workspace unopenable via
    // workspace.use/add. Skip it, leaving the file untouched so the user
    // can recover or delete it. Mirrors badge.list's skip-and-warn. Catch
    // by name, not the BadgeCorrupt class, to keep the dep arrow one-way
    // (workspace must not import the badges module's internals).
    if (err instanceof Error && err.name === 'BadgeCorrupt') {
      console.warn(`[bh] skipping corrupt badge during materialize: ${file}`);
      stats.skipped++;
      return;
    }
    // A symlink planted INSIDE .bh/badges/ (so the badge JSON path itself
    // escapes) makes badge.get/set throw PathEscape. Skip-and-warn like a
    // corrupt badge rather than abort the whole workspace open.
    if (err instanceof Error && err.name === 'PathEscape') {
      console.warn(`[bh] skipping out-of-workspace badge path during materialize: ${file}`);
      stats.skipped++;
      return;
    }
    throw err;
  }
  if (existing) {
    stats.skipped++;
    return;
  }
  try {
    await run('badge.set', { file, patch: { kind } });
  } catch (err) {
    // A dangling symlink leaf inside .bh/badges/ reads as "missing" (null)
    // above but refuses the WRITE — skip-and-warn rather than abort open.
    if (err instanceof Error && err.name === 'PathEscape') {
      console.warn(`[bh] skipping out-of-workspace badge path during materialize: ${file}`);
      stats.skipped++;
      return;
    }
    throw err;
  }
  stats.created++;
}

