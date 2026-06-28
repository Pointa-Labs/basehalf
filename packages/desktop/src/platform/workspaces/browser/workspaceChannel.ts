import type { BaseHalfSandboxApi } from '../../../code/electron-sandbox/sandboxApi.js';
import { createLazySandboxChannel } from '../../ipc/browser/sandboxApi.js';
import type { WorkspaceChannelBridge } from '../common/workspaces.js';

export interface WorkspaceChannel extends WorkspaceChannelBridge {}

export function createWorkspaceChannel(bridge: BaseHalfSandboxApi): WorkspaceChannel {
  return bridge.workspace;
}

export const workspaceChannel: WorkspaceChannel = createLazySandboxChannel(createWorkspaceChannel);
