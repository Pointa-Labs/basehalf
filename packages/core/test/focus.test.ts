import { beforeEach, describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';
import { parseFocus, parseIntent, renderFocus } from '../src/modules/focus/store.js';
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

  it('omitting both files and folder is treated as clear (active=[])', async () => {
    const result = await ctx.core.run('focus.set', {});
    expect(result.active).toEqual([]);
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

  it('parseIntent round-trips the intent line (and is undefined when absent)', () => {
    const withIntent = renderFocus(['a.md'], 'derive theorem 2');
    expect(parseIntent(withIntent)).toBe('derive theorem 2');
    const noIntent = renderFocus(['a.md']);
    expect(parseIntent(noIntent)).toBeUndefined();
    // A `- intent:`-looking line inside the active block is NOT mistaken for it.
    expect(parseIntent('# bh focus\n\nactive:\n  - intent.md\n')).toBeUndefined();
  });

  // focus.md is line-delimited; a newline in a path can't round-trip. Before
  // the guard, focus.set({files:['a\nb.md']}) wrote a 2-line list item and
  // focus.get read back only 'a', silently dropping the rest of the list.
  it('rejects a path with a newline rather than corrupt the round-trip', async () => {
    const ctx = await seed();
    await expect(ctx.core.run('focus.set', { files: ['file\nname.md'] })).rejects.toThrow(
      /newline/i,
    );
    await expect(
      ctx.core.run('focus.set', { files: ['ok.md', 'bad\rcarriage.md'] }),
    ).rejects.toThrow(/newline/i);
  });

  it('still accepts adversarial-but-representable names (colon, hash, parens, leading dash)', async () => {
    const ctx = await seed();
    const tricky = ['a:b.md', '#hash.md', '(none)', '-dash.md', 'notes/中文.md'];
    const result = await ctx.core.run('focus.set', { files: tricky });
    expect(result.active).toEqual(tricky);
    // And they survive the on-disk round-trip via focus.get.
    const got = await ctx.core.run('focus.get', {});
    expect(got.active).toEqual(tricky);
  });

  it('parseFocus skips inlined prompt/refs sub-lines and still collects every path', () => {
    const md = renderFocus(
      [
        { file: 'a.md', prompt: 'about a', refs: [{ to: 'b.md', note: 'why a→b' }] },
        { file: 'b.md' },
      ],
      'do the thing',
    );
    expect(md).toContain('intent: do the thing');
    expect(md).toContain('prompt: about a');
    expect(md).toContain('-> b.md  (note: why a→b)');
    // Both paths survive — the deep-indented sub-lines must not end the block.
    expect(parseFocus(md)).toEqual(['a.md', 'b.md']);
  });

  it('collapses a multi-line prompt so it cannot inject a fake list item', () => {
    const md = renderFocus(
      [{ file: 'a.md', prompt: 'line1\nline2\n- not a real item' }, { file: 'b.md' }],
      undefined,
    );
    expect(md).toContain('prompt: line1 line2 - not a real item');
    // The injected "- not a real item" was flattened onto the prompt line, so
    // it is NOT parsed as an active item; b.md is still found.
    expect(parseFocus(md)).toEqual(['a.md', 'b.md']);
  });
});

describe('focus brief (compound-thinking payload inlined into focus.md)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it("inlines each active file's prompt + reference notes as a turn brief", async () => {
    await ctx.core.run('badge.set', {
      file: 'chapter-03.md',
      kind: 'file',
      patch: { prompt: 'teacher emphasized ch 1, 3, 6' },
    });
    await ctx.core.run('badge.addRef', {
      file: 'chapter-03.md',
      to: 'supply.md',
      note: 'derivation depends on this',
    });
    await ctx.core.run('focus.set', { files: ['chapter-03.md'] });
    const md = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(md).toContain('- chapter-03.md');
    expect(md).toContain('prompt: teacher emphasized ch 1, 3, 6');
    expect(md).toContain('-> supply.md  (note: derivation depends on this)');
    // The round-trippable path list is unaffected by the inlined meaning.
    const got = await ctx.core.run('focus.get', {});
    expect(got.active).toEqual(['chapter-03.md']);
  });

  it('a file with no badge contributes just its bare path (no empty prompt/refs)', async () => {
    await ctx.core.run('focus.set', { files: ['no-badge.md'] });
    const md = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(md).toContain('- no-badge.md');
    expect(md).not.toContain('prompt:');
    expect(md).not.toContain('refs:');
  });

  it('inlines who points AT a focused file (referenced-by, with note)', async () => {
    // other.md → focused.md (with a note). Focusing focused.md should surface the
    // backlink so the agent sees BOTH directions of the human's relationships.
    await ctx.core.run('badge.addRef', {
      file: 'other.md',
      to: 'focused.md',
      note: 'builds on this',
    });
    await ctx.core.run('focus.set', { files: ['focused.md'] });
    const md = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(md).toContain('referenced-by:');
    expect(md).toContain('<- other.md  (note: builds on this)');
    // Still round-trips to the bare active list.
    const got = await ctx.core.run('focus.get', {});
    expect(got.active).toEqual(['focused.md']);
  });

  it('an empty brief carries a next-step hint instead of being a dead read', async () => {
    await ctx.core.run('focus.set', { files: [] });
    const md = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(md).toContain('(none)');
    expect(md).toContain('bh search');
    // The hint is a comment — parseFocus still reads an empty active list.
    const got = await ctx.core.run('focus.get', {});
    expect(got.active).toEqual([]);
  });

  it('portable brief appends capped file excerpts; on-disk focus.md stays paths+notes', async () => {
    ctx.files.set('/work/note.md', '# Title\n\nthe actual content lives on disk');
    await ctx.core.run('badge.set', { file: 'note.md', patch: { prompt: 'read this first' } });
    await ctx.core.run('focus.set', { files: ['note.md'] });

    // The on-disk brief never inlines content (an in-repo agent reads files itself).
    const onDisk = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(onDisk).not.toContain('the actual content lives on disk');

    // The non-portable brief equals the file; the portable one appends excerpts.
    const plain = (await ctx.core.run('focus.brief', { stamp: false })) as { brief: string };
    expect(plain.brief).not.toContain('the actual content lives on disk');
    const portable = (await ctx.core.run('focus.brief', { stamp: false, portable: true })) as {
      brief: string;
    };
    expect(portable.brief).toContain('# file contents');
    expect(portable.brief).toContain('### note.md');
    expect(portable.brief).toContain('the actual content lives on disk');
  });
});

