import { describe, expect, it } from 'vitest';
import type { GitChannel } from '../src/workbench/contrib/scm/browser/gitChannel.js';
import { createGitScmService } from '../src/workbench/contrib/scm/browser/gitScmService.js';

function fakeGitChannel(calls: Array<{ name: string; args: unknown[] }>): GitChannel {
  return {
    init: async () => calls.push({ name: 'init', args: [] }),
    stage: async (paths) => calls.push({ name: 'stage', args: [paths] }),
    stageAll: async () => calls.push({ name: 'stageAll', args: [] }),
    unstage: async (paths) => calls.push({ name: 'unstage', args: [paths] }),
    unstageAll: async () => calls.push({ name: 'unstageAll', args: [] }),
    discard: async (paths) => calls.push({ name: 'discard', args: [paths] }),
    deleteWorkspaceEntry: async (path, kind) =>
      calls.push({ name: 'deleteWorkspaceEntry', args: [path, kind] }),
    commit: async (message, options) => calls.push({ name: 'commit', args: [message, options] }),
    push: async (options) => calls.push({ name: 'push', args: [options] }),
    publish: async (options) => calls.push({ name: 'publish', args: [options] }),
    pull: async (options) => calls.push({ name: 'pull', args: [options] }),
    fetch: async () => calls.push({ name: 'fetch', args: [] }),
    sync: async () => calls.push({ name: 'sync', args: [] }),
    remotes: async () => {
      calls.push({ name: 'remotes', args: [] });
      return { remotes: [{ name: 'origin', isReadOnly: false }] };
    },
    reset: async (args) => calls.push({ name: 'reset', args: [args] }),
    checkout: async (branch, options) => calls.push({ name: 'checkout', args: [branch, options] }),
    createBranch: async (name, options) =>
      calls.push({ name: 'createBranch', args: [name, options] }),
    renameBranch: async (from, to) => calls.push({ name: 'renameBranch', args: [from, to] }),
    renameCurrentBranch: async (to) => calls.push({ name: 'renameCurrentBranch', args: [to] }),
    deleteBranch: async (name, options) =>
      calls.push({ name: 'deleteBranch', args: [name, options] }),
    deleteRemoteRef: async (remote, name, options) =>
      calls.push({ name: 'deleteRemoteRef', args: [remote, name, options] }),
    merge: async (branch) => {
      calls.push({ name: 'merge', args: [branch] });
      return { merged: true, conflicts: false, stdout: '', stderr: '' };
    },
    cherryPick: async (ref) => {
      calls.push({ name: 'cherryPick', args: [ref] });
      return { applied: true, conflicts: false };
    },
    revert: async (ref) => {
      calls.push({ name: 'revert', args: [ref] });
      return { reverted: true, conflicts: false };
    },
    rebase: async (branch) => {
      calls.push({ name: 'rebase', args: [branch] });
      return { ok: true };
    },
    rebaseInteractive: async (args) => {
      calls.push({ name: 'rebaseInteractive', args: [args] });
      return { rebased: true, conflicts: false };
    },
    tag: async (name, ref) => calls.push({ name: 'tag', args: [name, ref] }),
    tagDelete: async (name) => calls.push({ name: 'tagDelete', args: [name] }),
    status: async () => {
      calls.push({ name: 'status', args: [] });
      return { isRepo: true, files: [] };
    },
    show: async (ref, path) => {
      calls.push({ name: 'show', args: [ref, path] });
      return 'file content';
    },
    diff: async (path, options) => {
      calls.push({ name: 'diff', args: [path, options] });
      return 'patch';
    },
    apply: async (args) => calls.push({ name: 'apply', args: [args] }),
    blame: async (path, options) => {
      calls.push({ name: 'blame', args: [path, options] });
      return { lines: [{ line: 1, sha: 'abc' }] };
    },
    conflictStages: async (path) => {
      calls.push({ name: 'conflictStages', args: [path] });
      return { base: 'base', ours: 'ours', theirs: 'theirs' };
    },
    refs: async (args) => {
      calls.push({ name: 'refs', args: [args] });
      return { refs: [], current: 'main' };
    },
    log: async (args) => {
      calls.push({ name: 'log', args: [args] });
      return { commits: [{ hash: 'abc' }] };
    },
    mergeBase: async (refs) => {
      calls.push({ name: 'mergeBase', args: [refs] });
      return 'base';
    },
    searchHistory: async (args) => {
      calls.push({ name: 'searchHistory', args: [args] });
      return [{ hash: 'hit' }];
    },
    commitFiles: async (ref, parent) => {
      calls.push({ name: 'commitFiles', args: [ref, parent] });
      return [{ path: 'a.ts', status: 'M' }];
    },
    stash: async (message, options) => {
      calls.push({ name: 'stash', args: [message, options] });
      return { stashed: true };
    },
    stashList: async () => {
      calls.push({ name: 'stashList', args: [] });
      return [{ ref: 'stash@{0}', message: 'wip' }];
    },
    stashApply: async (ref) => calls.push({ name: 'stashApply', args: [ref] }),
    stashPop: async (ref) => calls.push({ name: 'stashPop', args: [ref] }),
    stashDrop: async (ref) => calls.push({ name: 'stashDrop', args: [ref] }),
  } as unknown as GitChannel;
}

