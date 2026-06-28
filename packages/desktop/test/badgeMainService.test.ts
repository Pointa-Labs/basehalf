import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AdhdYamlBackendProvider } from '../src/workbench/services/mirror/electron-main/adhdBackendProvider.js';
import {
  type BadgeBackendProvider,
  BadgeYamlBackendProvider,
} from '../src/workbench/services/mirror/electron-main/badgeBackendProvider.js';
import { BadgeMainService } from '../src/workbench/services/mirror/electron-main/badgeMainService.js';
import { CanvasYamlBackendProvider } from '../src/workbench/services/mirror/electron-main/canvasBackendProvider.js';
import { FocusYamlBackendProvider } from '../src/workbench/services/mirror/electron-main/focusBackendProvider.js';

describe('BadgeMainService', () => {
  it('delegates badge operations to the configured backend provider', async () => {
    const calls: Array<{ name: string; args: readonly unknown[] }> = [];
    const badge = { path: 'a.md', kind: 'file' as const, references: [] };
    const backend = {
      async get(...args: [string | null, { file: string }]) {
        calls.push({ name: 'get', args });
        return badge;
      },
      async set(...args: [string | null, { file: string; patch: { description: string } }]) {
        calls.push({ name: 'set', args });
        return badge;
      },
      async list(...args: [string | null, { query: string }]) {
        calls.push({ name: 'list', args });
        return { badges: [badge] };
      },
      async rename(...args: [string | null, { from: string; to: string }]) {
        calls.push({ name: 'rename', args });
        return { badge, updatedRefs: ['ref.md'], focusUpdated: true };
      },
    } as unknown as BadgeBackendProvider;
    const service = new BadgeMainService(backend);

    await expect(service.get('/repo', { file: 'a.md' })).resolves.toEqual(badge);
    await expect(
      service.set('/repo', { file: 'a.md', patch: { description: 'note' } }),
    ).resolves.toEqual(badge);
    await expect(service.list('/repo', { query: 'a' })).resolves.toEqual({ badges: [badge] });
    await expect(service.rename('/repo', { from: 'a.md', to: 'b.md' })).resolves.toEqual({
      badge,
      updatedRefs: ['ref.md'],
      focusUpdated: true,
    });

    expect(calls).toEqual([
      { name: 'get', args: ['/repo', { file: 'a.md' }] },
      { name: 'set', args: ['/repo', { file: 'a.md', patch: { description: 'note' } }] },
      { name: 'list', args: ['/repo', { query: 'a' }] },
      { name: 'rename', args: ['/repo', { from: 'a.md', to: 'b.md' }] },
    ]);
  });
});

