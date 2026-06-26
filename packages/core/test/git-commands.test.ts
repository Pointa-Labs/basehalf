import { describe, expect, it } from 'vitest';
import {
  type GitBranchesResult,
  type GitRunner,
  type GitShowResult,
  type GitStatusResult,
  createCore,
} from '../src/index.js';

interface Recorded {
  args: string[];
  cwd: string;
  stdin?: string;
}

/** A fake GitRunner that records calls and returns canned output. Mirrors
 *  defaultGit's contract: throws when the exit code isn't in acceptExitCodes. */
function makeFakeGit(
  reply: (args: readonly string[]) => { stdout?: string; stderr?: string; exitCode?: number },
): { git: GitRunner; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const git: GitRunner = async (args, opts) => {
    calls.push({ args: [...args], cwd: opts.cwd, stdin: opts.stdin });
    const r = reply(args);
    const exitCode = r.exitCode ?? 0;
    if (!(opts.acceptExitCodes ?? [0]).includes(exitCode)) {
      throw Object.assign(new Error(`git failed (${exitCode})`), { name: 'GitError', exitCode });
    }
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode };
  };
  return { git, calls };
}

const ROOT = { workspaceRoot: '/repo' };

describe('git commands (injected fake runner)', () => {
  it('git.status parses porcelain into a structured result', async () => {
    const { git, calls } = makeFakeGit(() => ({
      stdout: '## main...origin/main [ahead 1]\0 M a.ts\0A  b.ts\0',
    }));
    const core = createCore({ git, configDir: '/cfg' });
    const r = (await core.run('git.status', {}, ROOT)) as GitStatusResult;
    expect(r.isRepo).toBe(true);
    expect(r).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 1, behind: 0 });
    expect(r.files).toEqual([
      { path: 'a.ts', x: ' ', y: 'M' },
      { path: 'b.ts', x: 'A', y: ' ' },
    ]);
    expect(calls[0].args).toEqual(['status', '--porcelain=v1', '-z', '--branch']);
    expect(calls[0].cwd).toBe('/repo');
  });

  it('git.status → isRepo:false outside a repo (git exits 128)', async () => {
    const { git } = makeFakeGit(() => ({ exitCode: 128, stderr: 'fatal: not a git repository' }));
    const core = createCore({ git, configDir: '/cfg' });
    const r = (await core.run('git.status', {}, { workspaceRoot: '/x' })) as GitStatusResult;
    expect(r.isRepo).toBe(false);
    expect(r.files).toEqual([]);
  });

  it('git.stage runs `add -- <paths>` in the workspace root', async () => {
    const { git, calls } = makeFakeGit(() => ({}));
    const core = createCore({ git, configDir: '/cfg' });
    await core.run('git.stage', { paths: ['a.ts', 'b.ts'] }, ROOT);
    expect(calls[0].args).toEqual(['add', '--', 'a.ts', 'b.ts']);
    expect(calls[0].cwd).toBe('/repo');
  });

  it('git.commit pipes the message via stdin (-F -)', async () => {
    const { git, calls } = makeFakeGit(() => ({}));
    const core = createCore({ git, configDir: '/cfg' });
    await core.run('git.commit', { message: 'subject\n\nbody' }, ROOT);
    expect(calls[0].args).toEqual(['commit', '-F', '-']);
    expect(calls[0].stdin).toBe('subject\n\nbody');
  });

  it('git.commit --amend appends the flag', async () => {
    const { git, calls } = makeFakeGit(() => ({}));
    const core = createCore({ git, configDir: '/cfg' });
    await core.run('git.commit', { message: 'fix', amend: true }, ROOT);
    expect(calls[0].args).toEqual(['commit', '-F', '-', '--amend']);
  });

  it('git.discard restores the work tree (checkout -- <paths>)', async () => {
    const { git, calls } = makeFakeGit(() => ({}));
    const core = createCore({ git, configDir: '/cfg' });
    await core.run('git.discard', { paths: ['a.ts'] }, ROOT);
    expect(calls[0].args).toEqual(['checkout', '--', 'a.ts']);
  });

  it('git.push sets upstream when the branch has none', async () => {
    const { git, calls } = makeFakeGit((args) =>
      args[0] === 'status' ? { stdout: '## feat\0' } : {},
    );
    const core = createCore({ git, configDir: '/cfg' });
    await core.run('git.push', {}, ROOT);
    expect(calls.find((c) => c.args[0] === 'push')?.args).toEqual(['push', '-u', 'origin', 'feat']);
  });

  it('git.push is a plain push when an upstream exists', async () => {
    const { git, calls } = makeFakeGit((args) =>
      args[0] === 'status' ? { stdout: '## main...origin/main\0' } : {},
    );
    const core = createCore({ git, configDir: '/cfg' });
    await core.run('git.push', {}, ROOT);
    expect(calls.find((c) => c.args[0] === 'push')?.args).toEqual(['push']);
  });

  it('git.branches marks the current branch', async () => {
    const { git } = makeFakeGit((args) =>
      args[0] === 'status' ? { stdout: '## main\0' } : { stdout: 'main\nfeature-x\nold\n' },
    );
    const core = createCore({ git, configDir: '/cfg' });
    const r = (await core.run('git.branches', {}, ROOT)) as GitBranchesResult;
    expect(r.current).toBe('main');
    expect(r.branches).toEqual([
      { name: 'main', current: true },
      { name: 'feature-x', current: false },
      { name: 'old', current: false },
    ]);
  });

  it('git.show → null when the path is absent at the ref (exit 128)', async () => {
    const { git } = makeFakeGit(() => ({ exitCode: 128 }));
    const core = createCore({ git, configDir: '/cfg' });
    const r = (await core.run('git.show', { ref: 'HEAD', path: 'new.ts' }, ROOT)) as GitShowResult;
    expect(r.content).toBeNull();
  });

  it('git.show → cwd-relative `<ref>:./<path>`', async () => {
    const { git, calls } = makeFakeGit(() => ({ stdout: 'old content' }));
    const core = createCore({ git, configDir: '/cfg' });
    const r = (await core.run('git.show', { ref: 'HEAD', path: 'a.ts' }, ROOT)) as GitShowResult;
    expect(r.content).toBe('old content');
    expect(calls[0].args).toEqual(['show', 'HEAD:./a.ts']);
  });

  it('rejects a path that escapes the workspace', async () => {
    const { git, calls } = makeFakeGit(() => ({}));
    const core = createCore({ git, configDir: '/cfg' });
    await expect(core.run('git.stage', { paths: ['../escape'] }, ROOT)).rejects.toThrow();
    expect(calls).toHaveLength(0); // never reached git
  });
});
