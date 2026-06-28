import type { IpcRendererLike } from '../../../../platform/ipc/electron-sandbox/ipcRenderer.js';
import {
  GITHUB_IPC_CHANNELS,
  type GithubChannelBridge,
  type GithubReviewArgs,
} from '../common/githubPullRequests.js';

export interface GithubBridgeContainer {
  readonly github: GithubChannelBridge;
}

export function createGithubBridge(ipcRenderer: IpcRendererLike): GithubBridgeContainer {
  return {
    github: {
      repository: () =>
        ipcRenderer.invoke(GITHUB_IPC_CHANNELS.repository) as Promise<
          Awaited<ReturnType<GithubChannelBridge['repository']>>
        >,
      viewer: () =>
        ipcRenderer.invoke(GITHUB_IPC_CHANNELS.viewer) as Promise<
          Awaited<ReturnType<GithubChannelBridge['viewer']>>
        >,
      createPullRequestUrl: (branch) =>
        ipcRenderer.invoke(GITHUB_IPC_CHANNELS.createPullRequestUrl, branch) as Promise<
          string | null
        >,
      listPullRequests: (remoteUrl) =>
        ipcRenderer.invoke(GITHUB_IPC_CHANNELS.listPullRequests, remoteUrl) as Promise<
          Awaited<ReturnType<GithubChannelBridge['listPullRequests']>>
        >,
      pullRequestFiles: (remoteUrl, number) =>
        ipcRenderer.invoke(GITHUB_IPC_CHANNELS.pullRequestFiles, { remoteUrl, number }) as Promise<
          Awaited<ReturnType<GithubChannelBridge['pullRequestFiles']>>
        >,
      reviewPullRequest: (args: GithubReviewArgs) =>
        ipcRenderer.invoke(GITHUB_IPC_CHANNELS.reviewPullRequest, args) as Promise<void>,
      signIn: (token) =>
        ipcRenderer.invoke(GITHUB_IPC_CHANNELS.signIn, token) as Promise<string | null>,
      signOut: () => ipcRenderer.invoke(GITHUB_IPC_CHANNELS.signOut) as Promise<void>,
    },
  };
}
