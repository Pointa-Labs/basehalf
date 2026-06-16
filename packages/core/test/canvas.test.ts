import { beforeEach, describe, expect, it } from 'vitest';
import { type BadgeFile, type CanvasCard, type CanvasFile, createCore } from '../src/index.js';
import { mockFs } from './helpers/mock-fs.js';

/**
 * Canvas module unit tests. The canvas is a FOLDER's visual layer: a
 * `canvas.yaml` at `<workspace>/.bh/mirror/<folder>/canvas.yaml` (root folder →
 * `.bh/mirror/canvas.yaml`) holding card positions + edges. An edge is the
 * VISUAL face of a `badge.references` link, so connect/disconnect/reconnect keep
 * the canvas.yaml and the badge graph (references + the target's referenced_by)
 * in lockstep. These run against an in-memory FsLike + an injected configDir,
 * seeding `/work` as the current workspace so the per-command `workspace.current`
 * lookup resolves.
 */

/** On-disk path of a folder's canvas.yaml (root folder → `.bh/mirror/canvas.yaml`). */
const canvasYaml = (folder: string | null): string =>
  folder ? `/work/.bh/mirror/${folder}/canvas.yaml` : '/work/.bh/mirror/canvas.yaml';

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

/** A card at the given position with stock size — for setCard upserts. */
function card(path: string, x: number, y: number, kind: 'file' | 'folder' = 'file'): CanvasCard {
  return { path, kind, x, y, width: 200, height: 120 };
}

describe('canvas.get', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('returns null when no canvas.yaml exists for the folder', async () => {
    expect(await ctx.core.run('canvas.get', { folder: null })).toBeNull();
    expect(await ctx.core.run('canvas.get', { folder: 'docs' })).toBeNull();
  });

  it('reads back a canvas after a card is written (root folder = rel "")', async () => {
    await ctx.core.run('canvas.setCard', { folder: null, card: card('a.md', 10, 20) });
    const c = (await ctx.core.run('canvas.get', { folder: null })) as CanvasFile;
    expect(c.path).toBe('');
    expect(c.cards).toEqual([card('a.md', 10, 20)]);
    expect(c.edges).toEqual([]);
  });

  it('throws when there is no current workspace', async () => {
    const { fs } = mockFs();
    const core = createCore({ fs, configDir: '/cfg' });
    await expect(core.run('canvas.get', { folder: null })).rejects.toThrow(/No current workspace/);
  });
});

describe('canvas.setCard (upsert by card.path)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('adds a new card and persists canvas.yaml', async () => {
    const c = (await ctx.core.run('canvas.setCard', {
      folder: null,
      card: card('a.md', 5, 5),
    })) as CanvasFile;
    expect(c.cards).toEqual([card('a.md', 5, 5)]);
    expect(ctx.files.has(canvasYaml(null))).toBe(true);
  });

  it('upserts in place: re-setting the same path REPLACES (no duplicate)', async () => {
    await ctx.core.run('canvas.setCard', { folder: null, card: card('a.md', 0, 0) });
    const c = (await ctx.core.run('canvas.setCard', {
      folder: null,
      card: card('a.md', 99, 99),
    })) as CanvasFile;
    expect(c.cards).toHaveLength(1);
    expect(c.cards[0]).toEqual(card('a.md', 99, 99));
  });

  it('keeps distinct cards side by side', async () => {
    await ctx.core.run('canvas.setCard', { folder: 'docs', card: card('docs/a.md', 1, 1) });
    const c = (await ctx.core.run('canvas.setCard', {
      folder: 'docs',
      card: card('docs/b.md', 2, 2),
    })) as CanvasFile;
    expect(c.cards.map((k) => k.path).sort()).toEqual(['docs/a.md', 'docs/b.md']);
  });

  it('scopes cards to their folder canvas (root vs subfolder)', async () => {
    await ctx.core.run('canvas.setCard', { folder: null, card: card('a.md', 1, 1) });
    await ctx.core.run('canvas.setCard', { folder: 'docs', card: card('docs/x.md', 2, 2) });
    const root = (await ctx.core.run('canvas.get', { folder: null })) as CanvasFile;
    const docs = (await ctx.core.run('canvas.get', { folder: 'docs' })) as CanvasFile;
    expect(root.cards.map((k) => k.path)).toEqual(['a.md']);
    expect(docs.cards.map((k) => k.path)).toEqual(['docs/x.md']);
  });
});

