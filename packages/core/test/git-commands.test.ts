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

  it('git.push force uses --force-with-lease (never bare --force)', async () => {
    const { git, calls } = makeFakeGit((args) =>
      args[0] === 'status' ? { stdout: '## main...origin/main\0' } : {},
    );
    const core = createCore({ git, configDir: '/cfg' });
    await core.run('git.push', { force: true }, ROOT);
    expect(calls.find((c) => c.args[0] === 'push')?.args).toEqual(['push', '--force-with-lease']);
  });

  it('git.remoteUrl returns the origin URL, null when absent, rejects a bad name', async () => {
    const ok = makeFakeGit(() => ({ stdout: 'git@github.com:o/r.git\n' }));
    const core1 = createCore({ git: ok.git, configDir: '/cfg' });
    const r1 = (await core1.run('git.remoteUrl', {}, ROOT)) as { url: string | null };
    expect(ok.calls[0]?.args).toEqual(['remote', 'get-url', 'origin']);
    expect(r1.url).toBe('git@github.com:o/r.git');

    const none = makeFakeGit(() => ({ exitCode: 2, stderr: 'No such remote' }));
    const core2 = createCore({ git: none.git, configDir: '/cfg' });
    expect(((await core2.run('git.remoteUrl', {}, ROOT)) as { url: string | null }).url).toBeNull();

    await expect(core1.run('git.remoteUrl', { remote: '--upload-pack=x' }, ROOT)).rejects.toThrow(
      /invalid remote/,
    );
  });

  it('git.pull rebase passes --rebase', async () => {
    const { git, calls } = makeFakeGit(() => ({}));
    const core = createCore({ git, configDir: '/cfg' });
    await core.run('git.pull', {}, ROOT);
    expect(calls[0]?.args).toEqual(['pull']);
    await core.run('git.pull', { rebase: true }, ROOT);
    expect(calls[1]?.args).toEqual(['pull', '--rebase']);
  });

  it('git.branches marks the current branch', async () => {
    const { git } = makeFakeGit((args) =>
      args[0] === 'status'
        ? { stdout: '## main\0' }
        : { stdout: 'refs/heads/main\nrefs/heads/feature-x\nrefs/heads/old\n' },
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

  it('git.branches includeRemote lists remote-tracking refs (minus origin/HEAD)', async () => {
    const { git, calls } = makeFakeGit((args) =>
      args[0] === 'status'
        ? { stdout: '## main\0' }
        : {
            stdout:
              'refs/heads/main\nrefs/remotes/origin/HEAD\nrefs/remotes/origin/main\nrefs/remotes/origin/feat\n',
          },
    );
    const core = createCore({ git, configDir: '/cfg' });
    const r = (await core.run('git.branches', { includeRemote: true }, ROOT)) as GitBranchesResult;
    expect(calls.find((c) => c.args[0] === 'for-each-ref')?.args).toContain('refs/remotes');
    expect(r.branches).toEqual([
      { name: 'main', current: true },
      { name: 'origin/main', current: false, remote: true },
      { name: 'origin/feat', current: false, remote: true },
    ]);
  });

  it('git.stash pushes, and reports nothing-to-stash', async () => {
    const { git, calls } = makeFakeGit((args) =>
      args[1] === 'push' && args.length === 2 ? { stdout: 'No local changes to save' } : {},
    );
    const core = createCore({ git, configDir: '/cfg' });
    await core.run('git.stash', { message: 'wip' }, ROOT);
    expect(calls[0].args).toEqual(['stash', 'push', '-m', 'wip']);
    const r = (await core.run('git.stash', {}, ROOT)) as { stashed: boolean };
    expect(r.stashed).toBe(false);
  });

  it('git.stashApply / stashDrop / stashPop target a specific stash ref', async () => {
    const { git, calls } = makeFakeGit(() => ({}));
    const core = createCore({ git, configDir: '/cfg' });
    await core.run('git.stashApply', { ref: 'stash@{1}' }, ROOT);
    await core.run('git.stashDrop', { ref: 'stash@{2}' }, ROOT);
    await core.run('git.stashPop', { ref: 'stash@{0}' }, ROOT);
    await core.run('git.stashApply', {}, ROOT); // no ref → latest
    expect(calls[0].args).toEqual(['stash', 'apply', 'stash@{1}']);
    expect(calls[1].args).toEqual(['stash', 'drop', 'stash@{2}']);
    expect(calls[2].args).toEqual(['stash', 'pop', 'stash@{0}']);
    expect(calls[3].args).toEqual(['stash', 'apply']);
  });

  it('git stash ref args reject anything but stash@{N}', async () => {
    const { git, calls } = makeFakeGit(() => ({}));
    const core = createCore({ git, configDir: '/cfg' });
    await expect(core.run('git.stashDrop', { ref: '--all' }, ROOT)).rejects.toThrow(/unsafe ref/);
    await expect(core.run('git.stashApply', { ref: 'HEAD' }, ROOT)).rejects.toThrow(/unsafe ref/);
    expect(calls).toHaveLength(0);
  });

  it('git.searchHistory pickaxes -S<query> and parses matching commits', async () => {
    const rec = (fields: string[]) => `${fields.join('\x1f')}\x1e\n`;
    const one = rec([
      'h1',
      'h1',
      '',
      'Ada',
      'a@x.dev',
      '2026-06-27T10:00:00+00:00',
      'Ada',
      'a@x.dev',
      '2026-06-27T10:00:00+00:00',
      '',
      'add the thing',
      '',
    ]);
    const { git, calls } = makeFakeGit(() => ({ stdout: one }));
    const core = createCore({ git, configDir: '/cfg' });
    const r = (await core.run('git.searchHistory', { query: 'theThing', maxCount: 50 }, ROOT)) as {
      commits: Array<{ subject: string }>;
    };
    expect(calls[0]?.args).toEqual([
      'log',
      expect.stringContaining('%H'),
      '--max-count=50',
      '-StheThing',
    ]);
    expect(r.commits.map((c) => c.subject)).toEqual(['add the thing']);
  });

  it('git.searchHistory short-circuits an empty query and adds ignoreCase + path', async () => {
    const { git, calls } = makeFakeGit(() => ({ stdout: '' }));
    const core = createCore({ git, configDir: '/cfg' });
    const empty = (await core.run('git.searchHistory', { query: '' }, ROOT)) as { commits: [] };
    expect(empty.commits).toEqual([]);
    expect(calls).toHaveLength(0); // never spawned git
    await core.run('git.searchHistory', { query: 'X', ignoreCase: true, path: 'a.ts' }, ROOT);
    expect(calls[0]?.args).toEqual([
      'log',
      expect.stringContaining('%H'),
      '--regexp-ignore-case',
      '-SX',
      '--',
      'a.ts',
    ]);
  });

  it('git.conflictStages reads index stages 1/2/3 (base/ours/theirs); missing → null', async () => {
    const { git, calls } = makeFakeGit((args) => {
      const spec = args[1]; // `show :N:./f.txt`
      if (spec === ':1:./f.txt') return { stdout: 'base\n' };
      if (spec === ':2:./f.txt') return { stdout: 'ours\n' };
      if (spec === ':3:./f.txt') return { exitCode: 128 }; // theirs absent (e.g. delete/modify)
      return {};
    });
    const core = createCore({ git, configDir: '/cfg' });
    const r = (await core.run('git.conflictStages', { path: 'f.txt' }, ROOT)) as {
      base: string | null;
      ours: string | null;
      theirs: string | null;
    };
    expect(calls.map((c) => c.args[1])).toEqual([':1:./f.txt', ':2:./f.txt', ':3:./f.txt']);
    expect(r).toEqual({ base: 'base\n', ours: 'ours\n', theirs: null });
  });

  it('git.blame runs --line-porcelain and parses lines; rejects an unsafe ref', async () => {
    const SHA = '2222222222222222222222222222222222222222';
    const porcelain = [
      `${SHA} 1 1 1`,
      'author Bo',
      'author-time 1700001234',
      'summary tweak',
      'filename f.txt',
      '\thello',
      '',
    ].join('\n');
    const { git, calls } = makeFakeGit(() => ({ stdout: porcelain }));
    const core = createCore({ git, configDir: '/cfg' });
    const r = (await core.run('git.blame', { path: 'f.txt' }, ROOT)) as {
      lines: Array<{
        line: number;
        sha: string;
        author: string;
        authorTime: number;
        summary: string;
      }>;
    };
    expect(calls[0]?.args).toEqual(['blame', '--line-porcelain', '--', 'f.txt']);
    expect(r.lines).toEqual([
      { line: 1, sha: SHA, author: 'Bo', authorTime: 1700001234, summary: 'tweak' },
    ]);
    // A ref is passed through; an unsafe ref is rejected before spawning git.
    await core.run('git.blame', { path: 'f.txt', ref: 'HEAD~2' }, ROOT);
    expect(calls[1]?.args).toEqual(['blame', '--line-porcelain', 'HEAD~2', '--', 'f.txt']);
    await expect(core.run('git.blame', { path: 'f.txt', ref: '--output=x' }, ROOT)).rejects.toThrow(
      /unsafe ref/,
    );
  });

  it('git.blame returns no lines on exit 128 (untracked / no history)', async () => {
    const { git } = makeFakeGit(() => ({ exitCode: 128, stderr: 'no such path' }));
    const core = createCore({ git, configDir: '/cfg' });
    const r = (await core.run('git.blame', { path: 'new.txt' }, ROOT)) as { lines: unknown[] };
    expect(r.lines).toEqual([]);
  });

  it('git.stashList parses ref + hash + base parent + date + author + subject', async () => {
    const { git } = makeFakeGit(() => ({
      stdout:
        'stash@{0}\x1faaa111\x1fbbb222 ccc333\x1f2026-06-27T10:00:00+00:00\x1fAda\x1fada@x.dev\x1fWIP on main: abc\n' +
        'stash@{1}\x1fddd444\x1feee555\x1f2026-06-26T09:00:00+00:00\x1fBob\x1fbob@x.dev\x1fkeep\n',
    }));
    const core = createCore({ git, configDir: '/cfg' });
    const r = (await core.run('git.stashList', {}, ROOT)) as {
      entries: Array<{
        ref: string;
        message: string;
        hash: string;
        parents: string[];
        date: string;
        authorName: string;
        authorEmail: string;
      }>;
    };
    expect(r.entries).toEqual([
      {
        ref: 'stash@{0}',
        hash: 'aaa111',
        parents: ['bbb222', 'ccc333'],
        date: '2026-06-27T10:00:00+00:00',
        authorName: 'Ada',
        authorEmail: 'ada@x.dev',
        message: 'WIP on main: abc',
      },
      {
        ref: 'stash@{1}',
        hash: 'ddd444',
        parents: ['eee555'],
        date: '2026-06-26T09:00:00+00:00',
        authorName: 'Bob',
        authorEmail: 'bob@x.dev',
        message: 'keep',
      },
    ]);
  });

  it('git.revert → reverted, and conflicts:true on a conflict (exit 1)', async () => {
    const ok = makeFakeGit(() => ({ stdout: '' }));
    const core1 = createCore({ git: ok.git, configDir: '/cfg' });
    const r1 = (await core1.run('git.revert', { ref: 'abc' }, ROOT)) as { reverted: boolean };
    expect(ok.calls[0].args).toEqual(['revert', '--no-edit', 'abc']);
    expect(r1.reverted).toBe(true);
    const conf = makeFakeGit(() => ({ exitCode: 1, stdout: 'error: could not revert\nCONFLICT' }));
    const core2 = createCore({ git: conf.git, configDir: '/cfg' });
    const r2 = (await core2.run('git.revert', { ref: 'abc' }, ROOT)) as { conflicts: boolean };
    expect(r2.conflicts).toBe(true);
  });

  it('git.createBranch creates and switches by default (checkout -b)', async () => {
    const { git, calls } = makeFakeGit(() => ({}));
    const core = createCore({ git, configDir: '/cfg' });
    await core.run('git.createBranch', { name: 'feat/x' }, ROOT);
    expect(calls[0].args).toEqual(['checkout', '-b', 'feat/x']);
  });

  it('git.createBranch with checkout:false and a start ref just creates it', async () => {
    const { git, calls } = makeFakeGit(() => ({}));
    const core = createCore({ git, configDir: '/cfg' });
    await core.run('git.createBranch', { name: 'feat/x', ref: 'main', checkout: false }, ROOT);
    expect(calls[0].args).toEqual(['branch', 'feat/x', 'main']);
  });

  it('git.createBranch rejects an injection-shaped name before git', async () => {
    const { git, calls } = makeFakeGit(() => ({}));
    const core = createCore({ git, configDir: '/cfg' });
    await expect(core.run('git.createBranch', { name: '-D main' }, ROOT)).rejects.toThrow(
      /invalid branch name/,
    );
    expect(calls).toHaveLength(0);
  });

  it('git.deleteBranch uses -d, or -D when force', async () => {
    const { git, calls } = makeFakeGit(() => ({}));
    const core = createCore({ git, configDir: '/cfg' });
    await core.run('git.deleteBranch', { name: 'old' }, ROOT);
    await core.run('git.deleteBranch', { name: 'old', force: true }, ROOT);
    expect(calls[0].args).toEqual(['branch', '-d', 'old']);
    expect(calls[1].args).toEqual(['branch', '-D', 'old']);
  });

  it('git.merge → merged on a clean merge', async () => {
    const { git, calls } = makeFakeGit(() => ({ stdout: 'Fast-forward' }));
    const core = createCore({ git, configDir: '/cfg' });
    const r = (await core.run('git.merge', { branch: 'feat' }, ROOT)) as { merged: boolean };
    expect(r.merged).toBe(true);
    expect(calls[0].args).toEqual(['merge', 'feat']);
  });

  it('git.merge → conflicts:true (exit 1 with CONFLICT) is not an error', async () => {
    const { git } = makeFakeGit(() => ({
      exitCode: 1,
      stdout: 'CONFLICT (content): Merge conflict in a.ts',
    }));
    const core = createCore({ git, configDir: '/cfg' });
    const r = (await core.run('git.merge', { branch: 'feat' }, ROOT)) as {
      merged: boolean;
      conflicts: boolean;
    };
    expect(r).toMatchObject({ merged: false, conflicts: true });
  });

  it('git.merge → a non-conflict exit 1 still throws', async () => {
    const { git } = makeFakeGit(() => ({ exitCode: 1, stderr: 'not something we can merge' }));
    const core = createCore({ git, configDir: '/cfg' });
    await expect(core.run('git.merge', { branch: 'nope' }, ROOT)).rejects.toThrow(/merge failed/);
  });

  it('git.renameBranch renames the current branch (or a named one)', async () => {
    const { git, calls } = makeFakeGit(() => ({}));
    const core = createCore({ git, configDir: '/cfg' });
    await core.run('git.renameBranch', { to: 'main2' }, ROOT);
    await core.run('git.renameBranch', { from: 'old', to: 'new' }, ROOT);
    expect(calls[0].args).toEqual(['branch', '-m', 'main2']);
    expect(calls[1].args).toEqual(['branch', '-m', 'old', 'new']);
  });

  it('git.tag creates a tag at HEAD or a ref (rejects an unsafe name)', async () => {
    const { git, calls } = makeFakeGit(() => ({}));
    const core = createCore({ git, configDir: '/cfg' });
    await core.run('git.tag', { name: 'v1.0' }, ROOT);
    await core.run('git.tag', { name: 'v2', ref: 'abc' }, ROOT);
    expect(calls[0].args).toEqual(['tag', 'v1.0']);
    expect(calls[1].args).toEqual(['tag', 'v2', 'abc']);
    await expect(core.run('git.tag', { name: '-x' }, ROOT)).rejects.toThrow(/invalid branch name/);
  });

  it('git.cherryPick → applied, and conflicts:true on a conflict (exit 1)', async () => {
    const ok = makeFakeGit(() => ({}));
    const c1 = createCore({ git: ok.git, configDir: '/cfg' });
    const r1 = (await c1.run('git.cherryPick', { ref: 'abc' }, ROOT)) as { applied: boolean };
    expect(ok.calls[0].args).toEqual(['cherry-pick', 'abc']);
    expect(r1.applied).toBe(true);
    const conf = makeFakeGit(() => ({ exitCode: 1, stdout: 'CONFLICT (content)' }));
    const c2 = createCore({ git: conf.git, configDir: '/cfg' });
    const r2 = (await c2.run('git.cherryPick', { ref: 'abc' }, ROOT)) as { conflicts: boolean };
    expect(r2.conflicts).toBe(true);
  });

  it('git.reset uses the mode flag (default mixed); rejects an unsafe ref', async () => {
    const { git, calls } = makeFakeGit(() => ({}));
    const core = createCore({ git, configDir: '/cfg' });
    await core.run('git.reset', { ref: 'abc' }, ROOT);
    await core.run('git.reset', { ref: 'abc', mode: 'hard' }, ROOT);
    expect(calls[0].args).toEqual(['reset', '--mixed', 'abc']);
    expect(calls[1].args).toEqual(['reset', '--hard', 'abc']);
    await expect(core.run('git.reset', { ref: '-x' }, ROOT)).rejects.toThrow(/unsafe ref/);
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

  it('git.apply stages a hunk patch via stdin (--cached)', async () => {
    const { git, calls } = makeFakeGit(() => ({}));
    const core = createCore({ git, configDir: '/cfg' });
    const patch = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n';
    await core.run('git.apply', { patch, cached: true }, ROOT);
    expect(calls[0].args).toEqual(['apply', '--cached', '-']);
    expect(calls[0].stdin).toBe(patch);
  });

  it('git.apply --reverse for discard/unstage; rejects an empty patch', async () => {
    const { git, calls } = makeFakeGit(() => ({}));
    const core = createCore({ git, configDir: '/cfg' });
    await core.run('git.apply', { patch: '@@ -1 +1 @@\n-a\n+b\n', reverse: true }, ROOT);
    expect(calls[0].args).toEqual(['apply', '--reverse', '-']);
    await expect(core.run('git.apply', { patch: '  ' }, ROOT)).rejects.toThrow(/empty patch/);
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

  it('git.commitFiles lists a commit name-status (rename-aware)', async () => {
    const { git, calls } = makeFakeGit(() => ({ stdout: 'M\0a.ts\0R100\0old.ts\0new.ts\0' }));
    const core = createCore({ git, configDir: '/cfg' });
    const r = (await core.run('git.commitFiles', { ref: 'abc' }, ROOT)) as {
      files: Array<{ path: string; status: string; orig?: string }>;
    };
    expect(calls[0].args).toEqual([
      'diff-tree',
      '--no-commit-id',
      '--name-status',
      '-r',
      '--root',
      '-z',
      'abc',
    ]);
    expect(r.files).toEqual([
      { path: 'a.ts', status: 'M' },
      { path: 'new.ts', status: 'R', orig: 'old.ts' },
    ]);
  });

  it('git.commitFiles rejects an unsafe ref', async () => {
    const { git, calls } = makeFakeGit(() => ({ stdout: '' }));
    const core = createCore({ git, configDir: '/cfg' });
    await expect(core.run('git.commitFiles', { ref: '--x' }, ROOT)).rejects.toThrow(/unsafe ref/);
    expect(calls).toHaveLength(0);
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
