import { describe, expect, it, vi } from 'vitest';
import { GITHUB_IPC_CHANNELS } from '../src/workbench/contrib/githubPullRequests/common/githubPullRequests.js';
import { GithubMainChannel } from '../src/workbench/contrib/githubPullRequests/electron-main/githubMainChannel.js';
import type { GithubMainService } from '../src/workbench/contrib/githubPullRequests/electron-main/githubMainService.js';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

type Handler = (...args: unknown[]) => unknown;

function fakeIpc(): { handle: ReturnType<typeof vi.fn>; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }),
  };
}

describe('GithubMainChannel', () => {
  it('registers GitHub provider IPC handlers around the main service', async () => {
    const ipc = fakeIpc();
    const service = {
      repository: vi.fn(async () => null),
      createPullRequestUrl: vi.fn(async () => 'https://github.com/o/r/compare/topic?expand=1'),
      listRemoteSources: vi.fn(async () => []),
      listRemoteBranches: vi.fn(async () => []),
      listPullRequests: vi.fn(async () => []),
      pullRequestFiles: vi.fn(async () => []),
      reviewPullRequest: vi.fn(async () => undefined),
    } as unknown as GithubMainService;
    const getWorkspaceRoot = vi.fn(() => '/repo');
    new GithubMainChannel(service, getWorkspaceRoot, ipc).register();

    expect([...ipc.handlers.keys()]).toEqual([
      GITHUB_IPC_CHANNELS.repository,
      GITHUB_IPC_CHANNELS.createPullRequestUrl,
      GITHUB_IPC_CHANNELS.listRemoteSources,
      GITHUB_IPC_CHANNELS.listRemoteBranches,
      GITHUB_IPC_CHANNELS.listPullRequests,
      GITHUB_IPC_CHANNELS.pullRequestFiles,
      GITHUB_IPC_CHANNELS.reviewPullRequest,
    ]);

    const event = { sender: { id: 7 } };
    await expect(ipc.handlers.get(GITHUB_IPC_CHANNELS.repository)?.(event)).resolves.toBeNull();
    await expect(
      ipc.handlers.get(GITHUB_IPC_CHANNELS.createPullRequestUrl)?.(event, 'topic'),
    ).resolves.toBe('https://github.com/o/r/compare/topic?expand=1');
    await expect(
      ipc.handlers.get(GITHUB_IPC_CHANNELS.listRemoteSources)?.(event, 'basehalf'),
    ).resolves.toEqual([]);
    await expect(
      ipc.handlers.get(GITHUB_IPC_CHANNELS.listRemoteBranches)?.(
        event,
        'https://github.com/o/r.git',
      ),
    ).resolves.toEqual([]);
    await expect(
      ipc.handlers.get(GITHUB_IPC_CHANNELS.listPullRequests)?.(event, 'https://github.com/o/r.git'),
    ).resolves.toEqual([]);
    await expect(
      ipc.handlers.get(GITHUB_IPC_CHANNELS.pullRequestFiles)?.(event, {
        remoteUrl: 'https://github.com/o/r.git',
        number: 7,
      }),
    ).resolves.toEqual([]);
    await ipc.handlers.get(GITHUB_IPC_CHANNELS.reviewPullRequest)?.(event, {
      remoteUrl: 'https://github.com/o/r.git',
      number: 7,
      event: 'APPROVE',
    });

    expect(service.repository).toHaveBeenCalledWith('/repo');
    expect(service.createPullRequestUrl).toHaveBeenCalledWith('/repo', 'topic');
    expect(service.listRemoteSources).toHaveBeenCalledWith('basehalf');
    expect(service.listRemoteBranches).toHaveBeenCalledWith('https://github.com/o/r.git');
    expect(service.listPullRequests).toHaveBeenCalledWith('/repo', 'https://github.com/o/r.git');
    expect(service.pullRequestFiles).toHaveBeenCalledWith('/repo', {
      remoteUrl: 'https://github.com/o/r.git',
      number: 7,
    });
    expect(service.reviewPullRequest).toHaveBeenCalledWith('/repo', {
      remoteUrl: 'https://github.com/o/r.git',
      number: 7,
      event: 'APPROVE',
    });
    expect(getWorkspaceRoot).toHaveBeenCalledWith(event.sender);
  });
});
