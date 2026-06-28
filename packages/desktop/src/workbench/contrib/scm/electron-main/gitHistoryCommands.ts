import {
  type GitCommitFilesArgs,
  type GitCommitFilesResult,
  type GitDiffRefArgs,
  type GitDiffResult,
  GitErrorCodes,
  type GitLogArgs,
  type GitLogResult,
  type GitMergeBaseArgs,
  type GitMergeBaseResult,
  type GitSearchHistoryArgs,
  assignGitErrorCode,
  createGitErrorFromResult,
  ensureGitError,
} from '../common/git.js';
import {
  type GitCommandContext,
  type GitCommandHandler,
  runGit as git,
} from './gitCommandRunner.js';
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
  let stdin: string | undefined;
  if (args.maxCount !== undefined) cmd.push(`--max-count=${args.maxCount}`);
  if (args.maxParents !== undefined) {
    assertCount(args.maxParents, 'git.log maxParents');
    cmd.push(`--max-parents=${args.maxParents}`);
  }
  if (args.skip !== undefined) cmd.push(`--skip=${args.skip}`);
  if (args.all === true) {
    cmd.push('--all');
  } else if (args.refNames !== undefined && args.refNames.length > 0) {
    const refs = await normalizeLogRefs(args.refNames, ctx);
    stdin = refs.join('\n');
    cmd.push('--stdin');
  } else {
    const ref = await normalizeLogRef(args.ref ?? 'HEAD', ctx);
    assertSafeRef(ref, 'git.log');
    cmd.push(ref);
  }
  if (args.path !== undefined) cmd.push('--', args.path);
  const res = await git(ctx, cmd, {
    acceptExitCodes: [0, 128],
    ...(stdin !== undefined && { stdin }),
  });
  if (res.exitCode !== 0) {
    if (isEmptyRepositoryLogFailure(res.stderr)) {
      return { commits: [] };
    }
    throw normalizeLogError(createGitErrorFromResult(res, cmd));
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

async function normalizeLogRefs(
  refs: readonly string[],
  ctx: GitCommandContext,
): Promise<readonly string[]> {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const value = await normalizeLogRef(ref, ctx);
    if (seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

async function normalizeLogRef(ref: string, ctx: GitCommandContext): Promise<string> {
  assertSafeRef(ref, 'git.log');
  if (isRevisionExpression(ref)) return ref;

  const headRef = `refs/heads/${ref}`;
  const remoteRef = `refs/remotes/${ref}`;
  const tagRef = `refs/tags/${ref}`;
  const result = await git(ctx, [
    'for-each-ref',
    '--format=%(refname)',
    headRef,
    remoteRef,
    tagRef,
  ]);
  const matches = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (matches.length === 0) return ref;
  if (matches.length === 1) return matches[0] ?? ref;
  return (
    (ref.includes('/') ? matches.find((match) => match === remoteRef) : undefined) ??
    matches.find((match) => match === headRef) ??
    matches.find((match) => match === tagRef) ??
    matches[0] ??
    ref
  );
}

function normalizeLogError(err: unknown): Error {
  const gitError = ensureGitError(err);
  if (
    /fatal: ambiguous argument|fatal: bad revision|unknown revision|Needed a single revision/i.test(
      gitError.stderr ?? '',
    )
  ) {
    return assignGitErrorCode(gitError, GitErrorCodes.BadRevision);
  }
  return gitError;
}

function isEmptyRepositoryLogFailure(stderr: string): boolean {
  return /does not have any commits yet|bad default revision|bad revision 'HEAD'|ambiguous argument 'HEAD'|unknown revision.*HEAD/i.test(
    stderr,
  );
}

function isRevisionExpression(ref: string): boolean {
  return ref === 'HEAD' || ref.startsWith('refs/') || /(?:\.\.|\^|~|@\{)/.test(ref);
}
