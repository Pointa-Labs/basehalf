import {
  type Context,
  type GitRunOptions,
  type Handler,
  assertWorkspaceRelative,
  requireWorkspaceRoot,
} from '../../kernel/index.js';
import { parseBlame, parseLog, parseNameStatus, parseStashList, parseStatus } from './parse.js';
import type {
  GitApplyArgs,
  GitBlameArgs,
  GitBlameResult,
  GitBranchInfo,
  GitBranchesArgs,
  GitBranchesResult,
  GitCheckoutArgs,
  GitCherryPickArgs,
  GitCherryPickResult,
  GitCommitArgs,
  GitCommitFilesArgs,
  GitCommitFilesResult,
  GitCommitResult,
  GitConflictStagesArgs,
  GitConflictStagesResult,
  GitCreateBranchArgs,
  GitDeleteBranchArgs,
  GitDiffArgs,
  GitDiffRefArgs,
  GitDiffResult,
  GitLogArgs,
  GitLogResult,
  GitMergeArgs,
  GitMergeResult,
  GitOkResult,
  GitPathsArgs,
  GitPullArgs,
  GitPushArgs,
  GitRemoteResult,
  GitRenameBranchArgs,
  GitResetArgs,
  GitRevertArgs,
  GitRevertResult,
  GitSearchHistoryArgs,
  GitShowArgs,
  GitShowResult,
  GitStashArgs,
  GitStashListResult,
  GitStashRefArgs,
  GitStashResult,
  GitStatusResult,
  GitTagArgs,
  GitTagDeleteArgs,
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

/**
 * Validate a NEW branch name before interpolating it into a git arg. Blocks the
 * dangerous shapes (leading '-' → flag injection; whitespace/control chars; the
 * `~^:?*[\` git refname metacharacters; `..`). git's own `check-ref-format` is the
 * final authority — this is the injection guard, not a full refname validator.
 */
function assertBranchName(name: string, label: string): void {
  if (
    name === '' ||
    name.startsWith('-') ||
    name.includes('..') ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: blocking control chars is the point.
    /[\s~^:?*[\\\x00-\x1f]/.test(name)
  ) {
    throw new Error(`${label}: invalid branch name ${JSON.stringify(name)}`);
  }
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

export const push: Handler<GitPushArgs, GitRemoteResult> = async (args, ctx) => {
  // No upstream yet → set it (`push -u origin <branch>`); else a plain push.
  const st = parseStatus((await git(ctx, [...STATUS_ARGS])).stdout);
  const cmd =
    st.upstream !== null || st.branch === null ? ['push'] : ['push', '-u', 'origin', st.branch];
  // Force = --force-with-lease (never the unconditional --force): refuses to
  // overwrite upstream commits we haven't seen, so a force-push can't silently
  // clobber a teammate's work.
  if (args?.force === true) cmd.push('--force-with-lease');
  const res = await git(ctx, cmd, { timeoutMs: REMOTE_TIMEOUT_MS });
  return { stdout: res.stdout, stderr: res.stderr };
};

export const pull: Handler<GitPullArgs, GitRemoteResult> = async (args, ctx) => {
  const cmd = args?.rebase === true ? ['pull', '--rebase'] : ['pull'];
  const res = await git(ctx, cmd, { timeoutMs: REMOTE_TIMEOUT_MS });
  return { stdout: res.stdout, stderr: res.stderr };
};

export const fetch: Handler<unknown, GitRemoteResult> = async (_args, ctx) => {
  const res = await git(ctx, ['fetch'], { timeoutMs: REMOTE_TIMEOUT_MS });
  return { stdout: res.stdout, stderr: res.stderr };
};

export const branches: Handler<GitBranchesArgs, GitBranchesResult> = async (args, ctx) => {
  const current = parseStatus((await git(ctx, [...STATUS_ARGS])).stdout).branch;
  const refs = args?.includeRemote === true ? ['refs/heads', 'refs/remotes'] : ['refs/heads'];
  // `%(refname)` (full) so we can tell a local head from a remote-tracking ref.
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
      if (name.endsWith('/HEAD')) continue; // skip the symbolic origin/HEAD
      list.push({ name, current: false, remote: true });
    }
  }
  return { branches: list, current };
};

export const checkout: Handler<GitCheckoutArgs, GitOkResult> = async (args, ctx) => {
  await git(
    ctx,
    args.create === true ? ['checkout', '-b', args.branch] : ['checkout', args.branch],
  );
  return { ok: true };
};

export const createBranch: Handler<GitCreateBranchArgs, GitOkResult> = async (args, ctx) => {
  assertBranchName(args.name, 'git.createBranch');
  if (args.ref !== undefined) assertSafeRef(args.ref, 'git.createBranch ref');
  const start = args.ref !== undefined ? [args.ref] : [];
  // Default: create AND switch (VS Code's "Create Branch"). checkout:false just
  // creates it (`git branch <name> [start]`) without leaving the current branch.
  const cmd =
    args.checkout === false
      ? ['branch', args.name, ...start]
      : ['checkout', '-b', args.name, ...start];
  await git(ctx, cmd);
  return { ok: true };
};

export const deleteBranch: Handler<GitDeleteBranchArgs, GitOkResult> = async (args, ctx) => {
  assertSafeRef(args.name, 'git.deleteBranch');
  await git(ctx, ['branch', args.force === true ? '-D' : '-d', args.name]);
  return { ok: true };
};

export const merge: Handler<GitMergeArgs, GitMergeResult> = async (args, ctx) => {
  assertSafeRef(args.branch, 'git.merge');
  // A merge that hits conflicts exits 1 and leaves the work tree with markers —
  // that's a normal outcome the panel routes to the conflict UI, not an error.
  // Other non-zero exits (bad branch, etc.) still throw.
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

export const renameBranch: Handler<GitRenameBranchArgs, GitOkResult> = async (args, ctx) => {
  assertBranchName(args.to, 'git.renameBranch to');
  if (args.from !== undefined) assertSafeRef(args.from, 'git.renameBranch from');
  // `branch -m [from] to` renames `from` (or the current branch) to `to`.
  const cmd =
    args.from !== undefined ? ['branch', '-m', args.from, args.to] : ['branch', '-m', args.to];
  await git(ctx, cmd);
  return { ok: true };
};

export const init: Handler<unknown, GitOkResult> = async (_args, ctx) => {
  await git(ctx, ['init']);
  return { ok: true };
};

export const apply: Handler<GitApplyArgs, GitOkResult> = async (args, ctx) => {
  // Hunk-level staging: apply a single-hunk patch (extracted from git's own
  // diff bytes, so it round-trips cleanly). `--cached` targets the index;
  // `--reverse` unstages / discards. The patch comes via stdin (no shell).
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

export const stash: Handler<GitStashArgs, GitStashResult> = async (args, ctx) => {
  // Message via stdin-free args is fine — git stash takes -m <msg> as one arg, so
  // no shell escaping concern (ctx.git spawns argv, not a shell).
  const cmd =
    typeof args.message === 'string' && args.message.trim() !== ''
      ? ['stash', 'push', '-m', args.message]
      : ['stash', 'push'];
  const res = await git(ctx, cmd);
  // git prints "No local changes to save" and exits 0 when there's nothing to stash.
  return { stashed: !/no local changes to save/i.test(res.stdout) };
};

// A stash ref interpolated into an arg must be exactly `stash@{N}` — reject
// anything else so it can't smuggle a flag or another revision.
const STASH_REF = /^stash@\{\d+\}$/;
function assertStashRef(ref: string): void {
  if (!STASH_REF.test(ref)) throw new Error(`git stash: unsafe ref ${JSON.stringify(ref)}`);
}

export const stashPop: Handler<GitStashRefArgs, GitOkResult> = async (args, ctx) => {
  if (args?.ref !== undefined) assertStashRef(args.ref);
  // A pop can conflict (exit 1) — that's a normal outcome the panel surfaces via
  // the refreshed status, not an error. Omit ref → the latest stash.
  const cmd = args?.ref !== undefined ? ['stash', 'pop', args.ref] : ['stash', 'pop'];
  await git(ctx, cmd, { acceptExitCodes: [0, 1] });
  return { ok: true };
};

export const stashApply: Handler<GitStashRefArgs, GitOkResult> = async (args, ctx) => {
  if (args?.ref !== undefined) assertStashRef(args.ref);
  // Apply KEEPS the stash (vs pop, which drops it); a conflict exits 1.
  const cmd = args?.ref !== undefined ? ['stash', 'apply', args.ref] : ['stash', 'apply'];
  await git(ctx, cmd, { acceptExitCodes: [0, 1] });
  return { ok: true };
};

export const stashDrop: Handler<GitStashRefArgs, GitOkResult> = async (args, ctx) => {
  if (args?.ref !== undefined) assertStashRef(args.ref);
  const cmd = args?.ref !== undefined ? ['stash', 'drop', args.ref] : ['stash', 'drop'];
  await git(ctx, cmd);
  return { ok: true };
};

export const stashList: Handler<unknown, GitStashListResult> = async (_args, ctx) => {
  const res = await git(ctx, [
    'stash',
    'list',
    '--format=%gd%x1f%H%x1f%P%x1f%cI%x1f%an%x1f%ae%x1f%s',
  ]);
  return { entries: parseStashList(res.stdout) };
};

export const tag: Handler<GitTagArgs, GitOkResult> = async (args, ctx) => {
  assertBranchName(args.name, 'git.tag'); // tag names share git's refname rules
  if (args.ref !== undefined) assertSafeRef(args.ref, 'git.tag ref');
  await git(ctx, args.ref !== undefined ? ['tag', args.name, args.ref] : ['tag', args.name]);
  return { ok: true };
};

export const tagDelete: Handler<GitTagDeleteArgs, GitOkResult> = async (args, ctx) => {
  assertSafeRef(args.name, 'git.tagDelete');
  await git(ctx, ['tag', '-d', args.name]);
  return { ok: true };
};

export const cherryPick: Handler<GitCherryPickArgs, GitCherryPickResult> = async (args, ctx) => {
  assertSafeRef(args.ref, 'git.cherryPick');
  // A conflict exits 1 and leaves markers — a normal outcome routed to the
  // conflict UI, not an error. Other non-zero exits throw.
  const res = await git(ctx, ['cherry-pick', args.ref], { acceptExitCodes: [0, 1] });
  if (res.exitCode === 0) return { applied: true, conflicts: false };
  const conflicts = /conflict/i.test(res.stdout) || /conflict/i.test(res.stderr);
  if (conflicts) return { applied: false, conflicts: true };
  throw new Error(`git cherry-pick failed: ${res.stderr.trim() || res.stdout.trim() || 'exit 1'}`);
};

export const reset: Handler<GitResetArgs, GitOkResult> = async (args, ctx) => {
  assertSafeRef(args.ref, 'git.reset');
  const mode = args.mode ?? 'mixed';
  await git(ctx, ['reset', `--${mode}`, args.ref]);
  return { ok: true };
};

export const revert: Handler<GitRevertArgs, GitRevertResult> = async (args, ctx) => {
  assertSafeRef(args.ref, 'git.revert');
  // `--no-edit` keeps the default "Revert ..." message (no editor). A conflict
  // exits 1 and leaves markers — a normal outcome routed to the conflict UI.
  const res = await git(ctx, ['revert', '--no-edit', args.ref], { acceptExitCodes: [0, 1] });
  if (res.exitCode === 0) return { reverted: true, conflicts: false };
  const conflicts = /conflict/i.test(res.stdout) || /conflict/i.test(res.stderr);
  if (conflicts) return { reverted: false, conflicts: true };
  throw new Error(`git revert failed: ${res.stderr.trim() || res.stdout.trim() || 'exit 1'}`);
};

export const diff: Handler<GitDiffArgs, GitDiffResult> = async (args, ctx) => {
  assertWorkspaceRelative(args.path);
  const cmd =
    args.staged === true ? ['diff', '--cached', '--', args.path] : ['diff', '--', args.path];
  return { diff: (await git(ctx, cmd)).stdout };
};

export const searchHistory: Handler<GitSearchHistoryArgs, GitLogResult> = async (args, ctx) => {
  if (args.query === '') return { commits: [] };
  assertCount(args.maxCount, 'git.searchHistory maxCount');
  if (args.path !== undefined) assertWorkspaceRelative(args.path);
  // Pickaxe `-S<string>` = commits that changed the NUMBER of occurrences of the
  // string (the classic "when did this text appear/disappear"). The query is glued
  // to `-S` as ONE argv token, so it can never be re-read as a flag, and there's no
  // shell (the runner passes argv directly) — so no injection surface.
  const cmd = ['log', `--format=${LOG_FORMAT}`];
  if (args.maxCount !== undefined) cmd.push(`--max-count=${args.maxCount}`);
  if (args.ignoreCase === true) cmd.push('--regexp-ignore-case');
  cmd.push(`-S${args.query}`);
  if (args.path !== undefined) cmd.push('--', args.path);
  const res = await git(ctx, cmd, { acceptExitCodes: [0, 128] });
  return { commits: res.exitCode === 0 ? parseLog(res.stdout) : [] };
};

export const conflictStages: Handler<GitConflictStagesArgs, GitConflictStagesResult> = async (
  args,
  ctx,
) => {
  assertWorkspaceRelative(args.path);
  // The conflicted file's three index stages: 1 = base (common ancestor), 2 =
  // ours (current), 3 = theirs (incoming). `:N:./path` is the stage N blob at a
  // cwd-relative path. The stage digit is hard-coded (no injection) and the path
  // is workspace-validated; a missing stage exits 128 → null.
  const stage = async (n: 1 | 2 | 3): Promise<string | null> => {
    const res = await git(ctx, ['show', `:${n}:./${args.path}`], { acceptExitCodes: [0, 128] });
    return res.exitCode === 0 ? res.stdout : null;
  };
  return { base: await stage(1), ours: await stage(2), theirs: await stage(3) };
};

export const blame: Handler<GitBlameArgs, GitBlameResult> = async (args, ctx) => {
  assertWorkspaceRelative(args.path);
  const atRef = args.ref !== undefined && args.ref !== '';
  if (atRef) assertSafeRef(args.ref as string, 'git.blame');
  // --line-porcelain → a full header per line (simplest to parse). Exit 128 =
  // untracked / no history yet → no blame.
  const cmd = ['blame', '--line-porcelain'];
  if (atRef) cmd.push(args.ref as string);
  cmd.push('--', args.path);
  const res = await git(ctx, cmd, { acceptExitCodes: [0, 128] });
  return { lines: res.exitCode === 128 ? [] : parseBlame(res.stdout) };
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

export const commitFiles: Handler<GitCommitFilesArgs, GitCommitFilesResult> = async (args, ctx) => {
  assertSafeRef(args.ref, 'git.commitFiles');
  // `diff-tree --root` makes a root commit list its files as adds; `-r` recurses
  // into subtrees; `-z` + `--name-status` is the machine-readable rename-safe form.
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