describe('focus.resync (core reconcile of focus.md after badge edits)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('badge.set on an ACTIVE file auto-refreshes the inlined prompt, preserving intent', async () => {
    // Focus FIRST, then edit the badge — the case the renderer used to patch
    // with resyncFocusForFile and badge.rename used to drop the intent on.
    await ctx.core.run('focus.set', { files: ['ch.md'], intent: 'study for the exam' });
    await ctx.core.run('badge.set', { file: 'ch.md', patch: { prompt: 'NEW inlined prompt' } });
    const md = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(md).toContain('prompt: NEW inlined prompt'); // refreshed without a re-focus
    expect(md).toContain('intent: study for the exam'); // intent survived the resync
  });

  it('badge.addRef on an ACTIVE file inlines the new reference into the brief', async () => {
    await ctx.core.run('focus.set', { files: ['ch.md'] });
    await ctx.core.run('badge.addRef', { file: 'ch.md', to: 'supply.md', note: 'depends on' });
    const md = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(md).toContain('-> supply.md  (note: depends on)');
  });

  it('a badge edit on an UNfocused file does NOT rewrite focus.md (no churn)', async () => {
    await ctx.core.run('focus.set', { files: ['ch.md'] });
    const before = ctx.files.get('/work/.bh/focus.md') ?? '';
    await ctx.core.run('badge.set', { file: 'other.md', patch: { prompt: 'irrelevant' } });
    const after = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(after).toBe(before);
  });

  it('a kind-only / canvas-only badge.set on an ACTIVE file does NOT touch the brief', async () => {
    await ctx.core.run('badge.set', { file: 'ch.md', patch: { prompt: 'keep' } });
    await ctx.core.run('focus.set', { files: ['ch.md'] });
    const before = ctx.files.get('/work/.bh/focus.md') ?? '';
    // A canvas drag of the focused badge — no prompt/refs change → no resync.
    await ctx.core.run('badge.set', { file: 'ch.md', patch: { canvas: { x: 9, y: 9 } } });
    const after = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(after).toBe(before);
    expect(after).toContain('prompt: keep'); // brief intact
  });

  it('focus.resync is a no-op (resynced:false) when focus is empty', async () => {
    const res = await ctx.core.run('focus.resync', { file: 'anything.md' });
    expect(res.resynced).toBe(false);
  });

  it('focus.resync with no file arg re-renders the whole active list', async () => {
    await ctx.core.run('badge.set', { file: 'a.md', patch: { prompt: 'P-a' } });
    await ctx.core.run('focus.set', { files: ['a.md'] });
    const res = await ctx.core.run('focus.resync', {});
    expect(res.resynced).toBe(true);
    expect(ctx.files.get('/work/.bh/focus.md') ?? '').toContain('prompt: P-a');
  });
});

