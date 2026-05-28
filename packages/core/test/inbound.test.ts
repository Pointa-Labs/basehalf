import { beforeEach, describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';
import { mockFs } from './helpers/mock-fs.js';

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

describe('inbound.get', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('returns empty entries for a file with no inbound refs', async () => {
    const result = await ctx.core.run('inbound.get', { file: 'lonely.md' });
    expect(result).toEqual({ entries: [] });
  });

  it('returns entries set by a prior addRef', async () => {
    await ctx.core.run('inbound.addRef', { from: 'a.md', to: 'b.md', note: 'see also' });
    const result = await ctx.core.run('inbound.get', { file: 'b.md' });
    expect(result.entries).toEqual([{ from: 'a.md', note: 'see also' }]);
  });

  it('treats missing index file as empty (no crash)', async () => {
    // No file written; no addRef called. get should just return empty.
    expect(ctx.files.has('/work/.bh/index/inbound.json')).toBe(false);
    const result = await ctx.core.run('inbound.get', { file: 'whatever.md' });
    expect(result.entries).toEqual([]);
  });

  it('treats corrupt index file as empty (no crash)', async () => {
    ctx.files.set('/work/.bh/index/inbound.json', '{ not json }');
    const result = await ctx.core.run('inbound.get', { file: 'whatever.md' });
    expect(result.entries).toEqual([]);
  });
});

describe('inbound.addRef (incremental)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('creates a new entry on first addRef', async () => {
    const result = await ctx.core.run('inbound.addRef', { from: 'a.md', to: 'b.md' });
    expect(result.entries).toEqual([{ from: 'a.md' }]);
  });

  it('does NOT invent a rebuildAt on incremental writes (no epoch sentinel)', async () => {
    // Regression: prior behaviour seeded inbound.json with rebuildAt set to
    // new Date(0) ("1970-01-01T00:00:00.000Z") on the first incremental write,
    // which looked like a broken value in every git diff. The field should
    // only appear when inbound.rebuild has actually run.
    await ctx.core.run('inbound.addRef', { from: 'a.md', to: 'b.md' });
    const raw = ctx.files.get('/work/.bh/index/inbound.json');
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw as string) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('rebuildAt');
    expect(parsed.entries).toEqual({ 'b.md': [{ from: 'a.md' }] });
  });

  it('preserves a real rebuildAt across subsequent incremental writes', async () => {
    // After an explicit rebuild, later addRef/removeRef must keep that
    // timestamp around (it remains the answer to "when was the last full
    // walk?") rather than dropping it.
    await ctx.core.run('inbound.rebuild', {});
    const afterRebuild = JSON.parse(
      ctx.files.get('/work/.bh/index/inbound.json') as string,
    ) as Record<string, unknown>;
    const stamp = afterRebuild.rebuildAt as string;
    expect(typeof stamp).toBe('string');
    await ctx.core.run('inbound.addRef', { from: 'a.md', to: 'b.md' });
    const afterAdd = JSON.parse(ctx.files.get('/work/.bh/index/inbound.json') as string) as Record<
      string,
      unknown
    >;
    expect(afterAdd.rebuildAt).toBe(stamp);
  });

  it('appends multiple inbound entries to the same target', async () => {
    await ctx.core.run('inbound.addRef', { from: 'a.md', to: 'b.md' });
    await ctx.core.run('inbound.addRef', { from: 'c.md', to: 'b.md' });
    const result = await ctx.core.run('inbound.get', { file: 'b.md' });
    expect(result.entries).toEqual([{ from: 'a.md' }, { from: 'c.md' }]);
  });

  it('deduplicates by `from` — re-adding replaces existing entry', async () => {
    await ctx.core.run('inbound.addRef', { from: 'a.md', to: 'b.md', note: 'v1' });
    await ctx.core.run('inbound.addRef', { from: 'a.md', to: 'b.md', note: 'v2' });
    const result = await ctx.core.run('inbound.get', { file: 'b.md' });
    expect(result.entries).toEqual([{ from: 'a.md', note: 'v2' }]);
  });

  it('omits note when not provided', async () => {
    await ctx.core.run('inbound.addRef', { from: 'a.md', to: 'b.md' });
    const result = await ctx.core.run('inbound.get', { file: 'b.md' });
    expect(result.entries[0]).toEqual({ from: 'a.md' });
    expect(result.entries[0]).not.toHaveProperty('note');
  });
});

