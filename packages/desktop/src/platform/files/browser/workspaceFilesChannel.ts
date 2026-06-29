import type { BaseHalfSandboxApi } from '../../../code/electron-sandbox/sandboxApi.js';
import { createLazySandboxChannel } from '../../ipc/browser/sandboxApi.js';
import type { WorkspaceFilesChannelBridge } from '../common/workspaceFiles.js';

export interface WorkspaceFilesChannel extends WorkspaceFilesChannelBridge {}

export function createWorkspaceFilesChannel(bridge: BaseHalfSandboxApi): WorkspaceFilesChannel {
  return bridge.files;
}

export const workspaceFilesChannel: WorkspaceFilesChannel = createLazySandboxChannel(
  createWorkspaceFilesChannel,
);