describe('BadgeYamlBackendProvider', () => {
  it('maintains references and embedded backlinks across add, remove, set, and delete', async () => {
    await withTempWorkspace(async (root) => {
      const { badge } = createMirrorProviders();

      await expect(
        badge.set(root, { file: 'a.md', patch: { description: 'Alpha' } }),
      ).resolves.toMatchObject({
        path: 'a.md',
        description: 'Alpha',
        references: [],
      });
      await expect(badge.addRef(root, { file: 'a.md', to: 'b.md' })).resolves.toMatchObject({
        references: ['b.md'],
      });
      await expect(badge.get(root, { file: 'b.md' })).resolves.toMatchObject({
        referenced_by: ['a.md'],
      });

      await expect(
        badge.set(root, { file: 'a.md', patch: { description: 'Alpha edited' } }),
      ).resolves.toMatchObject({
        description: 'Alpha edited',
        references: ['b.md'],
      });
      await expect(badge.removeRef(root, { file: 'a.md', to: 'b.md' })).resolves.toMatchObject({
        references: [],
      });
      await expect(badge.get(root, { file: 'b.md' })).resolves.toBeNull();

      await badge.addRef(root, { file: 'a.md', to: 'b.md' });
      await expect(badge.delete(root, { file: 'a.md' })).resolves.toEqual({ deleted: true });
      await expect(badge.get(root, { file: 'b.md' })).resolves.toBeNull();
    });
  });

  it('renames a file badge and cascades canvas, ADHD, and focused viewport state', async () => {
    await withTempWorkspace(async (root) => {
      const { badge, canvas, adhd, focus } = createMirrorProviders();
      await badge.set(root, { file: 'docs/a.md', patch: { description: 'first' } });
      await badge.set(root, { file: 'docs/b.md', patch: { description: 'second' } });
      await canvas.setCard(root, {
        folder: 'docs',
        card: { path: 'docs/a.md', kind: 'file', x: 10, y: 20, width: 260, height: 140 },
      });
      await canvas.connect(root, {
        folder: 'docs',
        from: 'docs/a.md',
        to: 'docs/b.md',
        from_anchor: 'east',
        to_anchor: 'west',
        label: 'extends',
      });
      await focus.set(root, { path: 'docs/a.md', kind: 'file', visible_lines: { start: 5 } });
      await adhd.addKeyword(root, { file: 'docs/a.md', keyword: 'term' });

      await expect(
        badge.rename(root, { from: 'docs/a.md', to: 'docs/c.md', kind: 'file' }),
      ).resolves.toMatchObject({
        badge: { path: 'docs/c.md', references: ['docs/b.md'] },
        focusUpdated: true,
      });

      await expect(badge.get(root, { file: 'docs/a.md' })).resolves.toBeNull();
      await expect(badge.get(root, { file: 'docs/b.md' })).resolves.toMatchObject({
        referenced_by: ['docs/c.md'],
      });
      await expect(canvas.get(root, { folder: 'docs' })).resolves.toMatchObject({
        cards: [expect.objectContaining({ path: 'docs/c.md', x: 10, y: 20 })],
        edges: [expect.objectContaining({ from: 'docs/c.md', to: 'docs/b.md', label: 'extends' })],
      });
      await expect(focus.get(root)).resolves.toMatchObject({
        path: 'docs/c.md',
        visible_lines: { start: 5 },
      });
      await expect(adhd.get(root, 'docs/c.md')).resolves.toMatchObject({
        path: 'docs/c.md',
        highlight_keywords: ['term'],
      });
    });
  });

  it('renames folder descendants and rewrites intra-folder references', async () => {
    await withTempWorkspace(async (root) => {
      const { badge } = createMirrorProviders();
      await badge.set(root, { file: 'docs', patch: { kind: 'folder', description: 'folder' } });
      await badge.set(root, { file: 'docs/a.md', patch: { description: 'a' } });
      await badge.set(root, { file: 'docs/b.md', patch: { description: 'b' } });
      await badge.addRef(root, { file: 'docs/a.md', to: 'docs/b.md' });
      await badge.addRef(root, { file: 'outside.md', to: 'docs/a.md' });

      await expect(
        badge.rename(root, { from: 'docs', to: 'guide', kind: 'folder' }),
      ).resolves.toMatchObject({
        badge: { path: 'guide', description: 'folder' },
      });

      await expect(badge.get(root, { file: 'guide/a.md' })).resolves.toMatchObject({
        path: 'guide/a.md',
        description: 'a',
        references: ['guide/b.md'],
        referenced_by: ['outside.md'],
      });
      await expect(badge.get(root, { file: 'guide/b.md' })).resolves.toMatchObject({
        referenced_by: ['guide/a.md'],
      });
      await expect(badge.get(root, { file: 'outside.md' })).resolves.toMatchObject({
        references: ['guide/a.md'],
      });
      await expect(badge.get(root, { file: 'docs/a.md' })).resolves.toBeNull();
    });
  });

  it('marks only missing disk targets as orphan during pruneDangling', async () => {
    await withTempWorkspace(async (root) => {
      const { badge } = createMirrorProviders();
      await writeFile(join(root, 'live.md'), '# live\n');
      await badge.set(root, { file: 'live.md', patch: { description: 'here' } });
      await badge.set(root, { file: 'gone.md', patch: { description: 'gone' } });

      await expect(badge.pruneDangling(root)).resolves.toEqual({ orphaned: ['gone.md'] });
      await expect(badge.get(root, { file: 'gone.md' })).resolves.toMatchObject({
        orphan: true,
        description: 'gone',
      });
      const live = await badge.get(root, { file: 'live.md' });
      expect(live?.orphan).toBeUndefined();
    });
  });

  it('rejects calls without a bound workspace', async () => {
    const { badge } = createMirrorProviders();
    await expect(badge.get(null, { file: 'a.md' })).rejects.toThrow(/No workspace bound/i);
    await expect(badge.rename(null, { from: 'a.md', to: 'b.md' })).rejects.toThrow(
      /No workspace bound/i,
    );
  });
});

function createMirrorProviders(): {
  readonly badge: BadgeYamlBackendProvider;
  readonly canvas: CanvasYamlBackendProvider;
  readonly adhd: AdhdYamlBackendProvider;
  readonly focus: FocusYamlBackendProvider;
} {
  const adhd = new AdhdYamlBackendProvider();
  const focus = new FocusYamlBackendProvider();
  const targets: { canvas?: CanvasYamlBackendProvider } = {};
  const badge = new BadgeYamlBackendProvider({
    cascade: {
      relocateCanvas: (root, args) => {
        const canvas = targets.canvas;
        if (canvas === undefined) throw new Error('Canvas provider not initialized.');
        return canvas.relocate(root, args);
      },
      relocateAdhd: (root, args) => adhd.relocate(root, args),
      relocateFocus: (root, args) => focus.relocate(root, args),
    },
  });
  const canvas = new CanvasYamlBackendProvider({ badges: badge });
  targets.canvas = canvas;
  return { badge, canvas, adhd, focus };
}

async function withTempWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'basehalf-badge-yaml-'));
  try {
    await mkdir(root, { recursive: true });
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
