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

async function publishRemote(ctx: GitCommandContext, requested?: string): Promise<string> {
  const remotes = await gitRemoteInfos(ctx);

  if (requested !== undefined) {
    assertSafeRemote(requested);
    const remote = remotes.find((item) => item.name === requested);
    if (remote === undefined) {
      throw new Error(`Remote ${JSON.stringify(requested)} is not configured.`);
    }
    if (remote.isReadOnly) {
      throw new Error(`Remote ${JSON.stringify(requested)} is read-only and cannot be pushed to.`);
    }
    return requested;
  }

  const writable = remotes.filter((remote) => !remote.isReadOnly);
  if (writable.length === 0) {
    throw new Error('Your repository has no writable remotes configured to publish to.');
  }
  if (writable.length === 1) return (writable[0] as GitRemoteInfo).name;

  throw new Error('Multiple writable remotes are configured. Choose a remote to publish to.');
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

async function assertWritableRemote(ctx: GitCommandContext, remoteName: string): Promise<void> {
  assertSafeRemote(remoteName);
  const remote = (await gitRemoteInfos(ctx)).find((item) => item.name === remoteName);
  if (remote === undefined) {
    throw new Error(`Remote ${JSON.stringify(remoteName)} is not configured.`);
  }
  if (remote.isReadOnly) {
    throw new Error(`Remote ${JSON.stringify(remoteName)} is read-only and cannot be pushed to.`);
  }
}

function upstreamRemoteName(upstream: string | null): string | null {
  return parseUpstream(upstream)?.remote ?? null;
}

function parseUpstream(upstream: string | null): { remote: string; branch: string } | null {
  if (upstream === null) return null;
  const slash = upstream.indexOf('/');
  if (slash <= 0 || slash === upstream.length - 1) return null;
  return { remote: upstream.slice(0, slash), branch: upstream.slice(slash + 1) };
}

export const push: GitCommandHandler<GitPushArgs, GitRemoteResult> = async (args, ctx) => {
  const st = parseStatus((await git(ctx, [...STATUS_ARGS])).stdout);
  let cmd: string[];
  const upstream = parseUpstream(st.upstream);
  if (upstream !== null) {
    await assertWritableRemote(ctx, upstream.remote);
    assertBranchName(upstream.branch, 'git.push upstream branch');
    cmd = ['push', upstream.remote, `HEAD:${upstream.branch}`];
  } else if (st.branch === null) {
    throw new Error('Please check out a branch to push to a remote.');
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
  const upstream = parseUpstream(st.upstream);
  const cmd = args?.rebase === true ? ['pull', '--rebase'] : ['pull'];
  if (upstream !== null) {
    assertSafeRemote(upstream.remote);
    assertBranchName(upstream.branch, 'git.pull upstream branch');
    cmd.push(upstream.remote, upstream.branch);
  }
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
