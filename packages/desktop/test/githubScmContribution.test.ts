import { describe, expect, it, vi } from 'vitest';
import type { GithubPullRequestService } from '../src/workbench/contrib/githubPullRequests/browser/githubPullRequestService.js';
import { createGithubPullRequest } from '../src/workbench/contrib/githubPullRequests/browser/githubScmContribution.js';
import type { GitStatusResult } from '../src/workbench/contrib/scm/common/git.js';

function status(overrides: Partial<GitStatusResult> = {}): GitStatusResult {
  return {
    isRepo: true,
    branch: 'topic',
    detached: false,
    upstream: 'origin/topic',
    ahead: 0,
    behind: 0,
    files: [],
    ...overrides,
  };
}

function service(overrides: Partial<GithubPullRequestService> = {}): GithubPullRequestService {
  return {
    repository: async () => null,
    createPullRequestUrl: async () => 'https://github.com/o/r/compare/topic?expand=1',
    listPullRequests: async () => [],
    pullRequestFiles: async () => [],
    reviewPullRequest: async () => {},
    ...overrides,
  };
}

describe('githubScmContribution', () => {
  it('requires a current branch before asking GitHub for a pull request URL', async () => {
    const createPullRequestUrl = vi.fn();
    const openExternal = vi.fn();
    const toastError = vi.fn();

    await createGithubPullRequest({
      status: status({ branch: null }),
      service: service({ createPullRequestUrl }),
      openExternal,
      toastError,
    });

    expect(createPullRequestUrl).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      'A current branch is required to create a pull request.',
    );
  });

  it('surfaces a missing GitHub remote without opening the browser', async () => {
    const openExternal = vi.fn();
    const toastError = vi.fn();

    await createGithubPullRequest({
      status: status(),
      service: service({ createPullRequestUrl: async () => null }),
      openExternal,
      toastError,
    });

    expect(openExternal).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('No GitHub remote is configured.');
  });

  it('opens the GitHub pull request compare URL for the current branch', async () => {
    const openExternal = vi.fn(async () => ({ ok: true }));
    const selectPublishRemote = vi.fn();
    const toastError = vi.fn();

    await createGithubPullRequest({
      status: status({ branch: 'feature/a' }),
      service: service({
        createPullRequestUrl: async (branch) => `https://github.com/o/r/compare/${branch}?expand=1`,
      }),
      selectPublishRemote,
      openExternal,
      toastError,
    });

    expect(openExternal).toHaveBeenCalledWith('https://github.com/o/r/compare/feature/a?expand=1');
    expect(selectPublishRemote).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('publishes an unpublished branch before asking GitHub for the pull request URL', async () => {
    const calls: string[] = [];
    const url = 'https://github.com/o/r/compare/topic?expand=1';
    const git = {
      remotes: async () => ({ remotes: [] }),
      publish: async (options?: { remote?: string }) => {
        calls.push(`publish:${options?.remote ?? ''}`);
      },
    };
    const selectPublishRemote = vi.fn(async (passedGit) => {
      expect(passedGit).toBe(git);
      calls.push('pick');
      return 'origin';
    });
    const createPullRequestUrl = vi.fn(async (branch: string) => {
      calls.push(`url:${branch}`);
      return url;
    });
    const openExternal = vi.fn(async (openedUrl: string) => {
      calls.push(`open:${openedUrl}`);
      return { ok: true };
    });
    const toastError = vi.fn();

    await createGithubPullRequest({
      status: status({ upstream: null }),
      service: service({ createPullRequestUrl }),
      git,
      selectPublishRemote,
      openExternal,
      toastError,
    });

    expect(calls).toEqual(['pick', 'publish:origin', 'url:topic', `open:${url}`]);
    expect(createPullRequestUrl).toHaveBeenCalledWith('topic');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('does not open a pull request when publish remote selection is cancelled', async () => {
    const createPullRequestUrl = vi.fn();
    const publish = vi.fn();
    const openExternal = vi.fn();
    const toastError = vi.fn();

    await createGithubPullRequest({
      status: status({ upstream: null }),
      service: service({ createPullRequestUrl }),
      git: {
        remotes: async () => ({ remotes: [] }),
        publish,
      },
      selectPublishRemote: async () => null,
      openExternal,
      toastError,
    });

    expect(publish).not.toHaveBeenCalled();
    expect(createPullRequestUrl).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('surfaces publish failures without opening the pull request URL', async () => {
    const createPullRequestUrl = vi.fn();
    const openExternal = vi.fn();
    const toastError = vi.fn();

    await createGithubPullRequest({
      status: status({ upstream: null }),
      service: service({ createPullRequestUrl }),
      git: {
        remotes: async () => ({ remotes: [] }),
        publish: async () => {
          throw new Error('publish failed');
        },
      },
      selectPublishRemote: async () => 'origin',
      openExternal,
      toastError,
    });

    expect(createPullRequestUrl).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('publish failed');
  });

  it('surfaces native browser-open failures', async () => {
    const toastError = vi.fn();

    await createGithubPullRequest({
      status: status(),
      service: service(),
      openExternal: async () => ({ ok: false, error: 'blocked' }),
      toastError,
    });

    expect(toastError).toHaveBeenCalledWith('blocked');
  });

  it('surfaces GitHub provider failures', async () => {
    const openExternal = vi.fn();
    const toastError = vi.fn();

    await createGithubPullRequest({
      status: status(),
      service: service({
        createPullRequestUrl: async () => {
          throw new Error('bad credentials');
        },
      }),
      openExternal,
      toastError,
    });

    expect(openExternal).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('bad credentials');
  });
});
