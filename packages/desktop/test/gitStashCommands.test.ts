import { describe, expect, it } from 'vitest';
import type { GitRunOptions, GitRunResult } from '../src/workbench/contrib/scm/common/git.js';
import type { GitCommandContext } from '../src/workbench/contrib/scm/electron-main/gitCommandRunner.js';
import { stash, stashApply } from '../src/workbench/contrib/scm/electron-main/gitStashCommands.js';

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

describe('git stash commands', () => {
  it('reports no-op stashes without treating them as failures', async () => {
    const { ctx, calls } = gitContext((args) => {
      if (args[0] === 'stash') return ok('No local changes to save');
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await expect(stash({ includeUntracked: true, message: 'wip' }, ctx)).resolves.toEqual({
      stashed: false,
    });
    expect(calls.map((call) => call.args)).toEqual([['stash', 'push', '-u', '-m', 'wip']]);
  });

  it('rejects unsafe stash refs before running git', async () => {
    const { ctx, calls } = gitContext(() => {
      throw new Error('should not run');
    });

    await expect(stashApply({ ref: 'HEAD' }, ctx)).rejects.toThrow(/unsafe ref/);
    expect(calls).toEqual([]);
  });
});
