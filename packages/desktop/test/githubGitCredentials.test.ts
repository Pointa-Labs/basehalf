import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { SecretStore } from '../src/platform/secrets/common/secrets.js';
import {
  GITHUB_ASKPASS_SCRIPT,
  createGithubGitRunner,
  ensureGithubAskpassScript,
  gitUrlHost,
  githubAskpassEnv,
  isGithubUrl,
  isRemoteGitCommand,
  remoteNameForGitCommand,
} from '../src/workbench/contrib/githubPullRequests/electron-main/githubGitCredentials.js';
import type { GitRunOptions, GitRunner } from '../src/workbench/contrib/scm/common/git.js';

const secretStore = (value: string | null): SecretStore => ({
  async get() {
    return value;
  },
  async set() {
    throw new Error('unexpected set');
  },
  async delete() {
    throw new Error('unexpected delete');
  },
});

const execFileAsync = promisify(execFile);

describe('github git credentials provider', () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir !== null) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('classifies only network git commands as askpass candidates', () => {
    expect(isRemoteGitCommand(['fetch'])).toBe(true);
    expect(isRemoteGitCommand(['pull', '--rebase'])).toBe(true);
    expect(isRemoteGitCommand(['push'])).toBe(true);
    expect(isRemoteGitCommand(['status'])).toBe(false);
    expect(isRemoteGitCommand(['commit'])).toBe(false);
    expect(remoteNameForGitCommand(['fetch'])).toBe('origin');
    expect(remoteNameForGitCommand(['fetch', '--depth', '1', 'origin'])).toBe('origin');
    expect(remoteNameForGitCommand(['fetch', '--multiple', 'origin', 'upstream'])).toBeNull();
    expect(remoteNameForGitCommand(['pull', '--rebase', 'origin', 'main'])).toBe('origin');
    expect(remoteNameForGitCommand(['pull', '--strategy', 'ort', 'origin', 'main'])).toBe('origin');
    expect(remoteNameForGitCommand(['push', '-u', 'origin', 'topic'])).toBe('origin');
    expect(remoteNameForGitCommand(['push', '--repo', 'origin', 'topic'])).toBe('origin');
    expect(remoteNameForGitCommand(['push', '--repo=https://github.com/o/r.git', 'topic'])).toBe(
      'https://github.com/o/r.git',
    );
    expect(remoteNameForGitCommand(['push', '--receive-pack', 'git-receive-pack', 'origin'])).toBe(
      'origin',
    );
    expect(remoteNameForGitCommand(['push', 'HEAD:main'])).toBeNull();
    expect(gitUrlHost('git@github.com:owner/repo.git')).toBe('github.com');
    expect(isGithubUrl('git@GitHub.com:owner/repo.git')).toBe(true);
    expect(gitUrlHost('HEAD:main')).toBeNull();
    expect(isGithubUrl('https://github.com/owner/repo.git')).toBe(true);
    expect(isGithubUrl('https://gitlab.com/owner/repo.git')).toBe(false);
  });

  it('injects GitHub askpass only when the remote resolves to GitHub', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'bh-github-askpass-'));
    const calls: Array<{ args: readonly string[]; opts: GitRunOptions }> = [];
    const base: GitRunner = async (args, opts) => {
      calls.push({ args, opts });
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return { stdout: 'git@github.com:owner/repo.git\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    };

    const runner = createGithubGitRunner(tempDir, secretStore('secret-token'), base);
    await runner(['status'], { cwd: '/repo' });
    await runner(['fetch', 'origin'], { cwd: '/repo', env: { EXISTING: '1' } });

    expect(calls[0]?.opts.env).toBeUndefined();
    expect(calls[1]?.args).toEqual(['remote', 'get-url', 'origin']);
    expect(calls[2]?.opts.env).toMatchObject({
      EXISTING: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_HTTP_USER_AGENT: 'BaseHalf',
      BH_GIT_ASKPASS_USERNAME: 'x-access-token',
      BH_GIT_ASKPASS_PASSWORD: 'secret-token',
    });

    const scriptPath = calls[2]?.opts.env?.GIT_ASKPASS;
    expect(scriptPath).toBeTruthy();
    const script = await readFile(scriptPath ?? '', 'utf8');
    expect(script).toBe(GITHUB_ASKPASS_SCRIPT);
    expect(script).not.toContain('secret-token');
  });

  it('leaves non-GitHub remotes untouched even when a GitHub token is stored', async () => {
    const calls: Array<{ args: readonly string[]; opts: GitRunOptions }> = [];
    const base: GitRunner = async (args, opts) => {
      calls.push({ args, opts });
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return { stdout: 'https://gitlab.com/owner/repo.git\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    };

    const runner = createGithubGitRunner('/unused', secretStore('secret-token'), base);
    await runner(['push', 'origin', 'HEAD:main'], { cwd: '/repo' });

    expect(calls.map((call) => call.args)).toEqual([
      ['remote', 'get-url', 'origin'],
      ['push', 'origin', 'HEAD:main'],
    ]);
    expect(calls[1]?.opts.env).toBeUndefined();
  });

  it('does not inject askpass into multi-remote fetches', async () => {
    const calls: Array<{ args: readonly string[]; opts: GitRunOptions }> = [];
    const base: GitRunner = async (args, opts) => {
      calls.push({ args, opts });
      return { stdout: '', stderr: '', exitCode: 0 };
    };

    const runner = createGithubGitRunner('/unused', secretStore('secret-token'), base);
    await runner(['fetch', '--multiple', 'origin', 'upstream'], { cwd: '/repo' });

    expect(calls).toEqual([
      {
        args: ['fetch', '--multiple', 'origin', 'upstream'],
        opts: { cwd: '/repo' },
      },
    ]);
  });

  it('injects for direct GitHub URLs without querying remotes', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'bh-github-askpass-'));
    const calls: Array<{ args: readonly string[]; opts: GitRunOptions }> = [];
    const base: GitRunner = async (args, opts) => {
      calls.push({ args, opts });
      return { stdout: '', stderr: '', exitCode: 0 };
    };

    const runner = createGithubGitRunner(tempDir, secretStore('secret-token'), base);
    await runner(['clone', 'https://github.com/owner/repo.git'], { cwd: '/repo' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(['clone', 'https://github.com/owner/repo.git']);
    expect(calls[0]?.opts.env).toMatchObject({ BH_GIT_ASKPASS_PASSWORD: 'secret-token' });
  });

  it('leaves remote commands untouched when no GitHub token is stored', async () => {
    const calls: GitRunOptions[] = [];
    const base: GitRunner = async (_args, opts) => {
      calls.push(opts);
      return { stdout: '', stderr: '', exitCode: 0 };
    };

    const runner = createGithubGitRunner('/unused', secretStore(null), base);
    await runner(['fetch'], { cwd: '/repo' });

    expect(calls[0]?.env).toBeUndefined();
  });

  it('exports the exact env expected by the askpass runner', () => {
    expect(githubAskpassEnv('/askpass.sh', 'tok')).toEqual({
      GIT_ASKPASS: '/askpass.sh',
      GIT_TERMINAL_PROMPT: '0',
      GIT_HTTP_USER_AGENT: 'BaseHalf',
      BH_GIT_ASKPASS_USERNAME: 'x-access-token',
      BH_GIT_ASKPASS_PASSWORD: 'tok',
    });
  });

  it('askpass only answers prompts whose parsed host is GitHub', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'bh-github-askpass-'));
    const scriptPath = await ensureGithubAskpassScript(tempDir);
    const env = {
      BH_GIT_ASKPASS_USERNAME: 'x-access-token',
      BH_GIT_ASKPASS_PASSWORD: 'secret-token',
    };

    await expect(
      execFileAsync(scriptPath, ["Username for 'https://github.com':"], { env }),
    ).resolves.toMatchObject({ stdout: 'x-access-token\n' });
    await expect(
      execFileAsync(scriptPath, ["Password for 'https://x-access-token@github.com/o/r.git':"], {
        env,
      }),
    ).resolves.toMatchObject({ stdout: 'secret-token\n' });
    await expect(
      execFileAsync(scriptPath, ["Password for 'https://github.com@evil.example/o/r.git':"], {
        env,
      }),
    ).resolves.toMatchObject({ stdout: '\n' });
  });
});
