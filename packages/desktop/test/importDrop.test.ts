import { beforeEach, describe, expect, it } from 'vitest';
import { droppedPaths, handleExternalDrop } from '../src/renderer/src/lib/importDrop.js';
import { useWorkspaceStore } from '../src/renderer/src/store/workspace.js';

// Pin the OS drag-drop ROUTING contract (lib/importDrop): folders → add/open
// as workspace; files → COPY into the open workspace (workspace.importFile);
// files with no workspace open → an explanatory error, not a crash. The copy
// semantics themselves (collision suffix, containment, byte fidelity) are
// unit-tested in @basehalf/core — this mock mirrors that contract.

let kinds: Record<string, 'file' | 'dir' | null>;
let importCalls: Array<{ from: string; to: string | null }>;
let badgeSets: Array<{ file: string; x: number; y: number }>;
let addedDirs: string[];
let importResult: (from: string) => {
  path: string;
  name: string;
  imported: boolean;
  supported: boolean;
};

const baseName = (p: string): string => p.split('/').filter(Boolean).pop() ?? p;

const bh = {
  pathKind: async (p: string): Promise<'file' | 'dir' | null> => kinds[p] ?? null,
  // Preload bridge for File→path; the unit fixtures carry a legacy `.path`.
  pathForFile: (f: File & { path?: string }): string => f.path ?? '',
  run: async (name: string, args?: unknown): Promise<unknown> => {
    const a = (args ?? {}) as Record<string, unknown>;
    switch (name) {
      case 'workspace.importFile': {
        importCalls.push({ from: a.from as string, to: (a.to as string | null) ?? null });
        return importResult(a.from as string);
      }
      case 'badge.set': {
        const patch = a.patch as { canvas?: { x: number; y: number } };
        if (patch.canvas) {
          badgeSets.push({ file: a.file as string, x: patch.canvas.x, y: patch.canvas.y });
        }
        return {};
      }
      case 'workspace.add': {
        addedDirs.push(a.path as string);
        return {
          workspace: { name: baseName(a.path as string), path: a.path, addedAt: 'now' },
          setAsCurrent: false,
          bhDirCreated: true,
          alreadyRegistered: false,
        };
      }
      case 'workspace.use':
        return { current: { name: a.name } };
      case 'workspace.list':
        return { current: useWorkspaceStore.getState().current, workspaces: [] };
      default:
        return {};
    }
  },
};

beforeEach(() => {
  kinds = {};
  importCalls = [];
  badgeSets = [];
  addedDirs = [];
  importResult = (from) => ({
    path: baseName(from),
    name: baseName(from),
    imported: true,
    supported: true,
  });
  (globalThis as { window?: unknown }).window = { bh };
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  useWorkspaceStore.setState({ current: 'ws', busy: false, error: '', notice: '' });
});

describe('handleExternalDrop routing', () => {
  it('copies dropped files into the open workspace and confirms', async () => {
    kinds = { '/elsewhere/paper.pdf': 'file' };
    await handleExternalDrop(['/elsewhere/paper.pdf']);
    expect(importCalls).toEqual([{ from: '/elsewhere/paper.pdf', to: null }]);
    expect(useWorkspaceStore.getState().notice).toContain('Copied paper.pdf');
    expect(useWorkspaceStore.getState().notice).toContain('original stays');
    expect(useWorkspaceStore.getState().error).toBe('');
  });

  it('routes a dropped folder to add-as-workspace, not import', async () => {
    kinds = { '/projects/thesis': 'dir' };
    await handleExternalDrop(['/projects/thesis']);
    expect(importCalls).toHaveLength(0);
    expect(addedDirs).toEqual(['/projects/thesis']);
  });

  it('imports into the scoped folder when the canvas is inside one', async () => {
    kinds = { '/dl/img.png': 'file' };
    await handleExternalDrop(['/dl/img.png'], { folderScope: 'inbox' });
    expect(importCalls).toEqual([{ from: '/dl/img.png', to: 'inbox' }]);
  });

  it('places supported NEW files at the canvas drop point, staggered', async () => {
    kinds = { '/a/one.md': 'file', '/a/two.md': 'file' };
    await handleExternalDrop(['/a/one.md', '/a/two.md'], { canvasPoint: { x: 100, y: 50 } });
    expect(badgeSets).toEqual([
      { file: 'one.md', x: 100, y: 50 },
      { file: 'two.md', x: 132, y: 82 },
    ]);
  });

  it('does NOT reposition a file that was already in the workspace', async () => {
    kinds = { '/ws/own.md': 'file' };
    importResult = () => ({ path: 'own.md', name: 'own.md', imported: false, supported: true });
    await handleExternalDrop(['/ws/own.md'], { canvasPoint: { x: 10, y: 10 } });
    expect(badgeSets).toHaveLength(0);
    expect(useWorkspaceStore.getState().notice).toContain('already in this workspace');
  });

  it('skips canvas placement for unsupported types (no card to place)', async () => {
    kinds = { '/a/tool.bin': 'file' };
    importResult = () => ({ path: 'tool.bin', name: 'tool.bin', imported: true, supported: false });
    await handleExternalDrop(['/a/tool.bin'], { canvasPoint: { x: 0, y: 0 } });
    expect(badgeSets).toHaveLength(0);
  });

  it('file dropped with NO workspace open → explanatory error, nothing imported', async () => {
    useWorkspaceStore.setState({ current: null });
    kinds = { '/a/x.md': 'file' };
    await handleExternalDrop(['/a/x.md']);
    expect(importCalls).toHaveLength(0);
    expect(useWorkspaceStore.getState().error).toContain('Open a folder first');
  });

  it('a failed copy surfaces in error while the rest still land', async () => {
    kinds = { '/a/ok.md': 'file', '/a/bad.md': 'file' };
    const okResult = importResult;
    importResult = (from) => {
      if (from === '/a/bad.md') throw new Error('disk full');
      return okResult(from);
    };
    await handleExternalDrop(['/a/ok.md', '/a/bad.md']);
    expect(useWorkspaceStore.getState().notice).toContain('Copied ok.md');
    expect(useWorkspaceStore.getState().error).toContain('disk full');
  });
});

describe('droppedPaths', () => {
  it('extracts absolute paths from the drag payload, skipping path-less files', () => {
    const mk = (path?: string): File => {
      const f = {} as File & { path?: string };
      if (path !== undefined) f.path = path;
      return f;
    };
    const dt = { files: [mk('/a/x.md'), mk(), mk('/b/y.pdf')] } as unknown as DataTransfer;
    expect(droppedPaths(dt)).toEqual(['/a/x.md', '/b/y.pdf']);
  });
});
