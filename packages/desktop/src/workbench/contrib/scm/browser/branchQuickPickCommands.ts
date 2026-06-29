import { confirm, prompt } from '../../../../platform/dialogs/browser/dialogService.js';
import { toast } from '../../../../platform/notification/browser/notificationService.js';
import {
  pick,
  pickWithInputValue,
} from '../../../../platform/quickinput/browser/quickInputService.js';
import { GitErrorCodes, type GitRefInfo, ensureGitError } from '../common/git.js';
import type { BranchGitAdapter } from './branchGitAdapter.js';
import {
  type BranchQuickPickCommand,
  CHECKOUT_RECOVERY_OPTIONS,
  branchOption,
  checkoutTargetForRef,
  createBranchFromPickOptions,
  createBranchNameValidator,
  createCheckoutPickOptions,
  createDetachedCheckoutPickOptions,
  detachedCheckoutTargetForRef,
  isCheckoutBlockedError,
  orderCheckoutPickOptions,
  sanitizeBranchNameInput,
} from './branchQuickPickModel.js';

const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

interface CheckoutBranchCommandArgs {
  readonly git: BranchGitAdapter;
  readonly onAfter: () => void | Promise<void>;
}

export async function runCheckoutBranchCommand(args: CheckoutBranchCommandArgs): Promise<void> {
  try {
    await openBranchQuickPick(args);
  } catch (err) {
    toast.error(msg(err));
  }
}

export async function runCreateBranchFromCommand(args: CheckoutBranchCommandArgs): Promise<void> {
  try {
    const { refs } = await args.git.listRefs();
    await createBranchFrom(args.git, refs, args.onAfter);
  } catch (err) {
    toast.error(msg(err));
  }
}

export async function runMergeBranchCommand(args: CheckoutBranchCommandArgs): Promise<void> {
  try {
    await mergeBranch(args);
  } catch (err) {
    toast.error(msg(err));
  }
}

export async function runRebaseBranchCommand(args: CheckoutBranchCommandArgs): Promise<void> {
  try {
    await rebaseBranch(args);
  } catch (err) {
    toast.error(msg(err));
  }
}

export async function runRenameBranchCommand(args: CheckoutBranchCommandArgs): Promise<void> {
  try {
    await renameCurrentBranch(args);
  } catch (err) {
    toast.error(msg(err));
  }
}

export async function runDeleteBranchCommand(args: CheckoutBranchCommandArgs): Promise<void> {
  try {
    await deleteBranch(args);
  } catch (err) {
    toast.error(msg(err));
  }
}

