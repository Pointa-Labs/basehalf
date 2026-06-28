// Renderer-side file operation signal for optimistic workbench read-model updates.
//
// This mirrors the VS Code split between FileService operation events and Explorer
// read-model refreshes: the workspace service remains the disk writer, the watcher
// remains source of truth, and this service-level event only removes UI latency for
// successful in-app operations.

export type WorkspaceFileEntryKind = 'file' | 'folder';
export type WorkspaceFileOperation = 'delete' | 'move';

export type RemovedKind = WorkspaceFileEntryKind;

export class WorkspaceFileOperationEvent {
  constructor(resource: string, operation: 'delete', kind: WorkspaceFileEntryKind);
  constructor(resource: string, operation: 'move', kind: WorkspaceFileEntryKind, target: string);
  constructor(
    readonly resource: string,
    readonly operation: WorkspaceFileOperation,
    readonly kind: WorkspaceFileEntryKind,
    readonly target?: string,
  ) {}

  isOperation(operation: 'delete'): this is WorkspaceFileOperationEvent & {
    readonly operation: 'delete';
    readonly target: undefined;
  };
  isOperation(operation: 'move'): this is WorkspaceFileOperationEvent & {
    readonly operation: 'move';
    readonly target: string;
  };
  isOperation(operation: WorkspaceFileOperation): boolean {
    return this.operation === operation;
  }
}

type WorkspaceFileOperationListener = (event: WorkspaceFileOperationEvent) => void;
type RemovedListener = (path: string, kind: RemovedKind) => void;
type RenamedListener = (from: string, to: string, kind: RemovedKind) => void;

const operationListeners = new Set<WorkspaceFileOperationListener>();

export function emitWorkspaceFileOperation(event: WorkspaceFileOperationEvent): void {
  for (const listener of operationListeners) listener(event);
}

export function subscribeWorkspaceFileOperations(
  listener: WorkspaceFileOperationListener,
): () => void {
  operationListeners.add(listener);
  return () => {
    operationListeners.delete(listener);
  };
}

export function emitEntryRemoved(path: string, kind: RemovedKind): void {
  emitWorkspaceFileOperation(new WorkspaceFileOperationEvent(path, 'delete', kind));
}

export function subscribeEntryRemoved(listener: RemovedListener): () => void {
  return subscribeWorkspaceFileOperations((event) => {
    if (event.isOperation('delete')) listener(event.resource, event.kind);
  });
}

export function emitEntryRenamed(from: string, to: string, kind: RemovedKind): void {
  emitWorkspaceFileOperation(new WorkspaceFileOperationEvent(from, 'move', kind, to));
}

export function subscribeEntryRenamed(listener: RenamedListener): () => void {
  return subscribeWorkspaceFileOperations((event) => {
    if (event.isOperation('move')) listener(event.resource, event.target, event.kind);
  });
}
