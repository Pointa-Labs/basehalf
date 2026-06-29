import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from '../../../../platform/notification/browser/notificationService.js';
import type { CommitActionOptions } from '../common/commitTypes.js';
import type { GitStashEntry, GitStatusResult } from '../common/git.js';
import type { GitGroups, GitRow } from '../common/gitStatusModel.js';
import { createBranchGitAdapter } from './branchGitAdapter.js';
import {
  runCreateBranchFromCommand,
  runDeleteBranchCommand,
  runMergeBranchCommand,
  runRenameBranchCommand,
} from './branchQuickPickCommands.js';
import { type GitScmService, gitScmService } from './gitScmService.js';
import { runScmAction } from './scmCommandModel.js';
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
  readonly createBranchFromPrompt: () => void;
  readonly mergeBranchPrompt: () => void;
  readonly rebaseBranchPrompt: () => void;
  readonly renameBranchPrompt: () => void;
  readonly deleteBranchPrompt: () => void;
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
  const commitCommands = useScmCommitCommands({ act, git, hasStaged, message, setMessage, status });
  const remoteCommands = useScmRemoteCommands({
    act,
    git,
    status,
  });
  const stashCommands = useScmStashCommands({ act, git });
  const graphCommands = useScmGraphCommands({ git });
  const branchGit = useMemo(() => createBranchGitAdapter(git), [git]);
  const afterBranchCommand = useCallback(async (): Promise<void> => {
    await refresh();
    await loadStashes();
  }, [loadStashes, refresh]);
  const createBranchFromPrompt = useCallback((): void => {
    void runCreateBranchFromCommand({ git: branchGit, onAfter: afterBranchCommand });
  }, [afterBranchCommand, branchGit]);
  const mergeBranchPrompt = useCallback((): void => {
    void runMergeBranchCommand({ git: branchGit, onAfter: afterBranchCommand });
  }, [afterBranchCommand, branchGit]);
  const rebaseBranchPrompt = useCallback((): void => {
    toast.error('Rebase Branch is not available yet.');
  }, []);
  const renameBranchPrompt = useCallback((): void => {
    void runRenameBranchCommand({ git: branchGit, onAfter: afterBranchCommand });
  }, [afterBranchCommand, branchGit]);
  const deleteBranchPrompt = useCallback((): void => {
    void runDeleteBranchCommand({ git: branchGit, onAfter: afterBranchCommand });
  }, [afterBranchCommand, branchGit]);

  return {
    busy,
    error,
    ...resourceCommands,
    ...commitCommands,
    ...remoteCommands,
    ...stashCommands,
    ...graphCommands,
    createBranchFromPrompt,
    mergeBranchPrompt,
    rebaseBranchPrompt,
    renameBranchPrompt,
    deleteBranchPrompt,
  };
};
