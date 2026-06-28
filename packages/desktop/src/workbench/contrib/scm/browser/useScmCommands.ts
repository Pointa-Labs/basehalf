import { useCallback, useRef, useState } from 'react';
import { nativeHostService } from '../../../../platform/native/browser/nativeHostService.js';
import { toast } from '../../../browser/parts/notifications/toastStore.js';
import {
  type GithubPullRequestService,
  githubPullRequestService,
} from '../../githubPullRequests/browser/githubPullRequestService.js';
import type { GitStashEntry, GitStatusResult } from '../common/git.js';
import { type GitScmService, gitScmService } from './gitScmService.js';
import type { GitGroups, GitRow } from './gitStatusModel.js';
import { runScmAction } from './scmCommandModel.js';
import type { CommitActionOptions } from './types.js';
import { useScmCommitCommands } from './useScmCommitCommands.js';
import { useScmGraphCommands } from './useScmGraphCommands.js';
import { useScmRemoteCommands } from './useScmRemoteCommands.js';
import { useScmResourceCommands } from './useScmResourceCommands.js';
import { useScmStashCommands } from './useScmStashCommands.js';

interface UseScmCommandsArgs {
  readonly status: GitStatusResult | null;
  readonly groups: GitGroups;
  readonly message: string;
  readonly setMessage: (message: string) => void;
  readonly hasStaged: boolean;
  readonly refresh: () => Promise<void> | void;
  readonly loadStashes: () => Promise<void> | void;
  readonly gitService?: GitScmService;
  readonly githubService?: GithubPullRequestService;
  readonly openExternal?: (url: string) => Promise<{ ok: boolean; error?: string }>;
}

export interface ScmCommands {
  readonly busy: boolean;
  readonly error: string | null;
  readonly initRepository: () => void;
  readonly openRow: (row: GitRow) => void;
  readonly stage: (paths: string[]) => Promise<void>;
  readonly unstage: (paths: string[]) => Promise<void>;
  readonly discard: (row: GitRow) => void;
  readonly discardMany: (rows: readonly GitRow[]) => void;
  readonly discardAll: () => void;
  readonly commit: (options?: CommitActionOptions) => void;
  readonly createBranchPrompt: () => void;
  readonly createPullRequest: () => void;
  readonly publish: () => void;
  readonly pull: () => void;
  readonly push: () => void;
  readonly fetch: () => void;
  readonly stash: () => void;
  readonly sync: () => void;
  readonly pullRebase: () => void;
  readonly pushForce: () => void;
  readonly undoLastCommit: () => void;
  readonly openFullGraph: () => void;
  readonly revealHead: () => void;
  readonly applyStash: (ref: GitStashEntry['ref']) => void;
  readonly popStash: (ref?: GitStashEntry['ref']) => void;
  readonly dropStash: (ref: GitStashEntry['ref']) => void;
}

export const useScmCommands = ({
  status,
  groups,
  message,
  setMessage,
  hasStaged,
  refresh,
  loadStashes,
  gitService: git = gitScmService,
  githubService = githubPullRequestService,
  openExternal = (url) => nativeHostService.openExternal(url),
}: UseScmCommandsArgs): ScmCommands => {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const setActionBusy = useCallback((next: boolean): void => {
    busyRef.current = next;
    setBusy(next);
  }, []);

  // Run a git action, surface failures as a transient toast (VS Code-style), then
  // re-read status from disk truth. `error` is kept only for init/no-repo screens;
  // everyday action errors are toasts, not permanent panel chrome.
  const act = useCallback(
    (fn: () => Promise<unknown>): Promise<void> => {
      if (busyRef.current) return Promise.resolve();
      return runScmAction(fn, {
        setBusy: setActionBusy,
        setError,
        refresh,
        loadStashes,
        toastError: toast.error,
      });
    },
    [refresh, loadStashes, setActionBusy],
  );

  const resourceCommands = useScmResourceCommands({ act, git, groups });
  const commitCommands = useScmCommitCommands({ act, git, hasStaged, message, setMessage });
  const remoteCommands = useScmRemoteCommands({
    act,
    git,
    githubService,
    openExternal,
    status,
  });
  const stashCommands = useScmStashCommands({ act, git });
  const graphCommands = useScmGraphCommands({ git });

  return {
    busy,
    error,
    ...resourceCommands,
    ...commitCommands,
    ...remoteCommands,
    ...stashCommands,
    ...graphCommands,
  };
};
