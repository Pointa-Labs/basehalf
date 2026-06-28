import { describe, expect, it } from 'vitest';
import type { GitRunOptions, GitRunResult } from '../src/workbench/contrib/scm/common/git.js';
import type { GitCommandContext } from '../src/workbench/contrib/scm/electron-main/gitCommandRunner.js';
import {
  assertBranchName,
  assertSafeRef,
  assertSafeRemote,
} from '../src/workbench/contrib/scm/electron-main/gitRefGuards.js';
import {
  parseRemoteVerbose,
  publish,
  push,
  remoteUrl,
  sync,
} from '../src/workbench/contrib/scm/electron-main/gitRemoteCommands.js';

const ok = (stdout = '', stderr = ''): GitRunResult => ({ stdout, stderr, exitCode: 0 });

function gitContext(run: (args: readonly string[], opts: GitRunOptions) => GitRunResult): {
  ctx: GitCommandContext;
  calls: Array<{ args: readonly string[]; opts: GitRunOptions }>;
} {
  const calls: Array<{ args: readonly string[]; opts: GitRunOptions }> = [];
  return {
    calls,
    ctx: {
      workspaceRoot: '/repo',
      git: async (args, opts) => {
        calls.push({ args, opts });
        return run(args, opts);
      },
    },
  };
}

