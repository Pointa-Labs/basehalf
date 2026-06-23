import { beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { BadgeCorrupt, type BadgeFile, createCore } from '../src/index.js';
import { boundCore } from './helpers/bound-core.js';
import { mockFs } from './helpers/mock-fs.js';

/** On-disk path of a badge.yaml under the new mirror tree. */
const badgeYaml = (file: string) => `/work/.bh/mirror/${file}/badge.yaml`;

/** Seed a badge.yaml directly (the new YAML mirror layout). The new badge model
 *  keys identity on `path`, not `file`. */
function seedBadge(files: Map<string, string>, badge: Record<string, unknown>): void {
  files.set(badgeYaml(badge.path as string), stringify(badge));
}

/** Read a badge's embedded reverse links (the old inbound.get, now in-badge as a
 *  bare path[] under `referenced_by`). */
// biome-ignore lint/suspicious/noExplicitAny: cross-test core handle
async function backlinks(core: any, file: string): Promise<string[]> {
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
  const core = boundCore(createCore({ fs, configDir: '/cfg' }), '/work');
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
      path: 'foo.md',
      kind: 'file',
      references: ['bar.md'],
    });
    const result = (await ctx.core.run('badge.get', { file: 'foo.md' })) as BadgeFile;
    expect(result.path).toBe('foo.md');
    expect(result.references).toEqual(['bar.md']);
  });

  it('reads folder badge from its mirror node', async () => {
    seedBadge(ctx.files, {
      path: 'images',
      kind: 'folder',
      references: [],
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

  it('creates a new badge with empty refs (description renamed from prompt)', async () => {
    const result = (await ctx.core.run('badge.set', {
      file: 'note.md',
      patch: { description: 'hello' },
    })) as BadgeFile;
    expect(result.path).toBe('note.md');
    expect(result.kind).toBe('file');
    expect(result.description).toBe('hello');
    expect(result.references).toEqual([]);
    expect(ctx.files.has(badgeYaml('note.md'))).toBe(true);
  });

  it('updates an existing badge: replaces the description', async () => {
    await ctx.core.run('badge.set', {
      file: 'note.md',
      patch: { description: 'v1' },
    });
    const second = (await ctx.core.run('badge.set', {
      file: 'note.md',
      patch: { description: 'v2' },
    })) as BadgeFile;
    expect(second.description).toBe('v2');
  });

  it('clears the description with an empty string', async () => {
    await ctx.core.run('badge.set', { file: 'note.md', patch: { description: 'temp' } });
    const cleared = (await ctx.core.run('badge.set', {
      file: 'note.md',
      patch: { description: '' },
    })) as BadgeFile;
    expect(cleared.description).toBeUndefined();
  });

  it('writes folder badges to .bh/mirror/<rel>/badge.yaml', async () => {
    await ctx.core.run('badge.set', {
      file: 'pics',
      patch: { kind: 'folder', description: 'all images' },
    });
    expect(ctx.files.has(badgeYaml('pics'))).toBe(true);
  });

  it('preserves references on a description edit (refs are addRef/removeRef-owned)', async () => {
    // set() no longer accepts a references patch — a bare replacement would
    // bypass the referenced_by cascade and break the bidirectional invariant.
    // It must, however, PRESERVE the addRef-managed references across other edits.
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'b.md' });
    const updated = (await ctx.core.run('badge.set', {
      file: 'a.md',
      patch: { description: 'edited' },
    })) as BadgeFile;
    expect(updated.references).toEqual(['b.md']);
    expect(updated.description).toBe('edited');
  });

  it('preserves the orphan flag across an ordinary description edit', async () => {
    // A description edit on a deleted file must not silently un-orphan it.
    await ctx.core.run('badge.set', { file: 'a.md' });
    await ctx.core.run('badge.markOrphan', { file: 'a.md' });
    const edited = (await ctx.core.run('badge.set', {
      file: 'a.md',
      patch: { description: 'still gone' },
    })) as BadgeFile;
    expect(edited.orphan).toBe(true);
  });

  it('throws when no workspace is bound', async () => {
    const { fs } = mockFs();
    const core = createCore({ fs, configDir: '/cfg' });
    await expect(core.run('badge.set', { file: 'x.md' })).rejects.toThrow(/No workspace bound/i);
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

  it('returns all badges sorted by path', async () => {
    await ctx.core.run('badge.set', { file: 'c.md' });
    await ctx.core.run('badge.set', { file: 'a.md' });
    await ctx.core.run('badge.set', { file: 'b.md' });
    const { badges } = (await ctx.core.run('badge.list', {})) as { badges: BadgeFile[] };
    expect(badges.map((b) => b.path)).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('filters by kind', async () => {
    await ctx.core.run('badge.set', { file: 'note.md' });
    await ctx.core.run('badge.set', { file: 'images', patch: { kind: 'folder' } });
    const { badges } = (await ctx.core.run('badge.list', { kind: 'folder' })) as {
      badges: BadgeFile[];
    };
    expect(badges).toHaveLength(1);
    expect(badges[0]?.path).toBe('images');
  });

  it('filters by query (substring on path + description)', async () => {
    await ctx.core.run('badge.set', {
      file: 'econ.md',
      patch: { description: 'supply and demand' },
    });
    await ctx.core.run('badge.set', { file: 'history.md', patch: { description: 'war notes' } });
    const supply = (await ctx.core.run('badge.list', { query: 'supply' })) as {
      badges: BadgeFile[];
    };
    expect(supply.badges).toHaveLength(1);
    expect(supply.badges[0]?.path).toBe('econ.md');
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
    expect(badges.map((b) => b.path)).toEqual(['ok.md']);
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
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'target.md' });
    expect(await backlinks(ctx.core, 'target.md')).toEqual(['a.md']);

    await ctx.core.run('badge.delete', { file: 'a.md' });

    expect(await backlinks(ctx.core, 'target.md')).toEqual([]);
  });

  it('does NOT cascade to focus: deleting a focused node leaves current_focus alone', async () => {
    // Focus is a viewport mirror now, not a curated brief — badge.delete no
    // longer reconciles focus. The current_focus symlink stays pointed at the
    // node; it's `focus.pruneDangling` (run on workspace open / after deleteEntry)
    // that clears a focus whose file is gone, not badge.delete.
    await ctx.core.run('badge.set', { file: 'a.md', patch: { description: 'note' } });
    await ctx.core.run('focus.set', { path: 'a.md', kind: 'file' });
    await ctx.core.run('badge.delete', { file: 'a.md' });
    const focus = (await ctx.core.run('focus.get', {})) as { path: string; kind: string } | null;
    expect(focus).toEqual({ path: 'a.md', kind: 'file' });
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

  it('adds a reference (bare path) to an existing badge', async () => {
    await ctx.core.run('badge.set', { file: 'a.md' });
    const result = (await ctx.core.run('badge.addRef', {
      file: 'a.md',
      to: 'b.md',
    })) as BadgeFile;
    expect(result.references).toEqual(['b.md']);
  });

  it('creates badge on demand if it does not exist', async () => {
    const result = (await ctx.core.run('badge.addRef', {
      file: 'a.md',
      to: 'b.md',
    })) as BadgeFile;
    expect(result.path).toBe('a.md');
    expect(result.references).toEqual(['b.md']);
  });

  it('deduplicates: re-adding the same target stays a single entry', async () => {
    // Refs are bare paths now (no note/sides), so a re-add is idempotent rather
    // than a metadata replacement.
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'b.md' });
    const result = (await ctx.core.run('badge.addRef', {
      file: 'a.md',
      to: 'b.md',
    })) as BadgeFile;
    expect(result.references).toEqual(['b.md']);
  });

  it('embeds the reverse link on the target badge (referenced_by)', async () => {
    // No separate inbound index any more — addRef records the backlink on the
    // TARGET badge, materializing a minimal badge for an unannotated target.
    // referenced_by is a bare path[].
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'b.md' });
    expect(await backlinks(ctx.core, 'b.md')).toEqual(['a.md']);
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
    expect(result.references).toEqual(['c.md']);
  });

  it("drops the target's reciprocal backlink", async () => {
    // removeRef must scrub BOTH sides of the embedded graph.
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'b.md' });
    expect(await backlinks(ctx.core, 'b.md')).toEqual(['a.md']);
    await ctx.core.run('badge.removeRef', { file: 'a.md', to: 'b.md' });
    expect(await backlinks(ctx.core, 'b.md')).toEqual([]);
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
    expect(result.references).toEqual(['b.md']);
  });
});

