import { describe, expect, it } from 'vitest';
import type { GitRunOptions, GitRunResult } from '../src/workbench/contrib/scm/common/git.js';
import type { GitCommandContext } from '../src/workbench/contrib/scm/electron-main/gitCommandRunner.js';
import {
  cherryPick,
  rebaseInteractive,
  reset,
} from '../src/workbench/contrib/scm/electron-main/gitRewriteCommands.js';

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

describe('git rewrite commands', () => {
  it('returns cherry-pick conflicts as command data instead of throwing', async () => {
    const { ctx } = gitContext((args) => {
      if (args[0] === 'cherry-pick') {
        return { stdout: 'CONFLICT (content): conflict', stderr: '', exitCode: 1 };
      }
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await expect(cherryPick({ ref: 'abc123' }, ctx)).resolves.toEqual({
      applied: false,
      conflicts: true,
    });
  });

  it('validates reset mode before running git', async () => {
    const { ctx, calls } = gitContext(() => {
      throw new Error('should not run');
    });

    await expect(reset({ ref: 'HEAD', mode: 'sideways' as never }, ctx)).rejects.toThrow(
      /Invalid reset mode/,
    );
    expect(calls).toEqual([]);
  });

  it('rejects interactive rebase when tracked files are dirty', async () => {
    const { ctx } = gitContext((args) => {
      if (args[0] === 'status') return ok('## main\0 M tracked.ts\0');
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await expect(
      rebaseInteractive(
        {
          base: 'HEAD~2',
          items: [{ sha: 'abc123', action: 'pick' }],
        },
        ctx,
      ),
    ).rejects.toThrow(/Commit or stash/);
  });
});
