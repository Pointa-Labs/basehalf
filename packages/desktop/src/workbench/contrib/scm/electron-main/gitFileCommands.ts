import type {
  GitBlameArgs,
  GitBlameResult,
  GitConflictStagesArgs,
  GitConflictStagesResult,
  GitDiffArgs,
  GitDiffResult,
  GitShowArgs,
  GitShowResult,
} from '../common/git.js';
import { type GitCommandHandler, runGit as git } from './gitCommandRunner.js';
import { parseBlame } from './gitParsers.js';
import { assertWorkspaceRelative } from './gitPathGuards.js';
import { assertSafeRef } from './gitRefGuards.js';

export const diff: GitCommandHandler<GitDiffArgs, GitDiffResult> = async (args, ctx) => {
  assertWorkspaceRelative(args.path);
  const cmd =
    args.staged === true ? ['diff', '--cached', '--', args.path] : ['diff', '--', args.path];
  return { diff: (await git(ctx, cmd)).stdout };
};

export const conflictStages: GitCommandHandler<
  GitConflictStagesArgs,
  GitConflictStagesResult
> = async (args, ctx) => {
  assertWorkspaceRelative(args.path);
  const stage = async (n: 1 | 2 | 3): Promise<string | null> => {
    const res = await git(ctx, ['show', `:${n}:./${args.path}`], { acceptExitCodes: [0, 128] });
    return res.exitCode === 0 ? res.stdout : null;
  };
  return { base: await stage(1), ours: await stage(2), theirs: await stage(3) };
};

export const blame: GitCommandHandler<GitBlameArgs, GitBlameResult> = async (args, ctx) => {
  assertWorkspaceRelative(args.path);
  const atRef = args.ref !== undefined && args.ref !== '';
  if (atRef) assertSafeRef(args.ref as string, 'git.blame');
  const cmd = ['blame', '--line-porcelain'];
  if (atRef) cmd.push(args.ref as string);
  cmd.push('--', args.path);
  const res = await git(ctx, cmd, { acceptExitCodes: [0, 128] });
  return { lines: res.exitCode === 128 ? [] : parseBlame(res.stdout) };
};

export const show: GitCommandHandler<GitShowArgs, GitShowResult> = async (args, ctx) => {
  assertWorkspaceRelative(args.path);
  if (args.ref !== '') assertSafeRef(args.ref, 'git.show');
  const res = await git(ctx, ['show', `${args.ref}:./${args.path}`], { acceptExitCodes: [0, 128] });
  return { content: res.exitCode === 0 ? res.stdout : null };
};