// NOTE: the old `badge.reconnectRef` command was REMOVED — moving/relabelling a
// connection is now a CANVAS concern (canvas.reconnect), which keeps the visual
// edge AND the badge.references graph in lockstep. The reconnect behaviors that
// used to live here (moving a target / moving a source / updating a same-pair
// edge) are covered in canvas.test.ts; the badge-graph half of "endpoints
// changed → addRef(next)+removeRef(previous)" is exercised below via the same
// addRef/removeRef primitives canvas.reconnect drives.
describe('reference graph re-pointing (the canvas.reconnect primitives)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('moving a reference target: removeRef(previous) + addRef(next) re-points the edge', async () => {
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'b.md' });
    // canvas.reconnect with a changed target does addRef(next) then removeRef(prev).
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'c.md' });
    await ctx.core.run('badge.removeRef', { file: 'a.md', to: 'b.md' });
    const a = (await ctx.core.run('badge.get', { file: 'a.md' })) as BadgeFile;
    expect(a.references).toEqual(['c.md']);
    expect(await backlinks(ctx.core, 'b.md')).toEqual([]);
    expect(await backlinks(ctx.core, 'c.md')).toEqual(['a.md']);
  });

  it('moving a reference source leaves no stale outbound ref behind', async () => {
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'b.md' });
    await ctx.core.run('badge.addRef', { file: 'c.md', to: 'b.md' });
    await ctx.core.run('badge.removeRef', { file: 'a.md', to: 'b.md' });
    const a = (await ctx.core.run('badge.get', { file: 'a.md' })) as BadgeFile;
    const c = (await ctx.core.run('badge.get', { file: 'c.md' })) as BadgeFile;
    expect(a.references).toEqual([]);
    expect(c.references).toEqual(['b.md']);
    expect(await backlinks(ctx.core, 'b.md')).toEqual(['c.md']);
  });
});

