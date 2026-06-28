import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  type AdhdBackendProvider,
  AdhdYamlBackendProvider,
} from '../src/workbench/services/mirror/electron-main/adhdBackendProvider.js';
import { AdhdMainService } from '../src/workbench/services/mirror/electron-main/adhdMainService.js';

describe('AdhdMainService', () => {
  it('delegates reading-aid operations to the configured backend provider', async () => {
    const calls: Array<{ name: string; args: readonly unknown[] }> = [];
    const state = { path: 'a.md', kind: 'file' as const, highlight_keywords: ['term'] };
    const backend = {
      async get(...args: [string | null, string]) {
        calls.push({ name: 'get', args });
        return state;
      },
      async addKeyword(...args: [string | null, { file: string; keyword: string }]) {
        calls.push({ name: 'addKeyword', args });
        return state;
      },
      async markRead(...args: [string | null, { file: string; start: number; end: number }]) {
        calls.push({ name: 'markRead', args });
        return state;
      },
      async purgeNode(...args: [string | null, { path: string }]) {
        calls.push({ name: 'purgeNode', args });
        return { removed: 1 };
      },
    } as unknown as AdhdBackendProvider;
    const service = new AdhdMainService(backend);

    await expect(service.get('/repo', 'a.md')).resolves.toEqual(state);
    await expect(service.addKeyword('/repo', { file: 'a.md', keyword: 'term' })).resolves.toEqual(
      state,
    );
    await expect(service.markRead('/repo', { file: 'a.md', start: 1, end: 3 })).resolves.toEqual(
      state,
    );
    await expect(service.purgeNode('/repo', { path: 'b.md' })).resolves.toEqual({ removed: 1 });

    expect(calls).toEqual([
      { name: 'get', args: ['/repo', 'a.md'] },
      { name: 'addKeyword', args: ['/repo', { file: 'a.md', keyword: 'term' }] },
      { name: 'markRead', args: ['/repo', { file: 'a.md', start: 1, end: 3 }] },
      { name: 'purgeNode', args: ['/repo', { path: 'b.md' }] },
    ]);
  });
});

describe('AdhdYamlBackendProvider', () => {
  it('persists keywords and read ranges with the same sparse YAML shape as core', async () => {
    await withTempWorkspace(async (root) => {
      const backend = new AdhdYamlBackendProvider();

      await expect(backend.get(root, 'docs/a.md')).resolves.toBeNull();
      await expect(
        backend.addKeyword(root, { file: 'docs/a.md', keyword: ' 供需均衡 ' }),
      ).resolves.toEqual({
        path: 'docs/a.md',
        kind: 'file',
        highlight_keywords: ['供需均衡'],
      });
      await expect(
        backend.addKeyword(root, { file: 'docs/a.md', keyword: '供需均衡' }),
      ).resolves.toEqual({
        path: 'docs/a.md',
        kind: 'file',
        highlight_keywords: ['供需均衡'],
      });

      await backend.markRead(root, { file: 'docs/a.md', start: 12, end: 24 });
      await expect(
        backend.markRead(root, { file: 'docs/a.md', start: 25, end: 38 }),
      ).resolves.toMatchObject({
        read_paragraphs: [[12, 38]],
      });
      await expect(
        backend.markUnread(root, { file: 'docs/a.md', start: 20, end: 28 }),
      ).resolves.toMatchObject({
        read_paragraphs: [
          [12, 19],
          [29, 38],
        ],
      });

      expect(parse(await readFile(join(root, '.bh/mirror/docs/a.md/adhd.yaml'), 'utf8'))).toEqual({
        path: 'docs/a.md',
        kind: 'file',
        highlight_keywords: ['供需均衡'],
        read_paragraphs: [
          [12, 19],
          [29, 38],
        ],
      });
    });
  });

  it('replaces wholesale, prunes empty state, and reports revision signatures', async () => {
    await withTempWorkspace(async (root) => {
      const backend = new AdhdYamlBackendProvider();

      await expect(backend.revision(root)).resolves.toEqual({ count: 0, maxMtimeMs: 0 });
      await expect(
        backend.set(root, {
          file: 'a.md',
          highlight_keywords: ['x', 'x', ' y '],
          read_paragraphs: [
            [31, 38],
            [12, 24],
            [20, 26],
          ],
        }),
      ).resolves.toEqual({
        path: 'a.md',
        kind: 'file',
        highlight_keywords: ['x', 'y'],
        read_paragraphs: [
          [12, 26],
          [31, 38],
        ],
      });
      await backend.addKeyword(root, { file: 'b.md', keyword: 'k' });
      await expect(backend.revision(root)).resolves.toMatchObject({ count: 2 });

      await expect(backend.set(root, { file: 'a.md' })).resolves.toEqual({
        path: 'a.md',
        kind: 'file',
      });
      await expect(readFile(join(root, '.bh/mirror/a.md/adhd.yaml'), 'utf8')).rejects.toMatchObject(
        {
          code: 'ENOENT',
        },
      );
      await expect(backend.revision(root)).resolves.toMatchObject({ count: 1 });
    });
  });

  it('relocates and purges ADHD mirror nodes', async () => {
    await withTempWorkspace(async (root) => {
      const backend = new AdhdYamlBackendProvider();
      await backend.addKeyword(root, { file: 'docs/a.md', keyword: 'a' });
      await backend.addKeyword(root, { file: 'docs/deep/b.md', keyword: 'b' });

      await expect(backend.relocate(root, { from: 'docs', to: 'guide' })).resolves.toEqual({
        moved: 2,
      });
      await expect(backend.get(root, 'guide/a.md')).resolves.toMatchObject({
        path: 'guide/a.md',
        highlight_keywords: ['a'],
      });
      await expect(backend.get(root, 'guide/deep/b.md')).resolves.toMatchObject({
        path: 'guide/deep/b.md',
        highlight_keywords: ['b'],
      });
      await expect(
        readFile(join(root, '.bh/mirror/docs/a.md/adhd.yaml'), 'utf8'),
      ).rejects.toMatchObject({
        code: 'ENOENT',
      });

      await expect(backend.purgeNode(root, { path: 'guide' })).resolves.toEqual({ removed: 2 });
      await expect(backend.get(root, 'guide/a.md')).resolves.toBeNull();
      await expect(backend.get(root, 'guide/deep/b.md')).resolves.toBeNull();
    });
  });

  it('refuses to write mirror YAML through a symlinked mirror directory', async () => {
    await withTempWorkspace(async (root, outside) => {
      const backend = new AdhdYamlBackendProvider();
      await mkdir(join(root, '.bh/mirror'), { recursive: true });
      await symlink(outside, join(root, '.bh/mirror/docs'));

      await expect(
        backend.addKeyword(root, { file: 'docs/a.md', keyword: 'escape' }),
      ).rejects.toMatchObject({ name: 'PathEscape' });
      await expect(readFile(join(outside, 'a.md/adhd.yaml'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });
  });

  it('rejects calls without a bound workspace', async () => {
    const backend = new AdhdYamlBackendProvider();
    await expect(backend.get(null, 'a.md')).rejects.toThrow(/No workspace bound/i);
    await expect(backend.addKeyword(null, { file: 'a.md', keyword: 'k' })).rejects.toThrow(
      /No workspace bound/i,
    );
  });
});

async function withTempWorkspace(
  run: (root: string, outside: string) => Promise<void>,
): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), 'basehalf-adhd-yaml-'));
  const root = join(base, 'workspace');
  const outside = join(base, 'outside');
  try {
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await run(root, outside);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}
