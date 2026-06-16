import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createCore } from '../src/index.js';
import { mockFs } from './helpers/mock-fs.js';

/**
 * The mirror-node SUBTREE CASCADE: when a file/folder is renamed or deleted, the
 * WHOLE mirror node must follow — not just badge.yaml (which badge.rename already
 * moved) but the canvas card geometry (+ parent card/edges), the focus.yaml
 * viewport (+ current_focus symlink), and the adhd reading aids, for the node and
 * (folders) every descendant. Driven by workspace.renameEntry / deleteEntry, which
 * both route the cascade through badge.rename (the shared choke point).
 */

async function seed() {
  const { fs, files, links, dirs } = mockFs();
  dirs.add('/work');
  const core = createCore({ fs, configDir: '/cfg' });
  await core.run('workspace.add', { path: '/work', name: 'w' });
  return { fs, files, links, core };
}

const mirror = (rel: string, kind: string) => `/work/.bh/mirror/${rel}/${kind}.yaml`;
const ROOT_LINK = '/work/.bh/current_focus.yaml';

/** Seed two connected sibling files under a folder, with a badge / canvas card /
 *  edge / focus / adhd on the first — a full mirror node to drag around. */
async function seedDocsAB(core: { run: (c: string, a: unknown) => Promise<unknown> }) {
  await core.run('workspace.writeFile', { path: 'docs/a.md', content: '# A' });
  await core.run('workspace.writeFile', { path: 'docs/b.md', content: '# B' });
  await core.run('badge.set', { file: 'docs/a.md', patch: { description: 'first', kind: 'file' } });
  await core.run('badge.set', {
    file: 'docs/b.md',
    patch: { description: 'second', kind: 'file' },
  });
  // Card geometry for a.md in the parent folder canvas.
  await core.run('canvas.setCard', {
    folder: 'docs',
    card: { path: 'docs/a.md', kind: 'file', x: 10, y: 20, width: 260, height: 140 },
  });
  // An edge a→b in the parent canvas (also writes badge refs a→b in lockstep).
  await core.run('canvas.connect', {
    folder: 'docs',
    from: 'docs/a.md',
    to: 'docs/b.md',
    from_anchor: 'east',
    to_anchor: 'west',
    label: '延伸',
    kind: 'file',
  });
  await core.run('focus.set', { path: 'docs/a.md', kind: 'file', visible_lines: { start: 5 } });
  await core.run('adhd.addKeyword', { file: 'docs/a.md', keyword: '关键词' });
}

describe('rename cascade — FILE (same parent)', () => {
  it('carries focus / adhd / canvas-card / current_focus from a.md → c.md', async () => {
    const { core, files, links } = await seed();
    await seedDocsAB(core);

    await core.run('workspace.renameEntry', { from: 'docs/a.md', to: 'docs/c.md', kind: 'file' });

    // User file moved on disk.
    expect(files.has('/work/docs/c.md')).toBe(true);
    expect(files.has('/work/docs/a.md')).toBe(false);

    // Badge moved + ref graph followed (badge.rename's job, asserted for completeness).
    expect(await core.run('badge.get', { file: 'docs/a.md' })).toBeNull();
    expect(await core.run('badge.get', { file: 'docs/c.md' })).toMatchObject({
      path: 'docs/c.md',
      references: ['docs/b.md'],
    });
    expect(await core.run('badge.get', { file: 'docs/b.md' })).toMatchObject({
      referenced_by: ['docs/c.md'],
    });

    // focus.yaml relocated (path field re-rooted) + current_focus repointed.
    expect(files.has(mirror('docs/a.md', 'focus'))).toBe(false);
    expect(parse(files.get(mirror('docs/c.md', 'focus')) ?? '')).toEqual({
      path: 'docs/c.md',
      kind: 'file',
      visible_lines: { start: 5 },
    });
    expect(links.get(ROOT_LINK)).toBe('mirror/docs/c.md/focus.yaml');
    expect(await core.run('focus.get', {})).toEqual({
      path: 'docs/c.md',
      kind: 'file',
      visible_lines: { start: 5 },
    });

    // adhd.yaml relocated.
    expect(files.has(mirror('docs/a.md', 'adhd'))).toBe(false);
    expect(await core.run('adhd.get', { file: 'docs/c.md' })).toEqual({
      path: 'docs/c.md',
      kind: 'file',
      highlight_keywords: ['关键词'],
    });

    // Parent canvas: card renamed (geometry kept), edge endpoint remapped a→c.
    const canvas = (await core.run('canvas.get', { folder: 'docs' })) as {
      cards: Array<{ path: string; x: number; y: number }>;
      edges: Array<{ from: string; to: string; label?: string }>;
    };
    expect(canvas.cards).toContainEqual(
      expect.objectContaining({ path: 'docs/c.md', x: 10, y: 20 }),
    );
    expect(canvas.cards.find((c) => c.path === 'docs/a.md')).toBeUndefined();
    expect(canvas.edges).toEqual([
      expect.objectContaining({ from: 'docs/c.md', to: 'docs/b.md', label: '延伸' }),
    ]);
  });
});

