import type { BaseHalfSandboxApi } from '../../../code/electron-sandbox/sandboxApi.js';
import { createLazySandboxChannel } from '../../ipc/browser/sandboxApi.js';
import type { FileEventChannelBridge } from '../common/files.js';

export interface FileEventChannel extends FileEventChannelBridge {}

export function createFileEventChannel(bridge: BaseHalfSandboxApi): FileEventChannel {
  return {
    onDidChangeFiles: (handler) => bridge.onFileEvent(handler),
  };
}

export const fileEventChannel: FileEventChannel = createLazySandboxChannel(createFileEventChannel);
