import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { BadgeFile } from '../src/workbench/services/mirror/common/badge.js';
import type { CanvasCard } from '../src/workbench/services/mirror/common/canvas.js';
import {
  type CanvasBackendProvider,
  type CanvasBadgeBridge,
  CanvasYamlBackendProvider,
} from '../src/workbench/services/mirror/electron-main/canvasBackendProvider.js';
import { CanvasMainService } from '../src/workbench/services/mirror/electron-main/canvasMainService.js';

describe('CanvasMainService', () => {
  it('delegates canvas operations to the configured backend provider', async () => {
    const calls: Array<{ name: string; args: readonly unknown[] }> = [];
    const canvas = { path: '', cards: [], edges: [] };
    const card = { path: 'a.md', kind: 'file' as const, x: 1, y: 2, width: 3, height: 4 };
    const backend = {
      async get(...args: [string | null, { folder: null }]) {
        calls.push({ name: 'get', args });
        return canvas;
      },
      async setCard(...args: [string | null, { folder: null; card: typeof card }]) {
        calls.push({ name: 'setCard', args });
        return canvas;
      },
      async reconnect(...args: [string | null, { folder: null; previous: object; next: object }]) {
        calls.push({ name: 'reconnect', args });
        return canvas;
      },
      async purgeNode(...args: [string | null, { path: string }]) {
        calls.push({ name: 'purgeNode', args });
        return { removed: 2 };
      },
    } as unknown as CanvasBackendProvider;
    const service = new CanvasMainService(backend);

    await expect(service.get('/repo', { folder: null })).resolves.toEqual(canvas);
    await expect(service.setCard('/repo', { folder: null, card })).resolves.toEqual(canvas);
    await expect(
      service.reconnect('/repo', {
        folder: null,
        previous: { from: 'a.md', to: 'b.md' },
        next: { from: 'a.md', to: 'c.md', from_anchor: 'south', to_anchor: 'north' },
      }),
    ).resolves.toEqual(canvas);
    await expect(service.purgeNode('/repo', { path: 'b.md' })).resolves.toEqual({ removed: 2 });

    expect(calls).toEqual([
      { name: 'get', args: ['/repo', { folder: null }] },
      { name: 'setCard', args: ['/repo', { folder: null, card }] },
      {
        name: 'reconnect',
        args: [
          '/repo',
          {
            folder: null,
            previous: { from: 'a.md', to: 'b.md' },
            next: { from: 'a.md', to: 'c.md', from_anchor: 'south', to_anchor: 'north' },
          },
        ],
      },
      { name: 'purgeNode', args: ['/repo', { path: 'b.md' }] },
    ]);
  });
});

