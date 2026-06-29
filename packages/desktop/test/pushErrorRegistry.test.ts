import { describe, expect, it } from 'vitest';
import {
  PushErrorHandlerRegistry,
  registerPushErrorHandler,
  runPushErrorHandlers,
} from '../src/workbench/contrib/scm/browser/pushErrorRegistry.js';
import {
  GitError,
  GitErrorCodes,
  type GitRemoteInfo,
} from '../src/workbench/contrib/scm/common/git.js';
import type { PushErrorRepository } from '../src/workbench/contrib/scm/common/pushError.js';

const repository: PushErrorRepository = { root: '/repo', status: null };

const remote: GitRemoteInfo = {
  name: 'origin',
  fetchUrl: 'https://github.com/acme/repo.git',
  pushUrl: 'git@github.com:acme/repo.git',
  isReadOnly: false,
};

const error = new GitError({
  stderr: 'remote rejected\n',
  gitErrorCode: GitErrorCodes.PushRejected,
  gitCommand: 'push',
});

describe('PushErrorHandlerRegistry', () => {
  it('registers, enumerates, and disposes push error handlers', () => {
    const registry = new PushErrorHandlerRegistry();
    const first = { handlePushError: () => Promise.resolve(false) };
    const second = { handlePushError: () => Promise.resolve(false) };

    const disposeFirst = registerPushErrorHandler(first, registry);
    registerPushErrorHandler(second, registry);

    expect(registry.getPushErrorHandlers()).toEqual([first, second]);

    disposeFirst();

    expect(registry.getPushErrorHandlers()).toEqual([second]);
  });

  it('runs handlers in registration order until one handles the push error', async () => {
    const registry = new PushErrorHandlerRegistry();
    const calls: string[] = [];

    registerPushErrorHandler(
      {
        handlePushError: (_repository, _remote, refspec) => {
          calls.push(`first:${refspec}`);
          return Promise.resolve(false);
        },
      },
      registry,
    );
    registerPushErrorHandler(
      {
        handlePushError: (_repository, currentRemote) => {
          calls.push(`second:${currentRemote.name}`);
          return Promise.resolve(true);
        },
      },
      registry,
    );
    registerPushErrorHandler(
      {
        handlePushError: () => {
          calls.push('third');
          return Promise.resolve(true);
        },
      },
      registry,
    );

    await expect(
      runPushErrorHandlers(registry, repository, remote, 'HEAD:main', error),
    ).resolves.toBe(true);
    expect(calls).toEqual(['first:HEAD:main', 'second:origin']);
  });

  it('returns false when no registered handler consumes the push error', async () => {
    const registry = new PushErrorHandlerRegistry();
    registerPushErrorHandler({ handlePushError: () => Promise.resolve(false) }, registry);

    await expect(
      runPushErrorHandlers(registry, repository, remote, 'HEAD:main', error),
    ).resolves.toBe(false);
  });
});
