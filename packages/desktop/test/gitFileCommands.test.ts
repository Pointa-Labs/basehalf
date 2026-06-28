import { describe, expect, it } from 'vitest';
import type { GitRunOptions, GitRunResult } from '../src/workbench/contrib/scm/common/git.js';
import type { GitCommandContext } from '../src/workbench/contrib/scm/electron-main/gitCommandRunner.js';
import {
  conflictStages,
  diff,
  show,
} from '../src/workbench/contrib/scm/electron-main/gitFileCommands.js';

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

describe('git file commands', () => {
  it('runs staged file diffs behind a path separator', async () => {
    const { ctx, calls } = gitContext((args) => {
      if (args[0] === 'diff') return ok('diff bytes');
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await expect(diff({ path: 'src/file.ts', staged: true }, ctx)).resolves.toEqual({
      diff: 'diff bytes',
    });
    expect(calls.map((call) => call.args)).toEqual([['diff', '--cached', '--', 'src/file.ts']]);
  });

  it('returns null when a file does not exist at a ref', async () => {
    const { ctx } = gitContext((args) => {
      if (args[0] === 'show') return { stdout: '', stderr: 'missing', exitCode: 128 };
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await expect(show({ ref: 'HEAD', path: 'missing.ts' }, ctx)).resolves.toEqual({
      content: null,
    });
  });

  it('reads conflict index stages independently', async () => {
    const { ctx, calls } = gitContext((args) => {
      if (args[0] === 'show' && args[1] === ':1:./conflict.md') return ok('base');
      if (args[0] === 'show' && args[1] === ':2:./conflict.md') return ok('ours');
      if (args[0] === 'show' && args[1] === ':3:./conflict.md') return ok('theirs');
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await expect(conflictStages({ path: 'conflict.md' }, ctx)).resolves.toEqual({
      base: 'base',
      ours: 'ours',
      theirs: 'theirs',
    });
    expect(calls).toHaveLength(3);
  });
});