describe('canvas.removeCard (+ empty-prune)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('removes a card and reports removed:true', async () => {
    await ctx.core.run('canvas.setCard', { folder: null, card: card('a.md', 0, 0) });
    await ctx.core.run('canvas.setCard', { folder: null, card: card('b.md', 0, 0) });
    const res = (await ctx.core.run('canvas.removeCard', { folder: null, path: 'a.md' })) as {
      removed: boolean;
    };
    expect(res.removed).toBe(true);
    const c = (await ctx.core.run('canvas.get', { folder: null })) as CanvasFile;
    expect(c.cards.map((k) => k.path)).toEqual(['b.md']);
  });

  it('reports removed:false for a card that is not there', async () => {
    await ctx.core.run('canvas.setCard', { folder: null, card: card('a.md', 0, 0) });
    const res = (await ctx.core.run('canvas.removeCard', { folder: null, path: 'nope.md' })) as {
      removed: boolean;
    };
    expect(res.removed).toBe(false);
  });

  it('reports removed:false when there is no canvas at all', async () => {
    const res = (await ctx.core.run('canvas.removeCard', { folder: 'ghost', path: 'x.md' })) as {
      removed: boolean;
    };
    expect(res.removed).toBe(false);
  });

  it('prunes the canvas.yaml when the last card is removed (no cards/edges/size left)', async () => {
    await ctx.core.run('canvas.setCard', { folder: null, card: card('only.md', 0, 0) });
    expect(ctx.files.has(canvasYaml(null))).toBe(true);
    await ctx.core.run('canvas.removeCard', { folder: null, path: 'only.md' });
    // Sparse overlay: an empty canvas is deleted, not left as an empty husk.
    expect(ctx.files.has(canvasYaml(null))).toBe(false);
    expect(await ctx.core.run('canvas.get', { folder: null })).toBeNull();
  });

  it('does NOT prune while a size remains (canvas is not empty)', async () => {
    await ctx.core.run('canvas.setCard', { folder: null, card: card('a.md', 0, 0) });
    await ctx.core.run('canvas.setSize', { folder: null, size: { width: 1000, height: 800 } });
    await ctx.core.run('canvas.removeCard', { folder: null, path: 'a.md' });
    // size keeps it alive even with zero cards.
    const c = (await ctx.core.run('canvas.get', { folder: null })) as CanvasFile;
    expect(c.cards).toEqual([]);
    expect(c.size).toEqual({ width: 1000, height: 800 });
  });
});

describe('canvas.setSize', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('stores the overall canvas dimensions', async () => {
    const c = (await ctx.core.run('canvas.setSize', {
      folder: null,
      size: { width: 2400, height: 1600 },
    })) as CanvasFile;
    expect(c.size).toEqual({ width: 2400, height: 1600 });
    const reread = (await ctx.core.run('canvas.get', { folder: null })) as CanvasFile;
    expect(reread.size).toEqual({ width: 2400, height: 1600 });
  });

  it('updates the size without disturbing existing cards', async () => {
    await ctx.core.run('canvas.setCard', { folder: 'docs', card: card('docs/a.md', 7, 7) });
    const c = (await ctx.core.run('canvas.setSize', {
      folder: 'docs',
      size: { width: 800, height: 600 },
    })) as CanvasFile;
    expect(c.cards).toEqual([card('docs/a.md', 7, 7)]);
    expect(c.size).toEqual({ width: 800, height: 600 });
  });
});

