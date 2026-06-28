import { describe, expect, it } from 'vitest';
import {
  loadScmHistoryPage,
  resolveScmHistoryItemRefs,
  scmHistoryOptionsForFilter,
  scmHistoryOptionsForRefs,
} from '../src/workbench/contrib/scm/browser/scmHistoryViewModel.js';
import type {
  ScmHistoryItem,
  ScmHistoryItemRef,
  ScmHistoryProvider,
} from '../src/workbench/contrib/scm/common/history.js';

const historyItem = (id: string): ScmHistoryItem => ({
  id,
  parentIds: [],
  subject: id,
  message: id,
});

const ref = (id: string, name: string, revision?: string): ScmHistoryItemRef => ({
  id,
  name,
  revision,
});

describe('scmHistoryViewModel', () => {
  it('maps resolved history item refs to provider options without treating display names as revisions', () => {
    expect(
      scmHistoryOptionsForRefs(
        [ref('refs/heads/main', 'main', 'abc1234'), ref('refs/heads/798', '798', '798')],
        50,
        10,
      ),
    ).toEqual({
      historyItemRefs: ['abc1234', 'refs/heads/798'],
      limit: 50,
      skip: 10,
    });
  });

  it('resolves all, auto, and selected history refs through the SCM provider shape', async () => {
    const calls: unknown[] = [];
    const provider = {
      provideCurrentHistoryItemRefs: async () => ({
        historyItemRef: ref('refs/heads/main', 'main'),
        historyItemRemoteRef: ref('refs/remotes/origin/main', 'origin/main'),
      }),
      provideHistoryItemRefs: async (ids?: readonly string[]) => {
        calls.push(ids);
        if (ids?.[0] === 'refs/heads/missing') return [];
        return [ref('refs/heads/main', 'main'), ref('refs/remotes/origin/main', 'origin/main')];
      },
    };

    await expect(resolveScmHistoryItemRefs(provider, { kind: 'all' })).resolves.toEqual([
      ref('refs/heads/main', 'main'),
      ref('refs/remotes/origin/main', 'origin/main'),
    ]);
    await expect(resolveScmHistoryItemRefs(provider, { kind: 'auto' })).resolves.toEqual([
      ref('refs/heads/main', 'main'),
      ref('refs/remotes/origin/main', 'origin/main'),
    ]);
    await expect(
      resolveScmHistoryItemRefs(provider, { kind: 'ref', ref: 'refs/heads/missing' }),
    ).resolves.toEqual([
      ref('refs/heads/main', 'main'),
      ref('refs/remotes/origin/main', 'origin/main'),
    ]);
    expect(calls).toEqual([undefined, ['refs/heads/missing']]);
  });

  it('loads pages through the VS Code-style SCM history provider', async () => {
    const refs = [ref('refs/heads/main', 'main')];
    const itemOptions: unknown[] = [];
    const provider: ScmHistoryProvider = {
      provideCurrentHistoryItemRefs: async () => ({ historyItemRef: { id: 'HEAD', name: 'HEAD' } }),
      provideHistoryItemRefs: async (ids?: readonly string[]) => {
        if (ids?.[0] === 'refs/heads/main') return refs;
        return refs;
      },
      provideHistoryItems: async (options) => {
        itemOptions.push(options);
        return [historyItem('a'), historyItem('b')];
      },
      provideHistoryItemChanges: async () => [],
      resolveHistoryItem: async () => undefined,
      resolveHistoryItemRefsCommonAncestor: async () => undefined,
    };

    await expect(
      loadScmHistoryPage({
        provider,
        filter: { kind: 'ref', ref: 'refs/heads/main' },
        pageSize: 3,
        skip: 6,
      }),
    ).resolves.toEqual({
      historyItems: [historyItem('a'), historyItem('b')],
      refs,
      selectedRefs: refs,
      done: true,
    });
    await expect(
      scmHistoryOptionsForFilter({
        provider,
        filter: { kind: 'auto' },
        pageSize: 10,
        skip: 2,
      }),
    ).resolves.toEqual({ historyItemRefs: ['HEAD'], limit: 10, skip: 2 });
    expect(itemOptions).toEqual([{ historyItemRefs: ['refs/heads/main'], limit: 3, skip: 6 }]);
  });

  it('falls back when a selected full ref only resolves by ambiguous display name', async () => {
    const provider = {
      provideCurrentHistoryItemRefs: async () => ({
        historyItemRef: ref('refs/heads/main', 'main'),
      }),
      provideHistoryItemRefs: async () => [ref('refs/heads/origin/main', 'origin/main')],
    };

    await expect(
      resolveScmHistoryItemRefs(provider, { kind: 'ref', ref: 'refs/remotes/origin/main' }),
    ).resolves.toEqual([ref('refs/heads/main', 'main')]);
  });

  it('keeps numeric branch-name filters as resolved history item refs', async () => {
    const provider = {
      provideCurrentHistoryItemRefs: async () => ({
        historyItemRef: ref('refs/heads/main', 'main'),
      }),
      provideHistoryItemRefs: async (ids?: readonly string[]) =>
        ids?.[0] === '798' ? [ref('refs/heads/798', '798')] : [],
    };

    const refs = await resolveScmHistoryItemRefs(provider, { kind: 'ref', ref: '798' });

    expect(refs).toEqual([ref('refs/heads/798', '798')]);
    expect(scmHistoryOptionsForRefs(refs, 50, 0)).toEqual({
      historyItemRefs: ['refs/heads/798'],
      limit: 50,
      skip: 0,
    });
  });
});
