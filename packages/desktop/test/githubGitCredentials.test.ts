import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitRunOptions, GitRunner, SecretStore } from '@basehalf/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GITHUB_ASKPASS_SCRIPT,
  createGithubGitRunner,
  githubAskpassEnv,
  isRemoteGitCommand,
} from '../src/main/github-git-credentials.js';

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
  });

  it('builds a GitHub askpass env without embedding the token in the script', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'bh-github-askpass-'));
    const calls: Array<{ args: readonly string[]; opts: GitRunOptions }> = [];
    const base: GitRunner = async (args, opts) => {
      calls.push({ args, opts });
      return { stdout: '', stderr: '', exitCode: 0 };
    };

    const runner = createGithubGitRunner(tempDir, secretStore('secret-token'), base);
    await runner(['status'], { cwd: '/repo' });
    await runner(['fetch'], { cwd: '/repo', env: { EXISTING: '1' } });

    expect(calls[0]?.opts.env).toBeUndefined();
    expect(calls[1]?.opts.env).toMatchObject({
      EXISTING: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_HTTP_USER_AGENT: 'BaseHalf',
      BH_GIT_ASKPASS_USERNAME: 'x-access-token',
      BH_GIT_ASKPASS_PASSWORD: 'secret-token',
    });

    const scriptPath = calls[1]?.opts.env?.GIT_ASKPASS;
    expect(scriptPath).toBeTruthy();
    const script = await readFile(scriptPath ?? '', 'utf8');
    expect(script).toBe(GITHUB_ASKPASS_SCRIPT);
    expect(script).not.toContain('secret-token');
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
});
