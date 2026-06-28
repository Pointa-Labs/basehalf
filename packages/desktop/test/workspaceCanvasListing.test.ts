import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DesktopWorkspaceBackendProvider,
  type WorkspaceBackendProvider,
} from '../src/platform/workspaces/electron-main/workspaceBackendProvider.js';
import { CanvasListingMainService } from '../src/workbench/contrib/basehalfCanvas/electron-main/canvasListingMainService.js';
import type { BadgeFile } from '../src/workbench/services/mirror/common/badge.js';
import type { CanvasFile } from '../src/workbench/services/mirror/common/canvas.js';

describe('CanvasListingMainService', () => {
  it('lists direct canvas children with root hint filtering and folder previews', async () => {
    await withTempWorkspace(async (root) => {
      await mkdir(join(root, 'notes/sub'), { recursive: true });
      await mkdir(join(root, 'node_modules'), { recursive: true });
      await mkdir(join(root, '.git'), { recursive: true });
      await writeFile(join(root, 'CLAUDE.md'), '# hint');
      await writeFile(join(root, 'AGENTS.md'), '# hint');
      await writeFile(join(root, 'note.md'), '');
      await writeFile(join(root, 'script.sh'), '');
      await writeFile(join(root, 'Dockerfile'), '');
      await writeFile(join(root, '.DS_Store'), '');
      await writeFile(join(root, 'notes/a.md'), '');
      await writeFile(join(root, 'notes/b.png'), '');
      await writeFile(join(root, 'notes/code.sh'), '');
      await writeFile(join(root, 'notes/sub/deep.md'), '');
      await writeFile(join(root, 'node_modules/x.md'), '');
      const service = createService();

      const rootCanvas = await service.listCanvas(root, { folder: null });
      expect(rootCanvas.children.map((child) => child.path).sort()).toEqual([
        'Dockerfile',
        'note.md',
        'notes',
        'script.sh',
      ]);
      expect(rootCanvas.children.find((child) => child.path === 'notes')?.preview).toEqual({
        total: 4,
        items: [
          { name: 'sub', kind: 'folder' },
          { name: 'a.md', kind: 'file' },
          { name: 'b.png', kind: 'file' },
          { name: 'code.sh', kind: 'file' },
        ],
      });

      await writeFile(join(root, 'notes/AGENTS.md'), '# user content');
      const nested = await service.listCanvas(root, { folder: 'notes' });
      expect(nested.folder).toBe('notes');
      expect(nested.children.map((child) => child.path)).toContain('notes/AGENTS.md');
    });
  });

  it('merges sparse badge metadata with canvas cards and styled reference edges', async () => {
    await withTempWorkspace(async (root) => {
      await writeFile(join(root, 'a.md'), '');
      await writeFile(join(root, 'b.md'), '');
      const badges = new Map<string, BadgeFile>([
        [
          'file:a.md',
          {
            path: 'a.md',
            kind: 'file',
            description: 'hello',
            references: ['b.md'],
            referenced_by: [],
          },
        ],
        ['file:b.md', { path: 'b.md', kind: 'file', references: [], referenced_by: ['a.md'] }],
      ]);
      const canvases = new Map<string, CanvasFile>([
        [
          '<root>',
          {
            path: '',
            size: { width: 2400, height: 1600 },
            cards: [{ path: 'a.md', kind: 'file', x: 10, y: 20, width: 260, height: 140 }],
            edges: [
              {
                from: 'a.md',
                from_anchor: 'east',
                to: 'b.md',
                to_anchor: 'west',
                label: 'concept',
              },
            ],
          },
        ],
      ]);
      const service = createService({ badges, canvases });

      const result = await service.listCanvas(root, { folder: null });
      expect(result.size).toEqual({ width: 2400, height: 1600 });
      expect(result.children.find((child) => child.path === 'a.md')).toMatchObject({
        description: 'hello',
        references: ['b.md'],
        card: { x: 10, y: 20, width: 260, height: 140 },
      });
      expect(result.children.find((child) => child.path === 'b.md')?.referenced_by).toEqual([
        'a.md',
      ]);
      expect(result.edges).toEqual([
        { from: 'a.md', from_anchor: 'east', to: 'b.md', to_anchor: 'west', label: 'concept' },
      ]);
    });
  });

  it('caps flat folders while keeping annotated children', async () => {
    await withTempWorkspace(async (root) => {
      await mkdir(join(root, 'big'));
      for (let i = 0; i < 305; i++) {
        await writeFile(join(root, 'big', `f${String(i).padStart(3, '0')}.md`), '');
      }
      const badges = new Map<string, BadgeFile>([
        [
          'file:big/f303.md',
          {
            path: 'big/f303.md',
            kind: 'file',
            description: 'kept',
            references: [],
            referenced_by: [],
          },
        ],
      ]);
      const service = createService({ badges });

      const result = await service.listCanvas(root, { folder: 'big' });
      expect(result.children).toHaveLength(300);
      expect(result.truncated).toBe(5);
      const paths = result.children.map((child) => child.path);
      expect(paths).toContain('big/f303.md');
      expect(paths).not.toContain('big/f304.md');
    });
  });

  it('rejects unbound or escaping folder requests', async () => {
    const service = createService();
    await expect(service.listCanvas(null, { folder: null })).rejects.toThrow(/No workspace bound/i);
    await withTempWorkspace(async (root) => {
      await expect(service.listCanvas(root, { folder: '../x' })).rejects.toThrow(
        /Path traversal rejected/,
      );
    });
  });

  it('can be the default DesktopWorkspaceBackendProvider listCanvas path', async () => {
    await withTempWorkspace(async (root) => {
      const canvasListing = {
        listCanvas: vi.fn(async () => ({ folder: null, children: [], edges: [] })),
      };
      const fallback = {
        listCanvas: vi.fn(async () => {
          throw new Error('legacy listCanvas should not be called');
        }),
      } as unknown as WorkspaceBackendProvider;
      const backend = new DesktopWorkspaceBackendProvider({
        configDir: root,
        fallback,
        canvasListing,
      });

      await expect(backend.listCanvas(root, { folder: null })).resolves.toEqual({
        folder: null,
        children: [],
        edges: [],
      });
      expect(canvasListing.listCanvas).toHaveBeenCalledWith(root, { folder: null });
      expect(fallback.listCanvas).not.toHaveBeenCalled();
    });
  });
});

function createService(opts?: {
  readonly badges?: ReadonlyMap<string, BadgeFile>;
  readonly canvases?: ReadonlyMap<string, CanvasFile>;
}): CanvasListingMainService {
  return new CanvasListingMainService({
    mirror: {
      getBadge: async (_root, args) => opts?.badges?.get(`${args.kind}:${args.file}`) ?? null,
      getCanvas: async (_root, args) => opts?.canvases?.get(args.folder ?? '<root>') ?? null,
    },
  });
}

async function withTempWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'basehalf-canvas-listing-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
