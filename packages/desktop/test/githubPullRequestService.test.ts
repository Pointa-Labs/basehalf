import { describe, expect, it } from 'vitest';
import type { GithubChannel } from '../src/workbench/contrib/githubPullRequests/browser/githubChannel.js';
import { createGithubPullRequestService } from '../src/workbench/contrib/githubPullRequests/browser/githubPullRequestService.js';

describe('githubPullRequestService', () => {
  it('maps repository and viewer commands into service methods', async () => {
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
      viewer: async () => {
        calls.push({ name: 'viewer', args: {} });
        return 'ada';
      },
      createPullRequestUrl: async (branch) => {
        calls.push({ name: 'createPullRequestUrl', args: { branch } });
        return 'https://github.com/o/r/compare/x';
      },
    } as GithubChannel);

    expect(await service.repository()).toMatchObject({ owner: 'o', repo: 'r' });
    expect(await service.viewer()).toBe('ada');
    expect(await service.createPullRequestUrl('topic')).toBe('https://github.com/o/r/compare/x');
    expect(calls).toEqual([
      { name: 'repository', args: {} },
      { name: 'viewer', args: {} },
      { name: 'createPullRequestUrl', args: { branch: 'topic' } },
    ]);
  });

  it('maps pull request list, files, review, and account commands', async () => {
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
      signIn: async (token) => {
        calls.push({ name: 'signIn', args: { token } });
        return 'ada';
      },
      signOut: async () => {
        calls.push({ name: 'signOut', args: {} });
      },
    } as GithubChannel);

    expect(await service.listPullRequests('remote')).toHaveLength(1);
    expect(await service.pullRequestFiles('remote', 7)).toHaveLength(1);
    await service.reviewPullRequest({ remoteUrl: 'remote', number: 7, event: 'APPROVE' });
    expect(await service.signIn('tok')).toBe('ada');
    await service.signOut();

    expect(calls).toEqual([
      { name: 'listPullRequests', args: { remoteUrl: 'remote' } },
      { name: 'pullRequestFiles', args: { remoteUrl: 'remote', number: 7 } },
      {
        name: 'reviewPullRequest',
        args: { remoteUrl: 'remote', number: 7, event: 'APPROVE' },
      },
      { name: 'signIn', args: { token: 'tok' } },
      { name: 'signOut', args: {} },
    ]);
  });

  it('emits authentication changes after successful sign-in and sign-out', async () => {
    const events: string[] = [];
    const service = createGithubPullRequestService({
      signIn: async () => 'ada',
      signOut: async () => {},
    } as GithubChannel);
    const unsubscribe = service.onDidChangeAuthentication?.(() => events.push('auth'));

    expect(await service.signIn('tok')).toBe('ada');
    await service.signOut();
    unsubscribe?.();
    await service.signOut();

    expect(events).toEqual(['auth', 'auth']);
  });
});
