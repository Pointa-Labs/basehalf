import type { QuickPickOption } from '../../../../platform/quickinput/common/quickInput.js';
import type { GitRefInfo, GitStatusResult } from '../common/git.js';
export {
  type CheckoutTarget,
  checkoutTargetForRef,
  defaultBranchNameFromRef,
  detachedCheckoutTargetForRef,
  trackingBranchForRemote,
} from '../common/branchCheckoutModel.js';

export type BranchQuickPickMode = 'switch' | 'merge';
export type BranchQuickPickCommand = 'cmd:create' | 'cmd:createFrom' | 'cmd:checkoutDetached';
export type BranchCheckoutBusyReason = 'checkout' | 'commit' | 'sync' | 'operation';

export interface BranchCheckoutCommandModel {
  readonly label: string;
  readonly icon: string;
  readonly iconSpin: boolean;
  readonly tooltip: string;
  readonly ariaLabel: string;
  readonly disabled: boolean;
}

const CHECKOUT_BLOCKED_RE =
  /would be overwritten by checkout|local changes to the following files would be overwritten|untracked working tree files would be overwritten|please commit your changes or stash/i;

export const CHECKOUT_RECOVERY_OPTIONS = [
  {
    value: 'stash',
    label: 'Stash & Checkout',
    hint: 'Keep changes in stash',
    detail: 'Switch branches and leave the stash for later.',
  },
  {
    value: 'migrate',
    label: 'Migrate Changes',
    hint: 'Carry changes to target',
    detail: 'Stash, checkout, then apply the stash.',
  },
  {
    value: 'force',
    label: 'Force Checkout',
    hint: 'Discard local changes',
    detail: 'Overwrite files that block checkout.',
  },
] satisfies readonly QuickPickOption[];

export const BRANCH_QUICK_PICK_COMMANDS = [
  {
    value: 'cmd:create',
    label: 'Create Branch...',
    detail: 'Command',
    alwaysShow: true,
    separator: 'Commands',
  },
  {
    value: 'cmd:createFrom',
    label: 'Create Branch From...',
    detail: 'Command',
    alwaysShow: true,
    separator: 'Commands',
  },
  {
    value: 'cmd:checkoutDetached',
    label: 'Checkout Detached...',
    detail: 'Command',
    alwaysShow: true,
    separator: 'Commands',
  },
] satisfies readonly (QuickPickOption & { readonly value: BranchQuickPickCommand })[];

export const HEAD_REF_OPTION = {
  value: 'HEAD',
  label: 'HEAD',
  detail: 'Current HEAD',
} satisfies QuickPickOption;

export const isCheckoutBlockedError = (message: string): boolean =>
  CHECKOUT_BLOCKED_RE.test(message);

export const createBranchCheckoutCommandModel = (
  status: Pick<GitStatusResult, 'branch' | 'detached'>,
  busyReason?: BranchCheckoutBusyReason,
): BranchCheckoutCommandModel => {
  const label = status.detached ? 'detached' : (status.branch ?? '-');
  const action = checkoutTooltipAction(busyReason);
  return {
    label,
    icon: busyReason === 'checkout' ? 'loading' : status.detached ? 'git-commit' : 'git-branch',
    iconSpin: busyReason === 'checkout',
    tooltip: `${label}, ${action}`,
    ariaLabel: 'Checkout Branch/Tag',
    disabled: busyReason !== undefined,
  };
};

function checkoutTooltipAction(reason?: BranchCheckoutBusyReason): string {
  switch (reason) {
    case 'checkout':
      return 'Checking Out Branch/Tag...';
    case 'commit':
      return 'Committing Changes...';
    case 'sync':
      return 'Synchronizing Changes...';
    case 'operation':
      return 'Git operation in progress...';
    default:
      return 'Checkout Branch/Tag...';
  }
}

export const filterBranches = (
  branches: readonly GitRefInfo[],
  filter: string,
): readonly GitRefInfo[] => {
  const needle = filter.trim().toLowerCase();
  if (needle === '') return branches;
  return branches.filter((branch) => branch.name.toLowerCase().includes(needle));
};

export const branchOption = (branch: GitRefInfo): QuickPickOption => {
  const hint = branch.current
    ? 'current branch'
    : branch.type === 'remoteHead'
      ? 'remote'
      : undefined;
  const detail =
    branch.type === 'remoteHead'
      ? 'Remote Branch'
      : branch.type === 'tag'
        ? 'Tag'
        : branch.commit
          ? branch.commit.slice(0, 7)
          : 'Branch';
  return {
    value: branch.id,
    label: branch.name,
    hint,
    detail,
    separator: branchQuickPickSeparator(branch),
  };
};

export const branchQuickPickSeparator = (branch: GitRefInfo): string => {
  if (branch.type === 'remoteHead') return 'Remote Branches';
  if (branch.type === 'tag') return 'Tags';
  return 'Branches';
};

const BRANCH_NAME_SANITIZE_RE =
  /^\.|\/\.|\.\.|~|\^|:|\/$|\.lock$|\.lock\/|\\|\*|\s|^\s*$|\.$|\[|\]$/g;

export function sanitizeBranchNameInput(input: string, whitespaceChar = '-'): string {
  const trimmed = input.trim();
  if (trimmed === '') return '';
  const withoutLeadingDashes = trimmed.replace(/^-+/, '');
  if (withoutLeadingDashes === '') return '';
  return withoutLeadingDashes.replace(BRANCH_NAME_SANITIZE_RE, whitespaceChar);
}

export function createBranchNameValidator(
  refs: readonly GitRefInfo[],
): (value: string) => string | null {
  const localBranches = new Set(refs.filter((ref) => ref.type === 'head').map((ref) => ref.name));
  return (value: string): string | null => {
    const name = sanitizeBranchNameInput(value);
    if (name === '') return 'Branch name is required.';
    if (localBranches.has(name)) return `Branch "${name}" already exists.`;
    return null;
  };
}

export const createCheckoutPickOptions = (
  refs: readonly GitRefInfo[],
): readonly QuickPickOption[] => [
  ...BRANCH_QUICK_PICK_COMMANDS,
  ...refs.map((branch) => branchOption(branch)),
];

export const orderCheckoutPickOptions = (
  query: string,
  options: readonly QuickPickOption[],
): readonly QuickPickOption[] => {
  if (query.trim() === '') return options;
  const commands = options.filter((option) => option.value.startsWith('cmd:'));
  const refs = options.filter((option) => !option.value.startsWith('cmd:'));
  return [...refs, ...commands];
};

export const createRefPickOptions = (refs: readonly GitRefInfo[]): readonly QuickPickOption[] =>
  refs.map((branch) => branchOption(branch));

export const createBranchFromPickOptions = (
  refs: readonly GitRefInfo[],
): readonly QuickPickOption[] => [HEAD_REF_OPTION, ...createRefPickOptions(refs)];

export const createDetachedCheckoutPickOptions = (
  refs: readonly GitRefInfo[],
): readonly QuickPickOption[] => createRefPickOptions(refs.filter((ref) => ref.type !== 'tag'));

export const canDeleteBranch = (branch: GitRefInfo, mode: BranchQuickPickMode): boolean =>
  !branch.current && branch.type === 'head' && mode === 'switch';

export const isBranchPickDisabled = (
  branch: GitRefInfo,
  mode: BranchQuickPickMode,
  working: boolean,
): boolean => working || (mode === 'merge' && branch.current);
