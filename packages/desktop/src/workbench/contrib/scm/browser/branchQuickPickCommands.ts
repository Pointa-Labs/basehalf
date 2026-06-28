import { prompt } from '../../../../platform/dialogs/browser/dialogService.js';
import { toast } from '../../../../platform/notification/browser/notificationService.js';
import {
  pick,
  pickWithInputValue,
} from '../../../../platform/quickinput/browser/quickInputService.js';
import type { GitRefInfo } from '../common/git.js';
import type { BranchGitAdapter } from './branchGitAdapter.js';
import {
  type BranchQuickPickCommand,
  CHECKOUT_RECOVERY_OPTIONS,
  checkoutTargetForRef,
  createBranchFromPickOptions,
  createCheckoutPickOptions,
  createDetachedCheckoutPickOptions,
  detachedCheckoutTargetForRef,
  isCheckoutBlockedError,
  orderCheckoutPickOptions,
} from './branchQuickPickModel.js';

const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function openBranchQuickPick({
  git,
  onAfter,
}: {
  readonly git: BranchGitAdapter;
  readonly onAfter: () => void | Promise<void>;
}): Promise<void> {
  try {
    const { refs } = await git.listRefs();

    const choice = await pickWithInputValue({
      title: 'Switch Branch',
      placeholder: 'Select a branch or tag to checkout',
      emptyText: 'No branches or tags found.',
      options: createCheckoutPickOptions(refs),
      sortOptions: orderCheckoutPickOptions,
    });
    if (choice === null) return;

    if (isBranchQuickPickCommand(choice.value)) {
      await runBranchQuickPickCommand(choice.value, choice.inputValue.trim(), git, refs, onAfter);
    } else {
      const branch = refs.find((b) => b.id === choice.value);
      if (branch !== undefined) await checkoutBranchWithRecovery(git, branch, refs, onAfter);
    }
  } catch (err) {
    toast.error(msg(err));
  }
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

function isBranchQuickPickCommand(value: string): value is BranchQuickPickCommand {
  return value === 'cmd:create' || value === 'cmd:createFrom' || value === 'cmd:checkoutDetached';
}

async function runBranchQuickPickCommand(
  command: BranchQuickPickCommand,
  inputValue: string,
  git: BranchGitAdapter,
  refs: readonly GitRefInfo[],
  onAfter: () => void | Promise<void>,
): Promise<void> {
  if (command === 'cmd:create') {
    await createBranch(git, refs, onAfter, inputValue);
    return;
  }
  if (command === 'cmd:createFrom') {
    await createBranchFrom(git, refs, onAfter, inputValue);
    return;
  }
  await checkoutDetached(git, refs, onAfter);
}

async function recoverCheckout(
  git: BranchGitAdapter,
  target: { readonly branch: string; readonly track?: boolean; readonly detached?: boolean },
  onAfter: () => void | Promise<void>,
): Promise<void> {
  const choice = await pick({
    title: 'Your local changes would be overwritten',
    placeholder: 'Choose how to continue',
    emptyText: 'No checkout actions available.',
    options: CHECKOUT_RECOVERY_OPTIONS,
  });
  if (choice === null) return;

  if (choice === 'force') {
    await git.checkout(target.branch, checkoutOptions(target, { force: true }));
  } else {
    const stash = await git.stash(`Before checkout ${target.branch}`, { includeUntracked: true });
    await git.checkout(target.branch, checkoutOptions(target));
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
  inputValue = '',
): Promise<void> {
  const validate = createBranchNameValidator(refs);
  const name =
    inputValue.trim() !== ''
      ? inputValue.trim()
      : (
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

async function createBranchFrom(
  git: BranchGitAdapter,
  refs: readonly GitRefInfo[],
  onAfter: () => void | Promise<void>,
  inputValue = '',
): Promise<void> {
  const source = await pickRef('Create Branch From', refs, 'branchFrom');
  if (source === null) return;
  const validate = createBranchNameValidator(refs);
  const name =
    inputValue.trim() !== ''
      ? inputValue.trim()
      : (
          await prompt({
            title: 'Create Branch From',
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
  await git.createBranch(name, { ref: source.name });
  await onAfter();
  toast.info(`Created and checked out ${name}.`);
}

async function checkoutDetached(
  git: BranchGitAdapter,
  refs: readonly GitRefInfo[],
  onAfter: () => void | Promise<void>,
): Promise<void> {
  const source = await pickRef('Checkout Detached', refs, 'detached');
  if (source === null) return;
  if (!isGitRefInfo(source)) return;
  const target = detachedCheckoutTargetForRef(source);
  try {
    await git.checkout(target.branch, { detached: true });
    await onAfter();
    toast.info(`Checked out ${source.name} detached.`);
  } catch (err) {
    const message = msg(err);
    if (isCheckoutBlockedError(message)) {
      await recoverCheckout(git, target, onAfter);
      return;
    }
    throw err;
  }
}

async function pickRef(
  title: string,
  refs: readonly GitRefInfo[],
  mode: 'branchFrom' | 'detached',
): Promise<({ readonly name: string } & Partial<GitRefInfo>) | null> {
  const options =
    mode === 'branchFrom'
      ? createBranchFromPickOptions(refs)
      : createDetachedCheckoutPickOptions(refs);
  const choice = await pick({
    title,
    placeholder:
      mode === 'branchFrom' ? 'Select a ref to create the branch from' : 'Select a branch',
    emptyText: 'No branches or tags found.',
    options,
  });
  if (choice === null) return null;
  if (choice === 'HEAD') return { name: 'HEAD' };
  return refs.find((ref) => ref.id === choice) ?? null;
}

function isGitRefInfo(ref: { readonly name: string } & Partial<GitRefInfo>): ref is GitRefInfo {
  return (
    typeof ref.id === 'string' &&
    (ref.type === 'head' || ref.type === 'remoteHead' || ref.type === 'tag')
  );
}

function checkoutOptions(
  target: { readonly track?: boolean; readonly detached?: boolean },
  extra: { readonly force?: boolean } = {},
): { readonly detached?: boolean; readonly force?: boolean; readonly track?: boolean } | undefined {
  const options: { detached?: boolean; force?: boolean; track?: boolean } = {};
  if (target.detached === true) options.detached = true;
  if (target.track === true) options.track = true;
  if (extra.force === true) options.force = true;
  return Object.keys(options).length === 0 ? undefined : options;
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
