import { beforeEach, describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';
import { parseFocus, renderFocus } from '../src/modules/focus/store.js';
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

describe('focus.set', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('writes an explicit file list', async () => {
    const result = await ctx.core.run('focus.set', { files: ['a.md', 'b.md'] });
    expect(result.active).toEqual(['a.md', 'b.md']);
    const written = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(written).toContain('- a.md');
    expect(written).toContain('- b.md');
  });

  it('writes (none) marker for empty file list', async () => {
    await ctx.core.run('focus.set', { files: [] });
    const written = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(written).toContain('(none)');
  });

  it('omitting both files and viewId is treated as clear (active=[])', async () => {
    const result = await ctx.core.run('focus.set', {});
    expect(result.active).toEqual([]);
  });

  it('throws "View not found" when viewId does not match any view', async () => {
    await expect(ctx.core.run('focus.set', { viewId: 'missing' })).rejects.toThrow(
      /View not found/,
    );
  });

  it('expands viewId via the views module → members[].file', async () => {
    await ctx.core.run('view.create', { name: 'exam' });
    await ctx.core.run('view.addMember', { id: 'exam', file: 'chapter-03.md' });
    await ctx.core.run('view.addMember', { id: 'exam', file: 'supply.md' });
    const result = await ctx.core.run('focus.set', { viewId: 'exam' });
    expect(result.active).toEqual(['chapter-03.md', 'supply.md']);
  });
});

describe('focus.get', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('returns empty for a freshly-seeded workspace (active: (none))', async () => {
    // seed() runs workspace.add → materializeWithFallback → focus.init,
    // so focus.md exists with the empty template (`active:\n  (none)`).
    // focus.get parses that to an empty active list.
    const result = await ctx.core.run('focus.get', {});
    expect(result.active).toEqual([]);
  });

  it('returns empty when focus.md is missing on disk (tolerant read)', async () => {
    // Cover the path where the file was deleted externally between seed
    // and get — the handler must still return empty without throwing.
    ctx.files.delete('/work/.bh/focus.md');
    const result = await ctx.core.run('focus.get', {});
    expect(result.active).toEqual([]);
  });

  it('round-trips a list set via focus.set', async () => {
    await ctx.core.run('focus.set', { files: ['x.md', 'y.md'] });
    const result = await ctx.core.run('focus.get', {});
    expect(result.active).toEqual(['x.md', 'y.md']);
  });

  it('parses paths with spaces and CJK characters', async () => {
    await ctx.core.run('focus.set', { files: ['供需弹性.md', 'note with space.md'] });
    const result = await ctx.core.run('focus.get', {});
    expect(result.active).toEqual(['供需弹性.md', 'note with space.md']);
  });
});

describe('focus.clear', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('writes the (none) marker and a subsequent get returns empty', async () => {
    await ctx.core.run('focus.set', { files: ['a.md'] });
    const cleared = await ctx.core.run('focus.clear', {});
    expect(cleared.cleared).toBe(true);
    const result = await ctx.core.run('focus.get', {});
    expect(result.active).toEqual([]);
  });
});

describe('focus.init (seed contract surface)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('writes the empty template when focus.md does not yet exist', async () => {
    // seed() runs workspace.add → materializeWithFallback → focus.init,
    // so focus.md should already be on disk after seeding.
    const file = ctx.files.get('/work/.bh/focus.md');
    expect(file).toBeDefined();
    expect(file).toMatch(/^# bh focus/);
    expect(file).toMatch(/active:\s*\n\s*\(none\)/);
  });

  it('is a no-op when focus.md already has content (idempotent — user state preserved)', async () => {
    await ctx.core.run('focus.set', { files: ['a.md', 'b.md'] });
    const before = ctx.files.get('/work/.bh/focus.md');
    const result = await ctx.core.run('focus.init', {});
    expect(result.created).toBe(false);
    const after = ctx.files.get('/work/.bh/focus.md');
    expect(after).toBe(before);
  });

  it('rewrites the template when focus.md is missing on a re-call (e.g. user deleted it)', async () => {
    ctx.files.delete('/work/.bh/focus.md');
    const result = await ctx.core.run('focus.init', {});
    expect(result.created).toBe(true);
    const after = ctx.files.get('/work/.bh/focus.md');
    expect(after).toBeDefined();
    expect(after).toMatch(/active:/);
  });
});

describe('parseFocus / renderFocus (pure helpers)', () => {
  it('roundtrips an empty list', () => {
    const rendered = renderFocus([]);
    expect(parseFocus(rendered)).toEqual([]);
  });

  it('roundtrips a populated list', () => {
    const rendered = renderFocus(['a.md', 'b.md']);
    expect(parseFocus(rendered)).toEqual(['a.md', 'b.md']);
  });

  it('ignores non-list lines under active:', () => {
    const md = '# bh focus\n\nactive:\n  - real.md\nsome footer\n  - too-late.md\n';
    expect(parseFocus(md)).toEqual(['real.md']);
  });

  it('returns empty when active: section is missing', () => {
    expect(parseFocus('# random file\n\nno active section here\n')).toEqual([]);
  });
});