describe('focus.brief', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('returns the verbatim focus.md content (what the agent reads)', async () => {
    await ctx.core.run('badge.set', { file: 'a.md', patch: { prompt: 'about A' } });
    await ctx.core.run('focus.set', { files: ['a.md'], intent: 'do the thing' });
    const res = await ctx.core.run('focus.brief', {});
    const onDisk = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(res.brief).toBe(onDisk); // byte-for-byte what's on disk
    expect(res.brief).toContain('intent: do the thing');
    expect(res.brief).toContain('- a.md');
    expect(res.brief).toContain('prompt: about A');
  });

  it('returns the (none) brief when focus is empty (not an error)', async () => {
    await ctx.core.run('focus.set', { files: [] });
    const res = await ctx.core.run('focus.brief', {});
    expect(res.brief).toContain('active:');
    expect(res.brief).toContain('(none)');
  });

  it('returns an empty string (not a throw) when focus.md is absent on disk', async () => {
    ctx.files.delete('/work/.bh/focus.md'); // e.g. user deleted it externally
    const res = await ctx.core.run('focus.brief', {});
    expect(res.brief).toBe('');
  });

  it('throws when there is no current workspace', async () => {
    const { fs } = mockFs();
    const core = createCore({ fs, configDir: '/cfg' });
    await expect(core.run('focus.brief', {})).rejects.toThrow(/No current workspace/i);
  });
});

describe('focus provenance preservation through rename / toggle', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
    // Files on disk — focus.set({folder}) now gathers folder members from the
    // filesystem (workspace.listSupportedFiles), not the badge mirror.
    ctx.dirs.add('/work/notes');
    ctx.files.set('/work/notes/a.md', 'A body');
    await ctx.core.run('badge.set', { file: 'notes/a.md', patch: { prompt: 'A' } });
    await ctx.core.run('badge.set', {
      file: 'notes',
      patch: { kind: 'folder', prompt: 'folder intent' },
    });
  });

  it('focus.renameActiveFile remaps the path AND preserves the source-folder marker', async () => {
    await ctx.core.run('focus.set', { folder: 'notes' }); // active [notes/a.md], source notes
    const res = await ctx.core.run('focus.renameActiveFile', {
      from: 'notes/a.md',
      to: 'notes/a2.md',
    });
    expect(res.renamed).toBe(true);
    const md = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(md).toContain('- notes/a2.md');
    expect(md).not.toContain('- notes/a.md');
    expect(md).toContain('# source-folder: notes'); // provenance survives the rename
  });

  it('focus.renameActiveFile is a no-op when the file is not focused', async () => {
    await ctx.core.run('focus.set', { folder: 'notes' });
    const res = await ctx.core.run('focus.renameActiveFile', { from: 'nope.md', to: 'x.md' });
    expect(res.renamed).toBe(false);
  });

  it('focus.toggleActiveFile adds/removes a file while PRESERVING intent + provenance', async () => {
    await ctx.core.run('focus.set', { folder: 'notes' }); // active [notes/a.md], intent + source
    const added = await ctx.core.run('focus.toggleActiveFile', { file: 'b.md' });
    expect([...added.active].sort()).toEqual(['b.md', 'notes/a.md']);
    let md = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(md).toContain('# source-folder: notes'); // provenance kept
    expect(md).toContain('intent: folder intent'); // intent kept

    const removed = await ctx.core.run('focus.toggleActiveFile', { file: 'notes/a.md' });
    expect(removed.active).toEqual(['b.md']);
    md = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(md).toContain('# source-folder: notes');
    expect(md).toContain('intent: folder intent');
  });
});

