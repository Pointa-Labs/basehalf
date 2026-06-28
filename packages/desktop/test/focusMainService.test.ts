import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  type FocusBackendProvider,
  FocusYamlBackendProvider,
} from '../src/workbench/services/mirror/electron-main/focusBackendProvider.js';
import { FocusMainService } from '../src/workbench/services/mirror/electron-main/focusMainService.js';

describe('FocusMainService', () => {
  it('delegates focus operations to the configured backend provider', async () => {
    const calls: Array<{ name: string; args: readonly unknown[] }> = [];
    const node = { path: 'docs', kind: 'folder' as const };
    const backend = {
      async set(...args: [string | null, typeof node]) {
        calls.push({ name: 'set', args });
        return node;
      },
      async get(...args: [string | null]) {
        calls.push({ name: 'get', args });
        return node;
      },
      async clear(...args: [string | null]) {
        calls.push({ name: 'clear', args });
        return { cleared: true };
      },
      async pruneDangling(...args: [string | null]) {
        calls.push({ name: 'pruneDangling', args });
        return { cleared: true };
      },
      async relocate(...args: [string | null, { from: string; to: string }]) {
        calls.push({ name: 'relocate', args });
        return { moved: 1, repointed: true };
      },
      async purgeNode(...args: [string | null, { path: string }]) {
        calls.push({ name: 'purgeNode', args });
        return { removed: 1, cleared: false };
      },
    } as unknown as FocusBackendProvider;
    const service = new FocusMainService(backend);

    await expect(service.set('/repo', node)).resolves.toEqual(node);
    await expect(service.get('/repo')).resolves.toEqual(node);
    await expect(service.clear('/repo')).resolves.toEqual({ cleared: true });
    await expect(service.pruneDangling('/repo')).resolves.toEqual({ cleared: true });
    await expect(service.relocate('/repo', { from: 'a.md', to: 'b.md' })).resolves.toEqual({
      moved: 1,
      repointed: true,
    });
    await expect(service.purgeNode('/repo', { path: 'b.md' })).resolves.toEqual({
      removed: 1,
      cleared: false,
    });

    expect(calls).toEqual([
      { name: 'set', args: ['/repo', node] },
      { name: 'get', args: ['/repo'] },
      { name: 'clear', args: ['/repo'] },
      { name: 'pruneDangling', args: ['/repo'] },
      { name: 'relocate', args: ['/repo', { from: 'a.md', to: 'b.md' }] },
      { name: 'purgeNode', args: ['/repo', { path: 'b.md' }] },
    ]);
  });
});

