import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createCore } from '../src/index.js';
import { mockFs } from './helpers/mock-fs.js';

/**
 * Focus is a VIEWPORT MIRROR now (was a curated `.bh/focus.md` brief). Each
 * node owns `.bh/mirror/<path>/focus.yaml` (root folder → `.bh/mirror/focus.yaml`)
 * and `.bh/current_focus.yaml` is a RELATIVE SYMLINK to the active node's file.
 *
 *   focus.set({ path, kind, ...viewport state }) → writes the node focus.yaml AND
 *                                                   repoints current_focus at it
 *   focus.get()          → reads current_focus SECURELY (null when absent/escaping/dangling)
 *   focus.clear()        → removes the symlink
 *   focus.pruneDangling()→ clears the symlink iff the focused node's file/folder is gone
 *
 * Functional cases run against the in-memory mock (which now models symlinks);
 * the symlink-ESCAPE security case needs a real fs + real symlink (path-escape.test.ts).
 */

interface TestContext {
  files: Map<string, string>;
  links: Map<string, string>;
  dirs: Set<string>;
  // biome-ignore lint/suspicious/noExplicitAny: cross-test core handle
  core: any;
}

async function seed(): Promise<TestContext> {
  const { fs, files, links, dirs } = mockFs();
  dirs.add('/work');
  const core = createCore({ fs, configDir: '/cfg' });
  await core.run('workspace.add', { path: '/work', name: 'w' });
  return { files, links, dirs, core };
}

const LINK = '/work/.bh/current_focus.yaml';
const mirrorFocus = (rel: string): string =>
  rel === '' ? '/work/.bh/mirror/focus.yaml' : `/work/.bh/mirror/${rel}/focus.yaml`;