describe('badge.rename', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('moves the badge to the new mirror node (preserves description + refs)', async () => {
    await ctx.core.run('badge.set', {
      file: 'foo.md',
      patch: { description: 'careful — load-bearing' },
    });
    await ctx.core.run('badge.addRef', { file: 'foo.md', to: 'bar.md' });
    const result = (await ctx.core.run('badge.rename', {
      from: 'foo.md',
      to: 'foo-v2.md',
    })) as { badge: BadgeFile };
    expect(result.badge.path).toBe('foo-v2.md');
    expect(result.badge.description).toBe('careful — load-bearing');
    expect(result.badge.references).toEqual(['bar.md']);
    // Old badge node gone, new one exists.
    expect(ctx.files.has(badgeYaml('foo.md'))).toBe(false);
    expect(ctx.files.has(badgeYaml('foo-v2.md'))).toBe(true);
  });

  it('cascades refs: badges that pointed at `from` now point at `to`', async () => {
    // a.md → foo.md, b.md → foo.md
    await ctx.core.run('badge.set', { file: 'foo.md' });
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'foo.md' });
    await ctx.core.run('badge.addRef', { file: 'b.md', to: 'foo.md' });
    const result = (await ctx.core.run('badge.rename', {
      from: 'foo.md',
      to: 'foo-v2.md',
    })) as { updatedRefs: string[] };
    expect(new Set(result.updatedRefs)).toEqual(new Set(['a.md', 'b.md']));
    const a = (await ctx.core.run('badge.get', { file: 'a.md' })) as BadgeFile;
    const b = (await ctx.core.run('badge.get', { file: 'b.md' })) as BadgeFile;
    expect(a.references).toEqual(['foo-v2.md']);
    expect(b.references).toEqual(['foo-v2.md']);
    // The new target's embedded backlinks reflect both referrers.
    expect((await backlinks(ctx.core, 'foo-v2.md')).sort()).toEqual(['a.md', 'b.md']);
    // Old target has no badge (and so no backlinks) any more.
    expect(await ctx.core.run('badge.get', { file: 'foo.md' })).toBeNull();
  });

  it("migrates the moved badge's OWN outbound backlinks (from→to)", async () => {
    // foo.md → target.md. Renaming foo.md must re-point target.md's backlink
    // from foo.md to foo-v2.md, not leave a phantom backlink from the deleted
    // old name.
    await ctx.core.run('badge.set', { file: 'target.md' });
    await ctx.core.run('badge.addRef', { file: 'foo.md', to: 'target.md' });
    expect(await backlinks(ctx.core, 'target.md')).toEqual(['foo.md']);

    await ctx.core.run('badge.rename', { from: 'foo.md', to: 'foo-v2.md' });

    // The moved badge keeps its outbound ref...
    const moved = (await ctx.core.run('badge.get', { file: 'foo-v2.md' })) as BadgeFile;
    expect(moved.references).toEqual(['target.md']);
    // ...and target.md's embedded backlink now records the NEW name, with no
    // phantom entry from the deleted old name.
    expect(await backlinks(ctx.core, 'target.md')).toEqual(['foo-v2.md']);
  });

  it('drops a PHANTOM backlink when a referrer badge was externally deleted', async () => {
    // referrer.md → target.md, then referrer's badge.yaml vanishes (manual rm /
    // external corruption). Renaming target must NOT carry the now-dangling
    // backlink onto the moved copy (every referenced_by needs a live reciprocal).
    await ctx.core.run('badge.set', { file: 'target.md', patch: { description: 'keep' } });
    await ctx.core.run('badge.addRef', { file: 'referrer.md', to: 'target.md' });
    ctx.files.delete(badgeYaml('referrer.md')); // external deletion

    await ctx.core.run('badge.rename', { from: 'target.md', to: 'target2.md' });

    expect(await backlinks(ctx.core, 'target2.md')).toEqual([]);
  });

  it('cascades focus: focusUpdated:true + current_focus follows the renamed node', async () => {
    // The mirror-node cascade moves the focus.yaml subtree together with the badge
    // and repoints current_focus when it pointed inside the renamed node, so the
    // agent keeps tracking what the user is looking at across the rename.
    await ctx.core.run('badge.set', { file: 'foo.md' });
    await ctx.core.run('focus.set', { path: 'foo.md', kind: 'file' });
    const result = (await ctx.core.run('badge.rename', {
      from: 'foo.md',
      to: 'foo-v2.md',
    })) as { focusUpdated: boolean };
    expect(result.focusUpdated).toBe(true);
    // The focus.yaml moved and current_focus resolves to the NEW path.
    const focus = (await ctx.core.run('focus.get', {})) as { path: string; kind: string } | null;
    expect(focus).toEqual({ path: 'foo-v2.md', kind: 'file' });
  });

  it('reports focusUpdated:false when `from` was not the focused node', async () => {
    await ctx.core.run('badge.set', { file: 'foo.md' });
    await ctx.core.run('focus.set', { path: 'unrelated.md', kind: 'file' });
    const result = (await ctx.core.run('badge.rename', {
      from: 'foo.md',
      to: 'foo-v2.md',
    })) as { focusUpdated: boolean };
    expect(result.focusUpdated).toBe(false);
    const focus = (await ctx.core.run('focus.get', {})) as { path: string; kind: string } | null;
    expect(focus).toEqual({ path: 'unrelated.md', kind: 'file' });
  });

  it('throws when source badge does not exist', async () => {
    await expect(
      ctx.core.run('badge.rename', { from: 'never.md', to: 'whatever.md' }),
    ).rejects.toThrow(/no badge at never\.md/);
  });

  it('returns badge:null (no throw) for a missing source when ifExists is set', async () => {
    // The sparse-overlay common case: renaming an UNANNOTATED file still has to
    // succeed quietly (workspace.renameEntry relies on this).
    const result = (await ctx.core.run('badge.rename', {
      from: 'never.md',
      to: 'whatever.md',
      ifExists: true,
    })) as { badge: BadgeFile | null };
    expect(result.badge).toBeNull();
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

  it('folder rename carries every CHILD badge to the new path (description + refs preserved)', async () => {
    // docs/ with two annotated children + a nested folder with its own child.
    await ctx.core.run('badge.set', {
      file: 'docs',
      patch: { kind: 'folder', description: 'chapter' },
    });
    await ctx.core.run('badge.set', { file: 'docs/a.md', patch: { description: 'intro' } });
    await ctx.core.run('badge.set', { file: 'docs/b.md', patch: { description: 'detail' } });
    await ctx.core.run('badge.set', {
      file: 'docs/sub',
      patch: { kind: 'folder', description: 'aside' },
    });
    await ctx.core.run('badge.set', { file: 'docs/sub/c.md', patch: { description: 'nested' } });

    await ctx.core.run('badge.rename', { from: 'docs', to: 'guide', kind: 'folder' });

    // Every child badge now lives under the new prefix, with its description intact…
    expect(
      ((await ctx.core.run('badge.get', { file: 'guide/a.md' })) as BadgeFile).description,
    ).toBe('intro');
    expect(
      ((await ctx.core.run('badge.get', { file: 'guide/b.md' })) as BadgeFile).description,
    ).toBe('detail');
    expect(
      ((await ctx.core.run('badge.get', { file: 'guide/sub/c.md' })) as BadgeFile).description,
    ).toBe('nested');
    // …and nothing is stranded at the old path.
    expect(await ctx.core.run('badge.get', { file: 'docs/a.md' })).toBeNull();
    expect(await ctx.core.run('badge.get', { file: 'docs/sub/c.md' })).toBeNull();
  });

  it('folder rename re-points an intra-folder reference to the new child paths', async () => {
    await ctx.core.run('badge.set', { file: 'docs', patch: { kind: 'folder' } });
    await ctx.core.run('badge.set', { file: 'docs/a.md' });
    await ctx.core.run('badge.set', { file: 'docs/b.md' });
    await ctx.core.run('badge.addRef', { file: 'docs/a.md', to: 'docs/b.md' });

    await ctx.core.run('badge.rename', { from: 'docs', to: 'guide', kind: 'folder' });

    const a = (await ctx.core.run('badge.get', { file: 'guide/a.md' })) as BadgeFile;
    expect(a.references).toEqual(['guide/b.md']);
    expect(await backlinks(ctx.core, 'guide/b.md')).toEqual(['guide/a.md']);
  });

  it('folder rename rewrites an OUTSIDE referrer of a child to the new child path', async () => {
    await ctx.core.run('badge.set', { file: 'docs', patch: { kind: 'folder' } });
    await ctx.core.run('badge.set', { file: 'docs/a.md' });
    await ctx.core.run('badge.addRef', { file: 'outside.md', to: 'docs/a.md' });

    await ctx.core.run('badge.rename', { from: 'docs', to: 'guide', kind: 'folder' });

    const outside = (await ctx.core.run('badge.get', { file: 'outside.md' })) as BadgeFile;
    expect(outside.references).toEqual(['guide/a.md']);
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
    await ctx.core.run('badge.set', { file: 'gone.md', patch: { description: 'was here' } });
    await ctx.core.run('badge.set', { file: 'live.md', patch: { description: 'still here' } });

    const res = (await ctx.core.run('badge.pruneDangling', {})) as { orphaned: string[] };
    expect(res.orphaned).toEqual(['gone.md']);

    const gone = (await ctx.core.run('badge.get', { file: 'gone.md' })) as BadgeFile;
    const live = (await ctx.core.run('badge.get', { file: 'live.md' })) as BadgeFile;
    expect(gone.orphan).toBe(true);
    expect(gone.description).toBe('was here'); // description preserved — never deleted
    expect(live.orphan).toBeUndefined();
  });

  it('is idempotent: a second sweep re-orphans nothing', async () => {
    await ctx.core.run('badge.set', { file: 'gone.md' });
    await ctx.core.run('badge.pruneDangling', {});
    const res = (await ctx.core.run('badge.pruneDangling', {})) as { orphaned: string[] };
    expect(res.orphaned).toEqual([]);
  });
});

