import {
  type PickOption,
  pick as pickDialog,
  prompt,
} from '../../../browser/parts/dialogs/Dialog.js';
import { toast } from '../../../browser/parts/notifications/toastStore.js';
import type { GitRefInfo, GitStatusResult } from '../common/git.js';
import type { BranchGitAdapter } from './branchGitAdapter.js';
import {
  CHECKOUT_RECOVERY_OPTIONS,
  checkoutTargetForRef,
  isCheckoutBlockedError,
} from './branchQuickPickModel.js';

const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const CREATE_BRANCH_COMMAND = 'cmd:create';

export async function openBranchQuickPick({
  git,
  onAfter,
}: {
  readonly status: GitStatusResult;
  readonly git: BranchGitAdapter;
  readonly onAfter: () => void | Promise<void>;
}): Promise<void> {
  try {
    const { refs } = await git.listRefs();
    const options: PickOption[] = [
      {
        value: CREATE_BRANCH_COMMAND,
        label: 'Create Branch...',
        detail: 'Command',
      },
      ...refs.map((branch) => branchOption(branch)),
    ];

    const choice = await pickDialog({
      title: 'Switch Branch',
      placeholder: 'Select a branch or tag to checkout',
      emptyText: 'No branches or tags found.',
      options,
    });
    if (choice === null) return;

    if (choice === CREATE_BRANCH_COMMAND) {
      await createBranch(git, refs, onAfter);
    } else {
      const branch = refs.find((b) => b.id === choice);
      if (branch !== undefined) await checkoutBranchWithRecovery(git, branch, refs, onAfter);
    }
  } catch (err) {
    toast.error(msg(err));
  }
}

function branchOption(branch: GitRefInfo): PickOption {
  const hint = branch.current
    ? 'current branch'
    : branch.type === 'remoteHead'
      ? 'remote'
      : undefined;
  const detail =
    branch.type === 'remoteHead' ? 'Remote Branch' : branch.type === 'tag' ? 'Tag' : 'Branch';
  return {
    value: branch.id,
    label: branch.name,
    hint,
    detail,
  };
}

export async function checkoutBranchWithRecovery(
  git: BranchGitAdapter,
  branch: GitRefInfo,
  refs: readonly GitRefInfo[],
  onAfter: () => void | Promise<void>,
): Promise<void> {
  if (branch.current && branch.type === 'head') return;
  const target = checkoutTargetForRef(branch, refs);
  try {
    await git.checkout(target.branch, target.track === true ? { track: true } : undefined);
    await onAfter();
    toast.info(`Checked out ${target.branch}.`);
  } catch (err) {
    const message = msg(err);
    if (isCheckoutBlockedError(message)) {
      await recoverCheckout(git, target, onAfter);
      return;
    }
    throw err;
  }
}

async function recoverCheckout(
  git: BranchGitAdapter,
  target: { readonly branch: string; readonly track?: boolean },
  onAfter: () => void | Promise<void>,
): Promise<void> {
  const choice = await pickDialog({
    title: 'Your local changes would be overwritten',
    placeholder: 'Choose how to continue',
    emptyText: 'No checkout actions available.',
    options: CHECKOUT_RECOVERY_OPTIONS,
  });
  if (choice === null) return;

  if (choice === 'force') {
    await git.checkout(
      target.branch,
      target.track === true ? { force: true, track: true } : { force: true },
    );
  } else {
    const stash = await git.stash(`Before checkout ${target.branch}`, { includeUntracked: true });
    await git.checkout(target.branch, target.track === true ? { track: true } : undefined);
    if (choice === 'migrate' && stash.stashed) await git.stashPop();
  }

  await onAfter();
  if (choice === 'stash') toast.info(`Stashed changes and checked out ${target.branch}.`);
  else if (choice === 'migrate') toast.info(`Checked out ${target.branch} and reapplied changes.`);
  else toast.info(`Checked out ${target.branch}.`);
}

async function createBranch(
  git: BranchGitAdapter,
  refs: readonly GitRefInfo[],
  onAfter: () => void | Promise<void>,
): Promise<void> {
  const validate = createBranchNameValidator(refs);
  const name = (
    await prompt({
      title: 'Create Branch',
      label: 'Branch name',
      placeholder: 'feature/name',
      validate,
    })
  )?.trim();
  if (!name) return;
  const invalid = validate(name);
  if (invalid !== null) {
    toast.error(invalid);
    return;
  }
  await git.createBranch(name);
  await onAfter();
  toast.info(`Created and checked out ${name}.`);
}

function createBranchNameValidator(refs: readonly GitRefInfo[]): (value: string) => string | null {
  const localBranches = new Set(refs.filter((ref) => ref.type === 'head').map((ref) => ref.name));
  return (value: string): string | null => {
    const name = value.trim();
    if (name === '') return 'Branch name is required.';
    if (localBranches.has(name)) return `Branch "${name}" already exists.`;
    return null;
  };
}