describe('focus.set', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('writes a FILE node focus.yaml and points current_focus at it', async () => {
    const result = await ctx.core.run('focus.set', { path: 'a.md', kind: 'file' });
    expect(result).toEqual({ path: 'a.md', kind: 'file' });
    // The node's focus.yaml carries path + kind.
    const yaml = parse(ctx.files.get(mirrorFocus('a.md')) ?? '');
    expect(yaml).toEqual({ path: 'a.md', kind: 'file' });
    // current_focus is a RELATIVE symlink resolved against `.bh/`.
    expect(ctx.links.get(LINK)).toBe('mirror/a.md/focus.yaml');
  });

  it('writes a FOLDER node focus.yaml (root folder → mirror/focus.yaml)', async () => {
    const result = await ctx.core.run('focus.set', { path: '', kind: 'folder' });
    expect(result).toEqual({ path: '', kind: 'folder' });
    const yaml = parse(ctx.files.get(mirrorFocus('')) ?? '');
    expect(yaml).toEqual({ path: '', kind: 'folder' });
    expect(ctx.links.get(LINK)).toBe('mirror/focus.yaml');
  });

  it('persists OPTIONAL file viewport state (visible_lines + cursor) when provided', async () => {
    await ctx.core.run('focus.set', {
      path: 'docs/ch1.md',
      kind: 'file',
      visible_lines: { start: 12 },
      cursor: { line: 28, column: 6 },
    });
    const yaml = parse(ctx.files.get(mirrorFocus('docs/ch1.md')) ?? '');
    expect(yaml).toEqual({
      path: 'docs/ch1.md',
      kind: 'file',
      visible_lines: { start: 12 },
      cursor: { line: 28, column: 6 },
    });
  });

  it('persists OPTIONAL folder viewport state (viewport_center + zoom) when provided', async () => {
    await ctx.core.run('focus.set', {
      path: 'docs',
      kind: 'folder',
      viewport_center: { x: 800, y: 420 },
      zoom: 1.2,
    });
    const yaml = parse(ctx.files.get(mirrorFocus('docs')) ?? '');
    expect(yaml).toEqual({
      path: 'docs',
      kind: 'folder',
      viewport_center: { x: 800, y: 420 },
      zoom: 1.2,
    });
  });

  it('drops folder fields on a FILE node and vice-versa (kind decides the shape)', async () => {
    // Pass a folder field to a file node: it is ignored.
    await ctx.core.run('focus.set', {
      path: 'a.md',
      kind: 'file',
      viewport_center: { x: 1, y: 2 },
      zoom: 3,
      cursor: { line: 5, column: 0 },
    });
    expect(parse(ctx.files.get(mirrorFocus('a.md')) ?? '')).toEqual({
      path: 'a.md',
      kind: 'file',
      cursor: { line: 5, column: 0 },
    });
    // Pass a file field to a folder node: it is ignored.
    await ctx.core.run('focus.set', {
      path: 'docs',
      kind: 'folder',
      cursor: { line: 9, column: 9 },
      visible_lines: { start: 4 },
      zoom: 2,
    });
    expect(parse(ctx.files.get(mirrorFocus('docs')) ?? '')).toEqual({
      path: 'docs',
      kind: 'folder',
      zoom: 2,
    });
  });

  it('a state-less node-switch writes just { path, kind }', async () => {
    await ctx.core.run('focus.set', { path: 'a.md', kind: 'file' });
    expect(parse(ctx.files.get(mirrorFocus('a.md')) ?? '')).toEqual({ path: 'a.md', kind: 'file' });
  });

  it('MERGES live fields field-scoped: a cursor-only set preserves visible_lines', async () => {
    // The live-sync path fires scroll and cursor as SEPARATE focus.set calls.
    await ctx.core.run('focus.set', { path: 'a.md', kind: 'file', visible_lines: { start: 12 } });
    // A later cursor-only update must NOT wipe the just-written visible_lines.
    const merged = await ctx.core.run('focus.set', {
      path: 'a.md',
      kind: 'file',
      cursor: { line: 28, column: 6 },
    });
    expect(merged).toEqual({
      path: 'a.md',
      kind: 'file',
      visible_lines: { start: 12 },
      cursor: { line: 28, column: 6 },
    });
    expect(parse(ctx.files.get(mirrorFocus('a.md')) ?? '')).toEqual({
      path: 'a.md',
      kind: 'file',
      visible_lines: { start: 12 },
      cursor: { line: 28, column: 6 },
    });
    // And a scroll-only update overwrites ONLY visible_lines, keeping the cursor.
    const rescrolled = await ctx.core.run('focus.set', {
      path: 'a.md',
      kind: 'file',
      visible_lines: { start: 40 },
    });
    expect(rescrolled).toEqual({
      path: 'a.md',
      kind: 'file',
      visible_lines: { start: 40 },
      cursor: { line: 28, column: 6 },
    });
  });

  it('a node-switch (path+kind only) keeps the node its own last-known viewport', async () => {
    await ctx.core.run('focus.set', {
      path: 'docs',
      kind: 'folder',
      viewport_center: { x: 800, y: 420 },
      zoom: 1.2,
    });
    // Switch away and back with a bare node-switch: the folder keeps its viewport.
    await ctx.core.run('focus.set', { path: 'a.md', kind: 'file' });
    const back = await ctx.core.run('focus.set', { path: 'docs', kind: 'folder' });
    expect(back).toEqual({
      path: 'docs',
      kind: 'folder',
      viewport_center: { x: 800, y: 420 },
      zoom: 1.2,
    });
  });
});

describe('focus.get', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('returns null on a freshly-opened workspace (no current_focus symlink yet)', async () => {
    expect(await ctx.core.run('focus.get', {})).toBeNull();
  });

  it('round-trips a FILE node set via focus.set', async () => {
    await ctx.core.run('focus.set', {
      path: 'x.md',
      kind: 'file',
      visible_lines: { start: 3 },
    });
    expect(await ctx.core.run('focus.get', {})).toEqual({
      path: 'x.md',
      kind: 'file',
      visible_lines: { start: 3 },
    });
  });

  it('round-trips a FOLDER node set via focus.set', async () => {
    await ctx.core.run('focus.set', { path: 'docs', kind: 'folder', zoom: 1.5 });
    expect(await ctx.core.run('focus.get', {})).toEqual({
      path: 'docs',
      kind: 'folder',
      zoom: 1.5,
    });
  });

  it('round-trips paths with spaces and CJK characters', async () => {
    await ctx.core.run('focus.set', { path: '供需弹性.md', kind: 'file' });
    expect(await ctx.core.run('focus.get', {})).toEqual({ path: '供需弹性.md', kind: 'file' });
    await ctx.core.run('focus.set', { path: 'note with space.md', kind: 'file' });
    expect(await ctx.core.run('focus.get', {})).toEqual({
      path: 'note with space.md',
      kind: 'file',
    });
  });

  it('returns null when the symlink target focus.yaml is DANGLING (deleted externally)', async () => {
    await ctx.core.run('focus.set', { path: 'a.md', kind: 'file' });
    // Delete the node's focus.yaml out from under the still-present symlink.
    ctx.files.delete(mirrorFocus('a.md'));
    expect(await ctx.core.run('focus.get', {})).toBeNull();
  });

  it('returns null when current_focus is a regular FILE, not a symlink', async () => {
    // readlink returns null for a non-symlink; focus.get treats that as "no focus".
    ctx.files.set(LINK, 'path: a.md\nkind: file\n');
    expect(await ctx.core.run('focus.get', {})).toBeNull();
  });
});

