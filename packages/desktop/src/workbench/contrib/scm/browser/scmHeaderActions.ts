import type { MenuAction, MenuItem } from '../../../browser/ui/primitives/Menu.js';
import type { GitStatusResult } from '../common/git.js';
import type { SourceControlViewModel } from '../common/sourceControlViewModel.js';
import {
  SCM_BRANCH_MENU_ACTION_DESCRIPTORS,
  type ScmBranchMenuActionDescriptor,
  type ScmBranchMenuActionId,
} from './scmCommandModel.js';
import type { ScmCommands } from './useScmCommands.js';

export interface ScmHeaderIconAction {
  readonly id: 'publish' | 'refresh' | 'sync';
  readonly title: string;
  readonly glyph: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}

export interface ScmHeaderActionModel {
  readonly remoteAction: ScmHeaderIconAction;
  readonly refreshAction: ScmHeaderIconAction;
  readonly remoteCounts: string;
  readonly overflowActions: readonly MenuItem[];
}

interface ScmHeaderActionArgs {
  readonly status: GitStatusResult;
  readonly busy: boolean;
  readonly view: SourceControlViewModel;
  readonly commands: Pick<
    ScmCommands,
    | 'createBranchFromPrompt'
    | 'createBranchPrompt'
    | 'deleteBranchPrompt'
    | 'discardAll'
    | 'fetch'
    | 'mergeBranchPrompt'
    | 'popStash'
    | 'publish'
    | 'pull'
    | 'pullRebase'
    | 'push'
    | 'pushForce'
    | 'rebaseBranchPrompt'
    | 'renameBranchPrompt'
    | 'stash'
    | 'sync'
    | 'undoLastCommit'
  >;
  readonly refresh: () => Promise<void> | void;
  readonly contributionActions?: readonly MenuAction[];
}

const separator = (): MenuItem => ({ separator: true });

const groupedMenuItems = (groups: readonly (readonly MenuItem[])[]): MenuItem[] => {
  const items: MenuItem[] = [];
  for (const group of groups) {
    if (group.length === 0) continue;
    if (items.length > 0) items.push(separator());
    items.push(...group);
  }
  return items;
};

const scmBranchMenuGroups = [
  '1_merge',
  '2_branch',
  '3_modify',
] as const satisfies readonly ScmBranchMenuActionDescriptor['group'][];

type ScmBranchMenuHandlers = Record<ScmBranchMenuActionId, () => void>;

interface ScmBranchMenuActionsArgs {
  readonly status: GitStatusResult;
  readonly busy: boolean;
  readonly commands: Pick<
    ScmCommands,
    | 'createBranchFromPrompt'
    | 'createBranchPrompt'
    | 'deleteBranchPrompt'
    | 'mergeBranchPrompt'
    | 'rebaseBranchPrompt'
    | 'renameBranchPrompt'
  >;
}

export function scmBranchMenuActions({
  status,
  busy,
  commands,
}: ScmBranchMenuActionsArgs): MenuItem[] {
  const hasCurrentBranch = status.detached !== true && status.branch !== null;
  const handlers: ScmBranchMenuHandlers = {
    merge: commands.mergeBranchPrompt,
    rebase: commands.rebaseBranchPrompt,
    createBranch: commands.createBranchPrompt,
    createBranchFrom: commands.createBranchFromPrompt,
    renameBranch: commands.renameBranchPrompt,
    deleteBranch: commands.deleteBranchPrompt,
  };

  const actionFor = (descriptor: ScmBranchMenuActionDescriptor): MenuAction => ({
    label: descriptor.label,
    onClick: handlers[descriptor.id],
    disabled:
      busy || descriptor.id === 'rebase' || (descriptor.id === 'renameBranch' && !hasCurrentBranch),
    ...(descriptor.danger === true && { danger: true }),
  });

  return groupedMenuItems(
    scmBranchMenuGroups.map((group) =>
      [...SCM_BRANCH_MENU_ACTION_DESCRIPTORS]
        .filter((descriptor) => descriptor.group === group)
        .sort((a, b) => a.order - b.order)
        .map(actionFor),
    ),
  );
}

export function scmHeaderActionModel({
  status,
  busy,
  view,
  commands,
  refresh,
  contributionActions = [],
}: ScmHeaderActionArgs): ScmHeaderActionModel {
  const remoteCounts =
    status.ahead > 0 || status.behind > 0
      ? `${status.ahead > 0 ? `↑${status.ahead}` : ''}${status.behind > 0 ? `↓${status.behind}` : ''}`
      : '';
  const canPublish = status.detached !== true && status.branch !== null && status.upstream === null;
  const remoteAction: ScmHeaderIconAction = canPublish
    ? {
        id: 'publish',
        title: 'Publish Branch',
        glyph: 'cloud-upload',
        disabled: busy,
        onClick: commands.publish,
      }
    : {
        id: 'sync',
        title: remoteCounts !== '' ? `Sync Changes ${remoteCounts}` : 'Sync Changes (Pull, Push)',
        glyph: 'sync',
        disabled: busy,
        onClick: commands.sync,
      };

  return {
    remoteAction,
    refreshAction: {
      id: 'refresh',
      title: 'Refresh',
      glyph: 'refresh',
      disabled: busy,
      onClick: () => void refresh(),
    },
    remoteCounts,
    overflowActions: groupedMenuItems([
      [
        { label: 'Pull', onClick: commands.pull, disabled: !view.canPull },
        { label: 'Pull (Rebase)', onClick: commands.pullRebase, disabled: !view.canPull },
        { label: 'Push', onClick: commands.push },
        { label: 'Push (Force)', onClick: commands.pushForce },
        { label: 'Fetch', onClick: commands.fetch },
        { label: 'Publish Branch', onClick: commands.publish, disabled: !view.canPublish },
      ],
      scmBranchMenuActions({ status, busy, commands }),
      contributionActions,
      [{ label: 'Undo Last Commit', onClick: commands.undoLastCommit }],
      [
        { label: 'Stash', onClick: commands.stash },
        { label: 'Pop Stash', onClick: () => commands.popStash() },
      ],
      [{ label: 'Discard All Changes', onClick: commands.discardAll, danger: true }],
    ]),
  };
}
