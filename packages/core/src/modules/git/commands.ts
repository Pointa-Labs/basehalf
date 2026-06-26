import {
  type Context,
  type GitRunOptions,
  type Handler,
  assertWorkspaceRelative,
  requireWorkspaceRoot,
} from '../../kernel/index.js';
import { parseStatus } from './parse.js';
import type {
  GitBranchesResult,
  GitCheckoutArgs,
  GitCommitArgs,
  GitCommitResult,
  GitDiffArgs,
  GitDiffResult,
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

/** Run git in the bound workspace root. */
const git = (
  ctx: Context,
  args: readonly string[],
  opts: Omit<GitRunOptions, 'cwd'> = {},
): ReturnType<Context['git']> => ctx.git(args, { cwd: requireWorkspaceRoot(ctx), ...opts });

function assertPaths(paths: readonly string[]): void {
  for (const p of paths) assertWorkspaceRelative(p);
}

export const status: Handler<unknown, GitStatusResult> = async (_args, ctx) => {
  // `git status` exits 128 outside a repo — treat that as "not a repo" so the
  // panel shows the Initialize affordance instead of surfacing an error.
  const res = await git(ctx, [...STATUS_ARGS], { acceptExitCodes: [0, 128] });
  if (res.exitCode !== 0) {
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
  // `<ref>:./<path>` is cwd-relative (so a subdir workspace resolves correctly).
  // Exit 128 = the path doesn't exist at that ref (a new file has no baseline).
  const res = await git(ctx, ['show', `${args.ref}:./${args.path}`], { acceptExitCodes: [0, 128] });
  return { content: res.exitCode === 0 ? res.stdout : null };
};
