import { describe, expect, it } from 'vitest';
import { createExplorerService } from '../src/workbench/contrib/files/browser/explorerService.js';
import type { ExplorerDataProvider } from '../src/workbench/contrib/files/common/explorer.js';

const noopProvider = (
  entries = [{ name: 'README.md', type: 'file' as const }],
): ExplorerDataProvider => ({
  listChildren: async () => entries,
  onDidChangeFiles: () => () => {},
  onDidRunOperation: () => () => {},
});

describe('explorerService', () => {
  it('delegates child resolution through the explorer data provider', async () => {
    const service = createExplorerService(noopProvider([{ name: 'src', type: 'dir' }]));

    await expect(service.resolveChildren('/repo')).resolves.toEqual([{ name: 'src', type: 'dir' }]);
  });

  it('maps watcher events to loaded parent directories and ignores mirror control paths', () => {
    const service = createExplorerService(noopProvider());
    const childrenByPath = new Map([
      ['/repo', []],
      ['/repo/src', []],
    ]);

    expect(
      service.affectedLoadedDirectories({
        rootPath: '/repo',
        childrenByPath,
        event: { type: 'add', relPath: 'src/index.ts', isDir: false },
      }),
    ).toEqual(['/repo/src']);
    expect(
      service.affectedLoadedDirectories({
        rootPath: '/repo',
        childrenByPath,
        event: {
          type: 'rename',
          fromRelPath: 'src/old.ts',
          toRelPath: 'src/new.ts',
          isDir: false,
        },
      }),
    ).toEqual(['/repo/src']);
    expect(
      service.affectedLoadedDirectories({
        rootPath: '/repo',
        childrenByPath,
        event: { type: 'change', relPath: '.bh/mirror/focus.yaml', isDir: false },
      }),
    ).toEqual([]);
  });

  it('applies in-app create, delete, and move operations to the explorer tree cache', () => {
    const service = createExplorerService(noopProvider());
    const initialChildren = new Map([
      [
        '/repo',
        [
          { name: 'docs', type: 'dir' as const },
          { name: 'README.md', type: 'file' as const },
        ],
      ],
      ['/repo/docs', [{ name: 'a.md', type: 'file' as const }]],
    ]);

    const removed = service.applyFileOperation(
      {
        rootPath: '/repo',
        childrenByPath: initialChildren,
        expanded: new Set(['/repo/docs']),
      },
      { type: 'delete', resource: 'docs', kind: 'folder' },
    );
    expect(removed.childrenByPath.get('/repo')).toEqual([{ name: 'README.md', type: 'file' }]);
    expect(removed.childrenByPath.has('/repo/docs')).toBe(false);
    expect([...removed.expanded]).toEqual([]);

    const created = service.applyFileOperation(
      {
        rootPath: '/repo',
        childrenByPath: initialChildren,
        expanded: new Set(['/repo/docs']),
      },
      { type: 'create', resource: 'docs/b.md', kind: 'file' },
    );
    expect(created.childrenByPath.get('/repo/docs')).toEqual([
      { name: 'a.md', type: 'file' },
      { name: 'b.md', type: 'file' },
    ]);

    const moved = service.applyFileOperation(
      {
        rootPath: '/repo',
        childrenByPath: initialChildren,
        expanded: new Set(['/repo/docs']),
      },
      { type: 'move', resource: 'docs', target: 'notes', kind: 'folder' },
    );
    expect(moved.childrenByPath.get('/repo')).toEqual([
      { name: 'notes', type: 'dir' },
      { name: 'README.md', type: 'file' },
    ]);
    expect(moved.childrenByPath.get('/repo/notes')).toEqual([{ name: 'a.md', type: 'file' }]);
    expect([...moved.expanded]).toEqual(['/repo/notes']);
  });

  it('rebases or prunes cached directory subtrees for watcher events', () => {
    const service = createExplorerService(noopProvider());
    const state = {
      rootPath: '/repo',
      childrenByPath: new Map([
        [
          '/repo',
          [
            { name: 'docs', type: 'dir' as const },
            { name: 'src', type: 'dir' as const },
          ],
        ],
        ['/repo/docs', [{ name: 'nested', type: 'dir' as const }]],
        ['/repo/docs/nested', [{ name: 'a.md', type: 'file' as const }]],
        ['/repo/src', []],
      ]),
      expanded: new Set(['/repo/docs', '/repo/docs/nested']),
    };

    const renamed = service.applyFileEvent(state, {
      type: 'rename',
      fromRelPath: 'docs',
      toRelPath: 'src/docs',
      isDir: true,
    });

    expect(renamed?.childrenByPath.has('/repo/docs')).toBe(false);
    expect(renamed?.childrenByPath.get('/repo/src/docs/nested')).toEqual([
      { name: 'a.md', type: 'file' },
    ]);
    expect([...(renamed?.expanded ?? [])]).toEqual(['/repo/src/docs', '/repo/src/docs/nested']);

    const removed = service.applyFileEvent(
      {
        rootPath: '/repo',
        childrenByPath: renamed?.childrenByPath ?? state.childrenByPath,
        expanded: renamed?.expanded ?? state.expanded,
      },
      { type: 'unlink', relPath: 'src/docs', isDir: true },
    );

    expect(removed?.childrenByPath.has('/repo/src/docs')).toBe(false);
    expect(removed?.childrenByPath.has('/repo/src/docs/nested')).toBe(false);
    expect([...(removed?.expanded ?? [])]).toEqual([]);
  });

  it('applies watcher adds to loaded parents without surfacing mirror control paths', () => {
    const service = createExplorerService(noopProvider());
    const state = {
      rootPath: '/repo',
      childrenByPath: new Map([
        ['/repo', [{ name: 'src', type: 'dir' as const }]],
        ['/repo/src', []],
      ]),
      expanded: new Set(['/repo/src']),
    };

    const added = service.applyFileEvent(state, {
      type: 'add',
      relPath: 'src/index.ts',
      isDir: false,
    });
    expect(added?.childrenByPath.get('/repo/src')).toEqual([{ name: 'index.ts', type: 'file' }]);
    expect(
      service.applyFileEvent(
        {
          rootPath: '/repo',
          childrenByPath: added?.childrenByPath ?? state.childrenByPath,
          expanded: added?.expanded ?? state.expanded,
        },
        { type: 'add', relPath: '.bh/mirror/focus.yaml', isDir: false },
      ),
    ).toBeNull();
  });
});