describe('rename cascade — FOLDER (subtree re-root)', () => {
  it('re-roots the folder canvas + descendant focus/adhd and fixes the parent card', async () => {
    const { core, files, links } = await seed();
    await seedDocsAB(core);
    // A card for the docs folder itself in the ROOT canvas, to prove the parent
    // card follows a folder rename too.
    await core.run('canvas.setCard', {
      folder: '',
      card: { path: 'docs', kind: 'folder', x: 100, y: 100, width: 200, height: 120 },
    });

    await core.run('workspace.renameEntry', { from: 'docs', to: 'guide', kind: 'folder' });

    // The folder's OWN canvas re-rooted, with cards + edges prefix-swapped.
    expect(files.has(mirror('docs', 'canvas'))).toBe(false);
    const guideCanvas = (await core.run('canvas.get', { folder: 'guide' })) as {
      path: string;
      cards: Array<{ path: string }>;
      edges: Array<{ from: string; to: string }>;
    };
    expect(guideCanvas.path).toBe('guide');
    expect(guideCanvas.cards).toContainEqual(expect.objectContaining({ path: 'guide/a.md' }));
    expect(guideCanvas.edges).toEqual([
      expect.objectContaining({ from: 'guide/a.md', to: 'guide/b.md' }),
    ]);

    // Descendant focus + adhd carried, path fields re-rooted.
    expect(parse(files.get(mirror('guide/a.md', 'focus')) ?? '')).toMatchObject({
      path: 'guide/a.md',
    });
    expect(await core.run('adhd.get', { file: 'guide/a.md' })).toMatchObject({
      path: 'guide/a.md',
      highlight_keywords: ['关键词'],
    });
    // current_focus followed the descendant.
    expect(links.get(ROOT_LINK)).toBe('mirror/guide/a.md/focus.yaml');

    // Descendant badges followed (badge.rename), and the ROOT canvas card docs→guide.
    expect(await core.run('badge.get', { file: 'guide/a.md' })).toMatchObject({
      references: ['guide/b.md'],
    });
    const rootCanvas = (await core.run('canvas.get', { folder: '' })) as {
      cards: Array<{ path: string }>;
    };
    expect(rootCanvas.cards).toContainEqual(expect.objectContaining({ path: 'guide' }));
    expect(rootCanvas.cards.find((c) => c.path === 'docs')).toBeUndefined();
  });
});

describe('rename cascade — FILE (cross-folder move)', () => {
  it('pulls the card out of the old parent and carries focus/adhd to the new folder', async () => {
    const { core, files, links } = await seed();
    await seedDocsAB(core);
    await core.run('workspace.createFolder', { path: 'archive' });

    // Move docs/a.md → archive/a.md (a DIFFERENT parent folder).
    await core.run('workspace.renameEntry', {
      from: 'docs/a.md',
      to: 'archive/a.md',
      kind: 'file',
    });

    // The card is gone from the old parent (docs) canvas — and the edge a→b with it.
    const docsCanvas = (await core.run('canvas.get', { folder: 'docs' })) as {
      cards: Array<{ path: string }>;
      edges: unknown[];
    } | null;
    expect(docsCanvas?.cards.find((c) => c.path === 'docs/a.md')).toBeUndefined();
    expect(docsCanvas?.edges ?? []).toEqual([]);

    // focus + adhd carried to the new location; current_focus repointed.
    expect(files.has(mirror('docs/a.md', 'focus'))).toBe(false);
    expect(parse(files.get(mirror('archive/a.md', 'focus')) ?? '')).toMatchObject({
      path: 'archive/a.md',
    });
    expect(await core.run('adhd.get', { file: 'archive/a.md' })).toMatchObject({
      path: 'archive/a.md',
      highlight_keywords: ['关键词'],
    });
    expect(links.get(ROOT_LINK)).toBe('mirror/archive/a.md/focus.yaml');
    // Badge + its ref to b followed.
    expect(await core.run('badge.get', { file: 'archive/a.md' })).toMatchObject({
      references: ['docs/b.md'],
    });
  });
});

describe('delete cascade', () => {
  it('reaps focus / adhd / canvas + parent card/edges + current_focus for a file', async () => {
    const { core, files, links } = await seed();
    await seedDocsAB(core);

    await core.run('workspace.deleteEntry', { path: 'docs/a.md', kind: 'file' });

    // Mirror node reaped.
    expect(await core.run('badge.get', { file: 'docs/a.md' })).toBeNull();
    expect(files.has(mirror('docs/a.md', 'focus'))).toBe(false);
    expect(files.has(mirror('docs/a.md', 'adhd'))).toBe(false);
    // current_focus cleared (it pointed at the deleted node).
    expect(links.has(ROOT_LINK)).toBe(false);
    expect(await core.run('focus.get', {})).toBeNull();

    // Parent canvas: card + edges touching a.md dropped; b.md's card untouched.
    const canvas = (await core.run('canvas.get', { folder: 'docs' })) as {
      cards: Array<{ path: string }>;
      edges: Array<{ from: string; to: string }>;
    } | null;
    expect(canvas?.cards.find((c) => c.path === 'docs/a.md')).toBeUndefined();
    expect(canvas?.edges ?? []).toEqual([]);
    // b.md's reverse link to the deleted a.md is gone (empty referenced_by is
    // pruned, so the field is simply absent — sparse).
    const bBadge = (await core.run('badge.get', { file: 'docs/b.md' })) as {
      referenced_by?: string[];
    };
    expect(bBadge.referenced_by ?? []).not.toContain('docs/a.md');
  });

  it('reaps a whole folder subtree (canvas + descendant focus/adhd)', async () => {
    const { core, files } = await seed();
    await seedDocsAB(core);

    await core.run('workspace.deleteEntry', { path: 'docs', kind: 'folder' });

    expect(files.has(mirror('docs', 'canvas'))).toBe(false);
    expect(files.has(mirror('docs/a.md', 'focus'))).toBe(false);
    expect(files.has(mirror('docs/a.md', 'adhd'))).toBe(false);
    expect(await core.run('badge.get', { file: 'docs/a.md' })).toBeNull();
    expect(await core.run('badge.get', { file: 'docs/b.md' })).toBeNull();
  });
});