async function openBranchQuickPick({ git, onAfter }: CheckoutBranchCommandArgs): Promise<void> {
  const { refs } = await git.listRefs();

  const choice = await pickWithInputValue({
    title: 'Checkout Branch/Tag',
    placeholder: 'Select a branch or tag to checkout',
    emptyText: 'No branches or tags found.',
    options: createCheckoutPickOptions(refs),
    sortOptions: orderCheckoutPickOptions,
  });
  if (choice === null) return;

  if (isBranchQuickPickCommand(choice.value)) {
    await runBranchQuickPickCommand(choice.value, choice.inputValue, git, refs, onAfter);
  } else {
    const branch = refs.find((b) => b.id === choice.value);
    if (branch !== undefined) await checkoutBranchWithRecovery(git, branch, refs, onAfter);
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

async function mergeBranch({ git, onAfter }: CheckoutBranchCommandArgs): Promise<void> {
  const { refs } = await git.listRefs();
  const candidates = refs.filter(
    (ref) =>
      (ref.type === 'head' || ref.type === 'remoteHead' || ref.type === 'tag') &&
      !(ref.type === 'head' && ref.current),
  );
  const choice = await pick({
    title: 'Merge',
    placeholder: 'Select a branch or tag to merge from',
    emptyText: 'No branches or tags found.',
    options: candidates.map(branchOption),
  });
  if (choice === null) return;
  const branch = candidates.find((ref) => ref.id === choice);
  if (branch === undefined) return;

  const result = await git.merge(branch.name);
  await onAfter();
  if (result.conflicts) {
    toast.info(`Merged ${branch.name} with conflicts.`);
  } else if (result.merged) {
    toast.info(`Merged ${branch.name}.`);
  } else {
    toast.info(`Already up to date with ${branch.name}.`);
  }
}

async function rebaseBranch({ git, onAfter }: CheckoutBranchCommandArgs): Promise<void> {
  const { current, refs } = await git.listRefs();
  const currentBranch = currentLocalBranch(refs, current);
  if (currentBranch === null) {
    toast.error('A current branch is required to rebase.');
    return;
  }

  const candidates = rebaseBranchCandidates(refs, currentBranch);
  const upstream = currentBranchRef(refs, currentBranch)?.upstream;
  const choice = await pick({
    title: 'Rebase Branch',
    placeholder: 'Select a branch to rebase onto',
    emptyText: 'No branches found.',
    options: candidates.map((branch) => rebaseBranchOption(branch, upstream)),
  });
  if (choice === null) return;
  const branch = candidates.find((ref) => ref.id === choice);
  if (branch === undefined) return;

  const result = await git.rebase(branch.name);
  await onAfter();
  if (result.conflicts) {
    toast.info(`Rebase onto ${branch.name} stopped with conflicts.`);
  } else {
    toast.info(`Rebased current branch onto ${branch.name}.`);
  }
}

async function renameCurrentBranch({ git, onAfter }: CheckoutBranchCommandArgs): Promise<void> {
  const { current, refs } = await git.listRefs();
  const currentBranch = currentLocalBranch(refs, current);
  if (currentBranch === null) {
    toast.error('A current branch is required to rename.');
    return;
  }

  const validate = createBranchNameValidator(refs);
  const validateRename = (value: string): string | null => {
    const name = sanitizeBranchNameInput(value);
    return name === currentBranch ? null : validate(value);
  };
  const rawName = await prompt({
    title: 'Rename Branch',
    label: 'New branch name',
    placeholder: 'feature/name',
    defaultValue: currentBranch,
    validate: validateRename,
  });
  const name = rawName == null ? undefined : sanitizeBranchNameInput(rawName);
  if (!name || name === currentBranch) return;
  const invalid = validateRename(rawName ?? '');
  if (invalid !== null) {
    toast.error(invalid);
    return;
  }

  await git.renameCurrent(name);
  await onAfter();
  toast.info(`Renamed branch to ${name}.`);
}

async function deleteBranch({ git, onAfter }: CheckoutBranchCommandArgs): Promise<void> {
  const { refs } = await git.listRefs();
  const candidates = refs.filter((ref) => ref.type === 'head' && !ref.current);
  const choice = await pick({
    title: 'Delete Branch',
    placeholder: 'Select a branch to delete',
    emptyText: 'No local branches to delete.',
    options: candidates.map(branchOption),
  });
  if (choice === null) return;
  const branch = candidates.find((ref) => ref.id === choice);
  if (branch === undefined) return;
  const ok = await confirm({
    title: `Delete branch ${branch.name}?`,
    confirmText: 'Delete Branch',
    destructive: true,
  });
  if (!ok) return;

  const deleted = await deleteBranchWithRecovery(git, branch.name);
  if (!deleted) return;
  await onAfter();
  toast.info(`Deleted branch ${branch.name}.`);
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
  const rawName =
    inputValue.trim() !== ''
      ? inputValue
      : await prompt({
          title: 'Create Branch',
          label: 'Branch name',
          placeholder: 'feature/name',
          validate,
        });
  const name = rawName == null ? undefined : sanitizeBranchNameInput(rawName);
  if (!name) return;
  const invalid = validate(rawName ?? '');
  if (invalid !== null) {
    toast.error(invalid);
    return;
  }
  await git.createBranch(name);
  await onAfter();
  toast.info(`Created and checked out ${name}.`);
}

function currentLocalBranch(refs: readonly GitRefInfo[], current: string | null): string | null {
  const currentRef = refs.find((ref) => ref.type === 'head' && ref.current);
  if (currentRef !== undefined) return currentRef.name;
  if (current === null) return null;
  return refs.some((ref) => ref.type === 'head' && ref.name === current) ? current : null;
}

function currentBranchRef(
  refs: readonly GitRefInfo[],
  currentBranch: string,
): GitRefInfo | undefined {
  return refs.find((ref) => ref.type === 'head' && ref.name === currentBranch);
}

function rebaseBranchCandidates(
  refs: readonly GitRefInfo[],
  currentBranch: string,
): readonly GitRefInfo[] {
  const upstream = currentBranchRef(refs, currentBranch)?.upstream;
  const upstreamRef =
    upstream === undefined
      ? undefined
      : refs.find((ref) => ref.type === 'remoteHead' && ref.name === upstream);
  const candidates = refs.filter((ref) => {
    if (ref.type !== 'head' && ref.type !== 'remoteHead') return false;
    if (ref.type === 'head' && ref.name === currentBranch) return false;
    return !(upstream !== undefined && ref.type === 'remoteHead' && ref.name === upstream);
  });
  return upstreamRef === undefined ? candidates : [upstreamRef, ...candidates];
}

function rebaseBranchOption(branch: GitRefInfo, upstream: string | undefined) {
  const option = branchOption(branch);
  if (branch.type !== 'remoteHead' || branch.name !== upstream) return option;
  const { separator: _separator, ...upstreamOption } = option;
  return { ...upstreamOption, hint: '(upstream)' };
}

async function deleteBranchWithRecovery(git: BranchGitAdapter, name: string): Promise<boolean> {
  try {
    await git.deleteBranch(name);
    return true;
  } catch (err) {
    const gitError = ensureGitError(err);
    if (gitError.gitErrorCode !== GitErrorCodes.BranchNotFullyMerged) {
      throw gitError;
    }
    const ok = await confirm({
      title: `Branch ${name} is not fully merged. Force delete?`,
      confirmText: 'Force Delete',
      destructive: true,
    });
    if (!ok) return false;
    await git.deleteBranch(name, { force: true });
    return true;
  }
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
  const rawName =
    inputValue.trim() !== ''
      ? inputValue
      : await prompt({
          title: 'Create Branch From',
          label: 'Branch name',
          placeholder: 'feature/name',
          validate,
        });
  const name = rawName == null ? undefined : sanitizeBranchNameInput(rawName);
  if (!name) return;
  const invalid = validate(rawName ?? '');
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
