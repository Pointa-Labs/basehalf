import type {
  GitApplyArgs,
  GitCommitArgs,
  GitCommitResult,
  GitOkResult,
  GitPathsArgs,
  GitStatusResult,
} from '../common/git.js';
import { type GitCommandHandler, runGit as git } from './gitCommandRunner.js';
import { parseStatus } from './gitParsers.js';
import { assertWorkspaceRelative } from './gitPathGuards.js';
import { STATUS_ARGS } from './gitPorcelain.js';

/**
 * Index/worktree commands are explicit user actions routed from the SCM UI.
 * Path args are workspace-relative and validated; git's `--` pathspec separator
 * remains the final containment backstop.
 */

function assertPaths(paths: readonly string[]): void {
  for (const p of paths) assertWorkspaceRelative(p);
}

function isUnbornHeadError(stderr: string): boolean {
  return /ambiguous argument 'HEAD'|bad revision 'HEAD'|unknown revision.*HEAD|Needed a single revision|Failed to resolve 'HEAD'/i.test(
    stderr,
  );
}

export const status: GitCommandHandler<unknown, GitStatusResult> = async (_args, ctx) => {
  const res = await git(ctx, [...STATUS_ARGS], { acceptExitCodes: [0, 128] });
  if (res.exitCode !== 0) {
    if (/not a git repository/i.test(res.stderr)) {
      return {
        isRepo: false,
        branch: null,
        detached: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        files: [],
      };
    }
    throw new Error(`git status failed: ${res.stderr.trim() || `exit ${res.exitCode}`}`);
  }
  return { isRepo: true, ...parseStatus(res.stdout) };
};

export const stage: GitCommandHandler<GitPathsArgs, GitOkResult> = async (args, ctx) => {
  assertPaths(args.paths);
  if (args.paths.length > 0) await git(ctx, ['add', '--', ...args.paths]);
  return { ok: true };
};

export const unstage: GitCommandHandler<GitPathsArgs, GitOkResult> = async (args, ctx) => {
  assertPaths(args.paths);
  if (args.paths.length > 0) {
    const res = await git(ctx, ['reset', '-q', 'HEAD', '--', ...args.paths], {
      acceptExitCodes: [0, 1, 128],
    });
    if (res.exitCode === 128) {
      if (!isUnbornHeadError(res.stderr)) {
        throw new Error(`git unstage failed: ${res.stderr.trim() || 'exit 128'}`);
      }
      await git(ctx, ['rm', '--cached', '-r', '--', ...args.paths], { acceptExitCodes: [0, 1] });
    }
  }
  return { ok: true };
};

export const stageAll: GitCommandHandler<unknown, GitOkResult> = async (_args, ctx) => {
  await git(ctx, ['add', '-A']);
  return { ok: true };
};

export const unstageAll: GitCommandHandler<unknown, GitOkResult> = async (_args, ctx) => {
  const res = await git(ctx, ['reset', '-q', 'HEAD'], { acceptExitCodes: [0, 1, 128] });
  if (res.exitCode === 128) {
    if (!isUnbornHeadError(res.stderr)) {
      throw new Error(`git unstage failed: ${res.stderr.trim() || 'exit 128'}`);
    }
    await git(ctx, ['rm', '--cached', '-r', '.'], { acceptExitCodes: [0, 1] });
  }
  return { ok: true };
};

export const discard: GitCommandHandler<GitPathsArgs, GitOkResult> = async (args, ctx) => {
  assertPaths(args.paths);
  if (args.paths.length > 0) await git(ctx, ['checkout', '--', ...args.paths]);
  return { ok: true };
};

export const commit: GitCommandHandler<GitCommitArgs, GitCommitResult> = async (args, ctx) => {
  if (typeof args.message !== 'string' || args.message.trim() === '') {
    throw new Error('A commit message is required.');
  }
  const cmd = ['commit', '-F', '-'];
  if (args.amend === true) cmd.push('--amend');
  await git(ctx, cmd, { stdin: args.message });
  return { committed: true };
};

export const init: GitCommandHandler<unknown, GitOkResult> = async (_args, ctx) => {
  await git(ctx, ['init']);
  return { ok: true };
};

export const apply: GitCommandHandler<GitApplyArgs, GitOkResult> = async (args, ctx) => {
  if (typeof args.patch !== 'string' || args.patch.trim() === '') {
    throw new Error('git.apply: empty patch');
  }
  const cmd = ['apply'];
  if (args.cached === true) cmd.push('--cached');
  if (args.reverse === true) cmd.push('--reverse');
  cmd.push('-');
  await git(ctx, cmd, { stdin: args.patch });
  return { ok: true };
};
