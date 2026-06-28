import { describe, expect, it } from 'vitest';
import type { GitRunOptions, GitRunResult } from '../src/workbench/contrib/scm/common/git.js';
import {
  checkout,
  merge,
  refs,
} from '../src/workbench/contrib/scm/electron-main/gitBranchCommands.js';
import type { GitCommandContext } from '../src/workbench/contrib/scm/electron-main/gitCommandRunner.js';

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

describe('git branch commands', () => {
  it('returns VS Code-style full ref ids while displaying short names', async () => {
    const { ctx } = gitContext((args) => {
      if (args[0] === 'status') return ok('## 798\0');
      if (args[0] === 'for-each-ref') {
        return ok(
          [
            'refs/heads/798\0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            'refs/remotes/origin/main\0bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            'refs/tags/v1.0\0cccccccccccccccccccccccccccccccccccccccc',
          ].join('\n'),
        );
      }
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await expect(refs({ includeRemote: true, includeTags: true }, ctx)).resolves.toEqual({
      current: '798',
      refs: [
        {
          id: 'refs/heads/798',
          name: '798',
          type: 'head',
          current: true,
          commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
        {
          id: 'refs/remotes/origin/main',
          name: 'origin/main',
          type: 'remoteHead',
          current: false,
          remote: 'origin',
          commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
        {
          id: 'refs/tags/v1.0',
          name: 'v1.0',
          type: 'tag',
          current: false,
          commit: 'cccccccccccccccccccccccccccccccccccccccc',
        },
      ],
    });
  });

  it('checks out a remote-tracking ref with --track', async () => {
    const { ctx, calls } = gitContext((args) => {
      if (args[0] === 'checkout') return ok();
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await checkout({ branch: 'origin/feature-x', track: true }, ctx);

    expect(calls.map((call) => call.args)).toEqual([['checkout', '--track', 'origin/feature-x']]);
  });

  it('returns merge conflicts as command data instead of throwing', async () => {
    const { ctx } = gitContext((args) => {
      if (args[0] === 'merge') {
        return { stdout: 'CONFLICT (content): Merge conflict', stderr: '', exitCode: 1 };
      }
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    await expect(merge({ branch: 'feature-x' }, ctx)).resolves.toMatchObject({
      merged: false,
      conflicts: true,
    });
  });
});
