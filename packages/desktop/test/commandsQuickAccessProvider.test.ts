import { describe, expect, it, vi } from 'vitest';
import { QuickAccessController } from '../src/platform/quickinput/browser/quickAccessController.js';
import { QuickInputController } from '../src/platform/quickinput/browser/quickInputController.js';
import type {
  CancellationToken,
  QuickAccessProviderDisposable,
  QuickAccessProviderRunOptions,
} from '../src/platform/quickinput/common/quickAccess.js';
import { QuickAccessRegistry } from '../src/platform/quickinput/common/quickAccess.js';
import type { IQuickPick } from '../src/platform/quickinput/common/quickInput.js';
import type {
  CommandsQuickAccessContextProvider,
  CommandsQuickAccessPick,
} from '../src/workbench/browser/quickaccess/commandsQuickAccess.js';
import { CommandsQuickAccessProvider } from '../src/workbench/browser/quickaccess/commandsQuickAccess.js';
import { registerCommandPaletteQuickAccessProviders } from '../src/workbench/browser/quickaccess/quickAccessContributions.js';
import type { BuildCommandPaletteActionsBaseArgs } from '../src/workbench/common/quickaccess/commandPaletteProviders.js';
import { createGitQuickAccessContribution } from '../src/workbench/contrib/scm/browser/gitQuickAccessContribution.js';

class CapturingCommandsQuickAccessProvider extends CommandsQuickAccessProvider {
  lastPicker: IQuickPick<CommandsQuickAccessPick> | undefined;

  override provide(
    picker: IQuickPick<CommandsQuickAccessPick>,
    token: CancellationToken,
    options?: QuickAccessProviderRunOptions,
  ): QuickAccessProviderDisposable {
    this.lastPicker = picker;
    return super.provide(picker, token, options);
  }
}

describe('CommandsQuickAccessProvider', () => {
  it('is registered on the commands descriptor and returns command action picks', () => {
    const provider = new CapturingCommandsQuickAccessProvider(contextProvider());
    const registry = new QuickAccessRegistry();
    registerCommandPaletteQuickAccessProviders(registry, { commandsProvider: provider });

    expect(registry.getQuickAccessProvider('>')?.provider).toBe(provider);

    new QuickAccessController(registry, new QuickInputController()).show('>');

    const ids = commandIds(provider);
    expect(ids).toEqual(
      expect.arrayContaining(['action:add-folder', 'action:new-note', 'git:init']),
    );
    expect(ids).not.toContain('ws:docs');
    expect(ids).not.toContain('file:notes.md');
  });

  it('filters commands through the provider-owned picker path', () => {
    const provider = new CapturingCommandsQuickAccessProvider(contextProvider());
    const registry = new QuickAccessRegistry();
    registerCommandPaletteQuickAccessProviders(registry, { commandsProvider: provider });

    new QuickAccessController(registry, new QuickInputController()).show('>git');

    expect(commandIds(provider)).toEqual(['git:init']);
    expect(provider.lastPicker?.items[0]).toMatchObject({
      label: 'Git: Initialize Repository',
      description: 'Git',
      highlights: [[0, 3]],
    });
  });

  it('accepts a command pick by running the original command palette action', () => {
    const openSettings = vi.fn();
    const provider = new CapturingCommandsQuickAccessProvider(
      contextProvider({
        openSettings,
      }),
    );
    const registry = new QuickAccessRegistry();
    registerCommandPaletteQuickAccessProviders(registry, { commandsProvider: provider });
    const controller = new QuickAccessController(registry, new QuickInputController());

    controller.show('>settings');
    provider.lastPicker?.accept();

    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({ visible: false });
  });
});

function commandIds(provider: CapturingCommandsQuickAccessProvider): string[] {
  return (
    provider.lastPicker?.items.map((item) => {
      if ('type' in item) return item.label ?? '';
      return item.commandId;
    }) ?? []
  );
}

function contextProvider(
  overrides: Partial<BuildCommandPaletteActionsBaseArgs> = {},
): CommandsQuickAccessContextProvider {
  return () => ({
    workspaces: [
      { name: 'main', path: '/repo/main' },
      { name: 'docs', path: '/repo/docs' },
    ],
    current: 'main',
    files: [{ file: 'notes.md' }],
    filesWorkspace: 'main',
    recentFiles: [],
    modifierLabel: 'Ctrl+',
    tildifyPath: (path) => path,
    useWorkspace: vi.fn(),
    openFile: vi.fn(),
    pickAndAdd: vi.fn(),
    createDemo: vi.fn(),
    newNote: vi.fn(),
    promptForNewNote: vi.fn(),
    openSettings: vi.fn(),
    quickAccessContributions: [
      createGitQuickAccessContribution({
        current: 'main',
        git: { repo: false, workspace: 'main', branches: [], commits: [] },
        gitService: {
          checkout: vi.fn(async () => undefined),
          createBranch: vi.fn(async () => undefined),
          fetch: vi.fn(async () => undefined),
          init: vi.fn(async () => undefined),
          pull: vi.fn(async () => undefined),
          push: vi.fn(async () => undefined),
          stageAll: vi.fn(async () => undefined),
          stash: vi.fn(async () => undefined),
          stashPop: vi.fn(async () => undefined),
          unstageAll: vi.fn(async () => undefined),
        },
        promptCreateBranch: vi.fn(async () => null),
        showSourceControl: vi.fn(),
        openGitGraph: vi.fn(),
        runGit: vi.fn(),
        revealCommit: vi.fn(),
      }),
    ],
    ...overrides,
  });
}
