import { beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { BadgeCorrupt, type BadgeFile, createCore } from '../src/index.js';
import { mockFs } from './helpers/mock-fs.js';

/** On-disk path of a badge.yaml under the new mirror tree. */
const badgeYaml = (file: string) => `/work/.bh/mirror/${file}/badge.yaml`;

/** Seed a badge.yaml directly (the new YAML mirror layout). */
function seedBadge(files: Map<string, string>, badge: Record<string, unknown>): void {
  files.set(badgeYaml(badge.file as string), stringify(badge));
}

/** Read a badge's embedded reverse links (the old inbound.get, now in-badge). */
// biome-ignore lint/suspicious/noExplicitAny: cross-test core handle
async function backlinks(core: any, file: string): Promise<{ from: string; note?: string }[]> {
  const b = (await core.run('badge.get', { file })) as BadgeFile | null;
  return [...(b?.referenced_by ?? [])];
}

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
    seedBadge(ctx.files, {
      bhVersion: 1,
      file: 'foo.md',
      kind: 'file',
      references: [{ to: 'bar.md' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
    });
    const result = (await ctx.core.run('badge.get', { file: 'foo.md' })) as BadgeFile;
    expect(result.file).toBe('foo.md');
    expect(result.references).toEqual([{ to: 'bar.md' }]);
  });

  it('reads folder badge from its mirror node', async () => {
    seedBadge(ctx.files, {
      bhVersion: 1,
      file: 'images',
      kind: 'folder',
      references: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
    });
    const result = (await ctx.core.run('badge.get', {
      file: 'images',
      kind: 'folder',
    })) as BadgeFile;
    expect(result.kind).toBe('folder');
  });

  it('throws BadgeCorrupt when the YAML is malformed', async () => {
    ctx.files.set(badgeYaml('broken.md'), 'key: [unterminated');
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
    expect(ctx.files.has(badgeYaml('note.md'))).toBe(true);
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

  it('writes folder badges to .bh/mirror/<rel>/badge.yaml', async () => {
    await ctx.core.run('badge.set', {
      file: 'pics',
      patch: { kind: 'folder', prompt: 'all images' },
    });
    expect(ctx.files.has(badgeYaml('pics'))).toBe(true);
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

  it('skips a corrupt badge.yaml without crashing the listing', async () => {
    await ctx.core.run('badge.set', { file: 'ok.md' });
    ctx.files.set(badgeYaml('bad.md'), 'key: [unterminated');
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
    expect(ctx.files.has(badgeYaml('a.md'))).toBe(true);
    const result = (await ctx.core.run('badge.delete', { file: 'a.md' })) as {
      deleted: boolean;
    };
    expect(result.deleted).toBe(true);
    expect(ctx.files.has(badgeYaml('a.md'))).toBe(false);
  });

  it('returns deleted:false when badge is missing', async () => {
    const result = (await ctx.core.run('badge.delete', { file: 'missing.md' })) as {
      deleted: boolean;
    };
    expect(result.deleted).toBe(false);
  });

  it('cascades: clears the deleted badge’s backlink from each target', async () => {
    // a.md → target.md; deleting a.md must drop target.md's backlink from a.md
    // (no phantom backlink from a badge that no longer exists).
    await ctx.core.run('badge.set', { file: 'target.md' });
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'target.md', note: 'see' });
    expect((await backlinks(ctx.core, 'target.md')).map((e) => e.from)).toEqual(['a.md']);

    await ctx.core.run('badge.delete', { file: 'a.md' });

    expect(await backlinks(ctx.core, 'target.md')).toEqual([]);
  });

  it('cascades: a deleted focused file drops out of the brief', async () => {
    await ctx.core.run('badge.set', { file: 'a.md', patch: { prompt: 'note' } });
    await ctx.core.run('focus.set', { files: ['a.md', 'b.md'] });
    await ctx.core.run('badge.delete', { file: 'a.md' });
    // a.md's badge is gone; the brief should no longer inline its (now absent) note.
    const md = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(md).not.toContain('prompt: note');
  });

  it('deletes folder badge from its mirror node', async () => {
    await ctx.core.run('badge.set', { file: 'pics', patch: { kind: 'folder' } });
    const result = (await ctx.core.run('badge.delete', {
      file: 'pics',
      kind: 'folder',
    })) as { deleted: boolean };
    expect(result.deleted).toBe(true);
    expect(ctx.files.has(badgeYaml('pics'))).toBe(false);
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

  it('persists canvas side metadata for edge routing', async () => {
    const result = (await ctx.core.run('badge.addRef', {
      file: 'a.md',
      to: 'b.md',
      fromSide: 'right',
      toSide: 'left',
    })) as BadgeFile;
    expect(result.references).toEqual([{ to: 'b.md', fromSide: 'right', toSide: 'left' }]);
  });

  it('rejects invalid canvas sides', async () => {
    await expect(
      ctx.core.run('badge.addRef', {
        file: 'a.md',
        to: 'b.md',
        fromSide: 'middle',
      }),
    ).rejects.toThrow(/fromSide must be one of top, right, bottom, left/);
  });

  it('embeds the reverse link on the target badge (referenced_by)', async () => {
    // No separate inbound index any more — addRef records the backlink on the
    // TARGET badge, materializing a minimal badge for an unannotated target.
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'b.md', note: 'see' });
    expect(await backlinks(ctx.core, 'b.md')).toEqual([{ from: 'a.md', note: 'see' }]);
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

describe('badge.reconnectRef', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('moves a reference target and returns the canonical badge list', async () => {
    await ctx.core.run('badge.addRef', {
      file: 'a.md',
      to: 'b.md',
      note: 'keep',
      fromSide: 'right',
      toSide: 'left',
    });
    const result = (await ctx.core.run('badge.reconnectRef', {
      previous: { file: 'a.md', to: 'b.md' },
      next: {
        file: 'a.md',
        to: 'c.md',
        note: 'keep',
        fromSide: 'right',
        toSide: 'top',
      },
    })) as { badges: BadgeFile[] };

    const a = result.badges.find((b) => b.file === 'a.md');
    expect(a?.references).toEqual([{ to: 'c.md', note: 'keep', fromSide: 'right', toSide: 'top' }]);
  });

  it('moves a reference source without leaving the old outbound ref behind', async () => {
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'b.md' });
    const result = (await ctx.core.run('badge.reconnectRef', {
      previous: { file: 'a.md', to: 'b.md' },
      next: { file: 'c.md', to: 'b.md', fromSide: 'bottom', toSide: 'top' },
    })) as { badges: BadgeFile[] };

    const a = result.badges.find((b) => b.file === 'a.md');
    const c = result.badges.find((b) => b.file === 'c.md');
    expect(a?.references).toEqual([]);
    expect(c?.references).toEqual([{ to: 'b.md', fromSide: 'bottom', toSide: 'top' }]);
  });

  it('updates sides for the same directed pair instead of duplicating it', async () => {
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'b.md', fromSide: 'right' });
    const result = (await ctx.core.run('badge.reconnectRef', {
      previous: { file: 'a.md', to: 'b.md' },
      next: { file: 'a.md', to: 'b.md', fromSide: 'bottom', toSide: 'top' },
    })) as { badges: BadgeFile[] };

    const a = result.badges.find((b) => b.file === 'a.md');
    expect(a?.references).toEqual([{ to: 'b.md', fromSide: 'bottom', toSide: 'top' }]);
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
    // Old badge node gone, new one exists.
    expect(ctx.files.has(badgeYaml('foo.md'))).toBe(false);
    expect(ctx.files.has(badgeYaml('foo-v2.md'))).toBe(true);
  });

  it('cascades refs: badges that pointed at `from` now point at `to`', async () => {
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
    // The new target's embedded backlinks reflect both referrers.
    expect((await backlinks(ctx.core, 'foo-v2.md')).map((e) => e.from).sort()).toEqual([
      'a.md',
      'b.md',
    ]);
    // Old target has no badge (and so no backlinks) any more.
    expect(await ctx.core.run('badge.get', { file: 'foo.md' })).toBeNull();
  });

  it("migrates the moved badge's OWN outbound backlinks (from→to)", async () => {
    // foo.md → target.md (with note). Renaming foo.md must re-point
    // target.md's backlink from foo.md to foo-v2.md, not leave a phantom
    // backlink from the deleted old name.
    await ctx.core.run('badge.set', { file: 'target.md' });
    await ctx.core.run('badge.addRef', { file: 'foo.md', to: 'target.md', note: 'see' });
    expect((await backlinks(ctx.core, 'target.md')).map((e) => e.from)).toEqual(['foo.md']);

    await ctx.core.run('badge.rename', { from: 'foo.md', to: 'foo-v2.md' });

    // The moved badge keeps its outbound ref...
    const moved = (await ctx.core.run('badge.get', { file: 'foo-v2.md' })) as BadgeFile;
    expect(moved.references).toEqual([{ to: 'target.md', note: 'see' }]);
    // ...and target.md's embedded backlink now records the NEW name, note
    // preserved, with no phantom entry from the deleted old name.
    expect(await backlinks(ctx.core, 'target.md')).toEqual([{ from: 'foo-v2.md', note: 'see' }]);
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

  it('folder rename carries every CHILD badge to the new path (prompt + refs preserved)', async () => {
    // docs/ with two annotated children + a nested folder with its own child.
    await ctx.core.run('badge.set', { file: 'docs', patch: { kind: 'folder', prompt: 'chapter' } });
    await ctx.core.run('badge.set', { file: 'docs/a.md', patch: { prompt: 'intro' } });
    await ctx.core.run('badge.set', { file: 'docs/b.md', patch: { prompt: 'detail' } });
    await ctx.core.run('badge.set', {
      file: 'docs/sub',
      patch: { kind: 'folder', prompt: 'aside' },
    });
    await ctx.core.run('badge.set', { file: 'docs/sub/c.md', patch: { prompt: 'nested' } });

    await ctx.core.run('badge.rename', { from: 'docs', to: 'guide', kind: 'folder' });

    // Every child badge now lives under the new prefix, with its prompt intact…
    expect(((await ctx.core.run('badge.get', { file: 'guide/a.md' })) as BadgeFile).prompt).toBe(
      'intro',
    );
    expect(((await ctx.core.run('badge.get', { file: 'guide/b.md' })) as BadgeFile).prompt).toBe(
      'detail',
    );
    expect(
      ((await ctx.core.run('badge.get', { file: 'guide/sub/c.md' })) as BadgeFile).prompt,
    ).toBe('nested');
    // …and nothing is stranded at the old path.
    expect(await ctx.core.run('badge.get', { file: 'docs/a.md' })).toBeNull();
    expect(await ctx.core.run('badge.get', { file: 'docs/sub/c.md' })).toBeNull();
  });

  it('folder rename re-points an intra-folder reference to the new child paths', async () => {
    await ctx.core.run('badge.set', { file: 'docs', patch: { kind: 'folder' } });
    await ctx.core.run('badge.set', { file: 'docs/a.md' });
    await ctx.core.run('badge.set', { file: 'docs/b.md' });
    await ctx.core.run('badge.addRef', { file: 'docs/a.md', to: 'docs/b.md', note: 'see' });

    await ctx.core.run('badge.rename', { from: 'docs', to: 'guide', kind: 'folder' });

    const a = (await ctx.core.run('badge.get', { file: 'guide/a.md' })) as BadgeFile;
    expect(a.references).toEqual([{ to: 'guide/b.md', note: 'see' }]);
    expect((await backlinks(ctx.core, 'guide/b.md')).map((e) => e.from)).toEqual(['guide/a.md']);
  });

  it('folder rename rewrites an OUTSIDE referrer of a child to the new child path', async () => {
    await ctx.core.run('badge.set', { file: 'docs', patch: { kind: 'folder' } });
    await ctx.core.run('badge.set', { file: 'docs/a.md' });
    await ctx.core.run('badge.addRef', { file: 'outside.md', to: 'docs/a.md', note: 'ref' });

    await ctx.core.run('badge.rename', { from: 'docs', to: 'guide', kind: 'folder' });

    const outside = (await ctx.core.run('badge.get', { file: 'outside.md' })) as BadgeFile;
    expect(outside.references).toEqual([{ to: 'guide/a.md', note: 'ref' }]);
  });
});

describe('promptModifiedAt (freshness anchor)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

  it('is set when a prompt is first written, and only moves when the prompt TEXT changes', async () => {
    const created = (await ctx.core.run('badge.set', {
      file: 'a.md',
      patch: { prompt: 'first' },
    })) as BadgeFile;
    expect(created.promptModifiedAt).toBeDefined();
    const t1 = created.promptModifiedAt;

    await tick();
    // Canvas-only write (a drag) must NOT move the anchor — that pollution is
    // exactly why modifiedAt can't be used for freshness.
    const dragged = (await ctx.core.run('badge.set', {
      file: 'a.md',
      patch: { canvas: { x: 1, y: 2 } },
    })) as BadgeFile;
    expect(dragged.promptModifiedAt).toBe(t1);
    expect(dragged.modifiedAt).not.toBe(created.modifiedAt);

    await tick();
    // Re-saving the SAME text is not a change.
    const resaved = (await ctx.core.run('badge.set', {
      file: 'a.md',
      patch: { prompt: 'first' },
    })) as BadgeFile;
    expect(resaved.promptModifiedAt).toBe(t1);

    await tick();
    // A real text change moves it.
    const edited = (await ctx.core.run('badge.set', {
      file: 'a.md',
      patch: { prompt: 'second' },
    })) as BadgeFile;
    expect(edited.promptModifiedAt).not.toBe(t1);
  });

  it('is absent on badges that never had a prompt', async () => {
    const bare = (await ctx.core.run('badge.set', {
      file: 'b.md',
      patch: { canvas: { x: 0, y: 0 } },
    })) as BadgeFile;
    expect(bare.promptModifiedAt).toBeUndefined();
  });

  it('survives addRef/removeRef (reference edits are not prompt edits)', async () => {
    const created = (await ctx.core.run('badge.set', {
      file: 'a.md',
      patch: { prompt: 'note' },
    })) as BadgeFile;
    await new Promise((r) => setTimeout(r, 5));
    const withRef = (await ctx.core.run('badge.addRef', { file: 'a.md', to: 'b.md' })) as BadgeFile;
    expect(withRef.promptModifiedAt).toBe(created.promptModifiedAt);
    const without = (await ctx.core.run('badge.removeRef', {
      file: 'a.md',
      to: 'b.md',
    })) as BadgeFile;
    expect(without.promptModifiedAt).toBe(created.promptModifiedAt);
  });

  it('moves with the badge on rename (the note is unchanged, so its anchor is too)', async () => {
    const created = (await ctx.core.run('badge.set', {
      file: 'a.md',
      patch: { prompt: 'note' },
    })) as BadgeFile;
    await new Promise((r) => setTimeout(r, 5));
    const result = (await ctx.core.run('badge.rename', { from: 'a.md', to: 'a2.md' })) as {
      badge: BadgeFile;
    };
    expect(result.badge.promptModifiedAt).toBe(created.promptModifiedAt);
  });
});

describe('badge.pruneDangling (graph liveness sweep)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('marks a badge whose file is gone as orphan, leaves a live one alone', async () => {
    // gone.md has a badge but no file on disk; live.md has both.
    ctx.files.set('/work/live.md', '# live');
    await ctx.core.run('badge.set', { file: 'gone.md', patch: { prompt: 'was here' } });
    await ctx.core.run('badge.set', { file: 'live.md', patch: { prompt: 'still here' } });

    const res = (await ctx.core.run('badge.pruneDangling', {})) as { orphaned: string[] };
    expect(res.orphaned).toEqual(['gone.md']);

    const gone = (await ctx.core.run('badge.get', { file: 'gone.md' })) as BadgeFile;
    const live = (await ctx.core.run('badge.get', { file: 'live.md' })) as BadgeFile;
    expect(gone.orphan).toBe(true);
    expect(gone.prompt).toBe('was here'); // note preserved — never deleted
    expect(live.orphan).toBeUndefined();
  });

  it('is idempotent: a second sweep re-orphans nothing', async () => {
    await ctx.core.run('badge.set', { file: 'gone.md' });
    await ctx.core.run('badge.pruneDangling', {});
    const res = (await ctx.core.run('badge.pruneDangling', {})) as { orphaned: string[] };
    expect(res.orphaned).toEqual([]);
  });
});

