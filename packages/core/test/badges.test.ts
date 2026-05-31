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

  it('rejects a self-reference (file === to)', async () => {
    // Self-refs are meaningless for the agent walk and used to break
    // badge.rename (the self-ref's `to` was left pointing at the old name).
    // The guard now lives in core, not just the desktop dialog.
    await ctx.core.run('badge.set', { file: 'a.md' });
    await expect(ctx.core.run('badge.addRef', { file: 'a.md', to: 'a.md' })).rejects.toThrow(
      /cannot reference itself/i,
    );
    // The rejected ref must not have been written.
    const badge = (await ctx.core.run('badge.get', { file: 'a.md', kind: 'file' })) as BadgeFile;
    expect(badge.references).toEqual([]);
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

describe('badge.rename', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('moves the badge JSON file from old path to new path (preserves prompt + refs + canvas + createdAt)', async () => {
    await ctx.core.run('badge.set', {
      file: 'foo.md',
      patch: {
        prompt: 'careful — load-bearing',
        references: [{ to: 'bar.md' }],
        canvas: { x: 42, y: 17, collapsed: false },
      },
    });
    const before = (await ctx.core.run('badge.get', { file: 'foo.md' })) as BadgeFile;
    const result = (await ctx.core.run('badge.rename', {
      from: 'foo.md',
      to: 'foo-v2.md',
    })) as { badge: BadgeFile };
    expect(result.badge.file).toBe('foo-v2.md');
    expect(result.badge.prompt).toBe('careful — load-bearing');
    expect(result.badge.references).toEqual([{ to: 'bar.md' }]);
    expect(result.badge.canvas).toEqual({ x: 42, y: 17, collapsed: false });
    expect(result.badge.createdAt).toBe(before.createdAt);
    // Old badge file gone, new one exists.
    expect(ctx.files.has('/work/.bh/badges/foo.md.json')).toBe(false);
    expect(ctx.files.has('/work/.bh/badges/foo-v2.md.json')).toBe(true);
  });

  it('cascades inbound refs: badges that pointed at `from` now point at `to`', async () => {
    // a.md → foo.md, b.md → foo.md (with note)
    await ctx.core.run('badge.set', { file: 'foo.md' });
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'foo.md' });
    await ctx.core.run('badge.addRef', { file: 'b.md', to: 'foo.md', note: 'why' });
    const result = (await ctx.core.run('badge.rename', {
      from: 'foo.md',
      to: 'foo-v2.md',
    })) as { updatedRefs: string[] };
    expect(new Set(result.updatedRefs)).toEqual(new Set(['a.md', 'b.md']));
    const a = (await ctx.core.run('badge.get', { file: 'a.md' })) as BadgeFile;
    const b = (await ctx.core.run('badge.get', { file: 'b.md' })) as BadgeFile;
    expect(a.references).toEqual([{ to: 'foo-v2.md' }]);
    expect(b.references).toEqual([{ to: 'foo-v2.md', note: 'why' }]);
    // inbound index now reflects the new target.
    const inbound = (await ctx.core.run('inbound.get', { file: 'foo-v2.md' })) as {
      entries: { from: string }[];
    };
    expect(inbound.entries.map((e) => e.from).sort()).toEqual(['a.md', 'b.md']);
    // Old target has no inbound refs.
    const stale = (await ctx.core.run('inbound.get', { file: 'foo.md' })) as {
      entries: unknown[];
    };
    expect(stale.entries).toEqual([]);
  });

  it("migrates the moved badge's OWN outbound refs in the inbound index (from→to)", async () => {
    // foo.md → target.md (with note). Renaming foo.md must re-point
    // target.md's inbound entry from foo.md to foo-v2.md, not leave a
    // phantom backlink from the deleted old name.
    await ctx.core.run('badge.set', { file: 'target.md' });
    await ctx.core.run('badge.addRef', { file: 'foo.md', to: 'target.md', note: 'see' });
    expect(
      (
        (await ctx.core.run('inbound.get', { file: 'target.md' })) as {
          entries: { from: string }[];
        }
      ).entries.map((e) => e.from),
    ).toEqual(['foo.md']);

    await ctx.core.run('badge.rename', { from: 'foo.md', to: 'foo-v2.md' });

    // The moved badge keeps its outbound ref...
    const moved = (await ctx.core.run('badge.get', { file: 'foo-v2.md' })) as BadgeFile;
    expect(moved.references).toEqual([{ to: 'target.md', note: 'see' }]);
    // ...and target.md's inbound index now records the NEW name, with the
    // note preserved, and no phantom entry from the deleted old name.
    const inTarget = (await ctx.core.run('inbound.get', { file: 'target.md' })) as {
      entries: { from: string; note?: string }[];
    };
    expect(inTarget.entries).toEqual([{ from: 'foo-v2.md', note: 'see' }]);
  });

  it('updates focus.md if `from` was in the active list', async () => {
    await ctx.core.run('badge.set', { file: 'foo.md' });
    await ctx.core.run('focus.set', { files: ['unrelated.md', 'foo.md'] });
    const result = (await ctx.core.run('badge.rename', {
      from: 'foo.md',
      to: 'foo-v2.md',
    })) as { focusUpdated: boolean };
    expect(result.focusUpdated).toBe(true);
    const focus = (await ctx.core.run('focus.get', {})) as { active: string[] };
    expect(focus.active).toEqual(['unrelated.md', 'foo-v2.md']);
  });

  it('PRESERVES the focus intent when rewriting a renamed active file', async () => {
    await ctx.core.run('badge.set', { file: 'foo.md' });
    await ctx.core.run('focus.set', { files: ['foo.md'], intent: 'wire up auth' });
    const result = (await ctx.core.run('badge.rename', {
      from: 'foo.md',
      to: 'foo-v2.md',
    })) as { focusUpdated: boolean };
    expect(result.focusUpdated).toBe(true);
    const focus = (await ctx.core.run('focus.get', {})) as { active: string[]; intent?: string };
    expect(focus.active).toEqual(['foo-v2.md']);
    // The intent brief must survive a rename — losing it strands the agent.
    expect(focus.intent).toBe('wire up auth');
  });

  it('leaves focus.md alone when `from` was not in active list', async () => {
    await ctx.core.run('badge.set', { file: 'foo.md' });
    await ctx.core.run('focus.set', { files: ['unrelated.md'] });
    const result = (await ctx.core.run('badge.rename', {
      from: 'foo.md',
      to: 'foo-v2.md',
    })) as { focusUpdated: boolean };
    expect(result.focusUpdated).toBe(false);
    const focus = (await ctx.core.run('focus.get', {})) as { active: string[] };
    expect(focus.active).toEqual(['unrelated.md']);
  });

  it('throws when source badge does not exist', async () => {
    await expect(
      ctx.core.run('badge.rename', { from: 'never.md', to: 'whatever.md' }),
    ).rejects.toThrow(/no badge at never\.md/);
  });

  it('throws when destination already has a badge (collision)', async () => {
    await ctx.core.run('badge.set', { file: 'foo.md' });
    await ctx.core.run('badge.set', { file: 'bar.md' });
    await expect(ctx.core.run('badge.rename', { from: 'foo.md', to: 'bar.md' })).rejects.toThrow(
      /already exists at bar\.md/,
    );
  });

  it('throws when from === to (no-op rename is probably a caller bug)', async () => {
    await ctx.core.run('badge.set', { file: 'foo.md' });
    await expect(ctx.core.run('badge.rename', { from: 'foo.md', to: 'foo.md' })).rejects.toThrow(
      /from and to are the same/,
    );
  });

  it('clears the orphan flag on the moved badge (rename = file resurrected under new name)', async () => {
    await ctx.core.run('badge.set', { file: 'foo.md' });
    await ctx.core.run('badge.markOrphan', { file: 'foo.md' });
    const before = (await ctx.core.run('badge.get', { file: 'foo.md' })) as BadgeFile;
    expect(before.orphan).toBe(true);
    const result = (await ctx.core.run('badge.rename', {
      from: 'foo.md',
      to: 'foo-v2.md',
    })) as { badge: BadgeFile };
    expect(result.badge.orphan).toBeUndefined();
  });
});
