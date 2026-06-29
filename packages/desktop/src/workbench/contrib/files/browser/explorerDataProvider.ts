import {
  type WorkbenchFileChangeService,
  workbenchFileChangeService,
} from '../../../services/files/browser/fileChangeService.js';
import {
  type WorkspaceContentService,
  workspaceContentService,
} from '../../../services/workspace/browser/workspaceContentService.js';
import {
  type WorkspaceFileOperationEvent,
  subscribeWorkspaceFileOperations,
} from '../../../services/workspace/common/workspaceFileEvents.js';
import type { ExplorerDataProvider, ExplorerFileOperation } from '../common/explorer.js';

type WorkspaceFileOperationSource = {
  readonly onDidRunOperation: (
    listener: (event: WorkspaceFileOperationEvent) => void,
  ) => () => void;
};

export interface WorkspaceExplorerDataProviderOptions {
  readonly workspace: Pick<WorkspaceContentService, 'listFiles'>;
  readonly fileEvents: Pick<WorkbenchFileChangeService, 'onDidChangeFiles'>;
  readonly operations: WorkspaceFileOperationSource;
}

export function toExplorerFileOperation(
  event: WorkspaceFileOperationEvent,
): ExplorerFileOperation | null {
  if (event.isOperation('create')) {
    return { type: 'create', resource: event.resource, kind: event.kind };
  }
  if (event.isOperation('delete')) {
    return { type: 'delete', resource: event.resource, kind: event.kind };
  }
  if (event.isOperation('move')) {
    return { type: 'move', resource: event.resource, target: event.target, kind: event.kind };
  }
  return null;
}

export function createWorkspaceExplorerDataProvider(
  options: WorkspaceExplorerDataProviderOptions,
): ExplorerDataProvider {
  return {
    listChildren: async (path) => {
      const result = await options.workspace.listFiles(path);
      return result.entries;
    },
    onDidChangeFiles: (listener) => options.fileEvents.onDidChangeFiles(listener),
    onDidRunOperation: (listener) =>
      options.operations.onDidRunOperation((event) => {
        const operation = toExplorerFileOperation(event);
        if (operation !== null) listener(operation);
      }),
  };
}

export const workspaceExplorerDataProvider = createWorkspaceExplorerDataProvider({
  workspace: workspaceContentService,
  fileEvents: workbenchFileChangeService,
  operations: { onDidRunOperation: subscribeWorkspaceFileOperations },
});