describe('CanvasYamlBackendProvider', () => {
  it('persists cards and size with sparse canvas YAML semantics', async () => {
    await withTempWorkspace(async (root) => {
      const backend = new CanvasYamlBackendProvider({ badges: memoryBadgeBridge().bridge });

      await expect(backend.get(root, { folder: null })).resolves.toBeNull();
      await expect(
        backend.setCard(root, { folder: null, card: card('a.md', 1, 2) }),
      ).resolves.toMatchObject({
        path: '',
        cards: [card('a.md', 1, 2)],
        edges: [],
      });
      await expect(
        backend.setCard(root, { folder: null, card: card('a.md', 9, 9) }),
      ).resolves.toMatchObject({
        cards: [card('a.md', 9, 9)],
      });
      await backend.setSize(root, { folder: null, size: { width: 2400, height: 1600 } });

      expect(parse(await readFile(join(root, '.bh/mirror/canvas.yaml'), 'utf8'))).toEqual({
        path: '',
        cards: [card('a.md', 9, 9)],
        edges: [],
        size: { width: 2400, height: 1600 },
      });
      await expect(backend.revision(root)).resolves.toMatchObject({ count: 1 });

      await expect(backend.removeCard(root, { folder: null, path: 'a.md' })).resolves.toEqual({
        removed: true,
      });
      await expect(backend.get(root, { folder: null })).resolves.toEqual({
        path: '',
        cards: [],
        edges: [],
        size: { width: 2400, height: 1600 },
      });
    });
  });

  it('keeps canvas edges and badge references in lockstep', async () => {
    await withTempWorkspace(async (root) => {
      const badges = memoryBadgeBridge();
      const backend = new CanvasYamlBackendProvider({ badges: badges.bridge });

      await expect(
        backend.connect(root, {
          folder: null,
          from: 'a.md',
          to: 'b.md',
          from_anchor: 'east',
          to_anchor: 'west',
          label: '  leads to  ',
        }),
      ).resolves.toMatchObject({
        edges: [
          {
            from: 'a.md',
            from_anchor: 'east',
            to: 'b.md',
            to_anchor: 'west',
            label: 'leads to',
          },
        ],
      });
      expect([...(badges.refs.get('a.md') ?? [])]).toEqual(['b.md']);

      await backend.reconnect(root, {
        folder: null,
        previous: { from: 'a.md', to: 'b.md' },
        next: { from: 'a.md', to: 'c.md', from_anchor: 'south', to_anchor: 'north' },
      });
      expect([...(badges.refs.get('a.md') ?? [])]).toEqual(['c.md']);

      await expect(
        backend.disconnect(root, { folder: null, from: 'a.md', to: 'c.md' }),
      ).resolves.toEqual({ path: '', cards: [], edges: [] });
      expect([...(badges.refs.get('a.md') ?? [])]).toEqual([]);
      await expect(backend.get(root, { folder: null })).resolves.toBeNull();
    });
  });

  it('does not remove a pre-existing badge reference when the canvas write fails', async () => {
    await withTempWorkspace(async (root) => {
      const badges = memoryBadgeBridge({ 'a.md': ['b.md'] });
      const backend = new CanvasYamlBackendProvider({ badges: badges.bridge });
      await mkdir(join(root, '.bh/mirror'), { recursive: true });
      await writeFile(join(root, '.bh/mirror/canvas.yaml'), '[corrupt', 'utf8');

      await expect(
        backend.connect(root, {
          folder: null,
          from: 'a.md',
          to: 'b.md',
          from_anchor: 'east',
          to_anchor: 'west',
        }),
      ).rejects.toThrow(/Canvas corrupt/i);
      expect([...(badges.refs.get('a.md') ?? [])]).toEqual(['b.md']);
    });
  });

  it('relocates and purges canvas mirror nodes', async () => {
    await withTempWorkspace(async (root) => {
      const badges = memoryBadgeBridge();
      const backend = new CanvasYamlBackendProvider({ badges: badges.bridge });
      await backend.setCard(root, { folder: null, card: card('docs', 10, 20, 'folder') });
      await backend.connect(root, {
        folder: null,
        from: 'docs',
        to: 'other',
        from_anchor: 'east',
        to_anchor: 'west',
      });
      await backend.setCard(root, { folder: 'docs', card: card('docs/a.md', 1, 1) });
      await backend.connect(root, {
        folder: 'docs',
        from: 'docs/a.md',
        to: 'docs/b.md',
        from_anchor: 'south',
        to_anchor: 'north',
      });

      await expect(backend.relocate(root, { from: 'docs', to: 'guide' })).resolves.toEqual({
        moved: 1,
      });
      await expect(backend.get(root, { folder: null })).resolves.toMatchObject({
        cards: [card('guide', 10, 20, 'folder')],
        edges: [{ from: 'guide', from_anchor: 'east', to: 'other', to_anchor: 'west' }],
      });
      await expect(backend.get(root, { folder: 'guide' })).resolves.toMatchObject({
        path: 'guide',
        cards: [card('guide/a.md', 1, 1)],
        edges: [{ from: 'guide/a.md', from_anchor: 'south', to: 'guide/b.md', to_anchor: 'north' }],
      });
      await expect(
        readFile(join(root, '.bh/mirror/docs/canvas.yaml'), 'utf8'),
      ).rejects.toMatchObject({
        code: 'ENOENT',
      });

      await expect(backend.purgeNode(root, { path: 'guide' })).resolves.toEqual({ removed: 1 });
      await expect(backend.get(root, { folder: 'guide' })).resolves.toBeNull();
      await expect(backend.get(root, { folder: null })).resolves.toBeNull();
    });
  });

  it('rejects calls without a bound workspace', async () => {
    const backend = new CanvasYamlBackendProvider({ badges: memoryBadgeBridge().bridge });
    await expect(backend.get(null, { folder: null })).rejects.toThrow(/No workspace bound/i);
    await expect(backend.setCard(null, { folder: null, card: card('a.md', 1, 1) })).rejects.toThrow(
      /No workspace bound/i,
    );
  });
});

function card(path: string, x: number, y: number, kind: 'file' | 'folder' = 'file'): CanvasCard {
  return { path, kind, x, y, width: 200, height: 120 };
}

function memoryBadgeBridge(seed: Record<string, readonly string[]> = {}): {
  readonly bridge: CanvasBadgeBridge;
  readonly refs: Map<string, Set<string>>;
} {
  const refs = new Map<string, Set<string>>(
    Object.entries(seed).map(([path, targets]) => [path, new Set(targets)]),
  );
  const bridge: CanvasBadgeBridge = {
    async get(_workspaceRoot, args) {
      const references = refs.get(args.file);
      if (references === undefined) return null;
      return badge(args.file, [...references], args.kind);
    },
    async addRef(_workspaceRoot, args) {
      let references = refs.get(args.file);
      if (references === undefined) {
        references = new Set<string>();
        refs.set(args.file, references);
      }
      references.delete(args.to);
      references.add(args.to);
      return badge(args.file, [...references], args.kind);
    },
    async removeRef(_workspaceRoot, args) {
      const references = refs.get(args.file);
      if (references === undefined) throw new Error(`Badge not found: ${args.file}`);
      references.delete(args.to);
      return badge(args.file, [...references], args.kind);
    },
  };
  return { bridge, refs };
}

function badge(
  path: string,
  references: readonly string[],
  kind: 'file' | 'folder' = 'file',
): BadgeFile {
  return { path, kind, references };
}

async function withTempWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'basehalf-canvas-yaml-'));
  try {
    await mkdir(root, { recursive: true });
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
