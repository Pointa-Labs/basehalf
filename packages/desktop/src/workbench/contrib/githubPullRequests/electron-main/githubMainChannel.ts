import { type WebContents, ipcMain } from 'electron';
import {
  GITHUB_IPC_CHANNELS,
  githubIpcFailure,
  githubIpcSuccess,
} from '../common/githubPullRequests.js';
import type { GithubMainService } from './githubMainService.js';

type GithubIpcHandler = (event: GithubIpcEvent, payload?: unknown) => unknown;

export interface IpcMainGithubLike {
  handle(channel: string, listener: GithubIpcHandler): void;
}

export type GithubWorkspaceRootResolver = (sender: WebContents) => string | null;

interface GithubIpcEvent {
  readonly sender: WebContents;
}

/**
 * IPC channel for the GitHub provider. GitHub API calls and credentials stay in
 * main; renderer SCM views consume this explicit provider channel through the
 * same typed IPC shape as the Git provider.
 */
export class GithubMainChannel {
  constructor(
    private readonly github: GithubMainService,
    private readonly getWorkspaceRoot: GithubWorkspaceRootResolver,
    private readonly ipc: IpcMainGithubLike = ipcMain,
  ) {}

  register(): void {
    this.handle(GITHUB_IPC_CHANNELS.repository, (event) =>
      this.github.repository(this.getWorkspaceRoot(event.sender)),
    );
    this.handle(GITHUB_IPC_CHANNELS.createPullRequestUrl, (event, branch) =>
      this.github.createPullRequestUrl(this.getWorkspaceRoot(event.sender), branch),
    );
    this.handle(GITHUB_IPC_CHANNELS.listRemoteSources, (_event, query) =>
      this.github.listRemoteSources(query),
    );
    this.handle(GITHUB_IPC_CHANNELS.listRemoteBranches, (_event, remoteUrl) =>
      this.github.listRemoteBranches(remoteUrl),
    );
    this.handle(GITHUB_IPC_CHANNELS.listPullRequests, (event, remoteUrl) =>
      this.github.listPullRequests(this.getWorkspaceRoot(event.sender), remoteUrl),
    );
    this.handle(GITHUB_IPC_CHANNELS.pullRequestFiles, (event, payload) =>
      this.github.pullRequestFiles(this.getWorkspaceRoot(event.sender), payload),
    );
    this.handle(GITHUB_IPC_CHANNELS.reviewPullRequest, (event, payload) =>
      this.github.reviewPullRequest(this.getWorkspaceRoot(event.sender), payload),
    );
  }

  private handle(channel: string, listener: GithubIpcHandler): void {
    this.ipc.handle(channel, async (event, payload) => {
      try {
        return githubIpcSuccess(await listener(event, payload));
      } catch (err) {
        return githubIpcFailure(err);
      }
    });
  }
}
