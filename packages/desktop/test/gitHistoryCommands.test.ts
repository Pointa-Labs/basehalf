import { describe, expect, it } from 'vitest';
import type { GitRunOptions, GitRunResult } from '../src/workbench/contrib/scm/common/git.js';
import type { GitCommandContext } from '../src/workbench/contrib/scm/electron-main/gitCommandRunner.js';
import { log } from '../src/workbench/contrib/scm/electron-main/gitHistoryCommands.js';

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

describe('git history commands', () => {
  it('returns an empty history for bad revision log failures instead of surfacing git stderr', async () => {
    const { ctx, calls } = gitContext((args) => {
      if (args[0] === 'for-each-ref') return ok('');
      if (args[0] === 'log') {
        return {
          stdout: '',
          stderr:
            "fatal: ambiguous argument '798': unknown revision or path not in the working tree.\n",
          exitCode: 128,
        };
      }
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await expect(log({ ref: '798', maxCount: 20 }, ctx)).resolves.toEqual({ commits: [] });
    expect(calls.map((call) => call.args[0])).toEqual(['for-each-ref', 'log']);
    expect(calls[1]?.opts).toMatchObject({ cwd: '/repo', acceptExitCodes: [0, 128] });
  });
});
