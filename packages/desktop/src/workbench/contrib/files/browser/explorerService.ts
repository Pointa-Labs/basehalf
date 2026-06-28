import type { WorkspaceListFilesEntry } from '../../../../platform/workspaces/common/workspaces.js';
import type {
  ExplorerDataProvider,
  ExplorerFileOperation,
  ExplorerService as ExplorerServiceContract,
  ExplorerTreeMutation,
  ExplorerTreeState,
} from '../common/explorer.js';
import {
  affectedLoadedExplorerDirectories,
  applyExplorerFileEvent,
  applyExplorerFileOperation,
} from '../common/explorerTreeMutations.js';
import { workspaceExplorerDataProvider } from './explorerDataProvider.js';

export class WorkbenchExplorerService implements ExplorerServiceContract {
  constructor(private readonly provider: ExplorerDataProvider) {}

  resolveChildren(path: string): Promise<readonly WorkspaceListFilesEntry[]> {
    return this.provider.listChildren(path);
  }

  onDidChangeFiles: ExplorerServiceContract['onDidChangeFiles'] = (listener) =>
    this.provider.onDidChangeFiles(listener);

  onDidRunOperation: ExplorerServiceContract['onDidRunOperation'] = (listener) =>
    this.provider.onDidRunOperation(listener);

  affectedLoadedDirectories({
    rootPath,
    childrenByPath,
    event,
  }: Parameters<ExplorerServiceContract['affectedLoadedDirectories']>[0]): readonly string[] {
    return affectedLoadedExplorerDirectories({ rootPath, childrenByPath, event });
  }

  applyFileOperation(
    state: ExplorerTreeState,
    operation: ExplorerFileOperation,
  ): ExplorerTreeMutation {
    return applyExplorerFileOperation(state, operation);
  }

  applyFileEvent(
    state: ExplorerTreeState,
    event: Parameters<ExplorerServiceContract['applyFileEvent']>[1],
  ): ExplorerTreeMutation | null {
    return applyExplorerFileEvent(state, event);
  }
}

export function createExplorerService(
  provider: ExplorerDataProvider = workspaceExplorerDataProvider,
): ExplorerServiceContract {
  return new WorkbenchExplorerService(provider);
}

export const explorerService = createExplorerService();
