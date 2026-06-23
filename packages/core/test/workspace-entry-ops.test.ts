import { beforeEach, describe, expect, it } from 'vitest';
import { type BadgeFile, type FsLike, createCore } from '../src/index.js';
import { boundCore } from './helpers/bound-core.js';
import { mockFs } from './helpers/mock-fs.js';

/**
 * workspace.createFile / createFolder / deleteEntry / renameEntry — the core
 * commands behind the right-click context menu's five basic ops. These compose
 * the hardened file I/O with the badge/focus cascade, so the tests assert BOTH
 * the disk effect AND the overlay cascade (a deleted folder purges descendant
 * badges; a renamed folder carries them even when the folder itself is
 * unannotated — the sparse-overlay common case + the flagged folder-rename bug).
 */

interface Seeded {
  files: Map<string, string>;
  dirs: Set<string>;
  fs: FsLike;
  // biome-ignore lint/suspicious/noExplicitAny: cross-test core handle
  core: any;
}

async function seed(): Promise<Seeded> {
  const { fs, files, dirs } = mockFs();
  dirs.add('/work');
  const core = boundCore(createCore({ fs, configDir: '/cfg' }), '/work');
  await core.run('workspace.add', { path: '/work', name: 'w' });
  return { files, dirs, fs, core };
}

describe('workspace.createFile', () => {
  let s: Seeded;
  beforeEach(async () => {
    s = await seed();
  });

  it('creates an empty file at the requested path', async () => {
    const res = await s.core.run('workspace.createFile', { path: 'note.md' });
    expect(res.path).toBe('note.md');
    expect(s.files.get('/work/note.md')).toBe('');
  });

  it('seeds content when provided', async () => {
    await s.core.run('workspace.createFile', { path: 'a.md', content: '# Hi' });
    expect(s.files.get('/work/a.md')).toBe('# Hi');
  });

  it('auto-creates parent folders', async () => {
    const res = await s.core.run('workspace.createFile', { path: 'deep/nested/x.md' });
    expect(res.path).toBe('deep/nested/x.md');
    expect(s.files.has('/work/deep/nested/x.md')).toBe(true);
    expect(s.dirs.has('/work/deep/nested')).toBe(true);
  });

  it('never clobbers — collision suffixes -2/-3', async () => {
    await s.core.run('workspace.createFile', { path: 'note.md', content: 'first' });
    const second = await s.core.run('workspace.createFile', { path: 'note.md' });
    expect(second.path).toBe('note-2.md');
    expect(s.files.get('/work/note.md')).toBe('first'); // original untouched
    expect(s.files.get('/work/note-2.md')).toBe('');
  });

  it('rejects a path escaping the workspace', async () => {
    await expect(s.core.run('workspace.createFile', { path: '../evil.md' })).rejects.toThrow();
  });
});

describe('workspace.createFolder', () => {
  let s: Seeded;
  beforeEach(async () => {
    s = await seed();
  });

  it('creates a folder', async () => {
    const res = await s.core.run('workspace.createFolder', { path: 'docs' });
    expect(res.path).toBe('docs');
    expect(s.dirs.has('/work/docs')).toBe(true);
  });

  it('collision suffixes an existing folder name', async () => {
    await s.core.run('workspace.createFolder', { path: 'docs' });
    const second = await s.core.run('workspace.createFolder', { path: 'docs' });
    expect(second.path).toBe('docs-2');
    expect(s.dirs.has('/work/docs-2')).toBe(true);
  });
});

