import type { CommitActionOptions } from './commitTypes.js';
import {
  DEFAULT_GIT_POST_COMMIT_COMMANDS,
  type ScmPostCommitCommand,
  postCommitCommandActions,
} from './postCommitCommands.js';
import type { SourceControlViewModel } from './sourceControlViewModel.js';

export type SourceControlPrimaryAction = 'commit' | 'publish' | 'sync';

export interface SourceControlSecondaryAction {
  readonly label: string;
  readonly disabled?: boolean;
  readonly options: CommitActionOptions;
}

export interface SourceControlActionButtonModel {
  readonly primaryAction: SourceControlPrimaryAction;
  readonly primaryLabel: string;
  readonly primaryGlyph: string;
  readonly primaryEnabled: boolean;
  readonly commitMenuEnabled: boolean;
  readonly secondaryActions: readonly SourceControlSecondaryAction[];
}

export interface SourceControlActionButtonModelOptions {
  readonly postCommitCommandGroups?: readonly (readonly ScmPostCommitCommand[])[];
}

/**
 * Mirrors VS Code's Git action button priority:
 * Commit Changes -> Publish Branch -> Sync Changes -> disabled Commit Changes.
 */
export function sourceControlActionButtonModel(
  view: SourceControlViewModel,
  options: SourceControlActionButtonModelOptions = {},
): SourceControlActionButtonModel {
  const secondaryActions = commitSecondaryActions(
    view,
    options.postCommitCommandGroups ?? [DEFAULT_GIT_POST_COMMIT_COMMANDS],
  );
  const commitMenuEnabled = secondaryActions.some((action) => action.disabled !== true);
  if (view.canCommit) {
    return {
      primaryAction: 'commit',
      primaryLabel: 'Commit',
      primaryGlyph: 'check',
      primaryEnabled: true,
      commitMenuEnabled,
      secondaryActions,
    };
  }
  if (view.canPublish) {
    return {
      primaryAction: 'publish',
      primaryLabel: 'Publish Branch',
      primaryGlyph: 'cloud-upload',
      primaryEnabled: true,
      commitMenuEnabled: false,
      secondaryActions: [],
    };
  }
  if (view.canSync) {
    return {
      primaryAction: 'sync',
      primaryLabel: 'Sync Changes',
      primaryGlyph: 'sync',
      primaryEnabled: true,
      commitMenuEnabled: false,
      secondaryActions: [],
    };
  }
  return {
    primaryAction: 'commit',
    primaryLabel: 'Commit',
    primaryGlyph: 'check',
    primaryEnabled: false,
    commitMenuEnabled,
    secondaryActions,
  };
}

function commitSecondaryActions(
  view: SourceControlViewModel,
  postCommitCommandGroups: readonly (readonly ScmPostCommitCommand[])[],
): readonly SourceControlSecondaryAction[] {
  if (!view.canCommitAmend) return [];
  const actions: SourceControlSecondaryAction[] = [
    { label: 'Commit (Amend)', options: { amend: true } },
  ];
  if (view.canCommit) {
    actions.push(
      ...postCommitCommandActions(postCommitCommandGroups).map((action) => ({
        label: action.label,
        options: action.options,
      })),
    );
  }
  return actions;
}
