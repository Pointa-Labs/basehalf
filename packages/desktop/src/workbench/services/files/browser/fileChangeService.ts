import { fileEventService } from '../../../../platform/files/browser/fileEventService.js';
import type {
  FileEventSubscription,
  FileEventService as PlatformFileEventService,
  WorkspaceFileEvent,
} from '../../../../platform/files/common/files.js';

type FileChangeBackend = Pick<PlatformFileEventService, 'onDidChangeFiles'>;

export type WorkbenchFileChangeEvent = WorkspaceFileEvent;
export type WorkbenchFileChangeSubscription = FileEventSubscription;

export interface WorkbenchFileChangeService {
  onDidChangeFiles(
    handler: (event: WorkbenchFileChangeEvent) => void,
  ): WorkbenchFileChangeSubscription;
}

export function createWorkbenchFileChangeService(
  backend: FileChangeBackend,
): WorkbenchFileChangeService {
  return {
    onDidChangeFiles: (handler) => backend.onDidChangeFiles(handler),
  };
}

export const workbenchFileChangeService = createWorkbenchFileChangeService(fileEventService);
