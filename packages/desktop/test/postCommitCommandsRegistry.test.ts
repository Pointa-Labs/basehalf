import { describe, expect, it } from 'vitest';
import { PostCommitCommandsProviderRegistry } from '../src/workbench/contrib/scm/browser/postCommitCommandsRegistry.js';
import type { GitStatusResult } from '../src/workbench/contrib/scm/common/git.js';
import {
  GitPostCommitCommandsProvider,
  postCommitCommandActions,
  postCommitCommandGroups,
} from '../src/workbench/contrib/scm/common/postCommitCommands.js';
import { sourceControlActionButtonModel } from '../src/workbench/contrib/scm/common/sourceControlActionButtonModel.js';
import type { SourceControlViewModel } from '../src/workbench/contrib/scm/common/sourceControlViewModel.js';

const status = (overrides: Partial<GitStatusResult> = {}): GitStatusResult => ({
  isRepo: true,
  branch: 'main',
  detached: false,
  upstream: 'origin/main',
  ahead: 0,
  behind: 0,
  files: [],
  ...overrides,
});

const view = (overrides: Partial<SourceControlViewModel> = {}): SourceControlViewModel => ({
  count: 1,
  hasStaged: true,
  hasCommitMessage: true,
  canCommit: true,
  canCommitAmend: true,
  canPublish: false,
  canPull: true,
  canSync: false,
  commitBranch: 'main',
  ...overrides,
});

describe('PostCommitCommandsProviderRegistry', () => {
  it('registers, enumerates, fires changes, and disposes post-commit providers', () => {
    const registry = new PostCommitCommandsProviderRegistry();
    const events: string[] = [];
    const first = { getCommands: () => [{ command: 'git.push', title: 'Commit & Push' }] };
    const second = { getCommands: () => [{ command: 'git.sync', title: 'Commit & Sync' }] };

    registry.onDidChangePostCommitCommandsProviders(() => events.push('changed'));
    const disposeFirst = registry.registerPostCommitCommandsProvider(first);
    registry.registerPostCommitCommandsProvider(second);

    expect(registry.getPostCommitCommandsProviders()).toEqual([first, second]);
    expect(events).toEqual(['changed', 'changed']);

    disposeFirst();
    disposeFirst();

    expect(registry.getPostCommitCommandsProviders()).toEqual([second]);
    expect(events).toEqual(['changed', 'changed', 'changed']);
  });

  it('aggregates command groups in provider registration order', () => {
    const registry = new PostCommitCommandsProviderRegistry();
    const repository = { root: '/workspace', status: status() };
    const calls: string[] = [];

    registry.registerPostCommitCommandsProvider({
      getCommands: (repo) => {
        calls.push(`first:${repo.root}`);
        return [{ command: 'git.push', title: '$(arrow-up) Commit & Push' }];
      },
    });
    registry.registerPostCommitCommandsProvider({
      getCommands: (repo) => {
        calls.push(`second:${repo.status?.branch}`);
        return [{ command: 'git.sync', title: '$(sync) Commit & Sync' }];
      },
    });
    registry.registerPostCommitCommandsProvider({ getCommands: () => [] });

    expect(registry.getPostCommitCommandGroups(repository)).toEqual([
      [{ command: 'git.push', title: '$(arrow-up) Commit & Push' }],
      [{ command: 'git.sync', title: '$(sync) Commit & Sync' }],
    ]);
    expect(postCommitCommandGroups(registry, repository)).toHaveLength(2);
    expect(calls).toEqual(['first:/workspace', 'second:main', 'first:/workspace', 'second:main']);
  });

  it('models VS Code git post-commit push/sync provider commands', () => {
    const provider = new GitPostCommitCommandsProvider();

    expect(provider.getCommands({ root: '/workspace', status: null })).toEqual([]);
    expect(provider.getCommands({ root: '/workspace', status: status({ isRepo: false }) })).toEqual(
      [],
    );

    const commands = provider.getCommands({ root: '/workspace', status: status() });
    expect(commands.map((command) => [command.command, command.title, command.tooltip])).toEqual([
      ['git.push', '$(arrow-up) Commit & Push', 'Commit & Push Changes'],
      ['git.sync', '$(sync) Commit & Sync', 'Commit & Sync Changes'],
    ]);

    const protectedCommands = provider.getCommands({
      root: '/workspace',
      status: status(),
      isBranchProtected: true,
      branchProtectionPrompt: 'alwaysCommitToNewBranch',
      isCommitInProgress: true,
    });
    expect(protectedCommands.map((command) => command.title)).toEqual([
      '$(sync~spin) Commit & Push',
      '$(sync~spin) Commit & Sync',
    ]);
    expect(protectedCommands.map((command) => command.tooltip)).toEqual([
      'Committing to New Branch & Pushing Changes...',
      'Committing to New Branch & Synchronizing Changes...',
    ]);
  });

  it('adapts provider commands into BaseHalf commit action-button options', () => {
    expect(
      postCommitCommandActions([
        [
          { command: 'git.push', title: '$(arrow-up) Commit & Push' },
          { command: 'git.fetch', title: 'Fetch' },
        ],
        [{ command: 'git.sync', title: '$(sync) Commit & Sync' }],
      ]),
    ).toEqual([
      {
        command: { command: 'git.push', title: '$(arrow-up) Commit & Push' },
        label: 'Commit & Push',
        options: { after: 'push' },
      },
      {
        command: { command: 'git.sync', title: '$(sync) Commit & Sync' },
        label: 'Commit & Sync',
        options: { after: 'sync' },
      },
    ]);

    const actionButton = sourceControlActionButtonModel(view(), {
      postCommitCommandGroups: [
        [
          {
            command: 'git.sync',
            title: '$(sync) Commit & Sync',
            tooltip: 'Commit & Sync Changes',
          },
        ],
      ],
    });
    expect(actionButton.secondaryActions).toEqual([
      { label: 'Commit (Amend)', options: { amend: true } },
      { label: 'Commit & Sync', options: { after: 'sync' } },
    ]);
  });
});
