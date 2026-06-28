import { useCallback } from 'react';
import { type PickOption, pick } from '../../../browser/parts/dialogs/Dialog.js';
import { toast } from '../../../browser/parts/notifications/toastStore.js';
import {
  type GithubPullRequestService,
  githubPullRequestService,
} from '../../githubPullRequests/browser/githubPullRequestService.js';
import type { GitRemoteInfo, GitStatusResult } from '../common/git.js';
import type { GitScmService } from './gitScmService.js';
import { type ScmActionRunner, scmErrorMessage } from './scmCommandModel.js';

export interface ScmRemoteCommands {
  readonly createPullRequest: () => void;
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
  githubService = githubPullRequestService,
  openExternal,
  status,
}: {
  readonly act: ScmActionRunner;
  readonly git: GitScmService;
  readonly githubService?: GithubPullRequestService;
  readonly openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
  readonly status: GitStatusResult | null;
}): ScmRemoteCommands {
  // Open GitHub's "create PR" page for the current branch. GitHub-specific
  // remote selection and URL shaping stay behind the GitHub provider service.
  const createPullRequest = useCallback(
    (): void =>
      void (async () => {
        const branch = status?.branch;
        if (!branch) {
          toast.error('A current branch is required to create a pull request.');
          return;
        }
        try {
          const url = await githubService.createPullRequestUrl(branch);
          if (url === null) {
            toast.error('No GitHub remote is configured.');
            return;
          }
          const res = await openExternal(url);
          if (!res.ok) toast.error(res.error ?? 'Failed to open the browser.');
        } catch (err) {
          toast.error(scmErrorMessage(err));
        }
      })(),
    [githubService, openExternal, status?.branch],
  );

  const hasUpstream =
    status !== null &&
    status.detached !== true &&
    status.branch !== null &&
    status.upstream !== null;
  const canPublish =
    status !== null &&
    status.detached !== true &&
    status.branch !== null &&
    status.upstream === null;

  const publish = useCallback(
    (): void =>
      void (async () => {
        const remote = await choosePublishRemote(git);
        if (remote !== null) void act(() => git.publish({ remote }));
      })(),
    [act, git],
  );

  const pullUnavailableMessage =
    'The current branch has no upstream branch. Use Publish Branch first.';

  const pull = useCallback((): void => {
    if (!hasUpstream) {
      toast.info(pullUnavailableMessage);
      return;
    }
    void act(() => git.pull());
  }, [act, git, hasUpstream]);

  const push = useCallback((): void => {
    if (canPublish) {
      publish();
      return;
    }
    void act(() => git.push());
  }, [act, canPublish, git, publish]);

  const fetch = useCallback((): void => void act(() => git.fetch()), [act, git]);

  const sync = useCallback((): void => {
    if (canPublish) {
      publish();
      return;
    }
    void act(() => git.sync());
  }, [act, canPublish, git, publish]);

  const pullRebase = useCallback((): void => {
    if (!hasUpstream) {
      toast.info(pullUnavailableMessage);
      return;
    }
    void act(() => git.pull({ rebase: true }));
  }, [act, git, hasUpstream]);

  const pushForce = useCallback((): void => void act(() => git.push({ force: true })), [act, git]);

  return { createPullRequest, publish, pull, push, fetch, sync, pullRebase, pushForce };
}

async function choosePublishRemote(git: Pick<GitScmService, 'remotes'>): Promise<string | null> {
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

function remotePickOption(remote: GitRemoteInfo): PickOption {
  return {
    value: remote.name,
    label: remote.name,
    detail: remote.pushUrl ?? remote.fetchUrl,
  };
}