describe('canvas.connect (edge + badge ref in lockstep)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('writes the canvas edge AND creates the source badge reference + target referenced_by', async () => {
    const c = (await ctx.core.run('canvas.connect', {
      folder: 'docs',
      from: 'docs/a.md',
      to: 'docs/b.md',
      from_anchor: 'east',
      to_anchor: 'west',
      label: 'leads to',
    })) as CanvasFile;
    // The visual edge carries the compass anchors + label.
    expect(c.edges).toEqual([
      {
        from: 'docs/a.md',
        from_anchor: 'east',
        to: 'docs/b.md',
        to_anchor: 'west',
        label: 'leads to',
      },
    ]);
    // Lockstep: the source badge's references now point at the target…
    const a = (await ctx.core.run('badge.get', { file: 'docs/a.md' })) as BadgeFile;
    expect(a.references).toEqual(['docs/b.md']);
    // …and the target badge records the backlink (referenced_by).
    const b = (await ctx.core.run('badge.get', { file: 'docs/b.md' })) as BadgeFile;
    expect(b.referenced_by).toEqual(['docs/a.md']);
  });

  it('omits a blank/whitespace-only label from the persisted edge', async () => {
    const c = (await ctx.core.run('canvas.connect', {
      folder: null,
      from: 'a.md',
      to: 'b.md',
      from_anchor: 'south',
      to_anchor: 'north',
      label: '   ',
    })) as CanvasFile;
    expect(c.edges).toHaveLength(1);
    expect(c.edges[0]?.label).toBeUndefined();
  });

  it('re-connecting the same directed pair replaces the edge (no duplicate)', async () => {
    await ctx.core.run('canvas.connect', {
      folder: null,
      from: 'a.md',
      to: 'b.md',
      from_anchor: 'east',
      to_anchor: 'west',
    });
    const c = (await ctx.core.run('canvas.connect', {
      folder: null,
      from: 'a.md',
      to: 'b.md',
      from_anchor: 'north',
      to_anchor: 'south',
    })) as CanvasFile;
    expect(c.edges).toHaveLength(1);
    expect(c.edges[0]).toEqual({
      from: 'a.md',
      from_anchor: 'north',
      to: 'b.md',
      to_anchor: 'south',
    });
    // Still a single badge reference (addRef dedups on the same target).
    const a = (await ctx.core.run('badge.get', { file: 'a.md' })) as BadgeFile;
    expect(a.references).toEqual(['b.md']);
  });

  it('throws on a self-edge and writes neither edge nor ref', async () => {
    await expect(
      ctx.core.run('canvas.connect', {
        folder: null,
        from: 'a.md',
        to: 'a.md',
        from_anchor: 'east',
        to_anchor: 'west',
      }),
    ).rejects.toThrow(/cannot connect a card to itself/i);
    // No orphan edge or badge materialized by the rejected connect.
    expect(await ctx.core.run('canvas.get', { folder: null })).toBeNull();
    expect(await ctx.core.run('badge.get', { file: 'a.md' })).toBeNull();
  });

  it('throws on a non-compass from_anchor (and on a bad to_anchor)', async () => {
    await expect(
      ctx.core.run('canvas.connect', {
        folder: null,
        from: 'a.md',
        to: 'b.md',
        from_anchor: 'top', // legacy box-side name, not a compass anchor
        to_anchor: 'west',
      }),
    ).rejects.toThrow(/from_anchor must be one of north, east, south, west/);
    await expect(
      ctx.core.run('canvas.connect', {
        folder: null,
        from: 'a.md',
        to: 'b.md',
        from_anchor: 'east',
        to_anchor: 'middle',
      }),
    ).rejects.toThrow(/to_anchor must be one of north, east, south, west/);
  });
});

