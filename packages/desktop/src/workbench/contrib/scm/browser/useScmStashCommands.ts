import { useCallback } from 'react';
import { confirm } from '../../../../platform/dialogs/browser/dialogService.js';
import type { GitStashEntry } from '../common/git.js';
import type { GitScmService } from './gitScmService.js';
import { type ScmActionRunner, dropStashPrompt } from './scmCommandModel.js';

export interface ScmStashCommands {
  readonly stash: () => void;
  readonly applyStash: (ref: GitStashEntry['ref']) => void;
  readonly popStash: (ref?: GitStashEntry['ref']) => void;
  readonly dropStash: (ref: GitStashEntry['ref']) => void;
}

export function useScmStashCommands({
  act,
  git,
}: {
  readonly act: ScmActionRunner;
  readonly git: GitScmService;
}): ScmStashCommands {
  const stash = useCallback((): void => void act(() => git.stash()), [act, git]);

  const applyStash = useCallback(
    (ref: GitStashEntry['ref']): void => void act(() => git.stashApply(ref)),
    [act, git],
  );

  const popStash = useCallback(
    (ref?: GitStashEntry['ref']): void => void act(() => git.stashPop(ref)),
    [act, git],
  );

  const dropStash = useCallback(
    (ref: GitStashEntry['ref']): void => {
      void (async () => {
        const ok = await confirm({
          title: dropStashPrompt(ref),
          confirmText: 'Delete',
          destructive: true,
        });
        if (ok) void act(() => git.stashDrop(ref));
      })();
    },
    [act, git],
  );

  return { stash, applyStash, popStash, dropStash };
}
