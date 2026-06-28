import type { BaseHalfSandboxApi } from '../../../code/electron-sandbox/sandboxApi.js';
import { createLazySandboxChannel } from '../../ipc/browser/sandboxApi.js';
import type { FileEventSubscription, WorkspaceFileEvent } from './fileEventService.js';

export interface FileEventChannel {
  onDidChangeFiles(handler: (event: WorkspaceFileEvent) => void): FileEventSubscription;
}

export function createFileEventChannel(bridge: BaseHalfSandboxApi): FileEventChannel {
  return {
    onDidChangeFiles: (handler) => bridge.onFileEvent(handler),
  };
}

export const fileEventChannel: FileEventChannel = createLazySandboxChannel(createFileEventChannel);
