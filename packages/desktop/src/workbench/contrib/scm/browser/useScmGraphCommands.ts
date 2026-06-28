import { useCallback } from 'react';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import type { GitScmService } from './gitScmService.js';
import { useScmViewStore } from './scmViewStore.js';

export interface ScmGraphCommands {
  readonly openFullGraph: () => void;
  readonly revealHead: () => void;
}

export function useScmGraphCommands({ git }: { readonly git: GitScmService }): ScmGraphCommands {
  const openFullGraph = useCallback((): void => {
    useWorkspaceStore.getState().openGitGraph();
  }, []);

  // GRAPH header "Go to Current History Item" (VS Code) — reveal HEAD in the graph.
  const revealHead = useCallback(
    (): void =>
      void (async () => {
        try {
          const result = await git.log({ maxCount: 1 });
          const head = result.commits[0]?.hash;
          if (head !== undefined) useScmViewStore.getState().revealCommit(head);
        } catch {
          /* no HEAD yet */
        }
      })(),
    [git],
  );

  return { openFullGraph, revealHead };
}
