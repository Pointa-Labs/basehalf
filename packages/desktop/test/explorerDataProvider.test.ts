import { describe, expect, it } from 'vitest';
import type { WorkspaceFileEvent } from '../src/platform/files/common/files.js';
import {
  createWorkspaceExplorerDataProvider,
  toExplorerFileOperation,
} from '../src/workbench/contrib/files/browser/explorerDataProvider.js';
import { WorkspaceFileOperationEvent } from '../src/workbench/services/workspace/common/workspaceFileEvents.js';

describe('explorerDataProvider', () => {
  it('adapts workspace files, watcher events, and operation events for explorer consumers', async () => {
    const fileListeners = new Set<(event: WorkspaceFileEvent) => void>();
    const operationListeners = new Set<(event: WorkspaceFileOperationEvent) => void>();
    const listCalls: string[] = [];
    const provider = createWorkspaceExplorerDataProvider({
      workspace: {
        listFiles: async (path) => {
          listCalls.push(path);
          return { path, entries: [{ name: 'src', type: 'dir' as const }] };
        },
      },
      fileEvents: {
        onDidChangeFiles: (listener) => {
          fileListeners.add(listener);
          return () => fileListeners.delete(listener);
        },
      },
      operations: {
        onDidRunOperation: (listener) => {
          operationListeners.add(listener);
          return () => operationListeners.delete(listener);
        },
      },
    });

    await expect(provider.listChildren('/repo')).resolves.toEqual([{ name: 'src', type: 'dir' }]);
    expect(listCalls).toEqual(['/repo']);

    const watcherEvents: WorkspaceFileEvent[] = [];
    const unsubscribeFiles = provider.onDidChangeFiles((event) => watcherEvents.push(event));
    for (const listener of fileListeners) {
      listener({ type: 'add', relPath: 'src/index.ts', isDir: false });
    }
    unsubscribeFiles();
    expect(watcherEvents).toEqual([{ type: 'add', relPath: 'src/index.ts', isDir: false }]);

    const operations: unknown[] = [];
    const unsubscribeOperations = provider.onDidRunOperation((event) => operations.push(event));
    for (const listener of operationListeners) {
      listener(new WorkspaceFileOperationEvent('new.md', 'create', 'file'));
      listener(new WorkspaceFileOperationEvent('old.md', 'delete', 'file'));
      listener(new WorkspaceFileOperationEvent('docs', 'move', 'folder', 'notes'));
    }
    unsubscribeOperations();
    expect(operations).toEqual([
      { type: 'create', resource: 'new.md', kind: 'file' },
      { type: 'delete', resource: 'old.md', kind: 'file' },
      { type: 'move', resource: 'docs', target: 'notes', kind: 'folder' },
    ]);
  });

  it('maps workspace file operation events to explorer operations', () => {
    expect(
      toExplorerFileOperation(new WorkspaceFileOperationEvent('a.md', 'create', 'file')),
    ).toEqual({ type: 'create', resource: 'a.md', kind: 'file' });
    expect(
      toExplorerFileOperation(new WorkspaceFileOperationEvent('a.md', 'delete', 'file')),
    ).toEqual({ type: 'delete', resource: 'a.md', kind: 'file' });
    expect(
      toExplorerFileOperation(new WorkspaceFileOperationEvent('from', 'move', 'folder', 'to')),
    ).toEqual({ type: 'move', resource: 'from', target: 'to', kind: 'folder' });
  });
});
