import type {
  GitPublishArgs,
  GitPullArgs,
  GitPushArgs,
  GitRemoteInfo,
  GitRemoteResult,
  GitRemoteUrlArgs,
  GitRemoteUrlResult,
  GitRemotesResult,
  GitSyncArgs,
} from '../common/git.js';
import {
  type GitCommandContext,
  type GitCommandHandler,
  runGit as git,
} from './gitCommandRunner.js';
import { parseStatus } from './gitParsers.js';
import { STATUS_ARGS } from './gitPorcelain.js';
import { assertBranchName, assertSafeRemote } from './gitRefGuards.js';

const REMOTE_TIMEOUT_MS = 120_000;

async function gitRemotes(ctx: GitCommandContext): Promise<string[]> {
  const res = await git(ctx, ['remote']);
  return res.stdout
    .split(/\r?\n/)
    .map((remote) => remote.trim())
    .filter((remote) => remote !== '');
}

async function publishRemote(ctx: GitCommandContext, requested?: string): Promise<string> {
  if (requested !== undefined) {
    assertSafeRemote(requested);
    return requested;
  }

  const remotes = await gitRemotes(ctx);
  if (remotes.length === 0) {
    throw new Error('Your repository has no remotes configured to publish to.');
  }

  return remotes.includes('origin') ? 'origin' : (remotes[0] as string);
}

export function parseRemoteVerbose(stdout: string): GitRemoteInfo[] {
  const byName = new Map<string, { name: string; fetchUrl?: string; pushUrl?: string }>();
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const match = /^(\S+)\s+(.+?)\s+\((fetch|push)\)$/i.exec(trimmed);
    if (match === null) continue;
    const [, name, url, type] = match;
    if (name === undefined || url === undefined || type === undefined) continue;
    let remote = byName.get(name);
    if (remote === undefined) {
      remote = { name };
      byName.set(name, remote);
    }
    if (/fetch/i.test(type)) remote.fetchUrl = url;
    else remote.pushUrl = url;
  }
  return [...byName.values()].map((remote) => ({
    ...remote,
    isReadOnly: remote.pushUrl === undefined || remote.pushUrl === 'no_push',
  }));
}

async function gitRemoteInfos(ctx: GitCommandContext): Promise<GitRemoteInfo[]> {
  return parseRemoteVerbose((await git(ctx, ['remote', '--verbose'])).stdout);
}

function upstreamRemoteName(upstream: string | null): string | null {
  if (upstream === null) return null;
  const slash = upstream.indexOf('/');
  return slash > 0 ? upstream.slice(0, slash) : null;
}

export const push: GitCommandHandler<GitPushArgs, GitRemoteResult> = async (args, ctx) => {
  // No upstream yet -> publish to VS Code's default remote choice (origin when
  // available, otherwise the first configured remote); else a plain push.
  const st = parseStatus((await git(ctx, [...STATUS_ARGS])).stdout);
  let cmd: string[];
  if (st.upstream !== null || st.branch === null) {
    cmd = ['push'];
  } else {
    assertBranchName(st.branch, 'git.push branch');
    cmd = ['push', '-u', await publishRemote(ctx), st.branch];
  }
  // Force = --force-with-lease (never the unconditional --force): refuses to
  // overwrite upstream commits we haven't seen, so a force-push can't silently
  // clobber a teammate's work.
  if (args?.force === true) cmd.push('--force-with-lease');
  const res = await git(ctx, cmd, { timeoutMs: REMOTE_TIMEOUT_MS });
  return { stdout: res.stdout, stderr: res.stderr };
};

export const publish: GitCommandHandler<GitPublishArgs, GitRemoteResult> = async (args, ctx) => {
  const st = parseStatus((await git(ctx, [...STATUS_ARGS])).stdout);
  if (st.branch === null) {
    throw new Error('Please check out a branch to push to a remote.');
  }
  assertBranchName(st.branch, 'git.publish branch');
  const remote = await publishRemote(ctx, args?.remote);
  const res = await git(ctx, ['push', '-u', remote, st.branch], { timeoutMs: REMOTE_TIMEOUT_MS });
  return { stdout: res.stdout, stderr: res.stderr };
};

export const pull: GitCommandHandler<GitPullArgs, GitRemoteResult> = async (args, ctx) => {
  const st = parseStatus((await git(ctx, [...STATUS_ARGS])).stdout);
  if (st.branch === null) {
    throw new Error('Please check out a branch before pulling.');
  }
  if (st.upstream === null) {
    throw new Error('The current branch has no upstream branch. Use Publish Branch first.');
  }
  const cmd = args?.rebase === true ? ['pull', '--rebase'] : ['pull'];
  const res = await git(ctx, cmd, { timeoutMs: REMOTE_TIMEOUT_MS });
  return { stdout: res.stdout, stderr: res.stderr };
};

export const sync: GitCommandHandler<GitSyncArgs, GitRemoteResult> = async (args, ctx) => {
  const st = parseStatus((await git(ctx, [...STATUS_ARGS])).stdout);
  if (st.branch === null) return { stdout: '', stderr: '' };
  if (st.upstream === null) return publish({}, ctx);

  const pulled = await pull(args?.rebase === true ? { rebase: true } : {}, ctx);
  const remoteName = upstreamRemoteName(st.upstream);
  const remote =
    remoteName !== null
      ? (await gitRemoteInfos(ctx)).find((item) => item.name === remoteName)
      : undefined;
  if (remote?.isReadOnly === true) {
    return pulled;
  }

  const afterPull = parseStatus((await git(ctx, [...STATUS_ARGS])).stdout);
  if (afterPull.ahead <= 0) return pulled;

  const pushed = await push({}, ctx);
  return {
    stdout: [pulled.stdout, pushed.stdout].filter(Boolean).join('\n'),
    stderr: [pulled.stderr, pushed.stderr].filter(Boolean).join('\n'),
  };
};

export const fetch: GitCommandHandler<unknown, GitRemoteResult> = async (_args, ctx) => {
  const res = await git(ctx, ['fetch'], { timeoutMs: REMOTE_TIMEOUT_MS });
  return { stdout: res.stdout, stderr: res.stderr };
};

export const remoteUrl: GitCommandHandler<GitRemoteUrlArgs, GitRemoteUrlResult> = async (
  args,
  ctx,
) => {
  const remote = args?.remote ?? 'origin';
  // A remote name interpolated into the arg - constrain it (no leading '-' -> flag).
  assertSafeRemote(remote);
  // Exit 2 = no such remote (older git), 128 = other "not found"; both -> null.
  const res = await git(ctx, ['remote', 'get-url', remote], { acceptExitCodes: [0, 2, 128] });
  const url = res.exitCode === 0 ? res.stdout.trim() : '';
  return { url: url === '' ? null : url };
};

export const remotes: GitCommandHandler<unknown, GitRemotesResult> = async (_args, ctx) => {
  return { remotes: await gitRemoteInfos(ctx) };
};