describe('switching nodes repoints current_focus', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('a second focus.set retargets the symlink (last node wins)', async () => {
    await ctx.core.run('focus.set', { path: 'a.md', kind: 'file' });
    expect(ctx.links.get(LINK)).toBe('mirror/a.md/focus.yaml');
    await ctx.core.run('focus.set', { path: 'b.md', kind: 'file' });
    expect(ctx.links.get(LINK)).toBe('mirror/b.md/focus.yaml');
    expect(await ctx.core.run('focus.get', {})).toEqual({ path: 'b.md', kind: 'file' });
    // The first node's focus.yaml is left behind as its last-known viewport.
    expect(ctx.files.has(mirrorFocus('a.md'))).toBe(true);
  });

  it('switching from a folder to a file node retargets cleanly', async () => {
    await ctx.core.run('focus.set', { path: 'docs', kind: 'folder' });
    expect(await ctx.core.run('focus.get', {})).toEqual({ path: 'docs', kind: 'folder' });
    await ctx.core.run('focus.set', { path: 'docs/a.md', kind: 'file' });
    expect(await ctx.core.run('focus.get', {})).toEqual({ path: 'docs/a.md', kind: 'file' });
  });
});

describe('focus.clear', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('removes the symlink and a subsequent get returns null', async () => {
    await ctx.core.run('focus.set', { path: 'a.md', kind: 'file' });
    const cleared = (await ctx.core.run('focus.clear', {})) as { cleared: boolean };
    expect(cleared.cleared).toBe(true);
    expect(ctx.links.has(LINK)).toBe(false);
    expect(await ctx.core.run('focus.get', {})).toBeNull();
    // The node's focus.yaml is left as its last-known viewport, not deleted.
    expect(ctx.files.has(mirrorFocus('a.md'))).toBe(true);
  });

  it('reports cleared:false when there was no current focus', async () => {
    const cleared = (await ctx.core.run('focus.clear', {})) as { cleared: boolean };
    expect(cleared.cleared).toBe(false);
  });
});

describe('focus.pruneDangling', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('clears the symlink when the focused FILE is gone on disk', async () => {
    await ctx.core.run('workspace.writeFile', { path: 'a.md', content: 'hi' });
    await ctx.core.run('focus.set', { path: 'a.md', kind: 'file' });
    // Delete the user file; the focus now points at a node that no longer exists.
    ctx.files.delete('/work/a.md');
    const pruned = (await ctx.core.run('focus.pruneDangling', {})) as { cleared: boolean };
    expect(pruned.cleared).toBe(true);
    expect(ctx.links.has(LINK)).toBe(false);
    expect(await ctx.core.run('focus.get', {})).toBeNull();
  });

  it('clears the symlink when the focused FOLDER is gone on disk', async () => {
    ctx.dirs.add('/work/docs');
    await ctx.core.run('focus.set', { path: 'docs', kind: 'folder' });
    ctx.dirs.delete('/work/docs');
    const pruned = (await ctx.core.run('focus.pruneDangling', {})) as { cleared: boolean };
    expect(pruned.cleared).toBe(true);
    expect(await ctx.core.run('focus.get', {})).toBeNull();
  });

  it('leaves the symlink when the focused node still exists', async () => {
    await ctx.core.run('workspace.writeFile', { path: 'a.md', content: 'hi' });
    await ctx.core.run('focus.set', { path: 'a.md', kind: 'file' });
    const pruned = (await ctx.core.run('focus.pruneDangling', {})) as { cleared: boolean };
    expect(pruned.cleared).toBe(false);
    expect(await ctx.core.run('focus.get', {})).toEqual({ path: 'a.md', kind: 'file' });
  });

  it('does NOT confuse kinds: a file focus whose path is a DIRECTORY on disk prunes', async () => {
    // node.kind is file but the path resolves to a directory → not the same node → prune.
    ctx.dirs.add('/work/a');
    await ctx.core.run('focus.set', { path: 'a', kind: 'file' });
    const pruned = (await ctx.core.run('focus.pruneDangling', {})) as { cleared: boolean };
    expect(pruned.cleared).toBe(true);
  });

  it('is a no-op (cleared:false) when nothing is focused', async () => {
    const pruned = (await ctx.core.run('focus.pruneDangling', {})) as { cleared: boolean };
    expect(pruned.cleared).toBe(false);
  });
});

