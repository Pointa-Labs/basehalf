import type { ContextMenuItem } from '../../../browser/parts/contextmenu/contextMenuStore.js';
import type { GitGraphActionDeps } from './gitGraphActionTypes.js';

export function fullGraphStashMenu(ref: string, deps: GitGraphActionDeps): ContextMenuItem[] {
  return [
    {
      id: 'apply',
      label: 'Apply Stash',
      run: () => deps.runGit(() => deps.git.stashApply(ref)),
    },
    {
      id: 'pop',
      label: 'Pop Stash',
      run: () => deps.runGit(() => deps.git.stashPop(ref)),
    },
    { separator: true },
    {
      id: 'drop',
      label: 'Drop Stash',
      danger: true,
      run: () =>
        void deps
          .confirm({ title: `Delete ${ref}?`, confirmText: 'Delete', destructive: true })
          .then((ok) => {
            if (ok) deps.runGit(() => deps.git.stashDrop(ref));
          }),
    },
  ];
}
