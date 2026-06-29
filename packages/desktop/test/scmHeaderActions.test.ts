import { describe, expect, it } from 'vitest';
import type { MenuItem } from '../src/workbench/browser/ui/primitives/Menu.js';
import { scmHeaderActionModel } from '../src/workbench/contrib/scm/browser/scmHeaderActions.js';
import type { GitStatusResult } from '../src/workbench/contrib/scm/common/git.js';
import type { SourceControlViewModel } from '../src/workbench/contrib/scm/common/sourceControlViewModel.js';

const noop = (): void => {};

const commands = {
  createBranchPrompt: noop,
  discardAll: noop,
  fetch: noop,
  popStash: noop,
  publish: noop,
  pull: noop,
  pullRebase: noop,
  push: noop,
  pushForce: noop,
  stash: noop,
  sync: noop,
  undoLastCommit: noop,
};

function status(overrides: Partial<GitStatusResult> = {}): GitStatusResult {
  return {
    isRepo: true,
    branch: 'main',
    detached: false,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    files: [],
    ...overrides,
  };
}

function view(overrides: Partial<SourceControlViewModel> = {}): SourceControlViewModel {
  return {
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
  };
}

const labels = (items: readonly MenuItem[]): string[] =>
  items.map((item) => ('separator' in item ? '---' : item.label));

describe('scmHeaderActionModel', () => {
  it('keeps refresh as a visible title action instead of an overflow item', () => {
    const model = scmHeaderActionModel({
      status: status({ ahead: 1, behind: 2 }),
      busy: false,
      view: view({ canPull: true, canSync: true }),
      commands,
      refresh: noop,
    });

    expect(model.remoteAction.id).toBe('sync');
    expect(model.remoteAction.title).toBe('Sync Changes ↑1↓2');
    expect(model.refreshAction).toMatchObject({
      id: 'refresh',
      title: 'Refresh',
      glyph: 'refresh',
    });
    expect(labels(model.overflowActions)).not.toContain('Refresh');
  });

  it('uses publish as the visible remote action for branches without upstream', () => {
    const model = scmHeaderActionModel({
      status: status({ upstream: null }),
      busy: false,
      view: view({ canPublish: true }),
      commands,
      refresh: noop,
    });

    expect(model.remoteAction).toMatchObject({
      id: 'publish',
      title: 'Publish Branch',
      glyph: 'cloud-upload',
    });
  });

  it('orders overflow actions by VS Code-style groups', () => {
    const model = scmHeaderActionModel({
      status: status(),
      busy: false,
      view: view({ canPull: true, canPublish: true }),
      commands,
      refresh: noop,
      contributionActions: [{ label: 'Create Pull Request…', onClick: noop }],
    });

    expect(labels(model.overflowActions)).toEqual([
      'Pull',
      'Pull (Rebase)',
      'Push',
      'Push (Force)',
      'Fetch',
      '---',
      'Create Branch…',
      'Publish Branch',
      '---',
      'Create Pull Request…',
      '---',
      'Undo Last Commit',
      '---',
      'Stash',
      'Pop Stash',
      '---',
      'Discard All Changes',
    ]);
  });
});
