import type { CommitActionOptions, CommitAfter } from './commitTypes.js';
import type { GitStatusResult } from './gitTypes.js';

export interface ScmPostCommitRepository {
  readonly root: string | null;
  readonly status: GitStatusResult | null;
  readonly isCommitInProgress?: boolean;
  readonly isBranchProtected?: boolean;
  readonly branchProtectionPrompt?: 'alwaysCommit' | 'alwaysCommitToNewBranch' | 'alwaysPrompt';
}

export interface ScmPostCommitCommand {
  readonly command: string;
  readonly title: string;
  readonly tooltip?: string;
  readonly arguments?: readonly unknown[];
}

export interface ScmPostCommitAction {
  readonly command: ScmPostCommitCommand;
  readonly label: string;
  readonly options: CommitActionOptions;
}

export type PostCommitCommandsProvidersChangeListener = () => void;

export interface PostCommitCommandsProvider {
  getCommands(repository: ScmPostCommitRepository): readonly ScmPostCommitCommand[];
}

export interface PostCommitCommandsProviderRegistry {
  onDidChangePostCommitCommandsProviders(
    listener: PostCommitCommandsProvidersChangeListener,
  ): () => void;
  registerPostCommitCommandsProvider(provider: PostCommitCommandsProvider): () => void;
  getPostCommitCommandsProviders(): readonly PostCommitCommandsProvider[];
}

export const DEFAULT_GIT_POST_COMMIT_COMMANDS = Object.freeze([
  {
    command: 'git.push',
    title: '$(arrow-up) Commit & Push',
    tooltip: 'Commit & Push Changes',
  },
  {
    command: 'git.sync',
    title: '$(sync) Commit & Sync',
    tooltip: 'Commit & Sync Changes',
  },
] satisfies readonly ScmPostCommitCommand[]);

export class GitPostCommitCommandsProvider implements PostCommitCommandsProvider {
  getCommands(repository: ScmPostCommitRepository): readonly ScmPostCommitCommand[] {
    if (repository.status === null || !repository.status.isRepo) return [];

    const alwaysPrompt =
      repository.isBranchProtected === true && repository.branchProtectionPrompt === 'alwaysPrompt';
    const alwaysCommitToNewBranch =
      repository.isBranchProtected === true &&
      repository.branchProtectionPrompt === 'alwaysCommitToNewBranch';
    const icon =
      repository.isCommitInProgress === true
        ? '$(sync~spin)'
        : alwaysPrompt
          ? '$(lock)'
          : alwaysCommitToNewBranch
            ? '$(git-branch)'
            : undefined;

    return [
      {
        command: 'git.push',
        title: `${icon ?? '$(arrow-up)'} Commit & Push`,
        tooltip: gitPostCommitTooltip(
          'push',
          repository.isCommitInProgress === true,
          alwaysCommitToNewBranch,
        ),
      },
      {
        command: 'git.sync',
        title: `${icon ?? '$(sync)'} Commit & Sync`,
        tooltip: gitPostCommitTooltip(
          'sync',
          repository.isCommitInProgress === true,
          alwaysCommitToNewBranch,
        ),
      },
    ];
  }
}

export function postCommitCommandGroups(
  registry: Pick<PostCommitCommandsProviderRegistry, 'getPostCommitCommandsProviders'>,
  repository: ScmPostCommitRepository,
): readonly (readonly ScmPostCommitCommand[])[] {
  return registry
    .getPostCommitCommandsProviders()
    .map((provider) => provider.getCommands(repository))
    .filter((commands) => commands.length > 0);
}

export function postCommitCommandActions(
  commandGroups: readonly (readonly ScmPostCommitCommand[])[],
): readonly ScmPostCommitAction[] {
  return commandGroups.flatMap((commands) =>
    commands.flatMap((command) => {
      const options = postCommitCommandOptions(command);
      return options === null
        ? []
        : [
            {
              command,
              label: postCommitCommandLabel(command),
              options,
            },
          ];
    }),
  );
}

export function postCommitCommandOptions(
  command: Pick<ScmPostCommitCommand, 'command'>,
): CommitActionOptions | null {
  const after = postCommitCommandAfter(command.command);
  return after === undefined ? null : { after };
}

export function postCommitCommandAfter(command: string): CommitAfter | undefined {
  if (command === 'git.push') return 'push';
  if (command === 'git.sync') return 'sync';
  return undefined;
}

export function postCommitCommandLabel(command: Pick<ScmPostCommitCommand, 'title'>): string {
  const stripped = command.title.replace(/^\$\([^)]+\)\s*/, '').trim();
  return stripped === '' ? command.title : stripped;
}

function gitPostCommitTooltip(
  command: 'push' | 'sync',
  inProgress: boolean,
  alwaysCommitToNewBranch: boolean,
): string {
  if (command === 'push') {
    if (inProgress) {
      return alwaysCommitToNewBranch
        ? 'Committing to New Branch & Pushing Changes...'
        : 'Committing & Pushing Changes...';
    }
    return alwaysCommitToNewBranch
      ? 'Commit to New Branch & Push Changes'
      : 'Commit & Push Changes';
  }

  if (inProgress) {
    return alwaysCommitToNewBranch
      ? 'Committing to New Branch & Synchronizing Changes...'
      : 'Committing & Synchronizing Changes...';
  }
  return alwaysCommitToNewBranch
    ? 'Commit to New Branch & Synchronize Changes'
    : 'Commit & Sync Changes';
}
