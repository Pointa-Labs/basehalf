import { describe, expect, it } from 'vitest';
import {
  historyGraphOptionsForFilter,
  historyLogArgsForFilter,
} from '../src/workbench/contrib/scm/browser/historyGraphModel.js';
import { historyErrorMessage } from '../src/workbench/contrib/scm/browser/useGitGraphHistory.js';
import type { ScmHistoryItemRef } from '../src/workbench/contrib/scm/common/history.js';

const ref = (id: string, name: string, revision?: string): ScmHistoryItemRef => ({
  id,
  name,
  revision,
});

describe('useGitGraphHistory model helpers', () => {
  it('preserves failed git history load messages for the graph UI', () => {
    expect(historyErrorMessage(new Error('git log failed'))).toBe('git log failed');
    expect(historyErrorMessage('fatal: ambiguous argument')).toBe('fatal: ambiguous argument');
  });

  it('does not pass unresolved branch-like history filters directly to git log', () => {
    expect(historyLogArgsForFilter({ kind: 'ref', ref: '798' }, null, 50, 0)).toEqual({
      ref: 'HEAD',
      maxCount: 50,
      skip: 0,
    });
    expect(
      historyLogArgsForFilter(
        { kind: 'refs', refs: ['798', 'refs/heads/main', 'refs/heads/main'] },
        null,
        50,
        10,
      ),
    ).toEqual({
      ref: 'refs/heads/main',
      maxCount: 50,
      skip: 10,
    });
  });

  it('resolves old bare branch filters through the history provider before loading graph pages', async () => {
    const provider = {
      provideCurrentHistoryItemRefs: async () => ({
        historyItemRef: ref('refs/heads/main', 'main'),
      }),
      provideHistoryItemRefs: async (ids?: readonly string[]) =>
        ids?.[0] === '798' ? [ref('refs/heads/798', '798')] : [],
    };

    await expect(
      historyGraphOptionsForFilter({
        provider,
        filter: { kind: 'ref', ref: '798' },
        pageSize: 80,
        skip: 0,
      }),
    ).resolves.toEqual({
      historyItemRefs: ['refs/heads/798'],
      limit: 80,
      skip: 0,
    });
  });
});
