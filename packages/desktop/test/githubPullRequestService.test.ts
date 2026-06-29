import { describe, expect, it } from 'vitest';
import type { GithubChannel } from '../src/workbench/contrib/githubPullRequests/browser/githubChannel.js';
import {
  createGithubPullRequestProvider,
  createGithubPullRequestService,
} from '../src/workbench/contrib/githubPullRequests/browser/githubPullRequestService.js';

describe('githubPullRequestService', () => {
  it('maps repository and pull request creation commands into service methods', async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const service = createGithubPullRequestService({
      repository: async () => {
        calls.push({ name: 'repository', args: {} });
        return {
          remoteName: 'origin',
          remoteUrl: 'https://github.com/o/r.git',
          owner: 'o',
          repo: 'r',
          webUrl: 'https://github.com/o/r',
          isReadOnly: false,
        };
      },
      createPullRequestUrl: async (branch) => {
        calls.push({ name: 'createPullRequestUrl', args: { branch } });
        return 'https://github.com/o/r/compare/x';
      },
    } as GithubChannel);

    expect(await service.repository()).toMatchObject({ owner: 'o', repo: 'r' });
    expect(await service.createPullRequestUrl('topic')).toBe('https://github.com/o/r/compare/x');
    expect(calls).toEqual([
      { name: 'repository', args: {} },
      { name: 'createPullRequestUrl', args: { branch: 'topic' } },
    ]);
  });

  it('maps pull request list, files, and review commands', async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const service = createGithubPullRequestService({
      listPullRequests: async (remoteUrl) => {
        calls.push({ name: 'listPullRequests', args: { remoteUrl } });
        return [
          {
            number: 7,
            title: 'Ship',
            author: 'ada',
            state: 'open',
            draft: false,
            headRef: 'topic',
            baseRef: 'main',
            url: 'https://github.com/o/r/pull/7',
            updatedAt: '2026-06-28T00:00:00Z',
          },
        ];
      },
      pullRequestFiles: async (remoteUrl, number) => {
        calls.push({ name: 'pullRequestFiles', args: { remoteUrl, number } });
        return [{ filename: 'a.ts', status: 'modified', additions: 1, deletions: 0 }];
      },
      reviewPullRequest: async (args) => {
        calls.push({ name: 'reviewPullRequest', args });
      },
    } as GithubChannel);

    expect(await service.listPullRequests('remote')).toHaveLength(1);
    expect(await service.pullRequestFiles('remote', 7)).toHaveLength(1);
    await service.reviewPullRequest({ remoteUrl: 'remote', number: 7, event: 'APPROVE' });

    expect(calls).toEqual([
      { name: 'listPullRequests', args: { remoteUrl: 'remote' } },
      { name: 'pullRequestFiles', args: { remoteUrl: 'remote', number: 7 } },
      {
        name: 'reviewPullRequest',
        args: { remoteUrl: 'remote', number: 7, event: 'APPROVE' },
      },
    ]);
  });

  it('wraps the IPC service as the GitHub pull request provider surface', async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const provider = createGithubPullRequestProvider({
      repository: async () => {
        calls.push({ name: 'repository', args: {} });
        return null;
      },
      createPullRequestUrl: async (branch) => {
        calls.push({ name: 'createPullRequestUrl', args: { branch } });
        return null;
      },
      listPullRequests: async (remoteUrl) => {
        calls.push({ name: 'listPullRequests', args: { remoteUrl } });
        return [];
      },
      pullRequestFiles: async (remoteUrl, number) => {
        calls.push({ name: 'pullRequestFiles', args: { remoteUrl, number } });
        return [];
      },
      reviewPullRequest: async (args) => {
        calls.push({ name: 'reviewPullRequest', args });
      },
    });

    expect(provider.id).toBe('github');
    expect(provider.name).toBe('GitHub');
    await expect(provider.provideRepository()).resolves.toBeNull();
    await expect(provider.createPullRequestUrl('topic')).resolves.toBeNull();
    await expect(provider.providePullRequests('remote')).resolves.toEqual([]);
    await expect(provider.providePullRequestFiles('remote', 7)).resolves.toEqual([]);
    await provider.reviewPullRequest({ remoteUrl: 'remote', number: 7, event: 'APPROVE' });

    expect(calls).toEqual([
      { name: 'repository', args: {} },
      { name: 'createPullRequestUrl', args: { branch: 'topic' } },
      { name: 'listPullRequests', args: { remoteUrl: 'remote' } },
      { name: 'pullRequestFiles', args: { remoteUrl: 'remote', number: 7 } },
      {
        name: 'reviewPullRequest',
        args: { remoteUrl: 'remote', number: 7, event: 'APPROVE' },
      },
    ]);
  });

  it('preserves provider error messages for renderer callers', async () => {
    const service = createGithubPullRequestService({
      listPullRequests: async () => {
        throw new Error('Not signed in to GitHub. Sign in from Settings.');
      },
    } as GithubChannel);
    const provider = createGithubPullRequestProvider(service);

    await expect(provider.providePullRequests('remote')).rejects.toThrow(
      'Not signed in to GitHub. Sign in from Settings.',
    );
  });
});
