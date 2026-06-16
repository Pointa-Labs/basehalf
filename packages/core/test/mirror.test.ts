import { describe, expect, it } from 'vitest';
import {
  MirrorCorrupt,
  listMirror,
  mirrorPath,
  mirrorRevision,
  patchMirror,
  readMirror,
  removeMirror,
  writeMirror,
} from '../src/kernel/index.js';
import { mockFs } from './helpers/mock-fs.js';

/**
 * Kernel mirror-store unit tests. The `.bh/mirror/<rel>/<kind>.yaml` layer the
 * badge/canvas/focus/adhd modules all write through. Runs against the in-memory
 * FsLike (no symlinks in play — symlink-escape robustness of the walk is
 * inherited from the same hardened guards the badge store uses).
 */

const ROOT = '/work';

function seed() {
  const { fs, files, dirs, mtimes } = mockFs();
  dirs.add(ROOT);
  return { fs, files, dirs, mtimes };
}

describe('mirrorPath routing', () => {
  it('routes a file node to .bh/mirror/<rel>/<kind>.yaml', () => {
    expect(mirrorPath(ROOT, 'docs/ch1.md', 'badge')).toBe(
      '/work/.bh/mirror/docs/ch1.md/badge.yaml',
    );
  });

  it('routes the workspace root folder to .bh/mirror/<kind>.yaml', () => {
    expect(mirrorPath(ROOT, '', 'canvas')).toBe('/work/.bh/mirror/canvas.yaml');
    expect(mirrorPath(ROOT, '.', 'badge')).toBe('/work/.bh/mirror/badge.yaml');
  });

  it('rejects a traversal rel', () => {
    expect(() => mirrorPath(ROOT, '../escape', 'badge')).toThrow(/traversal/i);
  });
});

describe('readMirror / writeMirror', () => {
  it('round-trips an object through YAML', async () => {
    const { fs } = seed();
    const badge = { path: 'a.md', kind: 'file', description: 'hi', references: ['b.md'] };
    await writeMirror(fs, ROOT, 'a.md', 'badge', badge);
    expect(await readMirror(fs, ROOT, 'a.md', 'badge')).toEqual(badge);
  });

  it('writes human-readable YAML, not JSON', async () => {
    const { fs, files } = seed();
    await writeMirror(fs, ROOT, 'a.md', 'badge', { path: 'a.md', kind: 'file' });
    const raw = files.get('/work/.bh/mirror/a.md/badge.yaml');
    expect(raw).toContain('path: a.md');
    expect(raw).toContain('kind: file');
    expect(raw?.endsWith('\n')).toBe(true);
  });

  it('returns null when the file does not exist', async () => {
    const { fs } = seed();
    expect(await readMirror(fs, ROOT, 'nope.md', 'focus')).toBeNull();
  });

  it('throws MirrorCorrupt on unparseable YAML', async () => {
    const { fs, files } = seed();
    files.set('/work/.bh/mirror/bad.md/badge.yaml', 'key: [unterminated');
    await expect(readMirror(fs, ROOT, 'bad.md', 'badge')).rejects.toBeInstanceOf(MirrorCorrupt);
  });
});

