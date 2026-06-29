import type { IpcRendererLike } from '../../../../platform/ipc/electron-sandbox/ipcRenderer.js';
import {
  GITHUB_IPC_CHANNELS,
  type GithubChannelBridge,
  type GithubReviewArgs,
  unwrapGithubIpcResult,
} from '../common/githubPullRequests.js';

export interface GithubBridgeContainer {
  readonly github: GithubChannelBridge;
}

export function createGithubBridge(ipcRenderer: IpcRendererLike): GithubBridgeContainer {
  return {
    github: {
      repository: () =>
        invokeGithub<Awaited<ReturnType<GithubChannelBridge['repository']>>>(
          ipcRenderer,
          GITHUB_IPC_CHANNELS.repository,
        ),
      createPullRequestUrl: (branch) =>
        invokeGithub<string | null>(ipcRenderer, GITHUB_IPC_CHANNELS.createPullRequestUrl, branch),
      branchProtection: (repositoryRoot) =>
        invokeGithub<Awaited<ReturnType<GithubChannelBridge['branchProtection']>>>(
          ipcRenderer,
          GITHUB_IPC_CHANNELS.branchProtection,
          repositoryRoot,
        ),
      listRemoteSources: (query) =>
        invokeGithub<Awaited<ReturnType<GithubChannelBridge['listRemoteSources']>>>(
          ipcRenderer,
          GITHUB_IPC_CHANNELS.listRemoteSources,
          query,
        ),
      listRemoteBranches: (remoteUrl) =>
        invokeGithub<Awaited<ReturnType<GithubChannelBridge['listRemoteBranches']>>>(
          ipcRenderer,
          GITHUB_IPC_CHANNELS.listRemoteBranches,
          remoteUrl,
        ),
      listPullRequests: (remoteUrl) =>
        invokeGithub<Awaited<ReturnType<GithubChannelBridge['listPullRequests']>>>(
          ipcRenderer,
          GITHUB_IPC_CHANNELS.listPullRequests,
          remoteUrl,
        ),
      pullRequestFiles: (remoteUrl, number) =>
        invokeGithub<Awaited<ReturnType<GithubChannelBridge['pullRequestFiles']>>>(
          ipcRenderer,
          GITHUB_IPC_CHANNELS.pullRequestFiles,
          { remoteUrl, number },
        ),
      reviewPullRequest: (args: GithubReviewArgs) =>
        invokeGithub<void>(ipcRenderer, GITHUB_IPC_CHANNELS.reviewPullRequest, args),
    },
  };
}

async function invokeGithub<T = void>(
  ipcRenderer: IpcRendererLike,
  channel: string,
  ...payload: [] | [unknown]
): Promise<T> {
  const raw =
    payload.length === 0
      ? await ipcRenderer.invoke(channel)
      : await ipcRenderer.invoke(channel, payload[0]);
  return unwrapGithubIpcResult<T>(raw);
}
