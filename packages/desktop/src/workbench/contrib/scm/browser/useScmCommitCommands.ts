import { useCallback } from 'react';
import { prompt } from '../../../browser/parts/dialogs/Dialog.js';
import type { GitScmService } from './gitScmService.js';
import { type ScmActionRunner, commitPlan } from './scmCommandModel.js';
import type { CommitActionOptions } from './types.js';

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
}: {
  readonly act: ScmActionRunner;
  readonly git: GitScmService;
  readonly hasStaged: boolean;
  readonly message: string;
  readonly setMessage: (message: string) => void;
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
        if (plan.after === 'push') await git.push();
        else if (plan.after === 'sync') await git.sync();
      });
    },
    [act, git, hasStaged, message, setMessage],
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
