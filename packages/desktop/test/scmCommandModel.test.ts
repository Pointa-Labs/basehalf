import { describe, expect, it } from 'vitest';
import type { GitScmService } from '../src/workbench/contrib/scm/browser/gitScmService.js';
import type { GitRow } from '../src/workbench/contrib/scm/browser/gitStatusModel.js';
import {
  applyDiscardPlan,
  commitPlan,
  discardAllPrompt,
  discardManyPrompt,
  discardPlan,
  discardRowPrompt,
  dropStashPrompt,
  runScmAction,
  scmErrorMessage,
} from '../src/workbench/contrib/scm/browser/scmCommandModel.js';
import { GitError } from '../src/workbench/contrib/scm/common/git.js';

const tracked = (path: string): GitRow => ({
  path,
  status: 'M',
  staged: false,
  untracked: false,
  conflict: false,
});

const untracked = (path: string): GitRow => ({
  path,
  status: 'U',
  staged: false,
  untracked: true,
  conflict: false,
});

describe('scmCommandModel', () => {
  it('runs SCM actions with VS Code-style refresh and transient error reporting', async () => {
    const calls: string[] = [];
    await runScmAction(
      async () => {
        calls.push('action');
      },
      {
        setBusy: (busy) => calls.push(`busy:${busy}`),
        setError: (message) => calls.push(`error:${message}`),
        toastError: (message) => calls.push(`toast:${message}`),
        refresh: () => calls.push('refresh'),
        loadStashes: () => calls.push('stashes'),
      },
    );

    expect(calls).toEqual(['busy:true', 'action', 'refresh', 'stashes', 'busy:false']);

    const failed: string[] = [];
    await runScmAction(
      async () => {
        throw new Error('git failed');
      },
      {
        setBusy: (busy) => failed.push(`busy:${busy}`),
        setError: (message) => failed.push(`error:${message}`),
        toastError: (message) => failed.push(`toast:${message}`),
        refresh: () => failed.push('refresh'),
        loadStashes: () => failed.push('stashes'),
      },
    );

    expect(failed).toEqual([
      'busy:true',
      'refresh',
      'stashes',
      'error:git failed',
      'toast:git failed',
      'busy:false',
    ]);
  });

  it('builds discard prompts and plans without React state', async () => {
    expect(discardRowPrompt(tracked('a.md'))).toContain('Discard changes in “a.md”?');
    expect(discardRowPrompt(untracked('drafts/'))).toContain('Move “drafts/” to the Trash?');
    expect(
      discardManyPrompt({
        trackedPaths: ['a.md'],
        untrackedEntries: [{ path: 'drafts', kind: 'folder' }],
      }),
    ).toBe(
      [
        'This will permanently discard changes in 1 tracked file(s). Tracked changes cannot be undone.',
        'This will move 1 untracked file/folder(s) to the Trash.',
      ].join('\n\n'),
    );
    expect(discardAllPrompt(3)).toBe('Discard all 3 unstaged change(s)? This is IRREVERSIBLE.');
    expect(dropStashPrompt('stash@{0}')).toBe('Delete stash stash@{0}? This is IRREVERSIBLE.');

    const plan = discardPlan([tracked('a.md'), untracked('new.md'), untracked('new-folder/')]);
    expect(plan).toEqual({
      trackedPaths: ['a.md'],
      untrackedEntries: [
        { path: 'new.md', kind: 'file' },
        { path: 'new-folder', kind: 'folder' },
      ],
    });

    const calls: string[] = [];
    await applyDiscardPlan(plan, {
      discard: async (paths) => calls.push(`discard:${paths.join(',')}`),
      deleteWorkspaceEntry: async (path, kind) => calls.push(`delete:${kind}:${path}`),
    } as Pick<GitScmService, 'discard' | 'deleteWorkspaceEntry'>);
    expect(calls).toEqual(['discard:a.md', 'delete:file:new.md', 'delete:folder:new-folder']);
  });

  it('plans commit variants and preserves useful error messages', () => {
    expect(commitPlan('  Ship it  ', {}, true)).toEqual({
      message: 'Ship it',
      amend: false,
    });
    expect(commitPlan('Amend', { amend: true, after: 'push' }, false)).toEqual({
      message: 'Amend',
      amend: true,
      after: 'push',
    });
    expect(commitPlan('', {}, true)).toBeNull();
    expect(commitPlan('No staged changes', {}, false)).toBeNull();
    expect(scmErrorMessage(new Error('boom'))).toBe('boom');
    const gitError = new GitError({
      message: 'Cannot pull with rebase: You have unstaged changes',
      stderr: 'Cannot pull with rebase, you have unstaged changes',
    });
    expect(scmErrorMessage(gitError)).toBe('Cannot pull with rebase, you have unstaged changes');
    expect(scmErrorMessage('fatal')).toBe('fatal');
  });
});
