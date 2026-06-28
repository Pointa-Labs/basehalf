import type {
  GitCommitFilesArgs,
  GitCommitFilesResult,
  GitDiffRefArgs,
  GitDiffResult,
  GitLogArgs,
  GitLogResult,
  GitMergeBaseArgs,
  GitMergeBaseResult,
  GitSearchHistoryArgs,
} from '../common/git.js';
import { type GitCommandHandler, runGit as git } from './gitCommandRunner.js';
import { parseLog, parseNameStatus } from './gitParsers.js';
import { assertWorkspaceRelative } from './gitPathGuards.js';
import { assertCount, assertSafeRef } from './gitRefGuards.js';

/** The empty-tree object: diff target for a root commit, which has no parent. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

// Commit fields joined by US (\x1f), records ended by RS (\x1e). Order MUST
// match parseLog: hash, shortHash, parents, author/committer data, refs, subject, body.
const LOG_FORMAT = `${[
  '%H',
  '%h',
  '%P',
  '%an',
  '%ae',
  '%aI',
  '%cn',
  '%ce',
  '%cI',
  '%D',
  '%s',
  '%b',
].join('%x1f')}%x1e`;

export const searchHistory: GitCommandHandler<GitSearchHistoryArgs, GitLogResult> = async (
  args,
  ctx,
) => {
  if (args.query === '') return { commits: [] };
  assertCount(args.maxCount, 'git.searchHistory maxCount');
  if (args.path !== undefined) assertWorkspaceRelative(args.path);
  const cmd = ['log', '--topo-order', '--decorate=full', `--format=${LOG_FORMAT}`];
  if (args.maxCount !== undefined) cmd.push(`--max-count=${args.maxCount}`);
  if (args.ignoreCase === true) cmd.push('--regexp-ignore-case');
  cmd.push(`-S${args.query}`);
  if (args.path !== undefined) cmd.push('--', args.path);
  const res = await git(ctx, cmd, { acceptExitCodes: [0, 128] });
  return { commits: res.exitCode === 0 ? parseLog(res.stdout) : [] };
};

export const log: GitCommandHandler<GitLogArgs, GitLogResult> = async (args, ctx) => {
  assertCount(args.maxCount, 'git.log maxCount');
  assertCount(args.skip, 'git.log skip');
  if (args.path !== undefined) assertWorkspaceRelative(args.path);
  const cmd = ['log', '--topo-order', '--decorate=full', `--format=${LOG_FORMAT}`];
  if (args.maxCount !== undefined) cmd.push(`--max-count=${args.maxCount}`);
  if (args.skip !== undefined) cmd.push(`--skip=${args.skip}`);
  if (args.all === true) {
    cmd.push('--all');
  } else if (args.refNames !== undefined && args.refNames.length > 0) {
    for (const ref of args.refNames) {
      assertSafeRef(ref, 'git.log');
      cmd.push(ref);
    }
  } else {
    const ref = args.ref ?? 'HEAD';
    assertSafeRef(ref, 'git.log');
    cmd.push(ref);
  }
  if (args.path !== undefined) cmd.push('--', args.path);
  const res = await git(ctx, cmd, { acceptExitCodes: [0, 128] });
  if (res.exitCode !== 0) {
    if (
      /does not have any commits yet|bad default revision|bad revision 'HEAD'/i.test(res.stderr)
    ) {
      return { commits: [] };
    }
    throw new Error(`git log failed: ${res.stderr.trim() || `exit ${res.exitCode}`}`);
  }
  return { commits: parseLog(res.stdout) };
};

export const mergeBase: GitCommandHandler<GitMergeBaseArgs, GitMergeBaseResult> = async (
  args,
  ctx,
) => {
  for (const ref of args.refs) assertSafeRef(ref, 'git.mergeBase');
  if (args.refs.length < 2) return { ref: null };
  const res = await git(ctx, ['merge-base', ...args.refs], { acceptExitCodes: [0, 1, 128] });
  if (res.exitCode === 0) return { ref: res.stdout.trim() || null };
  if (res.exitCode === 1) return { ref: null };
  throw new Error(`git merge-base failed: ${res.stderr.trim() || `exit ${res.exitCode}`}`);
};

export const commitFiles: GitCommandHandler<GitCommitFilesArgs, GitCommitFilesResult> = async (
  args,
  ctx,
) => {
  assertSafeRef(args.ref, 'git.commitFiles');
  if (args.parent !== undefined) {
    assertSafeRef(args.parent, 'git.commitFiles parent');
    const res = await git(ctx, ['diff', '--name-status', '-z', args.parent, args.ref]);
    return { files: parseNameStatus(res.stdout) };
  }
  const res = await git(ctx, [
    'diff-tree',
    '--no-commit-id',
    '--name-status',
    '-r',
    '--root',
    '-z',
    args.ref,
  ]);
  return { files: parseNameStatus(res.stdout) };
};

export const diffRef: GitCommandHandler<GitDiffRefArgs, GitDiffResult> = async (args, ctx) => {
  assertSafeRef(args.to, 'git.diffRef to');
  if (args.from !== undefined) assertSafeRef(args.from, 'git.diffRef from');
  if (args.path !== undefined) assertWorkspaceRelative(args.path);
  const pathArgs = args.path !== undefined ? ['--', args.path] : [];
  const from = args.from ?? `${args.to}^`;
  const res = await git(ctx, ['diff', from, args.to, ...pathArgs], { acceptExitCodes: [0, 128] });
  if (res.exitCode === 0) return { diff: res.stdout };
  if (args.from === undefined) {
    return { diff: (await git(ctx, ['diff', EMPTY_TREE, args.to, ...pathArgs])).stdout };
  }
  throw new Error(`git diff failed: ${res.stderr.trim() || `exit ${res.exitCode}`}`);
};
