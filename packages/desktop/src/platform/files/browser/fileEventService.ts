import type { WorkspaceFileEvent } from '../common/files.js';
import { type FileEventChannel, fileEventChannel } from './fileEventChannel.js';

export type { WorkspaceFileEvent };

export type FileEventSubscription = () => void;

export interface FileEventService {
  onDidChangeFiles(handler: (event: WorkspaceFileEvent) => void): FileEventSubscription;
}

export function createFileEventService(channel: FileEventChannel): FileEventService {
  return {
    onDidChangeFiles: (handler) => channel.onDidChangeFiles(handler),
  };
}

export const fileEventService = createFileEventService(fileEventChannel);
