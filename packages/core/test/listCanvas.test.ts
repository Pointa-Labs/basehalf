import { beforeEach, describe, expect, it } from 'vitest';
import { type CanvasBadge, createCore } from '../src/index.js';
import { mockFs } from './helpers/mock-fs.js';

interface TestContext {
  files: Map<string, string>;
  dirs: Set<string>;
  // biome-ignore lint/suspicious/noExplicitAny: cross-test core handle
  core: any;
}

function freshCore(): TestContext {
  const { fs, files, dirs } = mockFs();
  const core = createCore({ fs, configDir: '/cfg' });
  return { files, dirs, core };
}

/**
 * Open `/work` as the current workspace with a given layout. Nested entries need
 * their parent dirs in the `dirs` set (mockFs's readdir+stat gate on it).
 */
async function openWorkspace(
  ctx: TestContext,
  layout: { dirs?: string[]; files?: Record<string, string> },
): Promise<void> {
  ctx.dirs.add('/work');
  for (const d of layout.dirs ?? []) ctx.dirs.add(`/work/${d}`);
  for (const [f, c] of Object.entries(layout.files ?? {})) ctx.files.set(`/work/${f}`, c);
  await ctx.core.run('workspace.add', { path: '/work', name: 'w' });
}

async function listCanvas(ctx: TestContext, folder: string | null): Promise<CanvasBadge[]> {
  const { badges } = (await ctx.core.run('workspace.listCanvas', { folder })) as {
    badges: CanvasBadge[];
  };
  return badges;
}