describe('canvas.disconnect (edge + badge ref removed; tolerant)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('removes the edge AND drops the source ref + target referenced_by', async () => {
    await ctx.core.run('canvas.connect', {
      folder: null,
      from: 'a.md',
      to: 'b.md',
      from_anchor: 'east',
      to_anchor: 'west',
    });
    const c = (await ctx.core.run('canvas.disconnect', {
      folder: null,
      from: 'a.md',
      to: 'b.md',
    })) as CanvasFile;
    expect(c.edges).toEqual([]);
    // Lockstep teardown: the source badge no longer references the target…
    const a = (await ctx.core.run('badge.get', { file: 'a.md' })) as BadgeFile;
    expect(a.references).toEqual([]);
    // …and the (now stub) target badge was pruned, so its backlink is gone.
    expect(await ctx.core.run('badge.get', { file: 'b.md' })).toBeNull();
  });

  it('prunes the canvas.yaml when the last edge is disconnected (nothing left)', async () => {
    await ctx.core.run('canvas.connect', {
      folder: null,
      from: 'a.md',
      to: 'b.md',
      from_anchor: 'east',
      to_anchor: 'west',
    });
    expect(ctx.files.has(canvasYaml(null))).toBe(true);
    await ctx.core.run('canvas.disconnect', { folder: null, from: 'a.md', to: 'b.md' });
    expect(ctx.files.has(canvasYaml(null))).toBe(false);
  });

  it('is tolerant when the source badge is already gone — still removes the visual edge', async () => {
    await ctx.core.run('canvas.connect', {
      folder: null,
      from: 'a.md',
      to: 'b.md',
      from_anchor: 'east',
      to_anchor: 'west',
    });
    // Externally delete the source badge (a canvas edge can outlive its badge).
    ctx.files.delete('/work/.bh/mirror/a.md/badge.yaml');
    const c = (await ctx.core.run('canvas.disconnect', {
      folder: null,
      from: 'a.md',
      to: 'b.md',
    })) as CanvasFile;
    // The user-visible effect (edge removal) still happens; no throw.
    expect(c.edges).toEqual([]);
  });

  it('leaves an unrelated edge in place', async () => {
    await ctx.core.run('canvas.connect', {
      folder: null,
      from: 'a.md',
      to: 'b.md',
      from_anchor: 'east',
      to_anchor: 'west',
    });
    await ctx.core.run('canvas.connect', {
      folder: null,
      from: 'a.md',
      to: 'c.md',
      from_anchor: 'south',
      to_anchor: 'north',
    });
    const c = (await ctx.core.run('canvas.disconnect', {
      folder: null,
      from: 'a.md',
      to: 'b.md',
    })) as CanvasFile;
    expect(c.edges.map((e) => e.to)).toEqual(['c.md']);
    const a = (await ctx.core.run('badge.get', { file: 'a.md' })) as BadgeFile;
    expect(a.references).toEqual(['c.md']);
  });
});