describe('FocusYamlBackendProvider', () => {
  it('persists focus nodes, merges live fields, and uses current_focus symlinks', async () => {
    await withTempWorkspace(async (root) => {
      await writeFile(join(root, 'a.md'), '# A\n');
      const backend = new FocusYamlBackendProvider();

      await expect(
        backend.set(root, { path: 'a.md', kind: 'file', visible_lines: { start: 12 } }),
      ).resolves.toEqual({ path: 'a.md', kind: 'file', visible_lines: { start: 12 } });
      await expect(
        backend.set(root, { path: 'a.md', kind: 'file', cursor: { line: 28, column: 6 } }),
      ).resolves.toEqual({
        path: 'a.md',
        kind: 'file',
        visible_lines: { start: 12 },
        cursor: { line: 28, column: 6 },
      });

      expect(await backend.get(root)).toEqual({
        path: 'a.md',
        kind: 'file',
        visible_lines: { start: 12 },
        cursor: { line: 28, column: 6 },
      });
      expect(await readlink(join(root, '.bh/current_focus.yaml'))).toBe('mirror/a.md/focus.yaml');
      expect(parse(await readFile(join(root, '.bh/mirror/a.md/focus.yaml'), 'utf8'))).toEqual({
        path: 'a.md',
        kind: 'file',
        visible_lines: { start: 12 },
        cursor: { line: 28, column: 6 },
      });
    });
  });

  it('relocates and purges focus mirror nodes', async () => {
    await withTempWorkspace(async (root) => {
      const backend = new FocusYamlBackendProvider();
      await backend.set(root, { path: 'docs/a.md', kind: 'file', visible_lines: { start: 5 } });

      await expect(backend.relocate(root, { from: 'docs', to: 'guide' })).resolves.toEqual({
        moved: 1,
        repointed: true,
      });
      expect(await backend.get(root)).toEqual({
        path: 'guide/a.md',
        kind: 'file',
        visible_lines: { start: 5 },
      });
      expect(await readlink(join(root, '.bh/current_focus.yaml'))).toBe(
        'mirror/guide/a.md/focus.yaml',
      );
      await expect(
        readFile(join(root, '.bh/mirror/docs/a.md/focus.yaml'), 'utf8'),
      ).rejects.toMatchObject({
        code: 'ENOENT',
      });

      await expect(backend.purgeNode(root, { path: 'guide' })).resolves.toEqual({
        removed: 1,
        cleared: true,
      });
      await expect(backend.get(root)).resolves.toBeNull();
    });
  });

  it('prunes dangling focus and ignores escaping current_focus symlinks', async () => {
    await withTempWorkspace(async (root, outside) => {
      const backend = new FocusYamlBackendProvider();
      await writeFile(join(root, 'live.md'), '# live\n');
      await backend.set(root, { path: 'live.md', kind: 'file' });
      await expect(backend.pruneDangling(root)).resolves.toEqual({ cleared: false });

      await unlink(join(root, 'live.md'));
      await expect(backend.pruneDangling(root)).resolves.toEqual({ cleared: true });
      await expect(backend.get(root)).resolves.toBeNull();

      await mkdir(join(root, '.bh'), { recursive: true });
      await writeFile(join(outside, 'leak.yaml'), 'path: pwned\nkind: file\n');
      await symlink(join(outside, 'leak.yaml'), join(root, '.bh/current_focus.yaml'));
      await expect(backend.get(root)).resolves.toBeNull();
      await expect(readFile(join(outside, 'leak.yaml'), 'utf8')).resolves.toBe(
        'path: pwned\nkind: file\n',
      );
    });
  });

  it('ignores current_focus symlinks to non-mirror workspace files', async () => {
    await withTempWorkspace(async (root) => {
      const backend = new FocusYamlBackendProvider();
      await mkdir(join(root, '.bh'), { recursive: true });
      await writeFile(join(root, 'fake-focus.yaml'), 'path: a.md\nkind: file\n');
      await symlink('../fake-focus.yaml', join(root, '.bh/current_focus.yaml'));

      await expect(backend.get(root)).resolves.toBeNull();
    });
  });

  it('does not follow a symlinked .bh directory when clearing current_focus', async () => {
    await withTempWorkspace(async (root, outside) => {
      const backend = new FocusYamlBackendProvider();
      await symlink(outside, join(root, '.bh'));
      await writeFile(join(outside, 'current_focus.yaml'), 'do not delete\n');

      await expect(backend.clear(root)).resolves.toEqual({ cleared: false });
      await expect(backend.get(root)).resolves.toBeNull();
      await expect(readFile(join(outside, 'current_focus.yaml'), 'utf8')).resolves.toBe(
        'do not delete\n',
      );
    });
  });

  it('rejects calls without a bound workspace', async () => {
    const backend = new FocusYamlBackendProvider();
    await expect(backend.get(null)).rejects.toThrow(/No workspace bound/i);
    await expect(backend.set(null, { path: 'a.md', kind: 'file' })).rejects.toThrow(
      /No workspace bound/i,
    );
  });
});

async function withTempWorkspace(
  run: (root: string, outside: string) => Promise<void>,
): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), 'basehalf-focus-yaml-'));
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