// The canvas reads the FILESYSTEM one folder level at a time (no eager mirror);
// badges are a sparse overlay merged on top.
describe('workspace.listCanvas (filesystem-as-tree, sparse badges)', () => {
  let ctx: TestContext;
  beforeEach(() => {
    ctx = freshCore();
  });

  it('returns only the DIRECT children of a folder — never the flattened subtree', async () => {
    await openWorkspace(ctx, { dirs: ['sub'], files: { 'top.md': '', 'sub/deep.md': '' } });
    const root = (await listCanvas(ctx, null)).map((b) => b.file).sort();
    // `sub` shows as a folder + top.md; sub/deep.md is NOT flattened onto root.
    expect(root).toEqual(['sub', 'top.md']);
    const inside = (await listCanvas(ctx, 'sub')).map((b) => b.file);
    expect(inside).toEqual(['sub/deep.md']);
  });

  it('marks subfolders kind:folder and files kind:file', async () => {
    await openWorkspace(ctx, { dirs: ['notes'], files: { 'a.md': '' } });
    const badges = await listCanvas(ctx, null);
    expect(badges.find((b) => b.file === 'notes')?.kind).toBe('folder');
    expect(badges.find((b) => b.file === 'a.md')?.kind).toBe('file');
  });

  it('applies the supported-ext whitelist + skip-dir blacklist', async () => {
    await openWorkspace(ctx, {
      dirs: ['node_modules', '.git'],
      files: {
        'doc.md': '',
        'pic.png': '',
        'script.sh': '', // code → NavTree only, not a canvas tile
        'node_modules/x.md': '',
        '.git/HEAD': '',
      },
    });
    const names = (await listCanvas(ctx, null)).map((b) => b.file);
    expect(names).toContain('doc.md');
    expect(names).toContain('pic.png');
    expect(names).not.toContain('script.sh');
    expect(names).not.toContain('node_modules');
    expect(names).not.toContain('.git');
  });

  it('synthesizes a default badge for an unannotated file (and writes nothing to disk)', async () => {
    await openWorkspace(ctx, { files: { 'a.md': '' } });
    const a = (await listCanvas(ctx, null)).find((b) => b.file === 'a.md');
    expect(a).toBeDefined();
    expect(a?.references).toEqual([]);
    expect(a?.prompt).toBeUndefined();
    expect(a?.canvas).toBeUndefined();
    // Sparse: no badge JSON materialized for a file the user never annotated.
    expect(ctx.files.has('/work/.bh/badges/a.md.json')).toBe(false);
  });

  it('merges an existing sparse file badge (prompt + canvas + references)', async () => {
    await openWorkspace(ctx, { files: { 'a.md': '', 'b.md': '' } });
    await ctx.core.run('badge.set', {
      file: 'a.md',
      patch: { prompt: 'hello', canvas: { x: 10, y: 20 } },
    });
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'b.md' });
    const a = (await listCanvas(ctx, null)).find((b) => b.file === 'a.md');
    expect(a?.prompt).toBe('hello');
    expect(a?.canvas).toEqual({ x: 10, y: 20 });
    expect(a?.references.map((r) => r.to)).toEqual(['b.md']);
  });

  it('merges a folder badge prompt (kind:folder)', async () => {
    await openWorkspace(ctx, { dirs: ['notes'], files: { 'notes/x.md': '' } });
    await ctx.core.run('badge.set', {
      file: 'notes',
      patch: { kind: 'folder', prompt: 'my notes' },
    });
    const notes = (await listCanvas(ctx, null)).find((b) => b.file === 'notes');
    expect(notes?.kind).toBe('folder');
    expect(notes?.prompt).toBe('my notes');
  });

  it('attaches a folder contents preview (total + items), folders-first, supported-only', async () => {
    await openWorkspace(ctx, {
      dirs: ['notes', 'notes/sub'],
      files: {
        'notes/a.md': '',
        'notes/b.png': '',
        'notes/code.sh': '', // unsupported → excluded from total + items
        'notes/sub/deep.md': '',
      },
    });
    const notes = (await listCanvas(ctx, null)).find((b) => b.file === 'notes');
    // 3 supported direct children: sub/ (folder), a.md, b.png. code.sh excluded.
    expect(notes?.preview?.total).toBe(3);
    // listFiles sorts folders-first then alpha → sub, a.md, b.png.
    expect(notes?.preview?.items).toEqual([
      { name: 'sub', kind: 'folder' },
      { name: 'a.md', kind: 'file' },
      { name: 'b.png', kind: 'file' },
    ]);
  });

  it('caps the preview items at FOLDER_PREVIEW_LIMIT but keeps the true total', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 9; i++) files[`big/f${i}.md`] = '';
    await openWorkspace(ctx, { dirs: ['big'], files });
    const big = (await listCanvas(ctx, null)).find((b) => b.file === 'big');
    expect(big?.preview?.total).toBe(9);
    expect(big?.preview?.items).toHaveLength(6); // FOLDER_PREVIEW_LIMIT
  });

  it('reports an empty folder as total 0 with no items', async () => {
    await openWorkspace(ctx, { dirs: ['empty'] });
    const empty = (await listCanvas(ctx, null)).find((b) => b.file === 'empty');
    expect(empty?.preview).toEqual({ total: 0, items: [] });
  });

  it('leaves a file badge without a preview', async () => {
    await openWorkspace(ctx, { files: { 'a.md': '' } });
    const a = (await listCanvas(ctx, null)).find((b) => b.file === 'a.md');
    expect(a?.preview).toBeUndefined();
  });

  it('falls back to a synthesized default when a badge JSON is corrupt (no throw)', async () => {
    await openWorkspace(ctx, { files: { 'a.md': '' } });
    ctx.files.set('/work/.bh/badges/a.md.json', 'not json {{{');
    const badges = await listCanvas(ctx, null);
    const a = badges.find((b) => b.file === 'a.md');
    expect(a).toBeDefined();
    expect(a?.references).toEqual([]); // synthesized — the corrupt file didn't crash the canvas
  });

  it('throws when there is no current workspace', async () => {
    await expect(ctx.core.run('workspace.listCanvas', { folder: null })).rejects.toThrow();
  });
});

describe('workspace.listSupportedFiles (recursive)', () => {
  let ctx: TestContext;
  beforeEach(() => {
    ctx = freshCore();
  });

  it('collects supported files recursively, skipping blacklist dirs + code files', async () => {
    await openWorkspace(ctx, {
      dirs: ['sub', 'sub/deep', 'node_modules'],
      files: {
        'top.md': '',
        'sub/a.md': '',
        'sub/deep/b.png': '',
        'sub/code.sh': '',
        'node_modules/x.md': '',
      },
    });
    const { files } = (await ctx.core.run('workspace.listSupportedFiles', { folder: null })) as {
      files: string[];
    };
    expect(files).toEqual(['sub/a.md', 'sub/deep/b.png', 'top.md']);
  });

  it('scopes to a subfolder', async () => {
    await openWorkspace(ctx, { dirs: ['sub'], files: { 'top.md': '', 'sub/a.md': '' } });
    const { files } = (await ctx.core.run('workspace.listSupportedFiles', { folder: 'sub' })) as {
      files: string[];
    };
    expect(files).toEqual(['sub/a.md']);
  });
});
