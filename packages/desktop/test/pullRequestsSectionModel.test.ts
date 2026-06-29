import { describe, expect, it } from 'vitest';
import type { GithubPullRequestProvider } from '../src/workbench/contrib/githubPullRequests/browser/githubPullRequestService.js';
import {
  loadPullRequests,
  loginFromAuthenticationSessions,
  pullRequestEditorInput,
  resolvePullRequestRepository,
  shouldLoadPullRequests,
} from '../src/workbench/contrib/githubPullRequests/browser/pullRequestsSectionModel.js';
import type { GithubRemoteRepository } from '../src/workbench/contrib/githubPullRequests/common/githubPullRequests.js';
import type { PublicAuthenticationSession } from '../src/workbench/services/authentication/common/authentication.js';

const repo: GithubRemoteRepository = {
  remoteName: 'origin',
  remoteUrl: 'https://github.com/o/r.git',
  owner: 'o',
  repo: 'r',
  webUrl: 'https://github.com/o/r',
  isReadOnly: false,
};

function provider(overrides: Partial<GithubPullRequestProvider> = {}): GithubPullRequestProvider {
  return {
    id: 'github',
    name: 'GitHub',
    provideRepository: async () => repo,
    createPullRequestUrl: async () => null,
    providePullRequests: async () => [],
    providePullRequestFiles: async () => [],
    reviewPullRequest: async () => {},
    ...overrides,
  };
}

describe('pullRequestsSectionModel', () => {
  it('resolves repository without owning authentication', async () => {
    await expect(resolvePullRequestRepository(provider())).resolves.toEqual(repo);

    await expect(
      resolvePullRequestRepository(
        provider({
          provideRepository: async () => {
            throw new Error('not a github repo');
          },
        }),
      ),
    ).resolves.toBeNull();
  });

  it('maps authentication sessions into the section login state', () => {
    const session: PublicAuthenticationSession = {
      id: 'github',
      providerId: 'github',
      account: { id: 'ada', label: 'ada' },
      scopes: ['repo'],
    };

    expect(loginFromAuthenticationSessions([session])).toBe('ada');
    expect(loginFromAuthenticationSessions([])).toBeNull();
  });

  it('loads pull requests only for an open signed-in github repository section', () => {
    expect(shouldLoadPullRequests(repo, 'ada', true)).toBe(true);
    expect(shouldLoadPullRequests(repo, null, true)).toBe(false);
    expect(shouldLoadPullRequests(null, 'ada', true)).toBe(false);
    expect(shouldLoadPullRequests(repo, 'ada', false)).toBe(false);
  });

  it('maps provider success and failure into view state', async () => {
    await expect(
      loadPullRequests(
        provider({
          providePullRequests: async () => [
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
          ],
        }),
        repo.remoteUrl,
      ),
    ).resolves.toMatchObject({ pullRequests: [{ number: 7 }], error: null });

    await expect(
      loadPullRequests(
        provider({
          providePullRequests: async () => {
            throw new Error('bad credentials');
          },
        }),
        repo.remoteUrl,
      ),
    ).resolves.toEqual({ pullRequests: [], error: 'bad credentials' });
  });

  it('maps a GitHub pull request into the workspace PR editor input', () => {
    expect(
      pullRequestEditorInput(repo, {
        number: 7,
        title: 'Ship',
        author: 'ada',
        state: 'open',
        draft: false,
        headRef: 'topic',
        baseRef: 'main',
        url: 'https://github.com/o/r/pull/7',
        updatedAt: '2026-06-28T00:00:00Z',
      }),
    ).toEqual({
      number: 7,
      title: 'Ship',
      remoteUrl: 'https://github.com/o/r.git',
      url: 'https://github.com/o/r/pull/7',
    });
  });
});
