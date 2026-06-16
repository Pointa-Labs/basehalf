import { beforeEach, describe, expect, it } from 'vitest';
import { type CanvasChildBadge, type CanvasEdge, createCore } from '../src/index.js';
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

interface ListCanvasResult {
  folder: string | null;
  size?: { width: number; height: number };
  children: CanvasChildBadge[];
  edges: CanvasEdge[];
}

async function listCanvas(ctx: TestContext, folder: string | null): Promise<ListCanvasResult> {
  return (await ctx.core.run('workspace.listCanvas', { folder })) as ListCanvasResult;
}

async function listChildren(ctx: TestContext, folder: string | null): Promise<CanvasChildBadge[]> {
  return (await listCanvas(ctx, folder)).children;
}

// The canvas reads the FILESYSTEM one folder level at a time (no eager mirror);
// badges are a sparse overlay merged on top, and card positions / edges come
// from the folder's canvas.yaml.
describe('workspace.listCanvas (filesystem-as-tree, sparse badges)', () => {
  let ctx: TestContext;
  beforeEach(() => {
    ctx = freshCore();
  });

  it('returns only the DIRECT children of a folder — never the flattened subtree', async () => {
    await openWorkspace(ctx, { dirs: ['sub'], files: { 'top.md': '', 'sub/deep.md': '' } });
    const root = (await listChildren(ctx, null)).map((b) => b.path).sort();
    // `sub` shows as a folder + top.md; sub/deep.md is NOT flattened onto root.
    expect(root).toEqual(['sub', 'top.md']);
    const inside = (await listChildren(ctx, 'sub')).map((b) => b.path);
    expect(inside).toEqual(['sub/deep.md']);
  });

  it('echoes the requested folder in the result', async () => {
    await openWorkspace(ctx, { dirs: ['sub'], files: { 'sub/deep.md': '' } });
    expect((await listCanvas(ctx, null)).folder).toBeNull();
    expect((await listCanvas(ctx, 'sub')).folder).toBe('sub');
  });

  it('hides root-level agent-protocol pointer files; nested ones are user content', async () => {
    await openWorkspace(ctx, {
      dirs: ['docs'],
      files: {
        'CLAUDE.md': '# hint',
        'AGENTS.md': '# hint',
        'note.md': '',
        'docs/AGENTS.md': '# the user wrote this one on purpose',
      },
    });
    // Scaffolding, not content: the canvas (the user's map) skips them at root…
    const root = (await listChildren(ctx, null)).map((b) => b.path).sort();
    expect(root).toEqual(['docs', 'note.md']);
    // …but a nested AGENTS.md is the user's own file and stays visible.
    const inside = (await listChildren(ctx, 'docs')).map((b) => b.path);
    expect(inside).toEqual(['docs/AGENTS.md']);
  });

  it('marks subfolders kind:folder and files kind:file', async () => {
    await openWorkspace(ctx, { dirs: ['notes'], files: { 'a.md': '' } });
    const children = await listChildren(ctx, null);
    expect(children.find((b) => b.path === 'notes')?.kind).toBe('folder');
    expect(children.find((b) => b.path === 'a.md')?.kind).toBe('file');
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
    const names = (await listChildren(ctx, null)).map((b) => b.path);
    expect(names).toContain('doc.md');
    expect(names).toContain('pic.png');
    expect(names).not.toContain('script.sh');
    expect(names).not.toContain('node_modules');
    expect(names).not.toContain('.git');
  });

  it('synthesizes a default badge for an unannotated file (and writes nothing to disk)', async () => {
    await openWorkspace(ctx, { files: { 'a.md': '' } });
    const a = (await listChildren(ctx, null)).find((b) => b.path === 'a.md');
    expect(a).toBeDefined();
    expect(a?.references).toEqual([]);
    expect(a?.referenced_by).toEqual([]);
    expect(a?.description).toBeUndefined();
    expect(a?.card).toBeUndefined();
    // Sparse: no badge YAML materialized for a file the user never annotated.
    expect(ctx.files.has('/work/.bh/mirror/a.md/badge.yaml')).toBe(false);
  });

  it('merges an existing sparse file badge (description + card + references)', async () => {
    await openWorkspace(ctx, { files: { 'a.md': '', 'b.md': '' } });
    await ctx.core.run('badge.set', {
      file: 'a.md',
      patch: { description: 'hello' },
    });
    // Card position is the canvas's visual layer now — seed it via canvas.setCard.
    await ctx.core.run('canvas.setCard', {
      folder: null,
      card: { path: 'a.md', kind: 'file', x: 10, y: 20, width: 260, height: 140 },
    });
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'b.md' });
    const a = (await listChildren(ctx, null)).find((b) => b.path === 'a.md');
    expect(a?.description).toBe('hello');
    expect(a?.card).toEqual({ x: 10, y: 20, width: 260, height: 140 });
    // references is now a bare-path array.
    expect(a?.references).toEqual(['b.md']);
  });

  it('surfaces referenced_by (inbound) as bare-path array on the target child', async () => {
    await openWorkspace(ctx, { files: { 'a.md': '', 'b.md': '' } });
    await ctx.core.run('badge.addRef', { file: 'a.md', to: 'b.md' });
    const children = await listChildren(ctx, null);
    expect(children.find((b) => b.path === 'a.md')?.references).toEqual(['b.md']);
    expect(children.find((b) => b.path === 'b.md')?.referenced_by).toEqual(['a.md']);
  });

  it('merges a folder badge description (kind:folder)', async () => {
    await openWorkspace(ctx, { dirs: ['notes'], files: { 'notes/x.md': '' } });
    await ctx.core.run('badge.set', {
      file: 'notes',
      patch: { kind: 'folder', description: 'my notes' },
    });
    const notes = (await listChildren(ctx, null)).find((b) => b.path === 'notes');
    expect(notes?.kind).toBe('folder');
    expect(notes?.description).toBe('my notes');
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
    const notes = (await listChildren(ctx, null)).find((b) => b.path === 'notes');
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
    const big = (await listChildren(ctx, null)).find((b) => b.path === 'big');
    expect(big?.preview?.total).toBe(9);
    expect(big?.preview?.items).toHaveLength(6); // FOLDER_PREVIEW_LIMIT
  });

  it('reports an empty folder as total 0 with no items', async () => {
    await openWorkspace(ctx, { dirs: ['empty'] });
    const empty = (await listChildren(ctx, null)).find((b) => b.path === 'empty');
    expect(empty?.preview).toEqual({ total: 0, items: [] });
  });

  it('leaves a file badge without a preview', async () => {
    await openWorkspace(ctx, { files: { 'a.md': '' } });
    const a = (await listChildren(ctx, null)).find((b) => b.path === 'a.md');
    expect(a?.preview).toBeUndefined();
  });

  it('falls back to a synthesized default when a badge YAML is corrupt (no throw)', async () => {
    await openWorkspace(ctx, { files: { 'a.md': '' } });
    ctx.files.set('/work/.bh/mirror/a.md/badge.yaml', 'not: yaml: {{{');
    const children = await listChildren(ctx, null);
    const a = children.find((b) => b.path === 'a.md');
    expect(a).toBeDefined();
    expect(a?.references).toEqual([]); // synthesized — the corrupt file didn't crash the canvas
  });

  it('throws when there is no current workspace', async () => {
    await expect(ctx.core.run('workspace.listCanvas', { folder: null })).rejects.toThrow();
  });
});