describe('badge.markOrphan', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('flags an existing badge as orphan, preserving its content', async () => {
    await ctx.core.run('badge.set', { file: 'a.md', patch: { description: 'keep me' } });
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'b.md' });
    const res = (await ctx.core.run('badge.markOrphan', { file: 'a.md' })) as BadgeFile;
    expect(res.orphan).toBe(true);
    expect(res.description).toBe('keep me');
    expect(res.references).toEqual(['b.md']);
  });

  it('returns null when the badge does not exist', async () => {
    const res = await ctx.core.run('badge.markOrphan', { file: 'missing.md' });
    expect(res).toBeNull();
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

    await ctx.core.run('badge.set', { file: 'a.md', patch: { description: 'v1' } });
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

  it('two concurrent description patches on the same badge do not lose either edit', async () => {
    // Two near-simultaneous badge.set calls on the same badge each read the
    // pre-write badge; without the lock the second write resurrects the first's
    // stale state. The keyed mutex serializes the read→write so the last writer
    // wins cleanly (no torn merge) and the badge stays well-formed.
    await Promise.all([
      ctx.core.run('badge.set', { file: 'a.md', patch: { description: 'one honest sentence' } }),
      ctx.core.run('badge.set', { file: 'a.md', patch: { description: 'another sentence' } }),
    ]);
    const badge = (await ctx.core.run('badge.get', { file: 'a.md' })) as BadgeFile;
    // Exactly one of the two descriptions landed — never a corrupt/empty merge.
    expect(['one honest sentence', 'another sentence']).toContain(badge.description);
    expect(badge.references).toEqual([]);
  });

  it('a burst of addRef calls on the same badge all land', async () => {
    await Promise.all([
      ctx.core.run('badge.addRef', { file: 'hub.md', to: 'a.md' }),
      ctx.core.run('badge.addRef', { file: 'hub.md', to: 'b.md' }),
      ctx.core.run('badge.addRef', { file: 'hub.md', to: 'c.md' }),
    ]);
    const badge = (await ctx.core.run('badge.get', { file: 'hub.md' })) as BadgeFile;
    expect([...badge.references].sort()).toEqual(['a.md', 'b.md', 'c.md']);
  });
});
