import {
  type Context,
  type GitRunOptions,
  type Handler,
  assertWorkspaceRelative,
  requireWorkspaceRoot,
} from '../../kernel/index.js';
import { parseLog, parseStatus } from './parse.js';
import type {
  GitBranchesResult,
  GitCheckoutArgs,
  GitCommitArgs,
  GitCommitResult,
  GitDiffArgs,
  GitDiffRefArgs,
  GitDiffResult,
  GitLogArgs,
  GitLogResult,
  GitOkResult,
  GitPathsArgs,
  GitRemoteResult,
  GitShowArgs,
  GitShowResult,
  GitStatusResult,
} from './types.js';

/**
 * The `git.*` commands: thin, faithful wrappers over the system git (run through
 * the injected `ctx.git`, cwd = the bound workspace root). Reads parse porcelain
 * into structured results; writes (stage/commit/discard…) are EXPLICIT user
 * actions, exempt from the "core never writes user files unprompted" rule the
 * same way workspace.deleteEntry / createFile are. Path args are workspace-
 * relative and validated; git's own `--`/pathspec containment is the backstop.
 */

const REMOTE_TIMEOUT_MS = 120_000;
const STATUS_ARGS = ['status', '--porcelain=v1', '-z', '--branch'] as const;

// A ref interpolated into a git arg (treeish, `<ref>:./path`, `<ref>^`) must be a
// safe git revision: a constrained charset and never a leading '-' (git would read
// it as a flag). `^`/`~`/`@`/`/` are valid in real refs (HEAD^, main~1, @{u}).
const SAFE_REF = /^[\w./~^@][\w./~^@-]*$/;

/** The empty-tree object — diff target for a root commit (which has no parent). */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Run git in the bound workspace root. */
const git = (
  ctx: Context,
  args: readonly string[],
  opts: Omit<GitRunOptions, 'cwd'> = {},
): ReturnType<Context['git']> => ctx.git(args, { cwd: requireWorkspaceRoot(ctx), ...opts });

function assertPaths(paths: readonly string[]): void {
  for (const p of paths) assertWorkspaceRelative(p);
}

function assertSafeRef(ref: string, label: string): void {
  if (!SAFE_REF.test(ref)) throw new Error(`${label}: unsafe ref ${JSON.stringify(ref)}`);
}

/** A non-negative integer arg destined for a `--flag=<n>` (template-injection guard). */
function assertCount(n: number | undefined, label: string): void {
  if (n !== undefined && (!Number.isInteger(n) || n < 0)) {
    throw new Error(`${label}: expected a non-negative integer, got ${JSON.stringify(n)}`);
  }
}

export const status: Handler<unknown, GitStatusResult> = async (_args, ctx) => {
  // `git status` exits 128 outside a repo — treat ONLY that as "not a repo" so the
  // panel shows the Initialize affordance. A 128 from a real fault (corrupt .git,
  // unreadable HEAD, bad config) must surface as an error, not masquerade as
  // "uninitialized" — otherwise clicking Initialize would run `git init` over an
  // already-broken repo and bury the real cause.
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

export const stage: Handler<GitPathsArgs, GitOkResult> = async (args, ctx) => {
  assertPaths(args.paths);
  if (args.paths.length > 0) await git(ctx, ['add', '--', ...args.paths]);
  return { ok: true };
};

export const unstage: Handler<GitPathsArgs, GitOkResult> = async (args, ctx) => {
  assertPaths(args.paths);
  // `reset` can exit 1 in benign cases (e.g. unmerged entries remain) — the
  // post-refresh status is the source of truth, so don't treat that as failure.
  if (args.paths.length > 0) {
    await git(ctx, ['reset', '-q', 'HEAD', '--', ...args.paths], { acceptExitCodes: [0, 1] });
  }
  return { ok: true };
};

export const stageAll: Handler<unknown, GitOkResult> = async (_args, ctx) => {
  await git(ctx, ['add', '-A']);
  return { ok: true };
};

export const unstageAll: Handler<unknown, GitOkResult> = async (_args, ctx) => {
  await git(ctx, ['reset', '-q', 'HEAD'], { acceptExitCodes: [0, 1] });
  return { ok: true };
};

export const discard: Handler<GitPathsArgs, GitOkResult> = async (args, ctx) => {
  assertPaths(args.paths);
  // Restore the WORK TREE to the index (throw away unstaged edits). Untracked
  // files aren't git's to restore — the panel routes those to workspace.deleteEntry.
  if (args.paths.length > 0) await git(ctx, ['checkout', '--', ...args.paths]);
  return { ok: true };
};

export const commit: Handler<GitCommitArgs, GitCommitResult> = async (args, ctx) => {
  // Reject an empty/whitespace message here rather than leaning on git's localized
  // "Aborting commit due to empty commit message" stderr (a fragile contract).
  if (typeof args.message !== 'string' || args.message.trim() === '') {
    throw new Error('A commit message is required.');
  }
  // Message via stdin (`-F -`) so there's no shell escaping. gpgsign is left to
  // the user's config (a signed-commit setup is honored).
  const cmd = ['commit', '-F', '-'];
  if (args.amend === true) cmd.push('--amend');
  await git(ctx, cmd, { stdin: args.message });
  return { committed: true };
};

export const push: Handler<unknown, GitRemoteResult> = async (_args, ctx) => {
  // No upstream yet → set it (`push -u origin <branch>`); else a plain push.
  const st = parseStatus((await git(ctx, [...STATUS_ARGS])).stdout);
  const cmd =
    st.upstream !== null || st.branch === null ? ['push'] : ['push', '-u', 'origin', st.branch];
  const res = await git(ctx, cmd, { timeoutMs: REMOTE_TIMEOUT_MS });
  return { stdout: res.stdout, stderr: res.stderr };
};

export const pull: Handler<unknown, GitRemoteResult> = async (_args, ctx) => {
  const res = await git(ctx, ['pull'], { timeoutMs: REMOTE_TIMEOUT_MS });
  return { stdout: res.stdout, stderr: res.stderr };
};

export const fetch: Handler<unknown, GitRemoteResult> = async (_args, ctx) => {
  const res = await git(ctx, ['fetch'], { timeoutMs: REMOTE_TIMEOUT_MS });
  return { stdout: res.stdout, stderr: res.stderr };
};

export const branches: Handler<unknown, GitBranchesResult> = async (_args, ctx) => {
  const current = parseStatus((await git(ctx, [...STATUS_ARGS])).stdout).branch;
  const out = await git(ctx, [
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname:short)',
    'refs/heads',
  ]);
  const names = out.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return { branches: names.map((name) => ({ name, current: name === current })), current };
};

