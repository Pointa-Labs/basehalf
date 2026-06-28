import { describe, expect, it, vi } from 'vitest';
import type { GitRunOptions } from '../src/workbench/contrib/scm/common/git.js';
import {
  requireWorkspaceRoot,
  runGit,
} from '../src/workbench/contrib/scm/electron-main/gitCommandRunner.js';
import { assertWorkspaceRelative } from '../src/workbench/contrib/scm/electron-main/gitPathGuards.js';

describe('git command runner', () => {
  it('runs git with the bound repository cwd and preserves options', async () => {
    const calls: Array<{ args: readonly string[]; opts: GitRunOptions }> = [];
    const git = vi.fn(async (args, opts) => {
      calls.push({ args, opts });
      return { stdout: 'ok', stderr: '', exitCode: 0 };
    });

    const result = await runGit({ workspaceRoot: '/repo', git }, ['status'], {
      acceptExitCodes: [0, 128],
      stdin: 'input',
    });

    expect(result.stdout).toBe('ok');
    expect(calls).toEqual([
      {
        args: ['status'],
        opts: { cwd: '/repo', acceptExitCodes: [0, 128], stdin: 'input' },
      },
    ]);
  });

  it('rejects git commands without a bound workspace root', () => {
    const git = vi.fn();

    expect(() => requireWorkspaceRoot({ workspaceRoot: null, git })).toThrow(
      'No workspace bound to this Git operation.',
    );
    expect(() => runGit({ workspaceRoot: null, git }, ['status'])).toThrow(
      'No workspace bound to this Git operation.',
    );
    expect(git).not.toHaveBeenCalled();
  });
});

describe('git path guards', () => {
  it('allows workspace-relative file paths', () => {
    expect(() => assertWorkspaceRelative('src/file.ts')).not.toThrow();
  });

  it('rejects empty, root, absolute, and traversal paths', () => {
    for (const path of ['', '.', '/tmp/file', 'C:\\tmp\\file', '../file', 'src/../file']) {
      expect(() => assertWorkspaceRelative(path)).toThrow();
    }
  });
});
