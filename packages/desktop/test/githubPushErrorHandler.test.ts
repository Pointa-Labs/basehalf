import { describe, expect, it } from 'vitest';
import {
  GithubPushErrorHandler,
  GithubPushErrorKinds,
  classifyGithubPushError,
  createGithubPushErrorDelegate,
  parseGithubRemoteUrl,
  registerGithubPushErrorHandler,
} from '../src/workbench/contrib/githubPullRequests/browser/pushErrorHandler.js';
import { PushErrorHandlerRegistry } from '../src/workbench/contrib/scm/browser/pushErrorRegistry.js';
import {
  GitError,
  type GitErrorCode,
  GitErrorCodes,
  type GitRemoteInfo,
} from '../src/workbench/contrib/scm/common/git.js';
import type { PushErrorRepository } from '../src/workbench/contrib/scm/common/pushError.js';

const repository: PushErrorRepository = { root: '/repo', status: null };

function remote(pushUrl: string | null = 'https://github.com/acme/basehalf.git'): GitRemoteInfo {
  return {
    name: 'origin',
    fetchUrl: 'https://github.com/acme/basehalf.git',
    ...(pushUrl !== null && { pushUrl }),
    isReadOnly: pushUrl === null,
  };
}

function gitError(gitErrorCode: GitErrorCode, stderr = ''): GitError {
  return new GitError({
    stderr,
    gitErrorCode,
    gitCommand: 'push',
  });
}

describe('GitHub push error handler', () => {
  it('parses GitHub HTTPS, SSH, and ssh:// remote URLs', () => {
    expect(parseGithubRemoteUrl('https://github.com/acme/basehalf.git')).toEqual({
      owner: 'acme',
      repo: 'basehalf',
    });
    expect(parseGithubRemoteUrl('git@github.com:acme/basehalf.git')).toEqual({
      owner: 'acme',
      repo: 'basehalf',
    });
    expect(parseGithubRemoteUrl('ssh://git@github.com/acme/basehalf.git')).toEqual({
      owner: 'acme',
      repo: 'basehalf',
    });
    expect(parseGithubRemoteUrl('https://example.com/acme/basehalf.git')).toBeNull();
  });

  it('classifies GitHub permission-denied push failures', () => {
    expect(
      classifyGithubPushError(
        remote('git@github.com:pointa-labs/basehalf.git'),
        'HEAD:main',
        gitError(GitErrorCodes.PermissionDenied, 'git@github.com: Permission denied.\n'),
      ),
    ).toEqual({
      kind: GithubPushErrorKinds.PermissionDenied,
      owner: 'pointa-labs',
      repo: 'basehalf',
      remoteName: 'origin',
      remoteUrl: 'git@github.com:pointa-labs/basehalf.git',
      refspec: 'HEAD:main',
      stderr: 'git@github.com: Permission denied.\n',
    });
  });

  it('classifies GitHub secret-scanning push protection failures', () => {
    const stderr = [
      'remote: error GH009: Secrets detected!',
      'error: failed to push some refs to github.com:acme/basehalf.git',
    ].join('\n');

    expect(
      classifyGithubPushError(remote(), 'HEAD:main', gitError(GitErrorCodes.PushRejected, stderr)),
    ).toMatchObject({
      kind: GithubPushErrorKinds.PushProtection,
      owner: 'acme',
      repo: 'basehalf',
      stderr,
    });
  });

  it('ignores non-GitHub remotes, delete refspecs, and unrelated push failures', () => {
    expect(
      classifyGithubPushError(
        remote('https://example.com/acme/basehalf.git'),
        'HEAD:main',
        gitError(GitErrorCodes.PermissionDenied),
      ),
    ).toBeNull();
    expect(
      classifyGithubPushError(remote(), ':main', gitError(GitErrorCodes.PermissionDenied)),
    ).toBeNull();
    expect(
      classifyGithubPushError(remote(null), 'HEAD:main', gitError(GitErrorCodes.PermissionDenied)),
    ).toBeNull();
    expect(
      classifyGithubPushError(
        remote(),
        'HEAD:main',
        gitError(GitErrorCodes.PushRejected, 'error: failed to push some refs\n'),
      ),
    ).toBeNull();
    expect(
      classifyGithubPushError(
        remote(),
        'HEAD:main',
        gitError(GitErrorCodes.RemoteConnectionError, 'remote: error GH009: Secrets detected!\n'),
      ),
    ).toBeNull();
  });

  it('delegates classified GitHub push errors and returns the delegate result', async () => {
    const handled: unknown[] = [];
    const handler = new GithubPushErrorHandler({
      handleGithubPushError: (error, currentRepository) => {
        handled.push({ error, repository: currentRepository });
        return true;
      },
    });

    await expect(
      handler.handlePushError(
        repository,
        remote(),
        'HEAD:main',
        gitError(GitErrorCodes.PermissionDenied),
      ),
    ).resolves.toBe(true);

    expect(handled).toHaveLength(1);
    expect(handled[0]).toMatchObject({
      error: { kind: GithubPushErrorKinds.PermissionDenied, owner: 'acme', repo: 'basehalf' },
      repository,
    });
  });

  it('provides a default delegate that reports GitHub-specific push failures', async () => {
    const messages: string[] = [];
    const delegate = createGithubPushErrorDelegate({
      toastError: (message) => messages.push(message),
    });

    await expect(
      Promise.resolve(
        delegate.handleGithubPushError(
          {
            kind: GithubPushErrorKinds.PushProtection,
            owner: 'acme',
            repo: 'basehalf',
            remoteName: 'origin',
            remoteUrl: 'https://github.com/acme/basehalf.git',
            refspec: 'HEAD:main',
            stderr: 'remote: error GH009: Secrets detected!',
          },
          repository,
        ),
      ),
    ).resolves.toBe(true);

    expect(messages).toEqual([
      'Your push to "acme/basehalf" was rejected by GitHub push protection because one or more secrets were detected.',
    ]);
  });

  it('registers the GitHub push error handler with the SCM registry', () => {
    const registry = new PushErrorHandlerRegistry();
    const handler = new GithubPushErrorHandler({ handleGithubPushError: async () => true });

    const dispose = registerGithubPushErrorHandler(registry, handler);

    expect(registry.getPushErrorHandlers()).toEqual([handler]);

    dispose();
    expect(registry.getPushErrorHandlers()).toEqual([]);
  });

  it('does not delegate unclassified push errors', async () => {
    const handler = new GithubPushErrorHandler({
      handleGithubPushError: () => {
        throw new Error('unexpected delegate call');
      },
    });

    await expect(
      handler.handlePushError(
        repository,
        remote(),
        'HEAD:main',
        gitError(GitErrorCodes.PushRejected, 'error: failed to push some refs\n'),
      ),
    ).resolves.toBe(false);
  });
});