export const checkout: Handler<GitCheckoutArgs, GitOkResult> = async (args, ctx) => {
  await git(
    ctx,
    args.create === true ? ['checkout', '-b', args.branch] : ['checkout', args.branch],
  );
  return { ok: true };
};

export const init: Handler<unknown, GitOkResult> = async (_args, ctx) => {
  await git(ctx, ['init']);
  return { ok: true };
};

export const diff: Handler<GitDiffArgs, GitDiffResult> = async (args, ctx) => {
  assertWorkspaceRelative(args.path);
  const cmd =
    args.staged === true ? ['diff', '--cached', '--', args.path] : ['diff', '--', args.path];
  return { diff: (await git(ctx, cmd)).stdout };
};

export const show: Handler<GitShowArgs, GitShowResult> = async (args, ctx) => {
  assertWorkspaceRelative(args.path);
  // Empty ref = the index version (`:./path`); any other ref must be safe.
  if (args.ref !== '') assertSafeRef(args.ref, 'git.show');
  // `<ref>:./<path>` is cwd-relative (so a subdir workspace resolves correctly).
  // Exit 128 = the path doesn't exist at that ref (a new file has no baseline).
  const res = await git(ctx, ['show', `${args.ref}:./${args.path}`], { acceptExitCodes: [0, 128] });
  return { content: res.exitCode === 0 ? res.stdout : null };
};

// Commit fields joined by US (\x1f), records ended by RS (\x1e). See parse.ts —
// these escapes emit the exact bytes parseLog splits on. Order MUST match parseLog:
// hash, shortHash, parents, author{n,e,date}, committer{n,e,date}, refs, subject, body.
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

export const log: Handler<GitLogArgs, GitLogResult> = async (args, ctx) => {
  assertCount(args.maxCount, 'git.log maxCount');
  assertCount(args.skip, 'git.log skip');
  if (args.path !== undefined) assertWorkspaceRelative(args.path);
  const cmd = ['log', `--format=${LOG_FORMAT}`];
  if (args.maxCount !== undefined) cmd.push(`--max-count=${args.maxCount}`);
  if (args.skip !== undefined) cmd.push(`--skip=${args.skip}`);
  if (args.all === true) {
    cmd.push('--all');
  } else {
    const ref = args.ref ?? 'HEAD';
    assertSafeRef(ref, 'git.log');
    cmd.push(ref);
  }
  if (args.path !== undefined) cmd.push('--', args.path);
  // An unborn branch (no commits yet) exits 128 — surface that as an empty history,
  // not an error (the graph/panel just shows nothing). A genuinely bad ref/flag also
  // exits 128, but the safe-ref guard above already rejected those before we got here.
  const res = await git(ctx, cmd, { acceptExitCodes: [0, 128] });
  if (res.exitCode !== 0) {
    if (/does not have any commits yet|bad default revision/i.test(res.stderr)) {
      return { commits: [] };
    }
    throw new Error(`git log failed: ${res.stderr.trim() || `exit ${res.exitCode}`}`);
  }
  return { commits: parseLog(res.stdout) };
};

export const diffRef: Handler<GitDiffRefArgs, GitDiffResult> = async (args, ctx) => {
  assertSafeRef(args.to, 'git.diffRef to');
  if (args.from !== undefined) assertSafeRef(args.from, 'git.diffRef from');
  if (args.path !== undefined) assertWorkspaceRelative(args.path);
  const pathArgs = args.path !== undefined ? ['--', args.path] : [];
  // No `from` → "what this commit changed" = its first parent vs itself (`to^ to`).
  const from = args.from ?? `${args.to}^`;
  const res = await git(ctx, ['diff', from, args.to, ...pathArgs], { acceptExitCodes: [0, 128] });
  if (res.exitCode === 0) return { diff: res.stdout };
  // A defaulted `to^` fails (128) when `to` is a root commit (no parent) — fall back
  // to diffing against the empty tree so a repo's first commit still shows its diff.
  if (args.from === undefined) {
    return { diff: (await git(ctx, ['diff', EMPTY_TREE, args.to, ...pathArgs])).stdout };
  }
  throw new Error(`git diff failed: ${res.stderr.trim() || `exit ${res.exitCode}`}`);
};