describe('canvas.reconnect', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('endpoint change MOVES the badge ref (addRef next + removeRef previous)', async () => {
    await ctx.core.run('canvas.connect', {
      folder: null,
      from: 'a.md',
      to: 'b.md',
      from_anchor: 'east',
      to_anchor: 'west',
    });
    const c = (await ctx.core.run('canvas.reconnect', {
      folder: null,
      previous: { from: 'a.md', to: 'b.md' },
      next: { from: 'a.md', to: 'c.md', from_anchor: 'east', to_anchor: 'west' },
    })) as CanvasFile;
    // The edge now points at the new endpoint.
    expect(c.edges).toEqual([{ from: 'a.md', from_anchor: 'east', to: 'c.md', to_anchor: 'west' }]);
    // The badge ref moved with it: b.md dropped, c.md added.
    const a = (await ctx.core.run('badge.get', { file: 'a.md' })) as BadgeFile;
    expect(a.references).toEqual(['c.md']);
    // Old target's backlink is gone (its stub was pruned); new target gained one.
    expect(await ctx.core.run('badge.get', { file: 'b.md' })).toBeNull();
    const cBadge = (await ctx.core.run('badge.get', { file: 'c.md' })) as BadgeFile;
    expect(cBadge.referenced_by).toEqual(['a.md']);
  });

  it('moving the SOURCE endpoint repoints the ref to the new source', async () => {
    await ctx.core.run('canvas.connect', {
      folder: null,
      from: 'a.md',
      to: 'b.md',
      from_anchor: 'east',
      to_anchor: 'west',
    });
    await ctx.core.run('canvas.reconnect', {
      folder: null,
      previous: { from: 'a.md', to: 'b.md' },
      next: { from: 'x.md', to: 'b.md', from_anchor: 'south', to_anchor: 'north' },
    });
    // Old source no longer references b.md…
    const a = (await ctx.core.run('badge.get', { file: 'a.md' })) as BadgeFile;
    expect(a?.references ?? []).toEqual([]);
    // …the new source does.
    const x = (await ctx.core.run('badge.get', { file: 'x.md' })) as BadgeFile;
    expect(x.references).toEqual(['b.md']);
    const b = (await ctx.core.run('badge.get', { file: 'b.md' })) as BadgeFile;
    expect(b.referenced_by).toEqual(['x.md']);
  });

  it('anchor/label-only change rewrites the edge but does NOT touch the badge ref', async () => {
    await ctx.core.run('canvas.connect', {
      folder: null,
      from: 'a.md',
      to: 'b.md',
      from_anchor: 'east',
      to_anchor: 'west',
    });
    const c = (await ctx.core.run('canvas.reconnect', {
      folder: null,
      previous: { from: 'a.md', to: 'b.md' },
      next: {
        from: 'a.md',
        to: 'b.md',
        from_anchor: 'north',
        to_anchor: 'south',
        label: 'see also',
      },
    })) as CanvasFile;
    expect(c.edges).toEqual([
      { from: 'a.md', from_anchor: 'north', to: 'b.md', to_anchor: 'south', label: 'see also' },
    ]);
    // Same directed pair → the badge ref is untouched (a single, undisturbed link).
    const a = (await ctx.core.run('badge.get', { file: 'a.md' })) as BadgeFile;
    expect(a.references).toEqual(['b.md']);
    const b = (await ctx.core.run('badge.get', { file: 'b.md' })) as BadgeFile;
    expect(b.referenced_by).toEqual(['a.md']);
  });

  it('throws on a self-edge in next (endpoints would collapse)', async () => {
    await ctx.core.run('canvas.connect', {
      folder: null,
      from: 'a.md',
      to: 'b.md',
      from_anchor: 'east',
      to_anchor: 'west',
    });
    await expect(
      ctx.core.run('canvas.reconnect', {
        folder: null,
        previous: { from: 'a.md', to: 'b.md' },
        next: { from: 'a.md', to: 'a.md', from_anchor: 'east', to_anchor: 'west' },
      }),
    ).rejects.toThrow(/cannot connect a card to itself/i);
  });

  it('throws on a bad compass anchor in next', async () => {
    await ctx.core.run('canvas.connect', {
      folder: null,
      from: 'a.md',
      to: 'b.md',
      from_anchor: 'east',
      to_anchor: 'west',
    });
    await expect(
      ctx.core.run('canvas.reconnect', {
        folder: null,
        previous: { from: 'a.md', to: 'b.md' },
        next: { from: 'a.md', to: 'b.md', from_anchor: 'left', to_anchor: 'west' },
      }),
    ).rejects.toThrow(/from_anchor must be one of north, east, south, west/);
  });
});

describe('canvas.revision (cheap external-edit signature)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('count grows as canvases are written', async () => {
    const empty = (await ctx.core.run('canvas.revision', {})) as {
      count: number;
      maxMtimeMs: number;
    };
    expect(empty.count).toBe(0);

    await ctx.core.run('canvas.setCard', { folder: null, card: card('a.md', 0, 0) });
    const one = (await ctx.core.run('canvas.revision', {})) as { count: number };
    expect(one.count).toBe(1);

    await ctx.core.run('canvas.setCard', { folder: 'docs', card: card('docs/x.md', 0, 0) });
    const two = (await ctx.core.run('canvas.revision', {})) as { count: number };
    expect(two.count).toBe(2);
  });
});
