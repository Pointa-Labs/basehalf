import type { GitRefInfo, GitStatusResult } from '@basehalf/core';
import { type JSX, useState } from 'react';
import { color, font, radius, space, transition } from '../../design.js';
import { toast } from '../../store/toast.js';
import { Codicon } from '../Codicon.js';
import { type PickOption, confirm, pick as pickDialog, prompt } from '../Dialog.js';
import { type BranchGitAdapter, defaultBranchGitAdapter } from './branchGitAdapter.js';
import {
  CHECKOUT_RECOVERY_OPTIONS,
  canDeleteBranch,
  checkoutTargetForRef,
  isCheckoutBlockedError,
} from './branchQuickPickModel.js';

interface BranchQuickPickProps {
  readonly status: GitStatusResult;
  readonly disabled: boolean;
  readonly adapter?: BranchGitAdapter;
  /** Re-read git.status after a switch / merge / create (HEAD or tree changed). */
  readonly onAfter: () => void | Promise<void>;
  readonly variant?: 'scm' | 'statusBar';
}

const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export const BranchQuickPick = ({
  status,
  disabled,
  adapter,
  onAfter,
  variant = 'scm',
}: BranchQuickPickProps): JSX.Element => {
  const git = adapter ?? defaultBranchGitAdapter;
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const label = status.detached ? 'detached' : (status.branch ?? '-');

  const runPicker = (): void => {
    if (disabled || open) return;
    setOpen(true);
    void openBranchQuickPick({ status, git, onAfter }).finally(() => setOpen(false));
  };

  return (
    <button
      type="button"
      onClick={runPicker}
      disabled={disabled || open}
      title={status.upstream ?? 'Switch Branch'}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-testid={variant === 'statusBar' ? 'statusbar-branch' : 'scm-branch'}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={triggerStyle(variant, open || hover, disabled)}
    >
      <Codicon
        name="git-branch"
        size={variant === 'statusBar' ? 14 : 16}
        style={{ flexShrink: 0 }}
      />
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
          maxWidth: variant === 'statusBar' ? 200 : undefined,
        }}
      >
        {label}
      </span>
      {variant === 'scm' && <Codicon name="chevron-down" size={12} color={color.textGhost} />}
    </button>
  );
};

