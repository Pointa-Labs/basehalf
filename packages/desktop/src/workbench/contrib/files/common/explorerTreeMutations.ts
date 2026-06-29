import type { WorkbenchFileChangeEvent } from '../../../services/files/common/fileChangeTypes.js';
import type { ExplorerFileOperation, ExplorerTreeMutation, ExplorerTreeState } from './explorer.js';
import {
  addNavEntryOptimistically,
  moveNavEntryOptimistically,
  parentAbsPath,
  removeNavEntryOptimistically,
} from './navTreeModel.js';

export const isMirrorControlPath = (relPath: string): boolean =>
  relPath === '.bh' || relPath.startsWith('.bh/');

export function affectedLoadedExplorerDirectories({
  rootPath,
  childrenByPath,
  event,
}: {
  readonly rootPath: string;
  readonly childrenByPath: ExplorerTreeState['childrenByPath'];
  readonly event: WorkbenchFileChangeEvent;
}): readonly string[] {
  const affectedRelPaths =
    event.type === 'rename' ? [event.fromRelPath, event.toRelPath] : [event.relPath];
  const affected = new Set<string>();
  for (const relPath of affectedRelPaths) {
    if (isMirrorControlPath(relPath)) continue;
    const parentAbs = parentAbsPath(rootPath, relPath);
    if (childrenByPath.has(parentAbs)) affected.add(parentAbs);
  }
  return [...affected];
}

export function applyExplorerFileOperation(
  state: ExplorerTreeState,
  operation: ExplorerFileOperation,
): ExplorerTreeMutation {
  switch (operation.type) {
    case 'create':
      return addNavEntryOptimistically({
        childrenByPath: state.childrenByPath,
        expanded: state.expanded,
        rootPath: state.rootPath,
        rel: operation.resource,
        kind: operation.kind,
      });
    case 'delete':
      return removeNavEntryOptimistically({
        childrenByPath: state.childrenByPath,
        expanded: state.expanded,
        rootPath: state.rootPath,
        rel: operation.resource,
      });
    case 'move':
      return moveNavEntryOptimistically({
        childrenByPath: state.childrenByPath,
        expanded: state.expanded,
        rootPath: state.rootPath,
        from: operation.resource,
        to: operation.target,
        kind: operation.kind,
      });
  }
}

export function applyExplorerFileEvent(
  state: ExplorerTreeState,
  event: WorkbenchFileChangeEvent,
): ExplorerTreeMutation | null {
  if (event.type === 'unlink') {
    if (isMirrorControlPath(event.relPath)) return null;
    return removeNavEntryOptimistically({
      childrenByPath: state.childrenByPath,
      expanded: state.expanded,
      rootPath: state.rootPath,
      rel: event.relPath,
    });
  }
  if (event.type === 'rename') {
    if (isMirrorControlPath(event.fromRelPath) || isMirrorControlPath(event.toRelPath)) {
      return null;
    }
    return moveNavEntryOptimistically({
      childrenByPath: state.childrenByPath,
      expanded: state.expanded,
      rootPath: state.rootPath,
      from: event.fromRelPath,
      to: event.toRelPath,
      kind: event.isDir ? 'folder' : 'file',
    });
  }
  if (event.type === 'add') {
    if (isMirrorControlPath(event.relPath)) return null;
    return addNavEntryOptimistically({
      childrenByPath: state.childrenByPath,
      expanded: state.expanded,
      rootPath: state.rootPath,
      rel: event.relPath,
      kind: event.isDir ? 'folder' : 'file',
    });
  }
  return null;
}