describe('patchMirror', () => {
  it('creates when absent (patch receives null)', async () => {
    const { fs } = seed();
    const out = await patchMirror(fs, ROOT, 'a.md', 'badge', (cur) => {
      expect(cur).toBeNull();
      return { path: 'a.md', n: 1 };
    });
    expect(out).toEqual({ path: 'a.md', n: 1 });
    expect(await readMirror(fs, ROOT, 'a.md', 'badge')).toEqual({ path: 'a.md', n: 1 });
  });

  it('updates an existing value', async () => {
    const { fs } = seed();
    await writeMirror(fs, ROOT, 'a.md', 'badge', { path: 'a.md', n: 1 });
    await patchMirror(fs, ROOT, 'a.md', 'badge', (cur: { path: string; n: number } | null) => ({
      ...(cur as { path: string; n: number }),
      n: 2,
    }));
    expect(await readMirror(fs, ROOT, 'a.md', 'badge')).toEqual({ path: 'a.md', n: 2 });
  });

  it('removes the file when patch returns null', async () => {
    const { fs, files } = seed();
    await writeMirror(fs, ROOT, 'a.md', 'badge', { path: 'a.md' });
    await patchMirror(fs, ROOT, 'a.md', 'badge', () => null);
    expect(files.has('/work/.bh/mirror/a.md/badge.yaml')).toBe(false);
  });

  it('serializes concurrent read-modify-write (no lost update)', async () => {
    const { fs } = seed();
    const inc = () =>
      patchMirror(fs, ROOT, 'a.md', 'badge', (cur: { n: number } | null) => ({
        n: (cur?.n ?? 0) + 1,
      }));
    await Promise.all([inc(), inc(), inc(), inc(), inc()]);
    expect(await readMirror<{ n: number }>(fs, ROOT, 'a.md', 'badge')).toEqual({ n: 5 });
  });
});

describe('removeMirror', () => {
  it('returns false when nothing to remove, true after a write', async () => {
    const { fs } = seed();
    expect(await removeMirror(fs, ROOT, 'a.md', 'badge')).toBe(false);
    await writeMirror(fs, ROOT, 'a.md', 'badge', { path: 'a.md' });
    expect(await removeMirror(fs, ROOT, 'a.md', 'badge')).toBe(true);
    expect(await readMirror(fs, ROOT, 'a.md', 'badge')).toBeNull();
  });
});

describe('listMirror', () => {
  it('finds every node with the given kind, root + nested, sorted by rel', async () => {
    const { fs } = seed();
    await writeMirror(fs, ROOT, '', 'badge', { path: '.', kind: 'folder' });
    await writeMirror(fs, ROOT, 'docs', 'badge', { path: 'docs', kind: 'folder' });
    await writeMirror(fs, ROOT, 'docs/ch1.md', 'badge', { path: 'docs/ch1.md', kind: 'file' });
    // a focus.yaml under another node must NOT show up in a badge listing
    await writeMirror(fs, ROOT, 'docs/ch2.md', 'focus', { path: 'docs/ch2.md', kind: 'file' });

    const badges = await listMirror<{ path: string }>(fs, ROOT, 'badge');
    expect(badges.map((b) => b.rel)).toEqual(['', 'docs', 'docs/ch1.md']);
    expect(badges.find((b) => b.rel === 'docs/ch1.md')?.data.path).toBe('docs/ch1.md');
  });

  it('returns [] for an empty / nonexistent mirror tree', async () => {
    const { fs } = seed();
    expect(await listMirror(fs, ROOT, 'badge')).toEqual([]);
  });

  it('skips a corrupt file instead of crashing the listing', async () => {
    const { fs, files } = seed();
    await writeMirror(fs, ROOT, 'good.md', 'badge', { path: 'good.md' });
    files.set('/work/.bh/mirror/bad.md/badge.yaml', 'key: [unterminated');
    const badges = await listMirror<{ path: string }>(fs, ROOT, 'badge');
    expect(badges.map((b) => b.rel)).toEqual(['good.md']);
  });
});

describe('mirrorRevision', () => {
  it('counts files of a kind and tracks the newest mtime', async () => {
    const { fs, mtimes } = seed();
    await writeMirror(fs, ROOT, 'a.md', 'badge', { path: 'a.md' });
    await writeMirror(fs, ROOT, 'b.md', 'badge', { path: 'b.md' });
    mtimes.set('/work/.bh/mirror/a.md/badge.yaml', 100);
    mtimes.set('/work/.bh/mirror/b.md/badge.yaml', 250);
    const rev = await mirrorRevision(fs, ROOT, 'badge');
    expect(rev.count).toBe(2);
    expect(rev.maxMtimeMs).toBe(250);
  });

  it('is zero for an empty tree', async () => {
    const { fs } = seed();
    expect(await mirrorRevision(fs, ROOT, 'badge')).toEqual({ count: 0, maxMtimeMs: 0 });
  });
});