// The folder's visual layer (card positions, size, edges) lives in canvas.yaml
// and is surfaced through listCanvas.
describe('workspace.listCanvas (visual layer: cards, size, edges)', () => {
  let ctx: TestContext;
  beforeEach(() => {
    ctx = freshCore();
  });

  it('echoes the folder canvas size when the user has sized it', async () => {
    await openWorkspace(ctx, { files: { 'a.md': '' } });
    await ctx.core.run('canvas.setSize', { folder: null, size: { width: 2400, height: 1600 } });
    const result = await listCanvas(ctx, null);
    expect(result.size).toEqual({ width: 2400, height: 1600 });
  });

  it('returns edges between present children (seeded via canvas.connect)', async () => {
    await openWorkspace(ctx, { files: { 'a.md': '', 'b.md': '' } });
    await ctx.core.run('canvas.connect', {
      folder: null,
      from: 'a.md',
      to: 'b.md',
      from_anchor: 'east',
      to_anchor: 'west',
      label: 'concept',
    });
    const result = await listCanvas(ctx, null);
    expect(result.edges).toEqual([
      { from: 'a.md', from_anchor: 'east', to: 'b.md', to_anchor: 'west', label: 'concept' },
    ]);
    // canvas.connect keeps the badge graph in lockstep — the edge mirrors a ref.
    const children = result.children;
    expect(children.find((b) => b.path === 'a.md')?.references).toEqual(['b.md']);
    expect(children.find((b) => b.path === 'b.md')?.referenced_by).toEqual(['a.md']);
  });

  it('filters out edges whose endpoint is not a present child', async () => {
    await openWorkspace(ctx, { files: { 'a.md': '', 'b.md': '' } });
    await ctx.core.run('canvas.connect', {
      folder: null,
      from: 'a.md',
      to: 'b.md',
      from_anchor: 'east',
      to_anchor: 'west',
    });
    // Drop b.md from disk; the edge to it must not reach the renderer as a dangle.
    ctx.files.delete('/work/b.md');
    const result = await listCanvas(ctx, null);
    expect(result.children.map((b) => b.path)).toEqual(['a.md']);
    expect(result.edges).toEqual([]);
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