describe('inbound.removeRef (incremental)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('drops the matching entry', async () => {
    await ctx.core.run('inbound.addRef', { from: 'a.md', to: 'b.md' });
    await ctx.core.run('inbound.addRef', { from: 'c.md', to: 'b.md' });
    await ctx.core.run('inbound.removeRef', { from: 'a.md', to: 'b.md' });
    const result = await ctx.core.run('inbound.get', { file: 'b.md' });
    expect(result.entries).toEqual([{ from: 'c.md' }]);
  });

  it('removes the key entirely when last entry is gone', async () => {
    await ctx.core.run('inbound.addRef', { from: 'a.md', to: 'b.md' });
    await ctx.core.run('inbound.removeRef', { from: 'a.md', to: 'b.md' });
    const file = ctx.files.get('/work/.bh/index/inbound.json');
    expect(file).toBeDefined();
    const parsed = JSON.parse(file ?? '{}') as { entries: Record<string, unknown> };
    expect(parsed.entries['b.md']).toBeUndefined();
  });

  it('is a no-op on missing entry', async () => {
    await ctx.core.run('inbound.removeRef', { from: 'never.md', to: 'b.md' });
    // Should not throw; subsequent get is empty.
    const result = await ctx.core.run('inbound.get', { file: 'b.md' });
    expect(result.entries).toEqual([]);
  });
});

describe('inbound.rebuild (full scan)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('returns 0 entries when no badges exist', async () => {
    const result = await ctx.core.run('inbound.rebuild', {});
    expect(result.entryCount).toBe(0);
  });

  it('derives entries from all badge references', async () => {
    await ctx.core.run('badge.set', {
      file: 'a.md',
      patch: { references: [{ to: 'shared.md', note: 'parent' }] },
    });
    await ctx.core.run('badge.set', {
      file: 'b.md',
      patch: { references: [{ to: 'shared.md' }] },
    });
    const result = await ctx.core.run('inbound.rebuild', {});
    expect(result.entryCount).toBe(1);
    const inbound = await ctx.core.run('inbound.get', { file: 'shared.md' });
    expect(inbound.entries).toEqual(
      expect.arrayContaining([{ from: 'a.md', note: 'parent' }, { from: 'b.md' }]),
    );
  });

  it('overwrites any prior index (incremental drift is reset)', async () => {
    // Plant a stale entry that doesn't correspond to any real badge.
    await ctx.core.run('inbound.addRef', { from: 'ghost.md', to: 'real.md' });
    // Now rebuild from (empty) badges — ghost should be gone.
    await ctx.core.run('inbound.rebuild', {});
    const result = await ctx.core.run('inbound.get', { file: 'real.md' });
    expect(result.entries).toEqual([]);
  });

  it('records rebuildAt timestamp', async () => {
    const before = Date.now();
    const result = await ctx.core.run('inbound.rebuild', {});
    const after = Date.now();
    const at = Date.parse(result.rebuildAt);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(after);
  });
});

describe('badges ↔ inbound integration', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('badge.addRef updates inbound index automatically', async () => {
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'b.md', note: 'see' });
    const result = await ctx.core.run('inbound.get', { file: 'b.md' });
    expect(result.entries).toEqual([{ from: 'a.md', note: 'see' }]);
  });

  it('badge.removeRef removes corresponding inbound entry', async () => {
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'b.md' });
    await ctx.core.run('badge.removeRef', { file: 'a.md', to: 'b.md' });
    const result = await ctx.core.run('inbound.get', { file: 'b.md' });
    expect(result.entries).toEqual([]);
  });
});
