import { describe, expect, it } from 'vitest';
import {
  GitHistoryProvider,
  gitCommitFileToHistoryItemChange,
  gitCommitToHistoryItem,
  gitRefToHistoryItemRef,
} from '../src/workbench/contrib/scm/browser/gitHistoryProvider.js';
import type { GitCommit, GitLogArgs, GitRefInfo } from '../src/workbench/contrib/scm/common/git.js';

const commit = (props: Partial<GitCommit> = {}): GitCommit => ({
  hash: 'abcdef1234567890',
  shortHash: 'abcdef1',
  parents: ['parent'],
  author: { name: 'Ada', email: 'ada@example.com', date: '2026-06-28T01:02:03Z' },
  committer: { name: 'Ada', email: 'ada@example.com', date: '2026-06-28T01:02:03Z' },
  subject: 'Ship history provider',
  body: 'Longer body',
  refs: ['main'],
  tags: ['v1.0'],
  head: true,
  ...props,
});

describe('gitHistoryProvider', () => {
  it('maps git refs, commits, and files into SCM history shapes', () => {
    expect(
      gitRefToHistoryItemRef({
        id: 'refs/remotes/origin/main',
        name: 'origin/main',
        type: 'remoteHead',
        current: false,
        commit: 'abc',
      }),
    ).toEqual({
      id: 'refs/remotes/origin/main',
      name: 'origin/main',
      revision: 'abc',
      category: 'remote',
      description: undefined,
    });

    expect(gitCommitToHistoryItem(commit())).toMatchObject({
      id: 'abcdef1234567890',
      parentIds: ['parent'],
      subject: 'Ship history provider',
      displayId: 'abcdef1',
      author: 'Ada',
      authorEmail: 'ada@example.com',
      references: [
        { id: 'HEAD', name: 'HEAD', category: 'other' },
        { id: 'refs/heads/main', name: 'main', category: 'branch' },
        { id: 'refs/tags/v1.0', name: 'v1.0', category: 'tag' },
      ],
    });

    expect(
      gitCommitFileToHistoryItemChange({ path: 'new.ts', status: 'R', orig: 'old.ts' }),
    ).toEqual({
      path: 'new.ts',
      status: 'R',
      originalPath: 'old.ts',
    });
  });

  it('groups history refs and commit references like VS Code SCM history', async () => {
    const refs: GitRefInfo[] = [
      {
        id: 'refs/tags/v1.0',
        name: 'v1.0',
        type: 'tag',
        current: false,
        commit: 'tag-tip',
      },
      {
        id: 'refs/remotes/origin/main',
        name: 'origin/main',
        type: 'remoteHead',
        current: false,
        commit: 'remote-tip',
      },
      {
        id: 'refs/heads/main',
        name: 'main',
        type: 'head',
        current: true,
        commit: 'main-tip',
      },
      {
        id: 'refs/remotes/origin/HEAD',
        name: 'origin/HEAD',
        type: 'remoteHead',
        current: false,
        commit: 'remote-tip',
      },
      {
        id: 'refs/remotes/upstream/HEAD',
        name: 'upstream/HEAD',
        type: 'remoteHead',
        current: false,
        commit: 'upstream-tip',
      },
    ];
    const provider = new GitHistoryProvider({
      status: async () => ({
        isRepo: true,
        branch: 'main',
        detached: false,
        upstream: 'origin/main',
        ahead: 0,
        behind: 0,
        files: [],
      }),
      refs: async () => ({ refs }),
      log: async () => ({ commits: [] }),
      commitFiles: async () => [],
      mergeBase: async () => null,
    });

    await expect(provider.provideHistoryItemRefs()).resolves.toMatchObject([
      { id: 'refs/heads/main', name: 'main' },
      { id: 'refs/remotes/origin/main', name: 'origin/main' },
      { id: 'refs/tags/v1.0', name: 'v1.0' },
    ]);
    expect(
      gitCommitToHistoryItem(
        commit({
          refs: [
            'refs/remotes/origin/main',
            'refs/remotes/origin/HEAD',
            'upstream/HEAD',
            'refs/heads/main',
          ],
          tags: ['v1.0'],
        }),
      ).references,
    ).toMatchObject([
      { id: 'HEAD', name: 'HEAD' },
      { id: 'refs/heads/main', name: 'main' },
      { id: 'refs/remotes/origin/main', name: 'origin/main' },
      { id: 'refs/tags/v1.0', name: 'v1.0' },
    ]);
  });

  it('delegates refs, history items, changes, and resolve through the git service', async () => {
    const refs: GitRefInfo[] = [
      { id: 'refs/heads/main', name: 'main', type: 'head', current: true, commit: 'abc' },
      {
        id: 'refs/remotes/origin/main',
        name: 'origin/main',
        type: 'remoteHead',
        current: false,
        commit: 'def',
      },
    ];
    const logArgs: GitLogArgs[] = [];
    const provider = new GitHistoryProvider({
      status: async () => ({
        isRepo: true,
        branch: 'main',
        detached: false,
        upstream: 'origin/main',
        ahead: 0,
        behind: 0,
        files: [],
      }),
      refs: async () => ({ refs }),
      log: async (args) => {
        logArgs.push(args);
        return { commits: [commit({ hash: args.ref ?? 'missing' })] };
      },
      commitFiles: async (ref, parent) => [{ path: `${parent ?? 'root'}-${ref}.ts`, status: 'M' }],
      mergeBase: async (historyItemRefs) =>
        historyItemRefs.length > 1 ? `${historyItemRefs.join('+')}-base` : null,
    });

    await expect(provider.provideHistoryItemRefs(['main'])).resolves.toEqual([
      {
        id: 'refs/heads/main',
        name: 'main',
        revision: 'abc',
        category: 'branch',
        description: 'current',
      },
    ]);
    await expect(provider.provideCurrentHistoryItemRefs()).resolves.toMatchObject({
      historyItemRef: { id: 'refs/heads/main', name: 'main', revision: 'abc' },
      historyItemRemoteRef: {
        id: 'refs/remotes/origin/main',
        name: 'origin/main',
        revision: 'def',
      },
    });
    await expect(
      provider.provideHistoryItems({ historyItemRefs: ['main'], limit: 20, skip: 5 }),
    ).resolves.toMatchObject([{ id: 'refs/heads/main' }]);
    await expect(
      provider.provideHistoryItems({ historyItemRefs: ['main', 'origin/main'], limit: 30 }),
    ).resolves.toHaveLength(1);
    await expect(provider.provideHistoryItemChanges('abc', 'parent')).resolves.toEqual([
      { path: 'parent-abc.ts', status: 'M', originalPath: undefined },
    ]);
    await expect(provider.resolveHistoryItem('abc')).resolves.toMatchObject({ id: 'abc' });
    await expect(
      provider.resolveHistoryItemRefsCommonAncestor(['main', 'origin/main']),
    ).resolves.toBe('refs/heads/main+refs/remotes/origin/main-base');
    expect(logArgs).toEqual([
      { ref: 'refs/heads/main', maxCount: 20, skip: 5 },
      {
        refNames: ['refs/heads/main', 'refs/remotes/origin/main'],
        maxCount: 30,
        skip: undefined,
      },
      { ref: 'abc', maxCount: 1 },
    ]);
  });

  it('prefers full ref ids for current remote refs and selected ref lookups', async () => {
    const refs: GitRefInfo[] = [
      {
        id: 'refs/heads/origin/main',
        name: 'origin/main',
        type: 'head',
        current: false,
        commit: 'local',
      },
      {
        id: 'refs/remotes/origin/main',
        name: 'origin/main',
        type: 'remoteHead',
        current: false,
        commit: 'remote',
      },
      {
        id: 'refs/heads/main',
        name: 'main',
        type: 'head',
        current: true,
        commit: 'head',
      },
    ];
    const provider = new GitHistoryProvider({
      status: async () => ({
        isRepo: true,
        branch: 'main',
        detached: false,
        upstream: 'origin/main',
        ahead: 0,
        behind: 0,
        files: [],
      }),
      refs: async () => ({ refs }),
      log: async () => ({ commits: [] }),
      commitFiles: async () => [],
      mergeBase: async () => null,
    });

    await expect(provider.provideCurrentHistoryItemRefs()).resolves.toMatchObject({
      historyItemRef: { id: 'refs/heads/main', revision: 'head' },
      historyItemRemoteRef: { id: 'refs/remotes/origin/main', revision: 'remote' },
    });
    await expect(provider.provideHistoryItemRefs(['refs/remotes/origin/main'])).resolves.toEqual([
      {
        id: 'refs/remotes/origin/main',
        name: 'origin/main',
        revision: 'remote',
        category: 'remote',
        description: undefined,
      },
    ]);
  });

  it('normalizes display-name filters before treating hex-looking names as revisions', async () => {
    const refs: GitRefInfo[] = [
      {
        id: 'refs/heads/798',
        name: '798',
        type: 'head',
        current: false,
        commit: 'branch-798-tip',
      },
      {
        id: 'refs/heads/deadbee',
        name: 'deadbee',
        type: 'head',
        current: false,
        commit: 'branch-deadbee-tip',
      },
      {
        id: 'refs/tags/v-deadbee',
        name: 'v-deadbee',
        type: 'tag',
        current: false,
        commit: 'deadbee',
      },
    ];
    const logArgs: GitLogArgs[] = [];
    const provider = new GitHistoryProvider({
      status: async () => ({
        isRepo: true,
        branch: '798',
        detached: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        files: [],
      }),
      refs: async () => ({ refs }),
      log: async (args) => {
        logArgs.push(args);
        return { commits: [] };
      },
      commitFiles: async () => [],
      mergeBase: async () => null,
    });

    await expect(provider.provideHistoryItemRefs(['deadbee'])).resolves.toEqual([
      {
        id: 'refs/heads/deadbee',
        name: 'deadbee',
        revision: 'branch-deadbee-tip',
        category: 'branch',
        description: undefined,
      },
    ]);
    await provider.provideHistoryItems({ historyItemRefs: ['798'], limit: 10 });
    await provider.provideHistoryItems({ historyItemRefs: ['deadbee'], limit: 10 });

    expect(logArgs).toEqual([
      { ref: 'refs/heads/798', maxCount: 10, skip: undefined },
      { ref: 'refs/heads/deadbee', maxCount: 10, skip: undefined },
    ]);
  });

  it('falls back to HEAD instead of passing unknown branch-like labels to git log', async () => {
    const refs: GitRefInfo[] = [
      {
        id: 'refs/heads/main',
        name: 'main',
        type: 'head',
        current: true,
        commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    ];
    const logArgs: GitLogArgs[] = [];
    const provider = new GitHistoryProvider({
      status: async () => ({
        isRepo: true,
        branch: 'main',
        detached: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        files: [],
      }),
      refs: async () => ({ refs }),
      log: async (args) => {
        logArgs.push(args);
        return { commits: [] };
      },
      commitFiles: async () => [],
      mergeBase: async () => null,
    });

    await provider.provideHistoryItems({ historyItemRefs: ['798'], limit: 10 });
    await provider.provideHistoryItems({ historyItemRefs: ['refs/heads/deleted'], limit: 10 });

    expect(logArgs).toEqual([
      { ref: 'HEAD', maxCount: 10, skip: undefined },
      { ref: 'HEAD', maxCount: 10, skip: undefined },
    ]);
  });

  it('adds an inferred base ref for Auto history and resolves the current common ancestor via remote', async () => {
    const refs: GitRefInfo[] = [
      {
        id: 'refs/heads/feature/scm',
        name: 'feature/scm',
        type: 'head',
        current: true,
        commit: 'feature',
      },
      {
        id: 'refs/remotes/origin/feature/scm',
        name: 'origin/feature/scm',
        type: 'remoteHead',
        current: false,
        commit: 'remote',
      },
      {
        id: 'refs/remotes/origin/main',
        name: 'origin/main',
        type: 'remoteHead',
        current: false,
        commit: 'base',
      },
    ];
    const calls: string[][] = [];
    const provider = new GitHistoryProvider({
      status: async () => ({
        isRepo: true,
        branch: 'feature/scm',
        detached: false,
        upstream: 'origin/feature/scm',
        ahead: 1,
        behind: 0,
        files: [],
      }),
      refs: async () => ({ refs }),
      log: async () => ({ commits: [] }),
      commitFiles: async () => [],
      mergeBase: async (historyItemRefs) => {
        calls.push([...historyItemRefs]);
        return 'merge-base';
      },
    });

    await expect(provider.provideCurrentHistoryItemRefs()).resolves.toMatchObject({
      historyItemRef: { id: 'refs/heads/feature/scm', revision: 'feature' },
      historyItemRemoteRef: { id: 'refs/remotes/origin/feature/scm', revision: 'remote' },
      historyItemBaseRef: { id: 'refs/remotes/origin/main', revision: 'base' },
    });
    await expect(provider.resolveHistoryItemRefsCommonAncestor(['feature/scm'])).resolves.toBe(
      'merge-base',
    );
    expect(calls).toEqual([['refs/heads/feature/scm', 'refs/remotes/origin/feature/scm']]);
  });

  it('falls back to the first current-branch commit when there is no remote or base ref', async () => {
    const refs: GitRefInfo[] = [
      {
        id: 'refs/heads/main',
        name: 'main',
        type: 'head',
        current: true,
        commit: 'tip',
      },
    ];
    const logArgs: GitLogArgs[] = [];
    const provider = new GitHistoryProvider({
      status: async () => ({
        isRepo: true,
        branch: 'main',
        detached: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        files: [],
      }),
      refs: async () => ({ refs }),
      log: async (args) => {
        logArgs.push(args);
        return { commits: [commit({ hash: 'root', shortHash: 'root' })] };
      },
      commitFiles: async () => [],
      mergeBase: async () => null,
    });

    await expect(provider.resolveHistoryItemRefsCommonAncestor(['main'])).resolves.toBe('root');
    expect(logArgs).toEqual([{ ref: 'refs/heads/main', maxCount: 1, maxParents: 0 }]);
  });
});
