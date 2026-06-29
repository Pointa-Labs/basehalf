import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { droppedPaths, handleExternalDrop } from '../src/workbench/browser/dnd/importDrop.js';
import { workspaceFileOperationService } from '../src/workbench/services/workspace/browser/workspaceFileOperationService.js';
import { useWorkspaceStore } from '../src/workbench/services/workspace/browser/workspaceStore.js';

// Pin the OS drag-drop ROUTING contract (lib/importDrop): folders → add/open
// as workspace; files → COPY into the open workspace (files import operation);
// files with no workspace open → an explanatory error, not a crash. The copy
// semantics themselves (collision suffix, containment, byte fidelity) are
// owned by the desktop workspace backend — this mock mirrors that contract.

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
  // Preload bridge for File→path; the unit fixtures carry a legacy `.path`.
  pathForFile: (f: File & { path?: string }): string => f.path ?? '',
  pathKindForFile: async (f: File & { path?: string }): Promise<'file' | 'dir' | null> =>
    f.path !== undefined ? (kinds[f.path] ?? null) : null,
  workspace: {
    add: async (args: unknown): Promise<unknown> => runWorkspace('workspace.add', args),
    list: async (): Promise<unknown> => runWorkspace('workspace.list', {}),
  },
  canvas: {
    setCard: async (args: unknown): Promise<unknown> => runWorkspace('canvas.setCard', args),
  },
  run: async (name: string, args?: unknown): Promise<unknown> => runWorkspace(name, args),
};

async function runWorkspace(name: string, args?: unknown): Promise<unknown> {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'canvas.setCard': {
      // Card position now lands in the folder's canvas.yaml (canvas.setCard),
      // not the badge — same drop-placement contract, new command.
      const card = a.card as { path: string; x: number; y: number };
      badgeSets.push({ file: card.path, x: card.x, y: card.y });
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
}

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
  vi.spyOn(workspaceFileOperationService, 'importFile').mockImplementation(async (from, to) => {
    importCalls.push({ from, to: to ?? null });
    return importResult(from);
  });
  (globalThis as { window?: unknown }).window = { bh };
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  useWorkspaceStore.setState({ current: 'ws', busy: false, error: '', notice: '' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleExternalDrop routing', () => {
  it('copies dropped files into the open workspace and confirms', async () => {
    await handleExternalDrop([{ path: '/elsewhere/paper.pdf', kind: 'file' }]);
    expect(importCalls).toEqual([{ from: '/elsewhere/paper.pdf', to: null }]);
    expect(useWorkspaceStore.getState().notice).toContain('Copied paper.pdf');
    expect(useWorkspaceStore.getState().notice).toContain('original stays');
    expect(useWorkspaceStore.getState().error).toBe('');
  });

  it('routes a dropped folder to add-as-workspace, not import', async () => {
    await handleExternalDrop([{ path: '/projects/thesis', kind: 'dir' }]);
    expect(importCalls).toHaveLength(0);
    expect(addedDirs).toEqual(['/projects/thesis']);
  });

  it('imports into the scoped folder when the canvas is inside one', async () => {
    await handleExternalDrop([{ path: '/dl/img.png', kind: 'file' }], { folderScope: 'inbox' });
    expect(importCalls).toEqual([{ from: '/dl/img.png', to: 'inbox' }]);
  });

  it('places supported NEW files at the canvas drop point, staggered', async () => {
    await handleExternalDrop(
      [
        { path: '/a/one.md', kind: 'file' },
        { path: '/a/two.md', kind: 'file' },
      ],
      { canvasPoint: { x: 100, y: 50 } },
    );
    expect(badgeSets).toEqual([
      { file: 'one.md', x: 100, y: 50 },
      { file: 'two.md', x: 132, y: 82 },
    ]);
  });

  it('does NOT reposition a file that was already in the workspace', async () => {
    importResult = () => ({ path: 'own.md', name: 'own.md', imported: false, supported: true });
    await handleExternalDrop([{ path: '/ws/own.md', kind: 'file' }], {
      canvasPoint: { x: 10, y: 10 },
    });
    expect(badgeSets).toHaveLength(0);
    expect(useWorkspaceStore.getState().notice).toContain('already in this workspace');
  });

  it('skips canvas placement for unsupported types (no card to place)', async () => {
    importResult = () => ({ path: 'tool.bin', name: 'tool.bin', imported: true, supported: false });
    await handleExternalDrop([{ path: '/a/tool.bin', kind: 'file' }], {
      canvasPoint: { x: 0, y: 0 },
    });
    expect(badgeSets).toHaveLength(0);
  });

  it('file dropped with NO workspace open → explanatory error, nothing imported', async () => {
    useWorkspaceStore.setState({ current: null });
    await handleExternalDrop([{ path: '/a/x.md', kind: 'file' }]);
    expect(importCalls).toHaveLength(0);
    expect(useWorkspaceStore.getState().error).toContain('Open a folder first');
  });

  it('a failed copy surfaces in error while the rest still land', async () => {
    const okResult = importResult;
    importResult = (from) => {
      if (from === '/a/bad.md') throw new Error('disk full');
      return okResult(from);
    };
    await handleExternalDrop([
      { path: '/a/ok.md', kind: 'file' },
      { path: '/a/bad.md', kind: 'file' },
    ]);
    expect(useWorkspaceStore.getState().notice).toContain('Copied ok.md');
    expect(useWorkspaceStore.getState().error).toContain('disk full');
  });
});

describe('droppedPaths', () => {
  it('extracts absolute paths and kinds from the drag payload, skipping path-less files', async () => {
    kinds = { '/a/x.md': 'file', '/b/y.pdf': 'file' };
    const mk = (path?: string): File => {
      const f = {} as File & { path?: string };
      if (path !== undefined) f.path = path;
      return f;
    };
    const dt = { files: [mk('/a/x.md'), mk(), mk('/b/y.pdf')] } as unknown as DataTransfer;
    await expect(droppedPaths(dt)).resolves.toEqual([
      { path: '/a/x.md', kind: 'file' },
      { path: '/b/y.pdf', kind: 'file' },
    ]);
  });
});
