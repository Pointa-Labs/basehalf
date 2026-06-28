import { fileEventService } from '../../../../platform/files/browser/fileEventService.js';
import { workspaceService } from '../../../../platform/workspaces/browser/workspaceService.js';
import type { WorkspaceService } from '../../../../platform/workspaces/common/workspaces.js';
import {
  type WorkspaceFileOperationEvent,
  subscribeWorkspaceFileOperations,
} from '../../../services/workspace/browser/workspaceFileEvents.js';
import type { ExplorerDataProvider, ExplorerFileOperation } from '../common/explorer.js';

type FileEventSource = Pick<typeof fileEventService, 'onDidChangeFiles'>;
type WorkspaceFileOperationSource = {
  readonly onDidRunOperation: (
    listener: (event: WorkspaceFileOperationEvent) => void,
  ) => () => void;
};

export interface WorkspaceExplorerDataProviderOptions {
  readonly workspace: Pick<WorkspaceService, 'listFiles'>;
  readonly fileEvents: FileEventSource;
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
  workspace: workspaceService,
  fileEvents: fileEventService,
  operations: { onDidRunOperation: subscribeWorkspaceFileOperations },
});
