import { describe, expect, it } from 'vitest';
import {
  type SourceControlActionButtonModel,
  sourceControlActionButtonModel,
} from '../src/workbench/contrib/scm/browser/sourceControlActionButtonModel.js';
import type { SourceControlViewModel } from '../src/workbench/contrib/scm/browser/sourceControlViewModel.js';

const view = (overrides: Partial<SourceControlViewModel> = {}): SourceControlViewModel => ({
  count: 0,
  hasStaged: false,
  hasCommitMessage: false,
  canCommit: false,
  canCommitAmend: false,
  canPublish: false,
  canPull: false,
  canSync: false,
  commitBranch: 'main',
  ...overrides,
});

const pick = (model: SourceControlActionButtonModel) => ({
  primaryAction: model.primaryAction,
  primaryLabel: model.primaryLabel,
  primaryEnabled: model.primaryEnabled,
  commitMenuEnabled: model.commitMenuEnabled,
});

describe('sourceControlActionButtonModel', () => {
  it('uses VS Code priority for commit, publish, sync, and disabled commit', () => {
    const commit = sourceControlActionButtonModel(view({ canCommit: true, canCommitAmend: true }));
    expect(pick(commit)).toEqual({
      primaryAction: 'commit',
      primaryLabel: 'Commit',
      primaryEnabled: true,
      commitMenuEnabled: true,
    });
    expect(commit.secondaryActions.map((action) => action.label)).toEqual([
      'Commit (Amend)',
      'Commit & Push',
      'Commit & Sync',
    ]);
    const publish = sourceControlActionButtonModel(
      view({ canPublish: true, canCommitAmend: true }),
    );
    expect(pick(publish)).toEqual({
      primaryAction: 'publish',
      primaryLabel: 'Publish Branch',
      primaryEnabled: true,
      commitMenuEnabled: false,
    });
    expect(publish.secondaryActions).toEqual([]);
    const sync = sourceControlActionButtonModel(view({ canSync: true, canCommitAmend: true }));
    expect(pick(sync)).toEqual({
      primaryAction: 'sync',
      primaryLabel: 'Sync Changes',
      primaryEnabled: true,
      commitMenuEnabled: false,
    });
    expect(sync.secondaryActions).toEqual([]);
    expect(pick(sourceControlActionButtonModel(view()))).toEqual({
      primaryAction: 'commit',
      primaryLabel: 'Commit',
      primaryEnabled: false,
      commitMenuEnabled: false,
    });
  });

  it('keeps amend in the commit dropdown instead of as a standalone control', () => {
    expect(pick(sourceControlActionButtonModel(view({ canCommitAmend: true })))).toMatchObject({
      primaryAction: 'commit',
      primaryEnabled: false,
      commitMenuEnabled: true,
    });
    expect(sourceControlActionButtonModel(view({ canCommitAmend: true })).secondaryActions).toEqual(
      [{ label: 'Commit (Amend)', options: { amend: true } }],
    );
  });
});
