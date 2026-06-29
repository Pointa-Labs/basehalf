import { describe, expect, it } from 'vitest';
import type { MenuItem } from '../src/workbench/browser/ui/primitives/Menu.js';
import {
  scmBranchMenuActions,
  scmHeaderActionModel,
} from '../src/workbench/contrib/scm/browser/scmHeaderActions.js';
import type { GitStatusResult } from '../src/workbench/contrib/scm/common/git.js';
import type { SourceControlViewModel } from '../src/workbench/contrib/scm/common/sourceControlViewModel.js';

const noop = (): void => {};

const commands = {
  createBranchFromPrompt: noop,
  createBranchPrompt: noop,
  deleteBranchPrompt: noop,
  discardAll: noop,
  fetch: noop,
  mergeBranchPrompt: noop,
  popStash: noop,
  publish: noop,
  pull: noop,
  pullRebase: noop,
  push: noop,
  pushForce: noop,
  rebaseBranchPrompt: noop,
  renameBranchPrompt: noop,
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

const isAction = (item: MenuItem): item is Exclude<MenuItem, { readonly separator: true }> =>
  !('separator' in item);

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
      'Publish Branch',
      '---',
      'Merge…',
      'Rebase Branch…',
      '---',
      'Create Branch…',
      'Create Branch From…',
      '---',
      'Rename Branch…',
      'Delete Branch…',
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

  it('projects the VS Code git.branch submenu descriptors into header branch actions', () => {
    const actions = scmBranchMenuActions({
      status: status({ branch: null, detached: true }),
      busy: false,
      commands,
    });

    expect(labels(actions)).toEqual([
      'Merge…',
      'Rebase Branch…',
      '---',
      'Create Branch…',
      'Create Branch From…',
      '---',
      'Rename Branch…',
      'Delete Branch…',
    ]);

    const menuActions = actions.filter(isAction);
    const action = (label: string) => menuActions.find((item) => item.label === label);

    expect(action('Rebase Branch…')).toMatchObject({ disabled: true });
    expect(action('Rename Branch…')).toMatchObject({ disabled: true });
    expect(action('Delete Branch…')).toMatchObject({ danger: true, disabled: false });
  });

  it('enables Rebase Branch for an attached current branch', () => {
    const actions = scmBranchMenuActions({
      status: status({ branch: 'main', detached: false }),
      busy: false,
      commands,
    });

    const action = actions.filter(isAction).find((item) => item.label === 'Rebase Branch…');
    expect(action).toMatchObject({ disabled: false });
  });
});
