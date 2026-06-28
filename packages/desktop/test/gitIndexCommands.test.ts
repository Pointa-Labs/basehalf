import { describe, expect, it } from 'vitest';
import type { GitRunOptions, GitRunResult } from '../src/workbench/contrib/scm/common/git.js';
import type { GitCommandContext } from '../src/workbench/contrib/scm/electron-main/gitCommandRunner.js';
import {
  commit,
  status,
  unstage,
} from '../src/workbench/contrib/scm/electron-main/gitIndexCommands.js';

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

describe('git index commands', () => {
  it('maps non-repository status to the initialize state', async () => {
    const { ctx } = gitContext((args) => {
      if (args[0] === 'status') {
        return { stdout: '', stderr: 'fatal: not a git repository', exitCode: 128 };
      }
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await expect(status({}, ctx)).resolves.toMatchObject({
      isRepo: false,
      branch: null,
      files: [],
    });
  });

  it('rejects empty commit messages before running git', async () => {
    const { ctx, calls } = gitContext(() => {
      throw new Error('should not run');
    });

    await expect(commit({ message: '   ' }, ctx)).rejects.toThrow(/commit message/);
    expect(calls).toEqual([]);
  });

  it('unstages files on unborn branches via rm cached fallback', async () => {
    const { ctx, calls } = gitContext((args) => {
      if (args[0] === 'reset') {
        return { stdout: '', stderr: "fatal: ambiguous argument 'HEAD'", exitCode: 128 };
      }
      if (args[0] === 'rm') return ok();
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await expect(unstage({ paths: ['new.md'] }, ctx)).resolves.toEqual({ ok: true });
    expect(calls.map((call) => call.args)).toEqual([
      ['reset', '-q', 'HEAD', '--', 'new.md'],
      ['rm', '--cached', '-r', '--', 'new.md'],
    ]);
  });
});
