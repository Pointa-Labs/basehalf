import { beforeEach, describe, expect, it } from 'vitest';
import { type SavedView, createCore } from '../src/index.js';
import { slugifyId } from '../src/modules/views/store.js';
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

describe('view.create', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('creates a view with auto-slugified id', async () => {
    const v = (await ctx.core.run('view.create', { name: 'Exam Review (Econ)' })) as SavedView;
    expect(v.id).toBe('exam-review-econ');
    expect(v.name).toBe('Exam Review (Econ)');
    expect(v.members).toEqual([]);
    expect(v.createdAt).toBe(v.modifiedAt);
  });

  it('honors explicit id', async () => {
    const v = (await ctx.core.run('view.create', {
      name: 'whatever',
      id: 'my-explicit-id',
    })) as SavedView;
    expect(v.id).toBe('my-explicit-id');
  });

  it('honors prompt', async () => {
    const v = (await ctx.core.run('view.create', {
      name: 'X',
      prompt: 'study guide',
    })) as SavedView;
    expect(v.prompt).toBe('study guide');
  });

  it('throws on duplicate id', async () => {
    await ctx.core.run('view.create', { name: 'X' });
    await expect(ctx.core.run('view.create', { name: 'X' })).rejects.toThrow(/View already exists/);
  });
});

describe('view.list / view.get', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('list is empty initially', async () => {
    const result = (await ctx.core.run('view.list', {})) as { views: SavedView[] };
    expect(result.views).toEqual([]);
  });

  it('list returns all views sorted by id', async () => {
    await ctx.core.run('view.create', { name: 'Zeta' });
    await ctx.core.run('view.create', { name: 'Alpha' });
    const result = (await ctx.core.run('view.list', {})) as { views: SavedView[] };
    expect(result.views.map((v) => v.id)).toEqual(['alpha', 'zeta']);
  });

  it('get returns null for missing id', async () => {
    const result = await ctx.core.run('view.get', { id: 'never-existed' });
    expect(result).toBeNull();
  });

  it('get returns the created view', async () => {
    await ctx.core.run('view.create', { name: 'X' });
    const result = (await ctx.core.run('view.get', { id: 'x' })) as SavedView;
    expect(result.name).toBe('X');
  });
});

describe('view.update', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('updates name + bumps modifiedAt', async () => {
    const created = (await ctx.core.run('view.create', { name: 'old' })) as SavedView;
    await new Promise((r) => setTimeout(r, 10));
    const updated = (await ctx.core.run('view.update', {
      id: created.id,
      patch: { name: 'new' },
    })) as SavedView;
    expect(updated.name).toBe('new');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.modifiedAt).not.toBe(created.modifiedAt);
  });

  it('updates prompt', async () => {
    const v = (await ctx.core.run('view.create', { name: 'X' })) as SavedView;
    const updated = (await ctx.core.run('view.update', {
      id: v.id,
      patch: { prompt: 'a fresh prompt' },
    })) as SavedView;
    expect(updated.prompt).toBe('a fresh prompt');
  });

  it('throws on missing id', async () => {
    await expect(ctx.core.run('view.update', { id: 'gone', patch: { name: 'x' } })).rejects.toThrow(
      /View not found/,
    );
  });
});

describe('view.delete', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('returns deleted:true and removes file when view exists', async () => {
    await ctx.core.run('view.create', { name: 'X' });
    expect(ctx.files.has('/work/.bh/views/x.json')).toBe(true);
    const result = await ctx.core.run('view.delete', { id: 'x' });
    expect(result.deleted).toBe(true);
    expect(ctx.files.has('/work/.bh/views/x.json')).toBe(false);
  });

  it('returns deleted:false for missing id', async () => {
    const result = await ctx.core.run('view.delete', { id: 'never' });
    expect(result.deleted).toBe(false);
  });

  it('does NOT touch member badges or files (observer principle)', async () => {
    await ctx.core.run('badge.set', { file: 'a.md' });
    await ctx.core.run('view.create', { name: 'X' });
    await ctx.core.run('view.addMember', { id: 'x', file: 'a.md' });
    await ctx.core.run('view.delete', { id: 'x' });
    // Badge still exists on disk after view removal.
    expect(ctx.files.has('/work/.bh/badges/a.md.json')).toBe(true);
  });
});

describe('view.addMember / view.removeMember', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
    await ctx.core.run('view.create', { name: 'review' });
  });

  it('adds member without position', async () => {
    const v = (await ctx.core.run('view.addMember', {
      id: 'review',
      file: 'a.md',
    })) as SavedView;
    expect(v.members).toEqual([{ file: 'a.md' }]);
  });

  it('adds member with position', async () => {
    const v = (await ctx.core.run('view.addMember', {
      id: 'review',
      file: 'a.md',
      position: { x: 100, y: 200 },
    })) as SavedView;
    expect(v.members[0]).toEqual({ file: 'a.md', x: 100, y: 200 });
  });

  it('re-adding same file replaces (dedup by file)', async () => {
    await ctx.core.run('view.addMember', {
      id: 'review',
      file: 'a.md',
      position: { x: 100, y: 200 },
    });
    const v = (await ctx.core.run('view.addMember', {
      id: 'review',
      file: 'a.md',
      position: { x: 999, y: 999 },
    })) as SavedView;
    expect(v.members).toHaveLength(1);
    expect(v.members[0]?.x).toBe(999);
  });

  it('removeMember drops the matching file', async () => {
    await ctx.core.run('view.addMember', { id: 'review', file: 'a.md' });
    await ctx.core.run('view.addMember', { id: 'review', file: 'b.md' });
    const v = (await ctx.core.run('view.removeMember', {
      id: 'review',
      file: 'a.md',
    })) as SavedView;
    expect(v.members).toEqual([{ file: 'b.md' }]);
  });

  it('addMember throws when view does not exist', async () => {
    await expect(ctx.core.run('view.addMember', { id: 'never', file: 'a.md' })).rejects.toThrow(
      /View not found/,
    );
  });

  it('member is a reference, not a copy — same file across multiple views OK', async () => {
    await ctx.core.run('view.create', { name: 'second' });
    await ctx.core.run('view.addMember', { id: 'review', file: 'shared.md' });
    await ctx.core.run('view.addMember', { id: 'second', file: 'shared.md' });
    const v1 = (await ctx.core.run('view.get', { id: 'review' })) as SavedView;
    const v2 = (await ctx.core.run('view.get', { id: 'second' })) as SavedView;
    expect(v1.members[0]?.file).toBe('shared.md');
    expect(v2.members[0]?.file).toBe('shared.md');
  });
});

describe('focus.set with viewId — integration', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('focus.set({ viewId }) expands the view to the member file list', async () => {
    await ctx.core.run('view.create', { name: 'exam' });
    await ctx.core.run('view.addMember', { id: 'exam', file: 'chapter-03.md' });
    await ctx.core.run('view.addMember', { id: 'exam', file: 'supply.md' });
    const result = await ctx.core.run('focus.set', { viewId: 'exam' });
    expect(result.active).toEqual(['chapter-03.md', 'supply.md']);
  });
});

describe('slugifyId (pure helper)', () => {
  it('lowercases + replaces non-alphanumerics with dashes', () => {
    expect(slugifyId('Hello World!')).toBe('hello-world');
  });

  it('strips leading/trailing dashes', () => {
    expect(slugifyId('---abc---')).toBe('abc');
  });

  it('falls back to "view" for entirely non-alphanumeric input', () => {
    expect(slugifyId('---')).toBe('view');
  });
});
