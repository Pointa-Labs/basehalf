import type {
  GitBranchInfo,
  GitBranchesArgs,
  GitBranchesResult,
  GitCheckoutArgs,
  GitCreateBranchArgs,
  GitDeleteBranchArgs,
  GitMergeArgs,
  GitMergeResult,
  GitOkResult,
  GitRefInfo,
  GitRefsArgs,
  GitRefsResult,
  GitRenameBranchArgs,
  GitTagArgs,
  GitTagDeleteArgs,
} from '../common/git.js';
import { type GitCommandHandler, runGit as git } from './gitCommandRunner.js';
import { parseStatus } from './gitParsers.js';
import { STATUS_ARGS } from './gitPorcelain.js';
import { assertBranchName, assertSafeRef } from './gitRefGuards.js';

export const branches: GitCommandHandler<GitBranchesArgs, GitBranchesResult> = async (
  args,
  ctx,
) => {
  const current = parseStatus((await git(ctx, [...STATUS_ARGS])).stdout).branch;
  const refs = args?.includeRemote === true ? ['refs/heads', 'refs/remotes'] : ['refs/heads'];
  const out = await git(ctx, [
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname)',
    ...refs,
  ]);
  const list: GitBranchInfo[] = [];
  for (const line of out.stdout.split('\n')) {
    const ref = line.trim();
    if (ref.startsWith('refs/heads/')) {
      const name = ref.slice('refs/heads/'.length);
      list.push({ name, current: name === current });
    } else if (ref.startsWith('refs/remotes/')) {
      const name = ref.slice('refs/remotes/'.length);
      if (name.endsWith('/HEAD')) continue;
      list.push({ name, current: false, remote: true });
    }
  }
  return { branches: list, current };
};

export const refs: GitCommandHandler<GitRefsArgs, GitRefsResult> = async (args, ctx) => {
  const current = parseStatus((await git(ctx, [...STATUS_ARGS])).stdout).branch;
  const patterns = ['refs/heads'];
  if (args?.includeRemote === true) patterns.push('refs/remotes');
  if (args?.includeTags === true) patterns.push('refs/tags');
  const out = await git(ctx, [
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname)%00%(objectname)%00%(upstream:short)',
    ...patterns,
  ]);
  const list: GitRefInfo[] = [];
  for (const line of out.stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const [ref, commit, upstream] = trimmed.split('\0');
    if (ref === undefined) continue;
    if (ref.startsWith('refs/heads/')) {
      const name = ref.slice('refs/heads/'.length);
      list.push({
        id: ref,
        name,
        type: 'head',
        current: name === current,
        ...(upstream !== undefined && upstream !== '' && { upstream }),
        ...(commit !== undefined && commit !== '' && { commit }),
      });
    } else if (ref.startsWith('refs/remotes/')) {
      const name = ref.slice('refs/remotes/'.length);
      if (name.endsWith('/HEAD')) continue;
      const slash = name.indexOf('/');
      list.push({
        id: ref,
        name,
        type: 'remoteHead',
        current: false,
        ...(slash > 0 && { remote: name.slice(0, slash) }),
        ...(commit !== undefined && commit !== '' && { commit }),
      });
    } else if (ref.startsWith('refs/tags/')) {
      const name = ref.slice('refs/tags/'.length);
      list.push({
        id: ref,
        name,
        type: 'tag',
        current: false,
        ...(commit !== undefined && commit !== '' && { commit }),
      });
    }
  }
  return { refs: list, current };
};

export const checkout: GitCommandHandler<GitCheckoutArgs, GitOkResult> = async (args, ctx) => {
  if (args.create === true) assertBranchName(args.branch, 'git.checkout branch');
  else assertSafeRef(args.branch, 'git.checkout ref');
  const force = args.force === true ? ['--force'] : [];
  const cmd =
    args.create === true
      ? ['checkout', ...force, '-b', args.branch]
      : ['checkout', ...force, ...(args.track === true ? ['--track'] : []), args.branch];
  await git(ctx, cmd);
  return { ok: true };
};

export const createBranch: GitCommandHandler<GitCreateBranchArgs, GitOkResult> = async (
  args,
  ctx,
) => {
  assertBranchName(args.name, 'git.createBranch');
  if (args.ref !== undefined) assertSafeRef(args.ref, 'git.createBranch ref');
  const start = args.ref !== undefined ? [args.ref] : [];
  const cmd =
    args.checkout === false
      ? ['branch', '--no-track', args.name, ...start]
      : ['checkout', '-b', args.name, '--no-track', ...start];
  await git(ctx, cmd);
  return { ok: true };
};

export const deleteBranch: GitCommandHandler<GitDeleteBranchArgs, GitOkResult> = async (
  args,
  ctx,
) => {
  assertBranchName(args.name, 'git.deleteBranch');
  await git(ctx, ['branch', args.force === true ? '-D' : '-d', args.name]);
  return { ok: true };
};

export const renameBranch: GitCommandHandler<GitRenameBranchArgs, GitOkResult> = async (
  args,
  ctx,
) => {
  assertBranchName(args.to, 'git.renameBranch to');
  if (args.from !== undefined) assertSafeRef(args.from, 'git.renameBranch from');
  const cmd =
    args.from !== undefined ? ['branch', '-m', args.from, args.to] : ['branch', '-m', args.to];
  await git(ctx, cmd);
  return { ok: true };
};

export const merge: GitCommandHandler<GitMergeArgs, GitMergeResult> = async (args, ctx) => {
  assertSafeRef(args.branch, 'git.merge');
  const res = await git(ctx, ['merge', args.branch], { acceptExitCodes: [0, 1] });
  if (res.exitCode === 0) {
    return { merged: true, conflicts: false, stdout: res.stdout, stderr: res.stderr };
  }
  const conflicts = /conflict/i.test(res.stdout) || /conflict/i.test(res.stderr);
  if (conflicts) {
    return { merged: false, conflicts: true, stdout: res.stdout, stderr: res.stderr };
  }
  throw new Error(`git merge failed: ${res.stderr.trim() || res.stdout.trim() || 'exit 1'}`);
};

export const tag: GitCommandHandler<GitTagArgs, GitOkResult> = async (args, ctx) => {
  assertBranchName(args.name, 'git.tag');
  if (args.ref !== undefined) assertSafeRef(args.ref, 'git.tag ref');
  await git(ctx, args.ref !== undefined ? ['tag', args.name, args.ref] : ['tag', args.name]);
  return { ok: true };
};

export const tagDelete: GitCommandHandler<GitTagDeleteArgs, GitOkResult> = async (args, ctx) => {
  assertSafeRef(args.name, 'git.tagDelete');
  await git(ctx, ['tag', '-d', args.name]);
  return { ok: true };
};
