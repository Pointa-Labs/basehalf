import type { CommitActionOptions } from '../common/commitTypes.js';
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

/**
 * Mirrors VS Code's Git action button priority:
 * Commit Changes -> Publish Branch -> Sync Changes -> disabled Commit Changes.
 */
export function sourceControlActionButtonModel(
  view: SourceControlViewModel,
): SourceControlActionButtonModel {
  const secondaryActions = commitSecondaryActions(view);
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
): readonly SourceControlSecondaryAction[] {
  if (!view.canCommitAmend) return [];
  const actions: SourceControlSecondaryAction[] = [
    { label: 'Commit (Amend)', options: { amend: true } },
  ];
  if (view.canCommit) {
    actions.push(
      { label: 'Commit & Push', options: { after: 'push' } },
      { label: 'Commit & Sync', options: { after: 'sync' } },
    );
  }
  return actions;
}
