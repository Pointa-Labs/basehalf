import { useCallback } from 'react';
import { prompt } from '../../../../platform/dialogs/browser/dialogService.js';
import type { CommitActionOptions } from '../common/commitTypes.js';
import type { GitStatusResult } from '../common/git.js';
import type { GitScmService } from './gitScmService.js';
import { type ScmActionRunner, commitPlan } from './scmCommandModel.js';
import { choosePublishRemote, isPublishBranchState } from './useScmRemoteCommands.js';

export interface ScmCommitCommands {
  readonly commit: (options?: CommitActionOptions) => void;
  readonly createBranchPrompt: () => void;
  readonly undoLastCommit: () => void;
}

export function useScmCommitCommands({
  act,
  git,
  hasStaged,
  message,
  setMessage,
  status,
}: {
  readonly act: ScmActionRunner;
  readonly git: GitScmService;
  readonly hasStaged: boolean;
  readonly message: string;
  readonly setMessage: (message: string) => void;
  readonly status: GitStatusResult | null;
}): ScmCommitCommands {
  // Commit, optionally followed by push or sync — the VS Code
  // "Commit & Push" / "Commit & Sync" split-button actions.
  const commit = useCallback(
    (options: CommitActionOptions = {}): void => {
      const plan = commitPlan(message, options, hasStaged);
      if (plan === null) return;
      void act(async () => {
        await git.commit(plan.message, { amend: plan.amend });
        setMessage('');
        const operation = scmPostCommitRemoteOperation(plan.after, status);
        if (operation === 'push') await git.push();
        else if (operation === 'sync') await git.sync();
        else if (operation === 'publish') {
          const remote = await choosePublishRemote(git);
          if (remote !== null) await git.publish({ remote });
        }
      });
    },
    [act, git, hasStaged, message, setMessage, status],
  );

  const createBranchPrompt = useCallback(
    (): void =>
      void (async () => {
        // Electron has no window.prompt — use the app's custom prompt dialog.
        const name = (
          await prompt({ title: 'Create Branch', label: 'Branch name', placeholder: 'feature/x' })
        )?.trim();
        if (name) void act(() => git.createBranch(name));
      })(),
    [act, git],
  );

  const undoLastCommit = useCallback(
    (): void => void act(() => git.reset({ ref: 'HEAD~1', mode: 'soft' })),
    [act, git],
  );

  return { commit, createBranchPrompt, undoLastCommit };
}

export type ScmPostCommitRemoteOperation = 'publish' | 'push' | 'sync' | null;

export function scmPostCommitRemoteOperation(
  after: CommitActionOptions['after'],
  status: GitStatusResult | null,
): ScmPostCommitRemoteOperation {
  if (after === undefined) return null;
  if ((after === 'push' || after === 'sync') && isPublishBranchState(status)) return 'publish';
  return after;
}
