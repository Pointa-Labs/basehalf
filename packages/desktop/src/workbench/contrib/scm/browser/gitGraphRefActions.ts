import type { ContextMenuItem } from '../../../../platform/contextview/common/contextMenu.js';
import type { FullGraphRefModel } from '../common/gitGraphRefIndex.js';
import type { FullGraphRefMenuCommand, GitGraphActionRunner } from './gitGraphActionTypes.js';
export { deleteBranchRefWithRecovery } from './gitGraphActionTypes.js';
export type { FullGraphRefMenuCommand } from './gitGraphActionTypes.js';

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

export function fullGraphRefMenu(
  ref: FullGraphRefModel,
  runner: GitGraphActionRunner,
): ContextMenuItem[] {
  const { name, kind } = ref;
  const items: ContextMenuItem[] = [];

  for (const command of fullGraphRefMenuCommands(ref)) {
    if (command === 'checkout') {
      items.push({
        id: 'checkout',
        label: kind === 'tag' ? `Checkout tag ${name}` : `Checkout ${name}`,
        run: () => runner.executeRefAction(command, ref),
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
          run: () => runner.executeRefAction(command, ref),
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
        run: () => runner.executeRefAction(command, ref),
      },
    );
  }

  return items;
}
