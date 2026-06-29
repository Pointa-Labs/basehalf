import { describe, expect, it, vi } from 'vitest';
import {
  GIT_IPC_CHANNELS,
  GitError,
  GitErrorCodes,
  unwrapGitIpcResult,
} from '../src/workbench/contrib/scm/common/git.js';
import { GitMainChannel } from '../src/workbench/contrib/scm/electron-main/gitMainChannel.js';
import type { GitMainService } from '../src/workbench/contrib/scm/electron-main/gitMainService.js';

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

async function invokeGitHandler<T>(handler: Handler | undefined, ...args: unknown[]): Promise<T> {
  return unwrapGitIpcResult<T>(await handler?.(...args));
}

async function expectGitHandlerFailure(
  handler: Handler | undefined,
  args: readonly unknown[],
  message: string,
): Promise<void> {
  const result = await handler?.(...args);
  expect(() => unwrapGitIpcResult(result)).toThrow(message);
}

describe('GitMainChannel', () => {
  it('registers Git IPC handlers around the main service', async () => {
    const ipc = fakeIpc();
    const service = {
      stage: vi.fn(async () => undefined),
      deleteWorkspaceEntry: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      deleteRemoteRef: vi.fn(async () => undefined),
      fetch: vi.fn(async () => undefined),
      reset: vi.fn(async () => undefined),
      commitFiles: vi.fn(async () => []),
      mergeBase: vi.fn(async () => 'base'),
      rebase: vi.fn(async () => ({ ok: true })),
      log: vi.fn(async () => ({ commits: [] })),
      show: vi.fn(async () => 'content'),
      status: vi.fn(async () => ({ isRepo: true, files: [] })),
    } as unknown as GitMainService;
    const getWorkspaceRoot = vi.fn(() => '/repo');
    new GitMainChannel(service, getWorkspaceRoot, ipc).register();

    expect(ipc.handlers.has(GIT_IPC_CHANNELS.stage)).toBe(true);
    expect(ipc.handlers.has(GIT_IPC_CHANNELS.commit)).toBe(true);
    expect(ipc.handlers.has(GIT_IPC_CHANNELS.show)).toBe(true);
    expect(ipc.handlers.has(GIT_IPC_CHANNELS.status)).toBe(true);

    const event = { sender: { id: 7 } };
    await invokeGitHandler(ipc.handlers.get(GIT_IPC_CHANNELS.stage), event, ['a.ts']);
    await invokeGitHandler(ipc.handlers.get(GIT_IPC_CHANNELS.deleteWorkspaceEntry), event, {
      path: 'new.md',
      kind: 'file',
    });
    await invokeGitHandler(ipc.handlers.get(GIT_IPC_CHANNELS.commit), event, {
      message: 'msg',
      amend: true,
    });
    await invokeGitHandler(ipc.handlers.get(GIT_IPC_CHANNELS.deleteRemoteRef), event, {
      remote: 'origin',
      name: 'feature/scm',
      force: true,
    });
    await invokeGitHandler(ipc.handlers.get(GIT_IPC_CHANNELS.fetch), event, {
      all: true,
    });
    await invokeGitHandler(ipc.handlers.get(GIT_IPC_CHANNELS.reset), event, {
      ref: 'HEAD~1',
      mode: 'soft',
    });
    await expect(
      invokeGitHandler(ipc.handlers.get(GIT_IPC_CHANNELS.rebase), event, 'origin/main'),
    ).resolves.toEqual({ ok: true });
    await invokeGitHandler(ipc.handlers.get(GIT_IPC_CHANNELS.commitFiles), event, {
      ref: 'abc',
      parent: 'parent',
    });
    await expect(
      invokeGitHandler(ipc.handlers.get(GIT_IPC_CHANNELS.mergeBase), event, [
        'main',
        'origin/main',
      ]),
    ).resolves.toBe('base');
    await expect(
      invokeGitHandler(ipc.handlers.get(GIT_IPC_CHANNELS.log), event, {
        ref: 'main',
        maxCount: 1,
        maxParents: 0,
      }),
    ).resolves.toEqual({ commits: [] });
    await expect(
      invokeGitHandler(ipc.handlers.get(GIT_IPC_CHANNELS.show), event, {
        ref: 'HEAD',
        path: 'a.ts',
      }),
    ).resolves.toBe('content');
    await expect(
      invokeGitHandler(ipc.handlers.get(GIT_IPC_CHANNELS.status), event),
    ).resolves.toEqual({
      isRepo: true,
      files: [],
    });

    expect(service.stage).toHaveBeenCalledWith('/repo', ['a.ts']);
    expect(service.deleteWorkspaceEntry).toHaveBeenCalledWith('/repo', 'new.md', 'file');
    expect(service.commit).toHaveBeenCalledWith('/repo', 'msg', { amend: true });
    expect(service.deleteRemoteRef).toHaveBeenCalledWith('/repo', 'origin', 'feature/scm', {
      force: true,
    });
    expect(service.fetch).toHaveBeenCalledWith('/repo', { all: true });
    expect(service.reset).toHaveBeenCalledWith('/repo', { ref: 'HEAD~1', mode: 'soft' });
    expect(service.rebase).toHaveBeenCalledWith('/repo', 'origin/main');
    expect(service.commitFiles).toHaveBeenCalledWith('/repo', 'abc', 'parent');
    expect(service.mergeBase).toHaveBeenCalledWith('/repo', ['main', 'origin/main']);
    expect(service.log).toHaveBeenCalledWith('/repo', {
      ref: 'main',
      maxCount: 1,
      maxParents: 0,
    });
    expect(service.show).toHaveBeenCalledWith('/repo', 'HEAD', 'a.ts');
    expect(service.status).toHaveBeenCalledWith('/repo');
    expect(getWorkspaceRoot).toHaveBeenCalledWith(event.sender);
  });

  it('rejects invalid Git payloads at the IPC boundary before service dispatch', async () => {
    const ipc = fakeIpc();
    const service = {
      stage: vi.fn(async () => undefined),
      deleteWorkspaceEntry: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      publish: vi.fn(async () => undefined),
      reset: vi.fn(async () => undefined),
      checkout: vi.fn(async () => undefined),
      log: vi.fn(async () => ({ commits: [] })),
      searchHistory: vi.fn(async () => []),
      rebase: vi.fn(async () => ({ ok: true })),
      rebaseInteractive: vi.fn(async () => ({ ok: true })),
      apply: vi.fn(async () => undefined),
      stash: vi.fn(async () => ({ stashed: true })),
    } as unknown as GitMainService;
    new GitMainChannel(service, () => '/repo', ipc).register();

    const event = { sender: { id: 7 } };
    await expectGitHandlerFailure(
      ipc.handlers.get(GIT_IPC_CHANNELS.stage),
      [event, ['a.ts', 123]],
      'Invalid path.',
    );
    await expectGitHandlerFailure(
      ipc.handlers.get(GIT_IPC_CHANNELS.deleteWorkspaceEntry),
      [
        event,
        {
          path: '.',
          kind: 'folder',
        },
      ],
      'Delete path must name an entry inside the workspace.',
    );
    await expectGitHandlerFailure(
      ipc.handlers.get(GIT_IPC_CHANNELS.deleteWorkspaceEntry),
      [
        event,
        {
          path: '../draft.md',
          kind: 'file',
        },
      ],
      'Invalid delete path.',
    );
    await expectGitHandlerFailure(
      ipc.handlers.get(GIT_IPC_CHANNELS.deleteWorkspaceEntry),
      [
        event,
        {
          path: 'draft.md',
          kind: 'directory',
        },
      ],
      'Invalid delete kind.',
    );
    await expectGitHandlerFailure(
      ipc.handlers.get(GIT_IPC_CHANNELS.reset),
      [
        event,
        {
          ref: 'HEAD',
          mode: 'merge',
        },
      ],
      'Invalid reset mode.',
    );
    await expectGitHandlerFailure(
      ipc.handlers.get(GIT_IPC_CHANNELS.commit),
      [event, { message: 'msg', amend: 'yes' }],
      'Invalid commit amend option.',
    );
    await expectGitHandlerFailure(
      ipc.handlers.get(GIT_IPC_CHANNELS.publish),
      [event, { remote: '' }],
      'Invalid publish remote.',
    );
    await expectGitHandlerFailure(
      ipc.handlers.get(GIT_IPC_CHANNELS.checkout),
      [event, { branch: 'topic', create: true }],
      'Invalid checkout create option.',
    );
    await expectGitHandlerFailure(
      ipc.handlers.get(GIT_IPC_CHANNELS.log),
      [event, { refNames: ['main', 42] }],
      'Invalid log refs.',
    );
    await expectGitHandlerFailure(
      ipc.handlers.get(GIT_IPC_CHANNELS.searchHistory),
      [event, { maxCount: 5 }],
      'Invalid search history query.',
    );
    await expectGitHandlerFailure(
      ipc.handlers.get(GIT_IPC_CHANNELS.rebase),
      [event, ''],
      'Invalid rebase branch.',
    );
    await expectGitHandlerFailure(
      ipc.handlers.get(GIT_IPC_CHANNELS.rebaseInteractive),
      [
        event,
        {
          base: 'main',
          items: [{ sha: 'abc', action: 'squash' }],
        },
      ],
      'Invalid rebase item action.',
    );
    await expectGitHandlerFailure(
      ipc.handlers.get(GIT_IPC_CHANNELS.apply),
      [event, { patch: 'diff', cached: 'yes' }],
      'Invalid apply cached option.',
    );
    await expectGitHandlerFailure(
      ipc.handlers.get(GIT_IPC_CHANNELS.stash),
      [event, { includeUntracked: 'yes' }],
      'Invalid stash includeUntracked option.',
    );

    expect(service.stage).not.toHaveBeenCalled();
    expect(service.deleteWorkspaceEntry).not.toHaveBeenCalled();
    expect(service.commit).not.toHaveBeenCalled();
    expect(service.publish).not.toHaveBeenCalled();
    expect(service.reset).not.toHaveBeenCalled();
    expect(service.checkout).not.toHaveBeenCalled();
    expect(service.log).not.toHaveBeenCalled();
    expect(service.searchHistory).not.toHaveBeenCalled();
    expect(service.rebase).not.toHaveBeenCalled();
    expect(service.rebaseInteractive).not.toHaveBeenCalled();
    expect(service.apply).not.toHaveBeenCalled();
    expect(service.stash).not.toHaveBeenCalled();
  });

  it('serializes GitError data instead of relying on Electron error cloning', async () => {
    const ipc = fakeIpc();
    const service = {
      pull: vi.fn(async () => {
        throw new GitError({
          stderr: 'There is no tracking information for the current branch.\n',
          exitCode: 1,
          gitErrorCode: GitErrorCodes.NoUpstreamBranch,
          gitCommand: 'pull',
          gitArgs: ['pull'],
        });
      }),
    } as unknown as GitMainService;
    new GitMainChannel(service, () => '/repo', ipc).register();

    const event = { sender: { id: 7 } };
    const result = await ipc.handlers.get(GIT_IPC_CHANNELS.pull)?.(event, {});

    expect(result).toEqual({
      ok: false,
      error: {
        message: 'There is no tracking information for the current branch.',
        stderr: 'There is no tracking information for the current branch.\n',
        exitCode: 1,
        gitErrorCode: GitErrorCodes.NoUpstreamBranch,
        gitCommand: 'pull',
        gitArgs: ['pull'],
      },
    });
  });
});
