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

  it('list skips corrupt view JSON without crashing (AR-PR11-7)', async () => {
    await ctx.core.run('view.create', { name: 'good' });
    ctx.files.set('/work/.bh/views/broken.json', '{ not json }');
    const result = (await ctx.core.run('view.list', {})) as { views: SavedView[] };
    expect(result.views.map((v) => v.id)).toEqual(['good']);
  });

  it('get returns null on corrupt view JSON (orphan-tolerant)', async () => {
    ctx.files.set('/work/.bh/views/broken.json', '{ not json }');
    const result = await ctx.core.run('view.get', { id: 'broken' });
    expect(result).toBeNull();
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

  it('re-publishes the focused brief intent when a focused view prompt changes', async () => {
    const v = (await ctx.core.run('view.create', {
      name: 'V',
      prompt: 'old intent',
    })) as SavedView;
    await ctx.core.run('view.addMember', { id: v.id, file: 'a.md' });
    await ctx.core.run('view.addMember', { id: v.id, file: 'b.md' });
    await ctx.core.run('focus.set', { viewId: v.id });
    expect(ctx.files.get('/work/.bh/focus.md') ?? '').toContain('intent: old intent');

    await ctx.core.run('view.update', { id: v.id, patch: { prompt: 'new intent' } });
    const brief = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(brief).toContain('intent: new intent');
    expect(brief).not.toContain('old intent');
  });

  it('clears the brief intent when a focused view prompt is emptied', async () => {
    const v = (await ctx.core.run('view.create', {
      name: 'V',
      prompt: 'some intent',
    })) as SavedView;
    await ctx.core.run('view.addMember', { id: v.id, file: 'a.md' });
    await ctx.core.run('focus.set', { viewId: v.id });
    await ctx.core.run('view.update', { id: v.id, patch: { prompt: '' } });
    const brief = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(brief).not.toContain('intent:');
  });

  it('leaves focus.md untouched when the active set no longer matches the view members', async () => {
    const v = (await ctx.core.run('view.create', {
      name: 'V',
      prompt: 'old intent',
    })) as SavedView;
    await ctx.core.run('view.addMember', { id: v.id, file: 'a.md' });
    await ctx.core.run('view.addMember', { id: v.id, file: 'b.md' });
    await ctx.core.run('focus.set', { viewId: v.id });
    // User manually narrows focus → active no longer equals the view members.
    await ctx.core.run('focus.set', { files: ['a.md'] });
    const before = ctx.files.get('/work/.bh/focus.md') ?? '';

    await ctx.core.run('view.update', { id: v.id, patch: { prompt: 'new intent' } });
    expect(ctx.files.get('/work/.bh/focus.md') ?? '').toBe(before); // unchanged
  });

  it('does not touch focus.md when only the view name changes (no prompt edit)', async () => {
    const v = (await ctx.core.run('view.create', { name: 'V', prompt: 'keep' })) as SavedView;
    await ctx.core.run('view.addMember', { id: v.id, file: 'a.md' });
    await ctx.core.run('focus.set', { viewId: v.id });
    const before = ctx.files.get('/work/.bh/focus.md') ?? '';
    await ctx.core.run('view.update', { id: v.id, patch: { name: 'renamed' } });
    expect(ctx.files.get('/work/.bh/focus.md') ?? '').toBe(before);
  });

  it('does NOT clobber view A when a DIFFERENT view B with identical members is edited', async () => {
    await ctx.core.run('view.create', { name: 'A', id: 'a', prompt: 'intent A' });
    await ctx.core.run('view.addMember', { id: 'a', file: 'x.md' });
    await ctx.core.run('view.addMember', { id: 'a', file: 'y.md' });
    await ctx.core.run('view.create', { name: 'B', id: 'b', prompt: 'intent B' });
    await ctx.core.run('view.addMember', { id: 'b', file: 'x.md' });
    await ctx.core.run('view.addMember', { id: 'b', file: 'y.md' });
    await ctx.core.run('focus.set', { viewId: 'a' }); // focused on A
    expect(ctx.files.get('/work/.bh/focus.md') ?? '').toContain('intent: intent A');
    // Editing B (same members, NOT focused) must not hijack A's brief.
    await ctx.core.run('view.update', { id: 'b', patch: { prompt: 'intent B v2' } });
    const brief = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(brief).toContain('intent: intent A');
    expect(brief).not.toContain('intent B');
  });

  it('does NOT clobber a manual intent override on a focused view', async () => {
    await ctx.core.run('view.create', { name: 'V', id: 'v', prompt: 'view prompt' });
    await ctx.core.run('view.addMember', { id: 'v', file: 'x.md' });
    await ctx.core.run('focus.set', { viewId: 'v', intent: 'my manual override' });
    await ctx.core.run('view.update', { id: 'v', patch: { prompt: 'view prompt v2' } });
    expect(ctx.files.get('/work/.bh/focus.md') ?? '').toContain('intent: my manual override');
  });

  it('does NOT clobber a files-sourced curated intent that happens to equal the members', async () => {
    await ctx.core.run('view.create', { name: 'V', id: 'v', prompt: 'view prompt' });
    await ctx.core.run('view.addMember', { id: 'v', file: 'x.md' });
    await ctx.core.run('focus.set', { files: ['x.md'], intent: 'hand-curated intent' });
    await ctx.core.run('view.update', { id: 'v', patch: { prompt: 'view prompt v2' } });
    expect(ctx.files.get('/work/.bh/focus.md') ?? '').toContain('intent: hand-curated intent');
  });

  it('refreshes the intent of a focused EMPTY (0-member) view on prompt edit', async () => {
    await ctx.core.run('view.create', { name: 'V', id: 'v', prompt: 'old empty intent' });
    await ctx.core.run('focus.set', { viewId: 'v' }); // 0 members → active (none)
    const before = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(before).toContain('intent: old empty intent');
    expect(before).toContain('(none)');
    await ctx.core.run('view.update', { id: 'v', patch: { prompt: 'new empty intent' } });
    const after = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(after).toContain('intent: new empty intent');
    expect(after).toContain('(none)');
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