describe('focus source-folder provenance (folder = the grouping)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
    // Real files on disk: focus.set({folder}) gathers a folder's members from the
    // FILESYSTEM (workspace.listSupportedFiles), so they must exist — two under
    // notes/, one outside. Their prompts are a sparse badge overlay on top.
    ctx.dirs.add('/work/notes');
    ctx.dirs.add('/work/other');
    ctx.files.set('/work/notes/a.md', 'A body');
    ctx.files.set('/work/notes/b.md', 'B body');
    ctx.files.set('/work/other/c.md', 'C body');
    await ctx.core.run('badge.set', { file: 'notes/a.md', patch: { prompt: 'A' } });
    await ctx.core.run('badge.set', { file: 'notes/b.md', patch: { prompt: 'B' } });
    await ctx.core.run('badge.set', { file: 'other/c.md', patch: { prompt: 'C' } });
    // The folder badge with a prompt — its agent-facing intent.
    await ctx.core.run('badge.set', {
      file: 'notes',
      patch: { kind: 'folder', prompt: 'Chapter 3 notes' },
    });
  });

  it('focus.set({folder}) gathers supported files under it + uses the folder prompt as intent', async () => {
    const res = await ctx.core.run('focus.set', { folder: 'notes' });
    expect(res.active).toEqual(['notes/a.md', 'notes/b.md']); // sorted; other/c.md excluded
    const md = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(md).toContain('- notes/a.md');
    expect(md).toContain('- notes/b.md');
    expect(md).not.toContain('other/c.md');
    expect(md).toContain('intent: Chapter 3 notes');
    expect(md).toContain('# source-folder: notes');
  });

  it('editing the folder badge prompt refreshes a folder-sourced brief (by identity)', async () => {
    await ctx.core.run('focus.set', { folder: 'notes' });
    await ctx.core.run('badge.set', {
      file: 'notes',
      patch: { kind: 'folder', prompt: 'Chapter 3 — proof focus' },
    });
    const md = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(md).toContain('intent: Chapter 3 — proof focus');
    expect(md).not.toContain('Chapter 3 notes');
    expect(md).toContain('# source-folder: notes'); // provenance kept
  });

  it('editing a DIFFERENT folder prompt does NOT refresh (exact identity, no inference)', async () => {
    await ctx.core.run('focus.set', { folder: 'notes' });
    await ctx.core.run('badge.set', {
      file: 'other',
      patch: { kind: 'folder', prompt: 'unrelated' },
    });
    expect(ctx.files.get('/work/.bh/focus.md') ?? '').toContain('intent: Chapter 3 notes');
  });

  it('a per-file badge edit under the folder resyncs AND preserves the source-folder marker', async () => {
    await ctx.core.run('focus.set', { folder: 'notes' });
    await ctx.core.run('badge.set', { file: 'notes/a.md', patch: { prompt: 'A revised' } });
    const md = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(md).toContain('prompt: A revised'); // re-inlined
    expect(md).toContain('# source-folder: notes'); // provenance survived
    expect(md).toContain('intent: Chapter 3 notes'); // intent survived
  });

  it('focus.set({files}) strips a previously-written source-folder marker', async () => {
    await ctx.core.run('focus.set', { folder: 'notes' });
    await ctx.core.run('focus.set', { files: ['notes/a.md'] });
    expect(ctx.files.get('/work/.bh/focus.md') ?? '').not.toContain('# source-folder');
  });

  it('a manual intent override on a folder focus records NO provenance', async () => {
    await ctx.core.run('focus.set', { folder: 'notes', intent: 'my own question' });
    const md = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(md).toContain('intent: my own question');
    expect(md).not.toContain('# source-folder');
  });

  it('focus.get does NOT leak the source provenance', async () => {
    await ctx.core.run('focus.set', { folder: 'notes' });
    const got = (await ctx.core.run('focus.get', {})) as Record<string, unknown>;
    expect(Object.keys(got)).not.toContain('source');
    expect(Object.keys(got)).not.toContain('sourceView');
  });

  // A folder focus must keep meaning "read ALL its files" as files appear.
  it('a NEW file under a focused folder joins the brief automatically', async () => {
    await ctx.core.run('focus.set', { folder: 'notes' });
    expect(ctx.files.get('/work/.bh/focus.md') ?? '').not.toContain('notes/d.md');
    // A new file appears on disk; the watcher calls focus.reconcileNewFile (NO
    // badge is created — badges are a sparse overlay). The folder brief, which
    // gathers from the filesystem, pulls it in.
    ctx.files.set('/work/notes/d.md', 'D body');
    await ctx.core.run('focus.reconcileNewFile', { file: 'notes/d.md' });
    const md = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(md).toContain('- notes/d.md'); // pulled in, not stale
    expect(md).toContain('# source-folder: notes'); // provenance kept
    expect(md).toContain('intent: Chapter 3 notes'); // intent kept
  });

  it('a new file OUTSIDE the focused folder is left out of the brief', async () => {
    await ctx.core.run('focus.set', { folder: 'notes' });
    await ctx.core.run('badge.set', { file: 'other/d.md' });
    expect(ctx.files.get('/work/.bh/focus.md') ?? '').not.toContain('other/d.md');
  });

  it('a new file does NOT touch a files-sourced (non-folder) focus', async () => {
    await ctx.core.run('focus.set', { files: ['notes/a.md'] });
    await ctx.core.run('badge.set', { file: 'notes/d.md' });
    expect(ctx.files.get('/work/.bh/focus.md') ?? '').not.toContain('notes/d.md');
  });

  // Renaming a focused folder must keep the brief live-linked to it.
  it('renaming a focused folder remaps active child paths AND the source-folder provenance', async () => {
    await ctx.core.run('focus.set', { folder: 'notes' });
    await ctx.core.run('badge.rename', { from: 'notes', to: 'docs', kind: 'folder' });
    const md = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(md).toContain('- docs/a.md');
    expect(md).toContain('- docs/b.md');
    expect(md).not.toContain('notes/a.md');
    expect(md).toContain('# source-folder: docs'); // re-stamped to the new name
    expect(md).toContain('intent: Chapter 3 notes'); // intent kept
  });

  it('after a folder rename, editing the renamed folder prompt still refreshes the brief', async () => {
    await ctx.core.run('focus.set', { folder: 'notes' });
    await ctx.core.run('badge.rename', { from: 'notes', to: 'docs', kind: 'folder' });
    await ctx.core.run('badge.set', {
      file: 'docs',
      patch: { kind: 'folder', prompt: 'renamed-folder intent' },
    });
    expect(ctx.files.get('/work/.bh/focus.md') ?? '').toContain('intent: renamed-folder intent');
  });
});

