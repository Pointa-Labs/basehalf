import { describe, expect, it } from 'vitest';
import { FULL_GRAPH_PAGE_SIZE } from '../src/workbench/contrib/scm/browser/gitGraphViewModel.js';
import {
  fullGraphAvailableLogArgs,
  fullGraphErrorMessage,
  fullGraphLogArgs,
} from '../src/workbench/contrib/scm/browser/useFullGitGraphHistory.js';

describe('useFullGitGraphHistory provider helpers', () => {
  it('builds VS Code-style history provider log args for all, auto, and ref filters', () => {
    expect(fullGraphLogArgs({ kind: 'all' }, 0)).toEqual({
      all: true,
      maxCount: FULL_GRAPH_PAGE_SIZE,
      skip: 0,
    });
    expect(fullGraphLogArgs({ kind: 'auto' }, 10)).toEqual({
      ref: 'HEAD',
      maxCount: FULL_GRAPH_PAGE_SIZE,
      skip: 10,
    });
    expect(fullGraphLogArgs({ kind: 'ref', ref: 'refs/heads/feature/scm' }, 80)).toEqual({
      ref: 'refs/heads/feature/scm',
      maxCount: FULL_GRAPH_PAGE_SIZE,
      skip: 80,
    });
  });

  it('preserves provider load errors for the full graph view', () => {
    expect(fullGraphErrorMessage(new Error('git log failed'))).toBe('git log failed');
    expect(fullGraphErrorMessage('fatal: bad revision')).toBe('fatal: bad revision');
  });

  it('builds HEAD args when the selected full graph ref was removed', () => {
    const refs = [{ id: 'refs/heads/main', name: 'main', type: 'head' as const, current: true }];

    expect(fullGraphAvailableLogArgs({ kind: 'ref', ref: 'refs/heads/deleted' }, refs, 0)).toEqual({
      ref: 'HEAD',
      maxCount: FULL_GRAPH_PAGE_SIZE,
      skip: 0,
    });
    expect(fullGraphAvailableLogArgs({ kind: 'ref', ref: 'refs/heads/main' }, refs, 20)).toEqual({
      ref: 'refs/heads/main',
      maxCount: FULL_GRAPH_PAGE_SIZE,
      skip: 20,
    });
  });

  it('resolves bare numeric branch filters before building full graph log args', () => {
    const refs = [{ id: 'refs/heads/798', name: '798', type: 'head' as const, current: true }];

    expect(fullGraphAvailableLogArgs({ kind: 'ref', ref: '798' }, refs, 0)).toEqual({
      ref: 'refs/heads/798',
      maxCount: FULL_GRAPH_PAGE_SIZE,
      skip: 0,
    });
  });
});
