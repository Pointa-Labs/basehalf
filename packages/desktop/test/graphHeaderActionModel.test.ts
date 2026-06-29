import { describe, expect, it } from 'vitest';
import { graphHeaderActions } from '../src/workbench/contrib/scm/browser/graphHeaderActionModel.js';

const scmRemoteActionsKeptOutsideGraphHeader = [
  'publish',
  'sync',
  'pull',
  'pullRebase',
  'push',
  'pushForce',
  'fetch',
];

describe('graphHeaderActionModel', () => {
  it('orders the graph header like VS Code history title actions', () => {
    const actions = graphHeaderActions({ busy: false });

    expect(actions.map((action) => action.id)).toEqual([
      'refPicker',
      'revealCurrent',
      'refresh',
      'openFullGraph',
    ]);
    expect(actions.map((action) => action.title)).toEqual([
      'History Item Reference Picker',
      'Go to Current History Item',
      'Refresh',
      'Open Git Graph',
    ]);
  });

  it('keeps remote operations out of the graph header', () => {
    const graphHeaderIds = new Set<string>(
      graphHeaderActions({ busy: false }).map((action) => action.id),
    );

    for (const remoteAction of scmRemoteActionsKeptOutsideGraphHeader) {
      expect(graphHeaderIds.has(remoteAction)).toBe(false);
    }
  });

  it('disables all graph header actions while SCM is busy', () => {
    expect(graphHeaderActions({ busy: true }).map((action) => action.disabled)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });
});