describe('focus.setIntent (author the turn intent without touching the active set)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('writes the intent line and preserves the active set', async () => {
    await ctx.core.run('focus.set', { files: ['a.md', 'b.md'] });
    const res = await ctx.core.run('focus.setIntent', { intent: 'compare the two approaches' });
    expect(res.intent).toBe('compare the two approaches');
    const md = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(md).toContain('intent: compare the two approaches');
    expect(md).toContain('- a.md');
    expect(md).toContain('- b.md'); // active untouched
  });

  it('an empty / whitespace intent clears the line (returns null)', async () => {
    await ctx.core.run('focus.set', { files: ['a.md'], intent: 'old question' });
    const res = await ctx.core.run('focus.setIntent', { intent: '   ' });
    expect(res.intent).toBeNull();
    const md = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(md).not.toContain('intent:');
    expect(md).toContain('- a.md'); // still focused, just no intent
  });

  it('a manually-typed intent CLEARS folder provenance (no longer folder-derived)', async () => {
    await ctx.core.run('badge.set', { file: 'notes/a.md', patch: { prompt: 'A' } });
    await ctx.core.run('badge.set', {
      file: 'notes',
      patch: { kind: 'folder', prompt: 'folder intent' },
    });
    await ctx.core.run('focus.set', { folder: 'notes' });
    expect(ctx.files.get('/work/.bh/focus.md') ?? '').toContain('# source-folder: notes');
    await ctx.core.run('focus.setIntent', { intent: 'my own question' });
    const md = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(md).toContain('intent: my own question');
    expect(md).not.toContain('# source-folder'); // provenance dropped on manual override
  });

  it('SKIPS the write when expectedActive no longer matches (focus changed underneath)', async () => {
    await ctx.core.run('focus.set', { files: ['a.md'] });
    const res = await ctx.core.run('focus.setIntent', {
      intent: 'late question for the old focus',
      expectedActive: ['x.md'], // != current ['a.md']
    });
    expect(res.skipped).toBe(true);
    // The old question is NOT stamped onto the changed focus.
    expect(ctx.files.get('/work/.bh/focus.md') ?? '').not.toContain('late question');
  });

  it('WRITES when expectedActive still matches the current focus', async () => {
    await ctx.core.run('focus.set', { files: ['a.md', 'b.md'] });
    const res = await ctx.core.run('focus.setIntent', {
      intent: 'matched question',
      expectedActive: ['a.md', 'b.md'],
    });
    expect(res.skipped).toBeUndefined();
    expect(res.intent).toBe('matched question');
    expect(ctx.files.get('/work/.bh/focus.md') ?? '').toContain('intent: matched question');
  });
});

