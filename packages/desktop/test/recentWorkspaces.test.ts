import type { WorkspaceEntry } from '@basehalf/core';
import { describe, expect, it } from 'vitest';
import { sortByRecency } from '../src/renderer/src/lib/recentWorkspaces.js';

const ws = (name: string, addedAt: string, lastOpenedAt?: string): WorkspaceEntry => ({
  name,
  path: `/${name}`,
  addedAt,
  ...(lastOpenedAt !== undefined && { lastOpenedAt }),
});

describe('sortByRecency', () => {
  it('orders most-recently-opened first (by lastOpenedAt)', () => {
    const out = sortByRecency([
      ws('a', '2020-01-01T00:00:00Z', '2020-01-03T00:00:00Z'),
      ws('b', '2020-01-01T00:00:00Z', '2020-01-05T00:00:00Z'),
      ws('c', '2020-01-01T00:00:00Z', '2020-01-04T00:00:00Z'),
    ]);
    expect(out.map((w) => w.name)).toEqual(['b', 'c', 'a']);
  });

  it('falls back to addedAt when a workspace was never opened', () => {
    const out = sortByRecency([
      ws('old', '2020-01-01T00:00:00Z'),
      ws('new', '2020-06-01T00:00:00Z'),
    ]);
    expect(out.map((w) => w.name)).toEqual(['new', 'old']);
  });

  it('a touched (opened) workspace outranks a newer-added but never-opened one', () => {
    const out = sortByRecency([
      ws('added-recently', '2021-01-01T00:00:00Z'), // never opened
      ws('opened-recently', '2020-01-01T00:00:00Z', '2021-06-01T00:00:00Z'),
    ]);
    expect(out[0]?.name).toBe('opened-recently');
  });

  it('breaks ties by name so the order is stable', () => {
    const out = sortByRecency([
      ws('zeta', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z'),
      ws('alpha', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z'),
    ]);
    expect(out.map((w) => w.name)).toEqual(['alpha', 'zeta']);
  });

  it('does not mutate the input array', () => {
    const input = [ws('a', '2020-02-01T00:00:00Z'), ws('b', '2020-01-01T00:00:00Z')];
    const snapshot = input.map((w) => w.name);
    sortByRecency(input);
    expect(input.map((w) => w.name)).toEqual(snapshot);
  });
});