describe('badge.revision (cheap external-edit signature)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('count grows as badges are added; an edit moves the signature', async () => {
    const empty = (await ctx.core.run('badge.revision', {})) as {
      count: number;
      maxMtimeMs: number;
    };
    expect(empty.count).toBe(0);

    await ctx.core.run('badge.set', { file: 'a.md', patch: { prompt: 'v1' } });
    const one = (await ctx.core.run('badge.revision', {})) as { count: number };
    expect(one.count).toBe(1);

    await ctx.core.run('badge.set', { file: 'b.md' });
    const two = (await ctx.core.run('badge.revision', {})) as { count: number };
    expect(two.count).toBe(2);
  });
});

describe('badge.set concurrency (keyed mutex)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('two concurrent set patches on the same badge do not lose either field', async () => {
    // A prompt blur and a canvas drag of the same card both fire badge.set. Each
    // reads the pre-write badge; without the lock the second write resurrects the
    // first's stale field and silently drops the user's just-typed note (or the
    // new position). The keyed mutex serializes the read→write so both survive.
    await Promise.all([
      ctx.core.run('badge.set', { file: 'a.md', patch: { prompt: 'one honest sentence' } }),
      ctx.core.run('badge.set', {
        file: 'a.md',
        patch: { canvas: { x: 42, y: 7, width: 200, height: 120, collapsed: false } },
      }),
    ]);
    const badge = (await ctx.core.run('badge.get', { file: 'a.md' })) as BadgeFile;
    expect(badge.prompt).toBe('one honest sentence');
    expect(badge.canvas).toEqual({ x: 42, y: 7, width: 200, height: 120, collapsed: false });
  });

  it('a burst of addRef calls on the same badge all land', async () => {
    await Promise.all([
      ctx.core.run('badge.addRef', { file: 'hub.md', to: 'a.md' }),
      ctx.core.run('badge.addRef', { file: 'hub.md', to: 'b.md' }),
      ctx.core.run('badge.addRef', { file: 'hub.md', to: 'c.md' }),
    ]);
    const badge = (await ctx.core.run('badge.get', { file: 'hub.md' })) as BadgeFile;
    expect(badge.references.map((r) => r.to).sort()).toEqual(['a.md', 'b.md', 'c.md']);
  });
});