describe('brief liveness: orphan-flagged files never reach the brief (by construction)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('badge.markOrphan on a focused file cascades (via resync): it drops from the brief, with a heal note', async () => {
    await ctx.core.run('badge.set', { file: 'a.md', patch: { prompt: 'P-a' } });
    await ctx.core.run('badge.set', { file: 'b.md', patch: { prompt: 'P-b' } });
    await ctx.core.run('focus.set', { files: ['a.md', 'b.md'], intent: 'compare them' });
    // The watcher saw a.md unlinked → badge.markOrphan → cascade to focus.resync,
    // which re-assembles through the liveness choke point and excludes the orphan.
    await ctx.core.run('badge.markOrphan', { file: 'a.md' });
    const after = await ctx.core.run('focus.get', {});
    expect(after.active).toEqual(['b.md']); // a.md left the brief
    expect(after.intent).toBe('compare them'); // intent preserved
    const md = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(md).not.toContain('- a.md');
    expect(md).toContain('# note:'); // visible heal receipt
  });

  it('focus.set NEVER writes a known-deleted (orphan) file — dropped at the write', async () => {
    // The canvas multi-select can include an orphan badge (a MISSING card); the
    // brief must still never point at it. assembleItems excludes orphan-flagged
    // files for EVERY writer, so a dead pick is dropped (with a heal note) by
    // construction — not patched out afterwards.
    await ctx.core.run('badge.set', { file: 'a.md', patch: { prompt: 'P-a' } });
    await ctx.core.run('badge.set', { file: 'b.md', patch: { prompt: 'P-b' } });
    await ctx.core.run('badge.markOrphan', { file: 'a.md' }); // a.md deleted on disk
    const res = await ctx.core.run('focus.set', { files: ['a.md', 'b.md'] });
    expect(res.active).toEqual(['b.md']); // orphan a.md dropped at the write
    const md = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(md).not.toContain('- a.md');
    expect(md).toContain('# note:');
  });

  it('a metadata edit on an orphan file keeps it orphan — it does NOT re-enter the brief', async () => {
    // The liveness invariant relies on the orphan flag PERSISTING: editing a
    // deleted file's prompt (panel / CLI badge.set) must not silently un-orphan
    // it, or a later focus.set could publish a brief pointing at the dead file.
    await ctx.core.run('badge.set', { file: 'a.md', patch: { prompt: 'P-a' } });
    await ctx.core.run('badge.set', { file: 'b.md', patch: { prompt: 'P-b' } });
    await ctx.core.run('badge.markOrphan', { file: 'a.md' });
    await ctx.core.run('badge.set', { file: 'a.md', patch: { prompt: 'edited while gone' } });
    expect((await ctx.core.run('badge.get', { file: 'a.md' })).orphan).toBe(true); // survived the edit
    const res = await ctx.core.run('focus.set', { files: ['a.md', 'b.md'] });
    expect(res.active).toEqual(['b.md']); // still excluded
    // An explicit orphan:false (the watcher's add when the file re-appears) clears it.
    await ctx.core.run('badge.set', { file: 'a.md', patch: { kind: 'file', orphan: false } });
    expect((await ctx.core.run('badge.get', { file: 'a.md' })).orphan).toBeUndefined();
  });
});

