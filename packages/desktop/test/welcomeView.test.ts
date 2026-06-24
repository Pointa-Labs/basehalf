import type { WorkspaceEntry } from '@basehalf/core';
import { describe, expect, it } from 'vitest';
import { selectWelcomeView } from '../src/renderer/src/lib/welcomeView.js';

const ws = (name: string, addedAt: string, lastOpenedAt?: string): WorkspaceEntry => ({
  name,
  path: `/${name}`,
  addedAt,
  ...(lastOpenedAt !== undefined && { lastOpenedAt }),
});

describe('selectWelcomeView', () => {
  it('is first-run when the registry is empty', () => {
    const view = selectWelcomeView([], null);
    expect(view.variant).toBe('first-run');
    expect(view.recent).toEqual([]);
  });

  it('is returning when workspaces exist, most-recent-first', () => {
    const view = selectWelcomeView(
      [
        ws('a', '2020-01-01T00:00:00Z', '2020-01-03T00:00:00Z'),
        ws('b', '2020-01-01T00:00:00Z', '2020-01-05T00:00:00Z'),
      ],
      null,
    );
    expect(view.variant).toBe('returning');
    expect(view.recent.map((w) => w.name)).toEqual(['b', 'a']);
  });

  it('excludes the active workspace, and falls back to first-run when it was the only one', () => {
    // Defensive: on the welcome screen `current` is null, but if it's ever set we
    // must not list the active workspace as "recent" — and if it was the only one,
    // there's nothing to resume, so it's a first-run emphasis.
    const view = selectWelcomeView([ws('only', '2020-01-01T00:00:00Z')], 'only');
    expect(view.variant).toBe('first-run');
    expect(view.recent).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input = [ws('a', '2020-02-01T00:00:00Z'), ws('b', '2020-01-01T00:00:00Z')];
    const snapshot = input.map((w) => w.name);
    selectWelcomeView(input, null);
    expect(input.map((w) => w.name)).toEqual(snapshot);
  });
});
