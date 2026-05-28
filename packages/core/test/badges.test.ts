import { beforeEach, describe, expect, it } from 'vitest';
import { BadgeCorrupt, type BadgeFile, createCore } from '../src/index.js';
import { mockFs } from './helpers/mock-fs.js';

/**
 * Badge module unit tests. All run against an in-memory FsLike + an injected
 * configDir. Each test seeds a workspace at /work via workspace.add so the
 * "current workspace" lookup that every badge command does has something to
 * find.
 */

interface TestContext {
  files: Map<string, string>;
  dirs: Set<string>;
  // biome-ignore lint/suspicious/noExplicitAny: cross-test core handle
  core: any;
}

async function seed(): Promise<TestContext> {
  const { fs, files, dirs } = mockFs();
  dirs.add('/work');
  const core = createCore({ fs, configDir: '/cfg' });
  await core.run('workspace.add', { path: '/work', name: 'w' });
  return { files, dirs, core };
}

describe('badge.get', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('returns null when no badge file exists', async () => {
    const result = await ctx.core.run('badge.get', { file: 'missing.md' });
    expect(result).toBeNull();
  });

  it('reads and returns an existing badge', async () => {
    ctx.files.set(
      '/work/.bh/badges/foo.md.json',
      JSON.stringify({
        bhVersion: 1,
        file: 'foo.md',
        kind: 'file',
        references: [{ to: 'bar.md' }],
        createdAt: '2026-01-01T00:00:00.000Z',
        modifiedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    const result = (await ctx.core.run('badge.get', { file: 'foo.md' })) as BadgeFile;
    expect(result.file).toBe('foo.md');
    expect(result.references).toEqual([{ to: 'bar.md' }]);
  });

  it('reads folder badge from .badge.json path', async () => {
    ctx.files.set(
      '/work/.bh/badges/images/.badge.json',
      JSON.stringify({
        bhVersion: 1,
        file: 'images',
        kind: 'folder',
        references: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        modifiedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    const result = (await ctx.core.run('badge.get', {
      file: 'images',
      kind: 'folder',
    })) as BadgeFile;
    expect(result.kind).toBe('folder');
  });

  it('throws BadgeCorrupt when JSON is malformed', async () => {
    ctx.files.set('/work/.bh/badges/broken.md.json', '{ this is not json }');
    await expect(ctx.core.run('badge.get', { file: 'broken.md' })).rejects.toBeInstanceOf(
      BadgeCorrupt,
    );
  });
});

describe('badge.set', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('creates a new badge with empty refs + createdAt=modifiedAt', async () => {
    const result = (await ctx.core.run('badge.set', {
      file: 'note.md',
      patch: { prompt: 'hello' },
    })) as BadgeFile;
    expect(result.file).toBe('note.md');
    expect(result.kind).toBe('file');
    expect(result.prompt).toBe('hello');
    expect(result.references).toEqual([]);
    expect(result.createdAt).toBe(result.modifiedAt);
    expect(ctx.files.has('/work/.bh/badges/note.md.json')).toBe(true);
  });

  it('updates an existing badge: preserves createdAt, bumps modifiedAt', async () => {
    const first = (await ctx.core.run('badge.set', {
      file: 'note.md',
      patch: { prompt: 'v1' },
    })) as BadgeFile;
    await new Promise((r) => setTimeout(r, 10));
    const second = (await ctx.core.run('badge.set', {
      file: 'note.md',
      patch: { prompt: 'v2' },
    })) as BadgeFile;
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.modifiedAt).not.toBe(first.modifiedAt);
    expect(second.prompt).toBe('v2');
  });

  it('writes folder badges to .bh/badges/<rel>/.badge.json', async () => {
    await ctx.core.run('badge.set', {
      file: 'pics',
      patch: { kind: 'folder', prompt: 'all images' },
    });
    expect(ctx.files.has('/work/.bh/badges/pics/.badge.json')).toBe(true);
    expect(ctx.files.has('/work/.bh/badges/pics.json')).toBe(false);
  });

  it('honors canvas position when set', async () => {
    const result = (await ctx.core.run('badge.set', {
      file: 'note.md',
      patch: { canvas: { x: 100, y: 200, collapsed: false } },
    })) as BadgeFile;
    expect(result.canvas).toEqual({ x: 100, y: 200, collapsed: false });
  });

  it('replaces references array atomically', async () => {
    await ctx.core.run('badge.set', {
      file: 'a.md',
      patch: { references: [{ to: 'b.md' }, { to: 'c.md' }] },
    });
    const updated = (await ctx.core.run('badge.set', {
      file: 'a.md',
      patch: { references: [{ to: 'd.md' }] },
    })) as BadgeFile;
    expect(updated.references).toEqual([{ to: 'd.md' }]);
  });

  it('throws when no current workspace', async () => {
    const { fs } = mockFs();
    const core = createCore({ fs, configDir: '/cfg' });
    await expect(core.run('badge.set', { file: 'x.md' })).rejects.toThrow(/No current workspace/);
  });
});

describe('badge.list', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('returns empty when no badges exist', async () => {
    const { badges } = (await ctx.core.run('badge.list', {})) as { badges: BadgeFile[] };
    expect(badges).toEqual([]);
  });

  it('returns all badges sorted by file path', async () => {
    await ctx.core.run('badge.set', { file: 'c.md' });
    await ctx.core.run('badge.set', { file: 'a.md' });
    await ctx.core.run('badge.set', { file: 'b.md' });
    const { badges } = (await ctx.core.run('badge.list', {})) as { badges: BadgeFile[] };
    expect(badges.map((b) => b.file)).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('filters by kind', async () => {
    await ctx.core.run('badge.set', { file: 'note.md' });
    await ctx.core.run('badge.set', { file: 'images', patch: { kind: 'folder' } });
    const { badges } = (await ctx.core.run('badge.list', { kind: 'folder' })) as {
      badges: BadgeFile[];
    };
    expect(badges).toHaveLength(1);
    expect(badges[0]?.file).toBe('images');
  });

  it('filters by query (substring on file + prompt)', async () => {
    await ctx.core.run('badge.set', { file: 'econ.md', patch: { prompt: 'supply and demand' } });
    await ctx.core.run('badge.set', { file: 'history.md', patch: { prompt: 'war notes' } });
    const supply = (await ctx.core.run('badge.list', { query: 'supply' })) as {
      badges: BadgeFile[];
    };
    expect(supply.badges).toHaveLength(1);
    expect(supply.badges[0]?.file).toBe('econ.md');
  });

  it('query is case-insensitive', async () => {
    await ctx.core.run('badge.set', { file: 'README.MD' });
    const { badges } = (await ctx.core.run('badge.list', { query: 'readme' })) as {
      badges: BadgeFile[];
    };
    expect(badges).toHaveLength(1);
  });

  it('skips corrupt badge JSON without crashing the listing', async () => {
    await ctx.core.run('badge.set', { file: 'ok.md' });
    ctx.files.set('/work/.bh/badges/bad.md.json', 'not json');
    const { badges } = (await ctx.core.run('badge.list', {})) as { badges: BadgeFile[] };
    expect(badges.map((b) => b.file)).toEqual(['ok.md']);
  });
});

describe('badge.delete', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('returns deleted:true and removes the file when badge exists', async () => {
    await ctx.core.run('badge.set', { file: 'a.md' });
    expect(ctx.files.has('/work/.bh/badges/a.md.json')).toBe(true);
    const result = (await ctx.core.run('badge.delete', { file: 'a.md' })) as {
      deleted: boolean;
    };
    expect(result.deleted).toBe(true);
    expect(ctx.files.has('/work/.bh/badges/a.md.json')).toBe(false);
  });

  it('returns deleted:false when badge is missing', async () => {
    const result = (await ctx.core.run('badge.delete', { file: 'missing.md' })) as {
      deleted: boolean;
    };
    expect(result.deleted).toBe(false);
  });

  it('deletes folder badge from .badge.json path', async () => {
    await ctx.core.run('badge.set', { file: 'pics', patch: { kind: 'folder' } });
    const result = (await ctx.core.run('badge.delete', {
      file: 'pics',
      kind: 'folder',
    })) as { deleted: boolean };
    expect(result.deleted).toBe(true);
    expect(ctx.files.has('/work/.bh/badges/pics/.badge.json')).toBe(false);
  });
});

describe('badge.addRef', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('adds a reference to an existing badge', async () => {
    await ctx.core.run('badge.set', { file: 'a.md' });
    const result = (await ctx.core.run('badge.addRef', {
      file: 'a.md',
      to: 'b.md',
      note: 'see also',
    })) as BadgeFile;
    expect(result.references).toEqual([{ to: 'b.md', note: 'see also' }]);
  });

  it('creates badge on demand if it does not exist', async () => {
    const result = (await ctx.core.run('badge.addRef', {
      file: 'a.md',
      to: 'b.md',
    })) as BadgeFile;
    expect(result.file).toBe('a.md');
    expect(result.references).toEqual([{ to: 'b.md' }]);
  });

  it('deduplicates: re-adding same target replaces existing ref', async () => {
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'b.md', note: 'v1' });
    const result = (await ctx.core.run('badge.addRef', {
      file: 'a.md',
      to: 'b.md',
      note: 'v2',
    })) as BadgeFile;
    expect(result.references).toHaveLength(1);
    expect(result.references[0]?.note).toBe('v2');
  });

  it('tolerates inbound module not registered (UnknownCommand swallowed)', async () => {
    // No inbound module exists in PR 11-1. addRef should still succeed.
    await expect(ctx.core.run('badge.addRef', { file: 'a.md', to: 'b.md' })).resolves.toBeDefined();
  });
});

describe('badge.removeRef', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('removes the named reference', async () => {
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'b.md' });
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'c.md' });
    const result = (await ctx.core.run('badge.removeRef', {
      file: 'a.md',
      to: 'b.md',
    })) as BadgeFile;
    expect(result.references).toEqual([{ to: 'c.md' }]);
  });

  it('throws when badge does not exist', async () => {
    await expect(
      ctx.core.run('badge.removeRef', { file: 'missing.md', to: 'x.md' }),
    ).rejects.toThrow(/Badge not found/);
  });

  it('is a no-op on a missing reference (returns badge unchanged)', async () => {
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'b.md' });
    const result = (await ctx.core.run('badge.removeRef', {
      file: 'a.md',
      to: 'never-there.md',
    })) as BadgeFile;
    expect(result.references).toEqual([{ to: 'b.md' }]);
  });
});