describe('focus.pruneDangling (re-entry: drop active files gone from disk)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('drops an active file whose disk file vanished (git checkout / external rm), with a note', async () => {
    ctx.files.set('/work/a.md', '# a');
    ctx.files.set('/work/b.md', '# b');
    await ctx.core.run('focus.set', { files: ['a.md', 'b.md'], intent: 'study' });
    ctx.files.delete('/work/b.md'); // deleted on disk with NO watcher event
    const r = await ctx.core.run('focus.pruneDangling', {});
    expect(r.pruned).toBe(1);
    const after = await ctx.core.run('focus.get', {});
    expect(after.active).toEqual(['a.md']); // self-healed
    expect(after.intent).toBe('study'); // intent preserved
    expect(ctx.files.get('/work/.bh/focus.md') ?? '').toContain('# note:');
  });

  it('is a no-op (pruned:0) when every active file still exists on disk', async () => {
    ctx.files.set('/work/a.md', '# a');
    await ctx.core.run('focus.set', { files: ['a.md'] });
    const r = await ctx.core.run('focus.pruneDangling', {});
    expect(r.pruned).toBe(0);
  });

  it('workspace.use re-validates on re-open: a stale focus.md self-heals', async () => {
    ctx.files.set('/work/keep.md', '# keep');
    ctx.files.set('/work/gone.md', '# gone');
    await ctx.core.run('focus.set', { files: ['keep.md', 'gone.md'] });
    ctx.files.delete('/work/gone.md');
    // Re-open the workspace → materializeWithFallback → focus.pruneDangling.
    await ctx.core.run('workspace.use', { name: 'w' });
    const after = await ctx.core.run('focus.get', {});
    expect(after.active).toEqual(['keep.md']);
  });
});

describe('focus.brief served-receipt (CONFIRM: observable delivery)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('focus.brief stamps a served receipt in .bh/cache/; focus.get reads it back; the brief stays clean', async () => {
    await ctx.core.run('focus.set', { files: ['a.md'] });
    expect((await ctx.core.run('focus.get', {})).lastBriefServedAt).toBeUndefined(); // never served
    await ctx.core.run('focus.brief', {}); // an agent pulls the brief
    const after = await ctx.core.run('focus.get', {});
    expect(typeof after.lastBriefServedAt).toBe('string'); // receipt stamped + read back
    expect(ctx.files.has('/work/.bh/cache/focus-served.json')).toBe(true); // in gitignored cache
    expect(ctx.files.get('/work/.bh/focus.md') ?? '').not.toContain('servedAt'); // not in the brief
  });

  it('a focus CHANGE invalidates the receipt — "served Ns ago" never claims a stale set', async () => {
    await ctx.core.run('focus.set', { files: ['a.md'] });
    await ctx.core.run('focus.brief', {}); // agent pulls THIS set
    expect(typeof (await ctx.core.run('focus.get', {})).lastBriefServedAt).toBe('string');
    // User re-curates → the prior pull was of the OLD set; the receipt must clear.
    await ctx.core.run('focus.set', { files: ['a.md', 'b.md'] });
    expect((await ctx.core.run('focus.get', {})).lastBriefServedAt).toBeUndefined();
  });

  it('a {stamp:false} read (the in-app preview peek) does NOT record a delivery', async () => {
    await ctx.core.run('focus.set', { files: ['a.md'] });
    await ctx.core.run('focus.brief', { stamp: false }); // peek, not a hand-off
    expect((await ctx.core.run('focus.get', {})).lastBriefServedAt).toBeUndefined();
    expect(ctx.files.has('/work/.bh/cache/focus-served.json')).toBe(false);
  });

  it('a heal (focus.pruneDangling) also invalidates the receipt — every focus.md write clears it', async () => {
    ctx.files.set('/work/a.md', '# a');
    ctx.files.set('/work/b.md', '# b');
    await ctx.core.run('focus.set', { files: ['a.md', 'b.md'] });
    await ctx.core.run('focus.brief', {}); // agent pulled THIS (2-file) set
    expect(typeof (await ctx.core.run('focus.get', {})).lastBriefServedAt).toBe('string');
    ctx.files.delete('/work/b.md'); // gone while the watcher wasn't running
    await ctx.core.run('focus.pruneDangling', {}); // re-entry heal rewrites focus.md
    // The pulled set is no longer current → "served Ns ago" must not survive the heal.
    expect((await ctx.core.run('focus.get', {})).lastBriefServedAt).toBeUndefined();
  });
});

