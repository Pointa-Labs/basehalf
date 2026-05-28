import { beforeEach, describe, expect, it } from 'vitest';
import { type BadgeFile, createCore } from '../src/index.js';
import { mockFs } from './helpers/mock-fs.js';

interface TestContext {
  files: Map<string, string>;
  dirs: Set<string>;
  // biome-ignore lint/suspicious/noExplicitAny: cross-test core handle
  core: any;
}

function freshCore(): TestContext {
  const { fs, files, dirs } = mockFs();
  const core = createCore({ fs, configDir: '/cfg' });
  return { files, dirs, core };
}

/**
 * Materialization is triggered from workspace.add (when setAsCurrent)
 * and workspace.use. These tests verify the on-disk badge state after
 * those triggers — they don't call the materialize helper directly.
 */
describe('eager materialization on workspace.add (setAsCurrent)', () => {
  let ctx: TestContext;
  beforeEach(() => {
    ctx = freshCore();
  });

  it('creates badges for every supported-type file in a flat workspace', async () => {
    ctx.dirs.add('/work');
    ctx.files.set('/work/note.md', 'hi');
    ctx.files.set('/work/photo.png', 'bin');
    ctx.files.set('/work/script.sh', 'shell'); // not in whitelist — skipped
    await ctx.core.run('workspace.add', { path: '/work', name: 'w' });
    expect(ctx.files.has('/work/.bh/badges/note.md.json')).toBe(true);
    expect(ctx.files.has('/work/.bh/badges/photo.png.json')).toBe(true);
    expect(ctx.files.has('/work/.bh/badges/script.sh.json')).toBe(false);
  });

  it('creates folder badges for every subfolder (.badge.json convention)', async () => {
    ctx.dirs.add('/work');
    ctx.dirs.add('/work/images');
    ctx.dirs.add('/work/notes');
    await ctx.core.run('workspace.add', { path: '/work', name: 'w' });
    expect(ctx.files.has('/work/.bh/badges/images/.badge.json')).toBe(true);
    expect(ctx.files.has('/work/.bh/badges/notes/.badge.json')).toBe(true);
  });

  it('recurses into subfolders', async () => {
    ctx.dirs.add('/work');
    ctx.dirs.add('/work/sub');
    ctx.files.set('/work/sub/deep.md', '');
    await ctx.core.run('workspace.add', { path: '/work', name: 'w' });
    expect(ctx.files.has('/work/.bh/badges/sub/deep.md.json')).toBe(true);
  });

  it('skips SR-v0 §4.5 blacklist dirs (node_modules, .git, .bh, etc.)', async () => {
    ctx.dirs.add('/work');
    ctx.dirs.add('/work/node_modules');
    ctx.dirs.add('/work/.git');
    ctx.files.set('/work/node_modules/pkg/index.md', '');
    ctx.files.set('/work/.git/HEAD', '');
    ctx.files.set('/work/real.md', '');
    await ctx.core.run('workspace.add', { path: '/work', name: 'w' });
    expect(ctx.files.has('/work/.bh/badges/real.md.json')).toBe(true);
    expect(ctx.files.has('/work/.bh/badges/node_modules/.badge.json')).toBe(false);
    expect(ctx.files.has('/work/.bh/badges/.git/.badge.json')).toBe(false);
  });

  it('does NOT materialize on the second add (not auto-current)', async () => {
    ctx.dirs.add('/first');
    ctx.dirs.add('/second');
    ctx.files.set('/second/late.md', '');
    await ctx.core.run('workspace.add', { path: '/first', name: 'a' });
    await ctx.core.run('workspace.add', { path: '/second', name: 'b' });
    // /first auto-became-current → no files there to materialize (no badges
    // generated). /second is not current → its late.md doesn't get a badge.
    expect(ctx.files.has('/second/.bh/badges/late.md.json')).toBe(false);
  });

  it('is idempotent (re-add via use does not duplicate badges)', async () => {
    ctx.dirs.add('/work');
    ctx.files.set('/work/note.md', '');
    await ctx.core.run('workspace.add', { path: '/work', name: 'w' });
    const before = ctx.files.get('/work/.bh/badges/note.md.json');
    await ctx.core.run('workspace.use', { name: 'w' });
    const after = ctx.files.get('/work/.bh/badges/note.md.json');
    expect(after).toBe(before);
  });

  it('writes default badge with file/kind/empty refs/createdAt=modifiedAt', async () => {
    ctx.dirs.add('/work');
    ctx.files.set('/work/note.md', '');
    await ctx.core.run('workspace.add', { path: '/work', name: 'w' });
    const raw = ctx.files.get('/work/.bh/badges/note.md.json');
    expect(raw).toBeDefined();
    const badge = JSON.parse(raw ?? '{}') as BadgeFile;
    expect(badge.file).toBe('note.md');
    expect(badge.kind).toBe('file');
    expect(badge.references).toEqual([]);
    expect(badge.createdAt).toBe(badge.modifiedAt);
    expect(badge.prompt).toBeUndefined();
    expect(badge.canvas).toBeUndefined();
  });
});

describe('eager materialization on workspace.use (re-trigger)', () => {
  it('picks up new files added between sessions', async () => {
    const ctx = freshCore();
    ctx.dirs.add('/work');
    await ctx.core.run('workspace.add', { path: '/work', name: 'w' });
    expect(ctx.files.has('/work/.bh/badges/added-later.md.json')).toBe(false);
    // User drops a new file in the workspace from outside
    ctx.files.set('/work/added-later.md', 'new content');
    // Re-using the workspace (e.g. on app restart) materializes it
    await ctx.core.run('workspace.use', { name: 'w' });
    expect(ctx.files.has('/work/.bh/badges/added-later.md.json')).toBe(true);
  });

  it('uses POSIX-style relative paths even in nested layout', async () => {
    const ctx = freshCore();
    ctx.dirs.add('/work');
    ctx.dirs.add('/work/sub');
    ctx.dirs.add('/work/sub/deeper');
    ctx.files.set('/work/sub/deeper/x.md', '');
    await ctx.core.run('workspace.add', { path: '/work', name: 'w' });
    const raw = ctx.files.get('/work/.bh/badges/sub/deeper/x.md.json');
    expect(raw).toBeDefined();
    const badge = JSON.parse(raw ?? '{}') as BadgeFile;
    expect(badge.file).toBe('sub/deeper/x.md');
  });
});