async function openBranchQuickPick({
  status,
  git,
  onAfter,
}: {
  readonly status: GitStatusResult;
  readonly git: BranchGitAdapter;
  readonly onAfter: () => void | Promise<void>;
}): Promise<void> {
  try {
    const { refs } = await git.listRefs();
    const branchRefs = refs.filter((ref) => ref.type === 'head' || ref.type === 'remoteHead');
    const options: PickOption[] = [
      ...refs.map((branch) => branchOption(branch)),
      { value: 'cmd:create', label: 'Create Branch...', detail: 'Command' },
      { value: 'cmd:merge', label: 'Merge into Current Branch...', detail: 'Command' },
      ...(!status.detached && status.branch !== null
        ? [{ value: 'cmd:rename', label: 'Rename Current Branch...', detail: 'Command' }]
        : []),
      { value: 'cmd:delete', label: 'Delete Branch...', detail: 'Command' },
    ];

    const choice = await pickDialog({
      title: 'Switch Branch',
      placeholder: 'Select a branch or tag to checkout',
      emptyText: 'No branches found.',
      options,
    });
    if (choice === null) return;

    if (choice === 'cmd:create') {
      await createBranch(git, onAfter);
    } else if (choice === 'cmd:merge') {
      await mergeBranch(git, refs, onAfter);
    } else if (choice === 'cmd:rename') {
      await renameCurrentBranch(git, status, onAfter);
    } else if (choice === 'cmd:delete') {
      await deleteBranch(git, branchRefs, onAfter);
    } else {
      const branch = refs.find((b) => b.id === choice);
      if (branch !== undefined) await checkoutBranch(git, branch, refs, onAfter);
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

async function checkoutBranch(
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
  onAfter: () => void | Promise<void>,
): Promise<void> {
  const name = (
    await prompt({
      title: 'Create Branch',
      label: 'Branch name',
      placeholder: 'feature/name',
    })
  )?.trim();
  if (!name) return;
  await git.createBranch(name);
  await onAfter();
  toast.info(`Created ${name}.`);
}

async function mergeBranch(
  git: BranchGitAdapter,
  branches: readonly GitRefInfo[],
  onAfter: () => void | Promise<void>,
): Promise<void> {
  const mergeable = branches.filter((branch) => !branch.current);
  const choice = await pickDialog({
    title: 'Merge into Current Branch',
    placeholder: 'Select a branch or tag to merge from',
    emptyText: 'No branches available to merge.',
    options: mergeable.map(branchOption),
  });
  if (choice === null) return;
  const ref = mergeable.find((item) => item.id === choice);
  if (ref === undefined) return;
  const result = await git.merge(choice);
  await onAfter();
  if (result.conflicts) toast.error(`Merge from ${ref.name} stopped on conflicts.`);
  else toast.info(`Merged ${ref.name}.`);
}

async function renameCurrentBranch(
  git: BranchGitAdapter,
  status: GitStatusResult,
  onAfter: () => void | Promise<void>,
): Promise<void> {
  if (status.detached || status.branch === null) return;
  const name = (
    await prompt({
      title: `Rename ${status.branch}`,
      label: 'New branch name',
      defaultValue: status.branch,
    })
  )?.trim();
  if (!name || name === status.branch) return;
  await git.renameCurrent(name);
  await onAfter();
  toast.info(`Renamed branch to ${name}.`);
}

async function deleteBranch(
  git: BranchGitAdapter,
  branches: readonly GitRefInfo[],
  onAfter: () => void | Promise<void>,
): Promise<void> {
  const deletable = branches.filter((branch) => canDeleteBranch(branch, 'switch'));
  const choice = await pickDialog({
    title: 'Delete Branch',
    placeholder: 'Select a branch to delete',
    emptyText: 'No local branches can be deleted.',
    options: deletable.map(branchOption),
  });
  if (choice === null) return;
  const branch = deletable.find((item) => item.id === choice);
  if (branch === undefined) return;

  const force = await confirm({
    title: `Delete branch "${branch.name}"?`,
    body: 'If it is not fully merged, you can force delete it after git rejects the safe delete.',
    confirmText: 'Delete',
    destructive: true,
  });
  if (!force) return;

  try {
    await git.deleteBranch(branch.name);
  } catch {
    const forceDelete = await confirm({
      title: `Force delete branch "${branch.name}"?`,
      body: 'This branch is not fully merged.',
      confirmText: 'Force Delete',
      destructive: true,
    });
    if (!forceDelete) return;
    await git.deleteBranch(branch.name, { force: true });
  }
  await onAfter();
  toast.info(`Deleted ${branch.name}.`);
}

function triggerStyle(
  variant: 'scm' | 'statusBar',
  highlighted: boolean,
  disabled: boolean,
): React.CSSProperties {
  if (variant === 'statusBar') {
    return {
      display: 'flex',
      alignItems: 'center',
      gap: space[1],
      height: 18,
      padding: `0 ${space[1]}px`,
      background: highlighted ? color.divider : 'none',
      border: 'none',
      borderRadius: radius.sm,
      color: disabled ? color.textGhost : color.textSecondary,
      fontFamily: font.sans,
      fontSize: font.size.micro,
      cursor: disabled ? 'default' : 'pointer',
      transition: transition(['background', 'color']),
    };
  }

  return {
    display: 'flex',
    alignItems: 'center',
    gap: space[2],
    minWidth: 0,
    maxWidth: '100%',
    padding: `2px ${space[2]}px`,
    margin: `-2px -${space[1]}px`,
    background: highlighted ? color.divider : 'none',
    border: 'none',
    borderRadius: radius.sm,
    color: disabled ? color.textGhost : color.textSecondary,
    fontFamily: font.sans,
    fontSize: font.size.caption,
    cursor: disabled ? 'default' : 'pointer',
    transition: transition(['background']),
  };
}