describe('brief freshness marker (note vs file mtime)', () => {
  // Local seed exposing the mock's per-file mtimes (absent by default, so
  // every other suite keeps zero markers).
  async function seedWithMtimes(): Promise<TestContext & { mtimes: Map<string, number> }> {
    const { fs, files, dirs, mtimes } = mockFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/work', name: 'w' });
    return { files, dirs, core, mtimes };
  }

  it('flags a note written before the file last changed, with both dates', async () => {
    const ctx = await seedWithMtimes();
    ctx.files.set('/work/a.md', 'content');
    await ctx.core.run('badge.set', { file: 'a.md', patch: { prompt: 'my note' } });
    // File changes AFTER the note was written.
    ctx.mtimes.set('/work/a.md', Date.now() + 60_000);
    await ctx.core.run('focus.set', { files: ['a.md'] });
    const brief = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(brief).toContain('prompt: my note');
    expect(brief).toMatch(
      /\(note may be stale: written \d{4}-\d{2}-\d{2}, file changed \d{4}-\d{2}-\d{2}\)/,
    );
  });

  it('stays silent when the note is newer than the file', async () => {
    const ctx = await seedWithMtimes();
    ctx.files.set('/work/a.md', 'content');
    ctx.mtimes.set('/work/a.md', Date.now() - 60_000); // file older than the note
    await ctx.core.run('badge.set', { file: 'a.md', patch: { prompt: 'my note' } });
    await ctx.core.run('focus.set', { files: ['a.md'] });
    const brief = ctx.files.get('/work/.bh/focus.md') ?? '';
    expect(brief).toContain('prompt: my note');
    expect(brief).not.toContain('note may be stale');
  });

  it('stays silent when the fs reports no mtime or the badge predates the anchor (no guessing)', async () => {
    const ctx = await seedWithMtimes();
    ctx.files.set('/work/a.md', 'content'); // no mtimes entry → stat omits mtimeMs
    await ctx.core.run('badge.set', { file: 'a.md', patch: { prompt: 'my note' } });
    await ctx.core.run('focus.set', { files: ['a.md'] });
    expect(ctx.files.get('/work/.bh/focus.md') ?? '').not.toContain('note may be stale');

    // Legacy badge: prompt exists but promptModifiedAt is absent (pre-D1 data).
    const raw = JSON.parse(ctx.files.get('/work/.bh/badges/a.md.json') ?? '{}');
    raw.promptModifiedAt = undefined;
    ctx.files.set('/work/.bh/badges/a.md.json', JSON.stringify(raw));
    ctx.mtimes.set('/work/a.md', Date.now() + 60_000);
    await ctx.core.run('focus.resync', {});
    expect(ctx.files.get('/work/.bh/focus.md') ?? '').not.toContain('note may be stale');
  });

  it('round-trips: the marker line is invisible to parseFocus', () => {
    const rendered = renderFocus([
      {
        file: 'a.md',
        prompt: 'my note',
        promptStale: {
          notedAt: '2026-06-01T00:00:00.000Z',
          fileChangedAt: '2026-06-12T00:00:00.000Z',
        },
        refs: [{ to: 'b.md', note: 'why' }],
      },
    ]);
    expect(rendered).toContain('(note may be stale: written 2026-06-01, file changed 2026-06-12)');
    expect(parseFocus(rendered)).toEqual(['a.md']);
  });
});
