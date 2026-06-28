import type { BaseHalfSandboxApi } from '../../../../code/electron-sandbox/sandboxApi.js';
import { createLazySandboxChannel } from '../../../../platform/ipc/browser/sandboxApi.js';
import type { GithubChannelBridge } from '../common/githubPullRequests.js';

export interface GithubChannel extends GithubChannelBridge {}

export function createGithubChannel(bridge: BaseHalfSandboxApi): GithubChannel {
  return bridge.github;
}

export const githubChannel: GithubChannel = createLazySandboxChannel(createGithubChannel);
