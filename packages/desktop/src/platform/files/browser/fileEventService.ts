import type { FileEventService as FileEventServiceContract } from '../common/files.js';
import { type FileEventChannel, fileEventChannel } from './fileEventChannel.js';

export type {
  FileEventService,
  FileEventSubscription,
  WorkspaceFileEvent,
} from '../common/files.js';

export function createFileEventService(channel: FileEventChannel): FileEventServiceContract {
  return {
    onDidChangeFiles: (handler) => channel.onDidChangeFiles(handler),
  };
}

export const fileEventService = createFileEventService(fileEventChannel);
