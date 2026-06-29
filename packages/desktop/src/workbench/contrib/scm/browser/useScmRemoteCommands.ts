import { useCallback } from 'react';
import { toast } from '../../../../platform/notification/browser/notificationService.js';
import {
  type QuickPickOption,
  pick,
} from '../../../../platform/quickinput/browser/quickInputService.js';
import type { GitFetchArgs, GitRemoteInfo, GitStatusResult } from '../common/git.js';
import {
  FETCH_ALL_REMOTES_VALUE,
  type ScmRemoteOperation,
  fetchArgsForRemotePick,
  scmRemoteOperation,
} from '../common/remoteOperationModel.js';
import type { GitScmService } from './gitScmService.js';
import { type ScmActionRunner, scmErrorMessage } from './scmCommandModel.js';

export interface ScmRemoteCommands {
  readonly publish: () => void;
  readonly pull: () => void;
  readonly push: () => void;
  readonly fetch: () => void;
  readonly sync: () => void;
  readonly pullRebase: () => void;
  readonly pushForce: () => void;
}

export function useScmRemoteCommands({
  act,
  git,
  status,
}: {
  readonly act: ScmActionRunner;
  readonly git: GitScmService;
  readonly status: GitStatusResult | null;
}): ScmRemoteCommands {
  const publish = useCallback(
    (): void =>
      void (async () => {
        const remote = await choosePublishRemote(git);
        if (remote !== null) void act(() => git.publish({ remote }));
      })(),
    [act, git],
  );

  const runRemoteOperation = useCallback(
    (operation: ScmRemoteOperation): void => {
      if (operation.kind === 'publish') {
        publish();
      } else if (operation.kind === 'pull') {
        void act(() => git.pull(operation.rebase === true ? { rebase: true } : undefined));
      } else if (operation.kind === 'push') {
        void act(() => git.push(operation.force === true ? { force: true } : undefined));
      } else if (operation.kind === 'fetch') {
        void (async () => {
          const args = await chooseFetchRemote(git);
          if (args !== null) void act(() => git.fetch(args));
        })();
      } else {
        void act(() => git.sync());
      }
    },
    [act, git, publish],
  );

  const push = useCallback((): void => {
    runRemoteOperation(scmRemoteOperation('push', status));
  }, [runRemoteOperation, status]);

  const pull = useCallback((): void => {
    runRemoteOperation(scmRemoteOperation('pull', status));
  }, [runRemoteOperation, status]);

  const fetch = useCallback((): void => {
    runRemoteOperation(scmRemoteOperation('fetch', status));
  }, [runRemoteOperation, status]);

  const sync = useCallback((): void => {
    runRemoteOperation(scmRemoteOperation('sync', status));
  }, [runRemoteOperation, status]);

  const pullRebase = useCallback((): void => {
    runRemoteOperation(scmRemoteOperation('pullRebase', status));
  }, [runRemoteOperation, status]);

  const pushForce = useCallback((): void => {
    runRemoteOperation(scmRemoteOperation('pushForce', status));
  }, [runRemoteOperation, status]);

  return { publish, pull, push, fetch, sync, pullRebase, pushForce };
}

export async function chooseFetchRemote(
  git: Pick<GitScmService, 'fetch' | 'remotes'>,
): Promise<GitFetchArgs | null> {
  try {
    const result = await git.remotes();
    if (result.remotes.length === 0) return {};
    if (result.remotes.length === 1) {
      const remote = result.remotes[0];
      return remote === undefined ? {} : { remote: remote.name };
    }
    const choice = await pick({
      title: 'Fetch',
      placeholder: 'Select a remote to fetch from',
      emptyText: 'No remotes.',
      options: fetchRemotePickOptions(result.remotes),
    });
    return choice === null ? null : fetchArgsForRemotePick(choice);
  } catch (err) {
    toast.error(scmErrorMessage(err));
    return null;
  }
}

export function fetchRemotePickOptions(
  remotes: readonly GitRemoteInfo[],
): readonly QuickPickOption[] {
  return [
    {
      value: FETCH_ALL_REMOTES_VALUE,
      label: 'All Remotes',
      detail: 'Fetch from all remotes',
    },
    ...remotes.map(remotePickOption),
  ];
}

export async function choosePublishRemote(
  git: Pick<GitScmService, 'remotes'>,
): Promise<string | null> {
  try {
    const result = await git.remotes();
    const writable = result.remotes.filter((remote) => !remote.isReadOnly);
    if (writable.length === 0) {
      toast.error('No writable remote is configured.');
      return null;
    }
    if (writable.length === 1) return (writable[0] as GitRemoteInfo).name;
    return pick({
      title: 'Publish Branch',
      placeholder: 'Select a remote to publish to',
      emptyText: 'No writable remotes.',
      options: writable.map(remotePickOption),
    });
  } catch (err) {
    toast.error(scmErrorMessage(err));
    return null;
  }
}

function remotePickOption(remote: GitRemoteInfo): QuickPickOption {
  return {
    value: remote.name,
    label: remote.name,
    detail: remote.pushUrl ?? remote.fetchUrl,
  };
}