describe('no current workspace', () => {
  it('focus.get throws when no workspace is current', async () => {
    const { fs } = mockFs();
    const core = createCore({ fs, configDir: '/cfg' });
    await expect(core.run('focus.get', {})).rejects.toThrow(/No current workspace/i);
  });

  it('focus.set throws when no workspace is current', async () => {
    const { fs } = mockFs();
    const core = createCore({ fs, configDir: '/cfg' });
    await expect(core.run('focus.set', { path: 'a.md', kind: 'file' })).rejects.toThrow(
      /No current workspace/i,
    );
  });
});

// The symlink-ESCAPE security case (an agent repoints current_focus OUTSIDE the
// workspace → focus.get must return null, never read it) needs a real symlink the
// in-memory mock can't model. Run it against the REAL fs.
describe('focus.get security: a current_focus repointed outside the workspace (real fs)', () => {
  let base: string;
  let ws: string;
  let outside: string;
  // biome-ignore lint/suspicious/noExplicitAny: test-local core handle
  let core: any;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'bh-focus-esc-'));
    ws = join(base, 'workspace');
    outside = join(base, 'outside');
    await mkdir(ws, { recursive: true });
    await mkdir(outside, { recursive: true });
    const cfg = join(base, 'cfg');
    await mkdir(cfg, { recursive: true });
    core = createCore({ configDir: cfg });
    await core.run('workspace.add', { path: ws, name: 'ws' });
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('returns null (never reads the outside file) when the symlink escapes', async () => {
    await writeFile(join(outside, 'leak.yaml'), 'path: pwned\nkind: file\n');
    await mkdir(join(ws, '.bh'), { recursive: true });
    await symlink(join(outside, 'leak.yaml'), join(ws, '.bh/current_focus.yaml'));
    expect(await core.run('focus.get', {})).toBeNull();
    // The outside file was not touched.
    expect(await readFile(join(outside, 'leak.yaml'), 'utf8')).toBe('path: pwned\nkind: file\n');
  });

  it('round-trips a legitimate in-workspace focus end to end (real symlink)', async () => {
    await writeFile(join(ws, 'a.md'), '# A\n');
    await core.run('focus.set', { path: 'a.md', kind: 'file', visible_lines: { start: 7 } });
    expect(await core.run('focus.get', {})).toEqual({
      path: 'a.md',
      kind: 'file',
      visible_lines: { start: 7 },
    });
    // The symlink really points into .bh/mirror/.
    const real = await core.run('focus.get', {});
    expect(real.path).toBe('a.md');
  });
});

describe('focus.set cross-workspace guard', () => {
  // The desktop fires focus.set un-awaited; if the user switches workspaces while
  // it is in flight, the late root resolution must NOT plant workspace A's path
  // under workspace B. The optional `workspace` arg (the name A's path belongs to)
  // makes focus.set SKIP when it is no longer current. [[pr113-followup]]
  it('skips the write when `workspace` is no longer the current one', async () => {
    const { fs, files, links, dirs } = mockFs();
    dirs.add('/a');
    dirs.add('/b');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/a', name: 'wa' });
    await core.run('workspace.add', { path: '/b', name: 'wb' });
    await core.run('workspace.use', { name: 'wb' }); // make wb the current workspace

    // A stale set tagged for 'wa' lands while 'wb' is current → skipped: returns
    // the node, but writes NOTHING under /b (no focus.yaml, no current_focus).
    const node = await core.run('focus.set', { path: 'a/sub', kind: 'folder', workspace: 'wa' });
    expect(node).toEqual({ path: 'a/sub', kind: 'folder' });
    expect(files.get('/b/.bh/mirror/a/sub/focus.yaml')).toBeUndefined();
    expect(links.get('/b/.bh/current_focus.yaml')).toBeUndefined();
    expect(await core.run('focus.get', {})).toBeNull();

    // A set tagged for the CURRENT workspace ('wb') writes normally.
    await core.run('focus.set', { path: 'x.md', kind: 'file', workspace: 'wb' });
    expect(links.get('/b/.bh/current_focus.yaml')).toBe('mirror/x.md/focus.yaml');
    expect(await core.run('focus.get', {})).toEqual({ path: 'x.md', kind: 'file' });
  });
});
