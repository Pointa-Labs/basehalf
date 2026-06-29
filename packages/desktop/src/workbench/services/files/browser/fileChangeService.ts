import { fileEventService } from '../../../../platform/files/browser/fileEventService.js';
import type {
  WorkbenchFileChangeEvent,
  WorkbenchFileChangeSubscription,
} from '../common/fileChangeTypes.js';

type FileChangeBackend = {
  onDidChangeFiles(
    handler: (event: WorkbenchFileChangeEvent) => void,
  ): WorkbenchFileChangeSubscription;
};

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
