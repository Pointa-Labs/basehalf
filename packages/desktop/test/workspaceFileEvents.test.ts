import { describe, expect, it } from 'vitest';
import {
  WorkspaceFileOperationEvent,
  emitEntryRemoved,
  emitEntryRenamed,
  emitWorkspaceFileOperation,
  subscribeEntryRemoved,
  subscribeEntryRenamed,
  subscribeWorkspaceFileOperations,
} from '../src/workbench/services/workspace/browser/workspaceFileEvents.js';

describe('workspace file operation events', () => {
  it('emits one VS Code-style operation event for successful in-app delete and move', () => {
    const seen: WorkspaceFileOperationEvent[] = [];
    const unsub = subscribeWorkspaceFileOperations((event) => seen.push(event));

    emitEntryRemoved('old.md', 'file');
    emitEntryRenamed('docs', 'notes', 'folder');
    unsub();

    expect(seen).toHaveLength(2);
    expect(seen[0]?.isOperation('delete')).toBe(true);
    expect(seen[0]).toMatchObject({ resource: 'old.md', operation: 'delete', kind: 'file' });
    expect(seen[1]?.isOperation('move')).toBe(true);
    expect(seen[1]).toMatchObject({
      resource: 'docs',
      operation: 'move',
      kind: 'folder',
      target: 'notes',
    });
  });

  it('keeps the legacy removed and renamed subscriptions as filtered views', () => {
    const removed: Array<[string, string]> = [];
    const renamed: Array<[string, string, string]> = [];
    const unsubRemoved = subscribeEntryRemoved((path, kind) => removed.push([path, kind]));
    const unsubRenamed = subscribeEntryRenamed((from, to, kind) => renamed.push([from, to, kind]));

    emitWorkspaceFileOperation(new WorkspaceFileOperationEvent('a.md', 'delete', 'file'));
    emitWorkspaceFileOperation(new WorkspaceFileOperationEvent('from', 'move', 'folder', 'to'));
    unsubRemoved();
    unsubRenamed();

    expect(removed).toEqual([['a.md', 'file']]);
    expect(renamed).toEqual([['from', 'to', 'folder']]);
  });
});
