import type {
  GitOkResult,
  GitStashArgs,
  GitStashListResult,
  GitStashRefArgs,
  GitStashResult,
} from '../common/git.js';
import { type GitCommandHandler, runGit as git } from './gitCommandRunner.js';
import { parseStashList } from './gitParsers.js';

export const stash: GitCommandHandler<GitStashArgs, GitStashResult> = async (args, ctx) => {
  const cmd = ['stash', 'push'];
  if (args.includeUntracked === true) cmd.push('-u');
  if (typeof args.message === 'string' && args.message.trim() !== '') {
    cmd.push('-m', args.message);
  }
  const res = await git(ctx, cmd);
  return { stashed: !/no local changes to save/i.test(res.stdout) };
};

const STASH_REF = /^stash@\{\d+\}$/;

function assertStashRef(ref: string): void {
  if (!STASH_REF.test(ref)) throw new Error(`git stash: unsafe ref ${JSON.stringify(ref)}`);
}

export const stashPop: GitCommandHandler<GitStashRefArgs, GitOkResult> = async (args, ctx) => {
  if (args?.ref !== undefined) assertStashRef(args.ref);
  const cmd = args?.ref !== undefined ? ['stash', 'pop', args.ref] : ['stash', 'pop'];
  await git(ctx, cmd, { acceptExitCodes: [0, 1] });
  return { ok: true };
};

export const stashApply: GitCommandHandler<GitStashRefArgs, GitOkResult> = async (args, ctx) => {
  if (args?.ref !== undefined) assertStashRef(args.ref);
  const cmd = args?.ref !== undefined ? ['stash', 'apply', args.ref] : ['stash', 'apply'];
  await git(ctx, cmd, { acceptExitCodes: [0, 1] });
  return { ok: true };
};

export const stashDrop: GitCommandHandler<GitStashRefArgs, GitOkResult> = async (args, ctx) => {
  if (args?.ref !== undefined) assertStashRef(args.ref);
  const cmd = args?.ref !== undefined ? ['stash', 'drop', args.ref] : ['stash', 'drop'];
  await git(ctx, cmd);
  return { ok: true };
};

export const stashList: GitCommandHandler<unknown, GitStashListResult> = async (_args, ctx) => {
  const res = await git(ctx, [
    'stash',
    'list',
    '--format=%gd%x1f%H%x1f%P%x1f%cI%x1f%an%x1f%ae%x1f%s',
  ]);
  return { entries: parseStashList(res.stdout) };
};