describe('workspace.deleteEntry', () => {
  let s: Seeded;
  beforeEach(async () => {
    s = await seed();
  });

  it('deletes a file via fs.rm (no trash) and purges its badge', async () => {
    await s.core.run('workspace.createFile', { path: 'gone.md' });
    await s.core.run('badge.set', { file: 'gone.md', patch: { description: 'note' } });
    expect(await s.core.run('badge.get', { file: 'gone.md' })).not.toBeNull();

    const res = await s.core.run('workspace.deleteEntry', { path: 'gone.md', kind: 'file' });
    expect(res.deleted).toBe(true);
    expect(s.files.has('/work/gone.md')).toBe(false);
    expect(await s.core.run('badge.get', { file: 'gone.md' })).toBeNull();
  });

  it('prefers fs.trash when the host provides it (recoverable path)', async () => {
    const trashed: string[] = [];
    // Inject the Electron-style capability the desktop host wires.
    s.fs.trash = async (p: string): Promise<void> => {
      trashed.push(p);
      await s.fs.unlink(p);
    };
    await s.core.run('workspace.createFile', { path: 'bin.md' });
    await s.core.run('workspace.deleteEntry', { path: 'bin.md', kind: 'file' });
    expect(trashed).toEqual(['/work/bin.md']);
    expect(s.files.has('/work/bin.md')).toBe(false);
  });

  it('deletes a folder recursively and purges descendant badges', async () => {
    await s.core.run('workspace.createFile', { path: 'proj/a.md' });
    await s.core.run('workspace.createFile', { path: 'proj/sub/b.md' });
    await s.core.run('badge.set', { file: 'proj/a.md', patch: { description: 'a' } });
    await s.core.run('badge.set', { file: 'proj/sub/b.md', patch: { description: 'b' } });

    await s.core.run('workspace.deleteEntry', { path: 'proj', kind: 'folder' });

    expect(s.files.has('/work/proj/a.md')).toBe(false);
    expect(s.files.has('/work/proj/sub/b.md')).toBe(false);
    expect(s.dirs.has('/work/proj')).toBe(false);
    expect(await s.core.run('badge.get', { file: 'proj/a.md' })).toBeNull();
    expect(await s.core.run('badge.get', { file: 'proj/sub/b.md' })).toBeNull();
  });
});

describe('workspace.renameEntry', () => {
  let s: Seeded;
  beforeEach(async () => {
    s = await seed();
  });

  it('moves a file on disk and carries its badge', async () => {
    await s.core.run('workspace.createFile', { path: 'old.md', content: 'body' });
    await s.core.run('badge.set', { file: 'old.md', patch: { description: 'keep me' } });

    const res = await s.core.run('workspace.renameEntry', {
      from: 'old.md',
      to: 'new.md',
      kind: 'file',
    });
    expect(res.renamed).toBe(true);
    expect(res.to).toBe('new.md');
    expect(s.files.get('/work/new.md')).toBe('body');
    expect(s.files.has('/work/old.md')).toBe(false);
    const badge = (await s.core.run('badge.get', { file: 'new.md' })) as BadgeFile;
    expect(badge.description).toBe('keep me');
    expect(await s.core.run('badge.get', { file: 'old.md' })).toBeNull();
  });

  it('renames an UNANNOTATED file without throwing (sparse common case)', async () => {
    await s.core.run('workspace.createFile', { path: 'plain.md', content: 'x' });
    const res = await s.core.run('workspace.renameEntry', {
      from: 'plain.md',
      to: 'renamed.md',
      kind: 'file',
    });
    expect(res.renamed).toBe(true);
    expect(s.files.get('/work/renamed.md')).toBe('x');
  });

  it('renames a folder, carrying descendant badges even when the folder is unannotated', async () => {
    await s.core.run('workspace.createFile', { path: 'proj/a.md' });
    await s.core.run('workspace.createFile', { path: 'proj/sub/b.md' });
    // Annotate only the CHILDREN — the folder itself has no badge. This is the
    // case the watcher heuristic dropped (flagged folder-rename bug).
    await s.core.run('badge.set', { file: 'proj/a.md', patch: { description: 'a' } });
    await s.core.run('badge.set', { file: 'proj/sub/b.md', patch: { description: 'b' } });

    const res = await s.core.run('workspace.renameEntry', {
      from: 'proj',
      to: 'project',
      kind: 'folder',
    });
    expect(res.renamed).toBe(true);
    // Files moved.
    expect(s.files.has('/work/project/a.md')).toBe(true);
    expect(s.files.has('/work/project/sub/b.md')).toBe(true);
    expect(s.files.has('/work/proj/a.md')).toBe(false);
    // Descendant badges carried to the new prefix.
    const a = (await s.core.run('badge.get', { file: 'project/a.md' })) as BadgeFile;
    const b = (await s.core.run('badge.get', { file: 'project/sub/b.md' })) as BadgeFile;
    expect(a.description).toBe('a');
    expect(b.description).toBe('b');
    expect(await s.core.run('badge.get', { file: 'proj/a.md' })).toBeNull();
  });
});
