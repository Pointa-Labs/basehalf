import type {
  GitCherryPickArgs,
  GitCherryPickResult,
  GitOkResult,
  GitRebaseInteractiveArgs,
  GitRebaseResult,
  GitResetArgs,
  GitRevertArgs,
  GitRevertResult,
} from '../common/git.js';
import { type GitCommandHandler, runGit as git } from './gitCommandRunner.js';
import { parseStatus } from './gitParsers.js';
import { STATUS_ARGS } from './gitPorcelain.js';
import { assertSafeRef } from './gitRefGuards.js';

export const cherryPick: GitCommandHandler<GitCherryPickArgs, GitCherryPickResult> = async (
  args,
  ctx,
) => {
  assertSafeRef(args.ref, 'git.cherryPick');
  const res = await git(ctx, ['cherry-pick', args.ref], { acceptExitCodes: [0, 1] });
  if (res.exitCode === 0) return { applied: true, conflicts: false };
  const conflicts = /conflict/i.test(res.stdout) || /conflict/i.test(res.stderr);
  if (conflicts) return { applied: false, conflicts: true };
  throw new Error(`git cherry-pick failed: ${res.stderr.trim() || res.stdout.trim() || 'exit 1'}`);
};

export const reset: GitCommandHandler<GitResetArgs, GitOkResult> = async (args, ctx) => {
  assertSafeRef(args.ref, 'git.reset');
  const mode = args.mode ?? 'mixed';
  if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') {
    throw new Error(`Invalid reset mode: ${String(mode)}`);
  }
  await git(ctx, ['reset', `--${mode}`, args.ref]);
  return { ok: true };
};

export const revert: GitCommandHandler<GitRevertArgs, GitRevertResult> = async (args, ctx) => {
  assertSafeRef(args.ref, 'git.revert');
  const res = await git(ctx, ['revert', '--no-edit', args.ref], { acceptExitCodes: [0, 1] });
  if (res.exitCode === 0) return { reverted: true, conflicts: false };
  const conflicts = /conflict/i.test(res.stdout) || /conflict/i.test(res.stderr);
  if (conflicts) return { reverted: false, conflicts: true };
  throw new Error(`git revert failed: ${res.stderr.trim() || res.stdout.trim() || 'exit 1'}`);
};

export const rebaseInteractive: GitCommandHandler<
  GitRebaseInteractiveArgs,
  GitRebaseResult
> = async (args, ctx) => {
  assertSafeRef(args.base, 'git.rebaseInteractive base');
  for (const it of args.items) assertSafeRef(it.sha, 'git.rebaseInteractive sha');
  const st = parseStatus((await git(ctx, [...STATUS_ARGS])).stdout);
  const trackedDirty = st.files.some((f) => !(f.x === '?' && f.y === '?'));
  if (trackedDirty) throw new Error('Commit or stash your working-tree changes before rebasing.');
  if (st.branch === null) throw new Error('Cannot rebase in a detached HEAD state.');
  const branch = st.branch;
  const anc = await git(ctx, ['merge-base', '--is-ancestor', args.base, 'HEAD'], {
    acceptExitCodes: [0, 1],
  });
  if (anc.exitCode !== 0) {
    throw new Error('The selected base is not an ancestor of the current branch.');
  }
  const originalHead = (await git(ctx, ['rev-parse', 'HEAD'])).stdout.trim();
  const plan = args.items.filter((i) => i.action !== 'drop');

  const restore = async (): Promise<void> => {
    await git(ctx, ['cherry-pick', '--abort'], { acceptExitCodes: [0, 128] });
    await git(ctx, ['checkout', '--force', branch], { acceptExitCodes: [0, 1, 128] });
    await git(ctx, ['reset', '--hard', originalHead], { acceptExitCodes: [0, 1] });
  };

  try {
    await git(ctx, ['checkout', '--detach', args.base]);
    let pickedAny = false;
    for (const item of plan) {
      if (item.action === 'fixup' && pickedAny) {
        const r = await git(ctx, ['cherry-pick', '-n', item.sha], { acceptExitCodes: [0, 1, 128] });
        if (r.exitCode !== 0) {
          await restore();
          return { ok: false, conflicts: true };
        }
        await git(ctx, ['commit', '--amend', '--no-edit']);
      } else {
        const r = await git(ctx, ['cherry-pick', item.sha], { acceptExitCodes: [0, 1, 128] });
        if (r.exitCode !== 0) {
          await restore();
          return { ok: false, conflicts: true };
        }
        pickedAny = true;
        if (item.action === 'reword' && typeof item.message === 'string' && item.message.trim()) {
          await git(ctx, ['commit', '--amend', '-F', '-'], { stdin: item.message });
        }
      }
    }
    await git(ctx, ['checkout', '-B', branch]);
    return { ok: true };
  } catch (e) {
    await restore();
    throw e;
  }
};
