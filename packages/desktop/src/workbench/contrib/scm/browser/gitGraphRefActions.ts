import type { ContextMenuItem } from '../../../../platform/contextview/common/contextMenu.js';
import { GitErrorCodes, ensureGitError } from '../common/git.js';
import type { GitGraphActionDeps } from './gitGraphActionTypes.js';
import type { FullGraphRefModel } from './gitGraphRefIndex.js';

export type FullGraphRefMenuCommand = 'checkout' | 'delete-branch' | 'delete-tag';

export function fullGraphRefMenuCommands(
  ref: Pick<FullGraphRefModel, 'activeRemote' | 'current' | 'kind' | 'pseudo'>,
): readonly FullGraphRefMenuCommand[] {
  if (ref.kind === 'tag') return ['checkout', 'delete-tag'];
  if (ref.kind === 'branch' || ref.kind === 'remote') {
    return canDeleteBranchRef(ref) ? ['checkout', 'delete-branch'] : ['checkout'];
  }
  return ['checkout'];
}

function canDeleteBranchRef(
  ref: Pick<FullGraphRefModel, 'activeRemote' | 'current' | 'pseudo'>,
): boolean {
  return ref.current !== true && ref.activeRemote !== true && ref.pseudo !== true;
}

export async function deleteBranchRefWithRecovery(
  ref: Pick<FullGraphRefModel, 'kind' | 'name'>,
  deps: Pick<GitGraphActionDeps, 'confirm' | 'git'>,
): Promise<void> {
  const { name, kind } = ref;
  const remoteRef = kind === 'remote' ? remoteRefParts(name) : null;
  const deleteBranch = (force?: boolean): Promise<void> =>
    kind === 'remote'
      ? remoteRef === null
        ? Promise.resolve()
        : deps.git.deleteRemoteRef(
            remoteRef.remote,
            remoteRef.name,
            force === true ? { force: true } : {},
          )
      : deps.git.deleteBranch(name, force === true ? { force: true } : {});

  try {
    await deleteBranch();
  } catch (err) {
    const gitError = ensureGitError(err);
    if (gitError.gitErrorCode !== GitErrorCodes.BranchNotFullyMerged) {
      throw gitError;
    }
    if (
      await deps.confirm({
        title: `Branch ${name} is not fully merged. Force delete?`,
        confirmText: 'Force Delete',
        destructive: true,
      })
    ) {
      await deleteBranch(true);
    }
  }
}

export function fullGraphRefMenu(
  ref: FullGraphRefModel,
  deps: GitGraphActionDeps,
): ContextMenuItem[] {
  const { name, kind } = ref;
  const items: ContextMenuItem[] = [];

  for (const command of fullGraphRefMenuCommands(ref)) {
    if (command === 'checkout') {
      items.push({
        id: 'checkout',
        label: kind === 'tag' ? `Checkout tag ${name}` : `Checkout ${name}`,
        run: () =>
          deps.runGit(() =>
            deps.git.checkout(
              kind === 'remote' ? (ref.trackingLocal ?? ref.targetRef) : name,
              kind === 'remote' && ref.trackingLocal === undefined ? { track: true } : {},
            ),
          ),
      });
      continue;
    }

    if (command === 'delete-branch') {
      items.push(
        { separator: true },
        {
          id: 'delete',
          label: 'Delete Branch',
          danger: true,
          run: () =>
            void deps
              .confirm({
                title: `Delete branch ${name}?`,
                confirmText: 'Delete',
                destructive: true,
              })
              .then((ok) => {
                if (!ok) return;
                deps.runGit(() => deleteBranchRefWithRecovery(ref, deps));
              }),
        },
      );
      continue;
    }

    items.push(
      { separator: true },
      {
        id: 'delete',
        label: 'Delete Tag',
        danger: true,
        run: () =>
          void deps
            .confirm({
              title: `Delete tag ${name}?`,
              confirmText: 'Delete',
              destructive: true,
            })
            .then((ok) => {
              if (ok) deps.runGit(() => deps.git.tagDelete(name));
            }),
      },
    );
  }

  return items;
}

function remoteRefParts(name: string): { remote: string; name: string } | null {
  const index = name.indexOf('/');
  if (index <= 0 || index === name.length - 1) return null;
  return { remote: name.slice(0, index), name: name.slice(index + 1) };
}