describe('gitScmService', () => {
  it('maps SCM operations to the Git provider channel', async () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const service = createGitScmService(fakeGitChannel(calls));

    await service.init();
    await service.stage(['a.ts']);
    await service.stageAll();
    await service.unstage(['b.ts']);
    await service.unstageAll();
    await service.discard(['c.ts']);
    await service.deleteWorkspaceEntry('new-dir', 'folder');
    await service.commit('msg', { amend: true });
    await service.push({ force: true });
    await service.publish({ remote: 'origin' });
    await service.pull({ rebase: true });
    await service.fetch();
    await service.sync();
    expect(await service.remotes()).toEqual({ remotes: [{ name: 'origin', isReadOnly: false }] });
    await service.reset({ ref: 'HEAD~1', mode: 'soft' });
    await service.checkout('abc');
    await service.checkout('origin/topic', { track: true });
    await service.checkout('abc1234', { detached: true });
    await service.createBranch('topic', { ref: 'abc' });
    await service.renameBranch('topic', 'renamed');
    await service.renameCurrentBranch('current-renamed');
    await service.deleteBranch('renamed', { force: true });
    await service.deleteRemoteRef('origin', 'topic', { force: true });
    expect(await service.merge('abc')).toMatchObject({ conflicts: false });
    expect(await service.cherryPick('abc')).toMatchObject({ conflicts: false });
    expect(await service.revert('abc')).toMatchObject({ conflicts: false });
    expect(await service.rebase('origin/main')).toMatchObject({ ok: true });
    await service.tag('v1.0', 'abc');
    await service.tagDelete('v1.0');
    expect(await service.status()).toMatchObject({ isRepo: true });
    expect(await service.show('HEAD', 'a.ts')).toBe('file content');
    expect(await service.diff('a.ts', { staged: true })).toBe('patch');
    await service.apply({ patch: 'patch', cached: true, reverse: true });
    expect(await service.blame('a.ts')).toMatchObject({ lines: [{ line: 1, sha: 'abc' }] });
    expect(await service.conflictStages('a.ts')).toEqual({
      base: 'base',
      ours: 'ours',
      theirs: 'theirs',
    });
    expect(await service.refs({ includeRemote: true })).toMatchObject({ current: 'main' });
    expect(await service.log({ maxCount: 1 })).toEqual({ commits: [{ hash: 'abc' }] });
    expect(await service.mergeBase(['main', 'origin/main'])).toBe('base');
    expect(await service.searchHistory({ query: 'needle' })).toEqual([{ hash: 'hit' }]);
    expect(await service.commitFiles('abc', 'parent')).toEqual([{ path: 'a.ts', status: 'M' }]);
    expect(await service.stash('wip', { includeUntracked: true })).toEqual({ stashed: true });
    expect(await service.stash()).toEqual({ stashed: true });
    expect(await service.stashList()).toEqual([{ ref: 'stash@{0}', message: 'wip' }]);
    await service.stashApply('stash@{0}');
    await service.stashPop();
    await service.stashDrop('stash@{0}');

    expect(calls).toEqual([
      { name: 'init', args: [] },
      { name: 'stage', args: [['a.ts']] },
      { name: 'stageAll', args: [] },
      { name: 'unstage', args: [['b.ts']] },
      { name: 'unstageAll', args: [] },
      { name: 'discard', args: [['c.ts']] },
      { name: 'deleteWorkspaceEntry', args: ['new-dir', 'folder'] },
      { name: 'commit', args: ['msg', { amend: true }] },
      { name: 'push', args: [{ force: true }] },
      { name: 'publish', args: [{ remote: 'origin' }] },
      { name: 'pull', args: [{ rebase: true }] },
      { name: 'fetch', args: [] },
      { name: 'sync', args: [] },
      { name: 'remotes', args: [] },
      { name: 'reset', args: [{ ref: 'HEAD~1', mode: 'soft' }] },
      { name: 'checkout', args: ['abc', {}] },
      { name: 'checkout', args: ['origin/topic', { track: true }] },
      { name: 'checkout', args: ['abc1234', { detached: true }] },
      { name: 'createBranch', args: ['topic', { ref: 'abc' }] },
      { name: 'renameBranch', args: ['topic', 'renamed'] },
      { name: 'renameCurrentBranch', args: ['current-renamed'] },
      { name: 'deleteBranch', args: ['renamed', { force: true }] },
      { name: 'deleteRemoteRef', args: ['origin', 'topic', { force: true }] },
      { name: 'merge', args: ['abc'] },
      { name: 'cherryPick', args: ['abc'] },
      { name: 'revert', args: ['abc'] },
      { name: 'rebase', args: ['origin/main'] },
      { name: 'tag', args: ['v1.0', 'abc'] },
      { name: 'tagDelete', args: ['v1.0'] },
      { name: 'status', args: [] },
      { name: 'show', args: ['HEAD', 'a.ts'] },
      { name: 'diff', args: ['a.ts', { staged: true }] },
      { name: 'apply', args: [{ patch: 'patch', cached: true, reverse: true }] },
      { name: 'blame', args: ['a.ts', {}] },
      { name: 'conflictStages', args: ['a.ts'] },
      { name: 'refs', args: [{ includeRemote: true }] },
      { name: 'log', args: [{ maxCount: 1 }] },
      { name: 'mergeBase', args: [['main', 'origin/main']] },
      { name: 'searchHistory', args: [{ query: 'needle' }] },
      { name: 'commitFiles', args: ['abc', 'parent'] },
      { name: 'stash', args: ['wip', { includeUntracked: true }] },
      { name: 'stash', args: [undefined, {}] },
      { name: 'stashList', args: [] },
      { name: 'stashApply', args: ['stash@{0}'] },
      { name: 'stashPop', args: [undefined] },
      { name: 'stashDrop', args: ['stash@{0}'] },
    ]);
  });
});
