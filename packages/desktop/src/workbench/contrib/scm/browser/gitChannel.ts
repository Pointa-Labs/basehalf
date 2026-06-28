import type { BaseHalfSandboxApi } from '../../../../code/electron-sandbox/sandboxApi.js';
import { createLazySandboxChannel } from '../../../../platform/ipc/browser/sandboxApi.js';
import type { GitChannelBridge } from '../common/git.js';

export interface GitChannel extends GitChannelBridge {}

export function createGitChannel(bridge: BaseHalfSandboxApi): GitChannel {
  return bridge.git;
}

export const gitChannel: GitChannel = createLazySandboxChannel(createGitChannel);
