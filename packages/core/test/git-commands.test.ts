import { describe, expect, it } from 'vitest';
import {
  type GitBranchesResult,
  type GitDiffResult,
  type GitLogResult,
  type GitRunner,
  type GitShowResult,
  type GitStatusResult,
  createCore,
} from '../src/index.js';

const US = '\x1f';
const RS = '\x1e';

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

  it('git.status surfaces a real 128 fault (not every 128 is "not a repo")', async () => {
    const { git } = makeFakeGit(() => ({ exitCode: 128, stderr: 'fatal: bad config line 1' }));
    const core = createCore({ git, configDir: '/cfg' });
    await expect(core.run('git.status', {}, { workspaceRoot: '/x' })).rejects.toThrow(/bad config/);
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

  it('git.commit rejects an empty/whitespace message in core (not via git stderr)', async () => {
    const { git, calls } = makeFakeGit(() => ({}));
    const core = createCore({ git, configDir: '/cfg' });
    await expect(core.run('git.commit', { message: '   \n  ' }, ROOT)).rejects.toThrow(/message/i);
    expect(calls).toHaveLength(0); // never reached git
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

  it('git.show rejects an unsafe ref (leading dash → would read as a flag)', async () => {
    const { git, calls } = makeFakeGit(() => ({ stdout: 'x' }));
    const core = createCore({ git, configDir: '/cfg' });
    await expect(
      core.run('git.show', { ref: '--output=/etc/passwd', path: 'a.ts' }, ROOT),
    ).rejects.toThrow(/unsafe ref/);
    expect(calls).toHaveLength(0); // never reached git
  });

  it('git.show allows the empty ref (the index version)', async () => {
    const { git, calls } = makeFakeGit(() => ({ stdout: 'staged content' }));
    const core = createCore({ git, configDir: '/cfg' });
    const r = (await core.run('git.show', { ref: '', path: 'a.ts' }, ROOT)) as GitShowResult;
    expect(r.content).toBe('staged content');
    expect(calls[0].args).toEqual(['show', ':./a.ts']);
  });

  it('rejects a path that escapes the workspace', async () => {
    const { git, calls } = makeFakeGit(() => ({}));
    const core = createCore({ git, configDir: '/cfg' });
    await expect(core.run('git.stage', { paths: ['../escape'] }, ROOT)).rejects.toThrow();
    expect(calls).toHaveLength(0); // never reached git
  });

  it('git.log requests the US/RS format and parses the commits', async () => {
    const fields = [
      'c1',
      'c1',
      '',
      'Ada',
      'a@x',
      '2026-06-27T10:00:00+00:00',
      'Ada',
      'a@x',
      '2026-06-27T10:00:00+00:00',
      'HEAD -> main',
      'first',
      '',
    ];
    const out = `${fields.join(US)}${RS}\n`;
    const { git, calls } = makeFakeGit(() => ({ stdout: out }));
    const core = createCore({ git, configDir: '/cfg' });
    const r = (await core.run('git.log', {}, ROOT)) as GitLogResult;
    expect(calls[0].args[0]).toBe('log');
    expect(calls[0].args).toContain('HEAD'); // defaults to HEAD
    expect(r.commits).toHaveLength(1);
    expect(r.commits[0]).toMatchObject({
      hash: 'c1',
      subject: 'first',
      head: true,
      refs: ['main'],
    });
  });

  it('git.log passes maxCount/skip/all/path and uses --all instead of a ref', async () => {
    const { git, calls } = makeFakeGit(() => ({ stdout: '' }));
    const core = createCore({ git, configDir: '/cfg' });
    await core.run('git.log', { maxCount: 50, skip: 10, all: true, path: 'src/a.ts' }, ROOT);
    const a = calls[0].args;
    expect(a).toContain('--max-count=50');
    expect(a).toContain('--skip=10');
    expect(a).toContain('--all');
    expect(a).not.toContain('HEAD'); // --all supersedes the start ref
    expect(a.slice(-2)).toEqual(['--', 'src/a.ts']);
  });

  it('git.log → empty history on an unborn branch (git exits 128)', async () => {
    const { git } = makeFakeGit(() => ({
      exitCode: 128,
      stderr: "fatal: your current branch 'main' does not have any commits yet",
    }));
    const core = createCore({ git, configDir: '/cfg' });
    const r = (await core.run('git.log', {}, ROOT)) as GitLogResult;
    expect(r.commits).toEqual([]);
  });

  it('git.log rejects an unsafe ref before reaching git', async () => {
    const { git, calls } = makeFakeGit(() => ({ stdout: '' }));
    const core = createCore({ git, configDir: '/cfg' });
    await expect(core.run('git.log', { ref: '--output=x' }, ROOT)).rejects.toThrow(/unsafe ref/);
    expect(calls).toHaveLength(0);
  });

  it('git.log rejects a non-integer maxCount (template-injection guard)', async () => {
    const { git, calls } = makeFakeGit(() => ({ stdout: '' }));
    const core = createCore({ git, configDir: '/cfg' });
    await expect(core.run('git.log', { maxCount: 1.5 as number }, ROOT)).rejects.toThrow(
      /non-negative integer/,
    );
    expect(calls).toHaveLength(0);
  });

  it('git.diffRef diffs to^..to by default', async () => {
    const { git, calls } = makeFakeGit(() => ({ stdout: 'DIFF' }));
    const core = createCore({ git, configDir: '/cfg' });
    const r = (await core.run('git.diffRef', { to: 'abc123' }, ROOT)) as GitDiffResult;
    expect(r.diff).toBe('DIFF');
    expect(calls[0].args).toEqual(['diff', 'abc123^', 'abc123']);
  });

  it('git.diffRef falls back to the empty tree for a root commit (to^ fails 128)', async () => {
    const { git, calls } = makeFakeGit((args) =>
      args[1] === 'abc^' ? { exitCode: 128, stderr: 'bad revision' } : { stdout: 'ROOTDIFF' },
    );
    const core = createCore({ git, configDir: '/cfg' });
    const r = (await core.run('git.diffRef', { to: 'abc' }, ROOT)) as GitDiffResult;
    expect(r.diff).toBe('ROOTDIFF');
    expect(calls[1].args).toEqual(['diff', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', 'abc']);
  });

  it('git.diffRef uses an explicit from..to and scopes to a path', async () => {
    const { git, calls } = makeFakeGit(() => ({ stdout: 'D' }));
    const core = createCore({ git, configDir: '/cfg' });
    await core.run('git.diffRef', { from: 'main', to: 'feat', path: 'a.ts' }, ROOT);
    expect(calls[0].args).toEqual(['diff', 'main', 'feat', '--', 'a.ts']);
  });

  it('git.diffRef rejects an unsafe ref before reaching git', async () => {
    const { git, calls } = makeFakeGit(() => ({ stdout: '' }));
    const core = createCore({ git, configDir: '/cfg' });
    await expect(core.run('git.diffRef', { to: '-x' }, ROOT)).rejects.toThrow(/unsafe ref/);
    expect(calls).toHaveLength(0);
  });
});