describe('git remote commands', () => {
  it('parses verbose remotes and marks no_push remotes read-only', () => {
    expect(
      parseRemoteVerbose(
        [
          'origin https://github.com/acme/repo.git (fetch)',
          'origin no_push (push)',
          'backup git@example.com:acme/repo.git (fetch)',
          'backup git@example.com:acme/repo.git (push)',
        ].join('\n'),
      ),
    ).toEqual([
      {
        name: 'origin',
        fetchUrl: 'https://github.com/acme/repo.git',
        pushUrl: 'no_push',
        isReadOnly: true,
      },
      {
        name: 'backup',
        fetchUrl: 'git@example.com:acme/repo.git',
        pushUrl: 'git@example.com:acme/repo.git',
        isReadOnly: false,
      },
    ]);
  });

  it('publishes a branch without upstream to the only writable remote', async () => {
    const { ctx, calls } = gitContext((args) => {
      if (args[0] === 'status') return ok('## feature\0');
      if (args[0] === 'remote' && args[1] === '--verbose') {
        return ok(
          'origin https://github.com/acme/repo.git (fetch)\norigin git@github.com:acme/repo.git (push)\n',
        );
      }
      if (args[0] === 'push') return ok('published');
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await push({}, ctx);

    expect(calls.map((call) => call.args)).toEqual([
      ['status', '--porcelain=v1', '-z', '--branch'],
      ['remote', '--verbose'],
      ['push', '-u', 'origin', 'feature'],
    ]);
    expect(calls[2]?.opts).toMatchObject({ cwd: '/repo', timeoutMs: 120_000 });
  });

  it('does not silently choose a remote when multiple writable remotes exist', async () => {
    const { ctx } = gitContext((args) => {
      if (args[0] === 'status') return ok('## feature\0');
      if (args[0] === 'remote' && args[1] === '--verbose') {
        return ok(
          'origin https://github.com/upstream/repo.git (fetch)\norigin git@github.com:upstream/repo.git (push)\nfork https://github.com/fork/repo.git (fetch)\nfork git@github.com:fork/repo.git (push)\n',
        );
      }
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await expect(push({}, ctx)).rejects.toThrow(/Multiple writable remotes/);
  });

  it('uses --force-with-lease for force pushes', async () => {
    const { ctx, calls } = gitContext((args) => {
      if (args[0] === 'status') return ok('## main...origin/main\0');
      if (args[0] === 'remote' && args[1] === '--verbose') {
        return ok(
          'origin https://github.com/acme/repo.git (fetch)\norigin git@github.com:acme/repo.git (push)\n',
        );
      }
      if (args[0] === 'push') return ok('forced');
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await push({ force: true }, ctx);

    expect(calls.map((call) => call.args)).toEqual([
      ['status', '--porcelain=v1', '-z', '--branch'],
      ['remote', '--verbose'],
      ['push', 'origin', 'HEAD:main', '--force-with-lease'],
    ]);
  });

  it('pushes explicitly to the upstream branch refspec', async () => {
    const { ctx, calls } = gitContext((args) => {
      if (args[0] === 'status') return ok('## local...origin/trunk [ahead 1]\0');
      if (args[0] === 'remote' && args[1] === '--verbose') {
        return ok(
          'origin https://github.com/acme/repo.git (fetch)\norigin git@github.com:acme/repo.git (push)\n',
        );
      }
      if (args[0] === 'push') return ok('pushed');
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await push({}, ctx);

    expect(calls.map((call) => call.args)).toEqual([
      ['status', '--porcelain=v1', '-z', '--branch'],
      ['remote', '--verbose'],
      ['push', 'origin', 'HEAD:trunk'],
    ]);
  });

  it('refuses to push to a read-only upstream remote', async () => {
    const { ctx, calls } = gitContext((args) => {
      if (args[0] === 'status') return ok('## main...origin/main [ahead 1]\0');
      if (args[0] === 'remote' && args[1] === '--verbose') {
        return ok('origin https://github.com/acme/repo.git (fetch)\norigin no_push (push)\n');
      }
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await expect(push({}, ctx)).rejects.toThrow(/read-only/);

    expect(calls.map((call) => call.args)).toEqual([
      ['status', '--porcelain=v1', '-z', '--branch'],
      ['remote', '--verbose'],
    ]);
  });

  it('refuses to push from detached HEAD without an upstream branch', async () => {
    const { ctx, calls } = gitContext((args) => {
      if (args[0] === 'status') return ok('## HEAD (no branch)\0');
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await expect(push({}, ctx)).rejects.toThrow(/check out a branch/);

    expect(calls.map((call) => call.args)).toEqual([
      ['status', '--porcelain=v1', '-z', '--branch'],
    ]);
  });

  it('validates explicitly requested publish remotes before pushing', async () => {
    const { ctx, calls } = gitContext((args) => {
      if (args[0] === 'status') return ok('## feature\0');
      if (args[0] === 'remote' && args[1] === '--verbose') {
        return ok('origin https://github.com/acme/repo.git (fetch)\norigin no_push (push)\n');
      }
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await expect(publish({ remote: 'origin' }, ctx)).rejects.toThrow(/read-only/);

    expect(calls.map((call) => call.args)).toEqual([
      ['status', '--porcelain=v1', '-z', '--branch'],
      ['remote', '--verbose'],
    ]);
  });

  it('reports missing explicitly requested publish remotes before pushing', async () => {
    const { ctx, calls } = gitContext((args) => {
      if (args[0] === 'status') return ok('## feature\0');
      if (args[0] === 'remote' && args[1] === '--verbose') {
        return ok(
          'origin https://github.com/acme/repo.git (fetch)\norigin git@github.com:acme/repo.git (push)\n',
        );
      }
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await expect(publish({ remote: 'fork' }, ctx)).rejects.toThrow(/not configured/);

    expect(calls.map((call) => call.args)).toEqual([
      ['status', '--porcelain=v1', '-z', '--branch'],
      ['remote', '--verbose'],
    ]);
  });

  it('does not push during sync when the upstream remote is read-only', async () => {
    const { ctx, calls } = gitContext((args) => {
      if (args[0] === 'status') return ok('## main...origin/main [ahead 1]\0');
      if (args[0] === 'pull') return ok('pulled');
      if (args[0] === 'remote' && args[1] === '--verbose') {
        return ok('origin https://github.com/acme/repo.git (fetch)\norigin no_push (push)\n');
      }
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await sync({}, ctx);

    expect(calls.map((call) => call.args)).toEqual([
      ['status', '--porcelain=v1', '-z', '--branch'],
      ['status', '--porcelain=v1', '-z', '--branch'],
      ['pull', 'origin', 'main'],
      ['remote', '--verbose'],
    ]);
  });

  it('sync publishes without pulling when the current branch has no upstream', async () => {
    const { ctx, calls } = gitContext((args) => {
      if (args[0] === 'status') return ok('## feature\0');
      if (args[0] === 'remote' && args[1] === '--verbose') {
        return ok(
          'origin https://github.com/acme/repo.git (fetch)\norigin git@github.com:acme/repo.git (push)\n',
        );
      }
      if (args[0] === 'push') return ok('published');
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await sync({}, ctx);

    expect(calls.map((call) => call.args)).toEqual([
      ['status', '--porcelain=v1', '-z', '--branch'],
      ['status', '--porcelain=v1', '-z', '--branch'],
      ['remote', '--verbose'],
      ['push', '-u', 'origin', 'feature'],
    ]);
  });

  it('returns null for missing remote URLs and rejects unsafe remote names', async () => {
    const { ctx } = gitContext((args) => {
      if (args[0] === 'remote') return { stdout: '', stderr: 'no such remote', exitCode: 2 };
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await expect(remoteUrl({ remote: '../bad' }, ctx)).rejects.toThrow(/invalid remote/);
    await expect(remoteUrl({ remote: 'origin' }, ctx)).resolves.toEqual({ url: null });
  });
});

describe('git ref guards', () => {
  it('rejects unsafe refs, remotes, and new branch names', () => {
    expect(() => assertSafeRef('HEAD~1', 'ref')).not.toThrow();
    expect(() => assertSafeRef('-bad', 'ref')).toThrow(/unsafe ref/);
    expect(() => assertSafeRemote('origin')).not.toThrow();
    expect(() => assertSafeRemote('../origin')).toThrow(/invalid remote/);
    expect(() => assertBranchName('feature/refactor', 'branch')).not.toThrow();
    expect(() => assertBranchName('bad branch', 'branch')).toThrow(/invalid branch name/);
  });
});
