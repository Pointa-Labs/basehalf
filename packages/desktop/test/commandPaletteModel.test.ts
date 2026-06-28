import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CommandPaletteAction,
  filterCommandPaletteActions,
  moveCommandPaletteSelection,
  reconcileCommandPaletteSelection,
} from '../src/workbench/browser/quickaccess/commandPaletteModel.js';
import {
  COMMANDS_QUICK_ACCESS_ID,
  COMMANDS_QUICK_ACCESS_PREFIX,
  COMMAND_PALETTE_QUICK_ACCESS_PROVIDERS,
  DEFAULT_COMMAND_PALETTE_QUICK_ACCESS_ID,
  buildCommandPaletteActions,
  buildContentSearchActions,
  buildGitEntityActions,
  checkoutTargetForQuickAccessRef,
  commandPaletteProviderIncludesAdditionalPicks,
} from '../src/workbench/browser/quickaccess/commandPaletteProviders.js';
import type { GitScmService } from '../src/workbench/contrib/scm/browser/gitScmService.js';
import type { GitCommit, GitRefInfo } from '../src/workbench/contrib/scm/common/git.js';

const branch = (name: string, props: Partial<GitRefInfo> = {}): GitRefInfo => ({
  id: `refs/heads/${name}`,
  name,
  type: 'head',
  current: false,
  ...props,
});

const remote = (name: string, props: Partial<GitRefInfo> = {}): GitRefInfo => ({
  id: `refs/remotes/${name}`,
  name,
  type: 'remoteHead',
  remote: name.split('/')[0],
  current: false,
  ...props,
});

const commit = (subject: string, shortHash = 'abc1234'): GitCommit => ({
  hash: `${shortHash}${shortHash}`,
  shortHash,
  parents: [],
  author: { name: 'A', email: 'a@example.com', date: '2026-01-01T00:00:00Z' },
  committer: { name: 'A', email: 'a@example.com', date: '2026-01-01T00:00:00Z' },
  subject,
  body: '',
  refs: [],
  tags: [],
  head: false,
});

function storageStub(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    clear: vi.fn(() => values.clear()),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    get length() {
      return values.size;
    },
  } as Storage;
}

function action(id: string, label: string, category: CommandPaletteAction['category'] = 'Action') {
  return { id, label, category, run: vi.fn() } satisfies CommandPaletteAction;
}

function fakeGitService(overrides: Partial<GitScmService> = {}): GitScmService {
  return {
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
    ...overrides,
  } as unknown as GitScmService;
}

describe('commandPaletteModel', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', storageStub());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds command picks from workspaces, files, chrome actions, and repo state', () => {
    const actions = buildCommandPaletteActions({
      workspaces: [
        { name: 'main', path: '/repo/main' },
        { name: 'docs', path: '/repo/docs' },
      ],
      current: 'main',
      files: [{ file: 'notes/today.md', prompt: 'daily planning' }],
      filesWorkspace: 'main',
      git: { repo: false, workspace: 'main', branches: [], commits: [] },
      modifierLabel: 'Ctrl+',
      tildifyPath: (path) => path.replace('/repo', '~'),
      useWorkspace: vi.fn(),
      openFile: vi.fn(),
      pickAndAdd: vi.fn(),
      createDemo: vi.fn(),
      newNote: vi.fn(),
      promptForNewNote: vi.fn(),
      openSettings: vi.fn(),
      showSourceControl: vi.fn(),
      openGitGraph: vi.fn(),
      promptCreateBranch: vi.fn(async () => null),
      runGit: vi.fn(),
      gitService: fakeGitService(),
    });

    expect(actions.map((item) => item.id)).toContain('ws:docs');
    expect(actions.find((item) => item.id === 'ws:docs')?.hint).toBe('~/docs');
    expect(actions.find((item) => item.id === 'file:notes/today.md')).toMatchObject({
      label: 'today.md',
      hint: 'notes/today.md',
      searchAlso: 'daily planning',
    });
    expect(actions.map((item) => item.id)).toContain('git:init');
    expect(actions.find((item) => item.id === 'action:new-note')?.shortcut).toBe('Ctrl+N');
  });

  it('uses the commands quick access provider as a command-only boundary', () => {
    const actions = buildCommandPaletteActions({
      providerId: COMMANDS_QUICK_ACCESS_ID,
      workspaces: [
        { name: 'main', path: '/repo/main' },
        { name: 'docs', path: '/repo/docs' },
      ],
      current: 'main',
      files: [{ file: 'notes/today.md', prompt: 'daily planning' }],
      filesWorkspace: 'main',
      git: { repo: false, workspace: 'main', branches: [], commits: [] },
      modifierLabel: 'Ctrl+',
      tildifyPath: (path) => path.replace('/repo', '~'),
      useWorkspace: vi.fn(),
      openFile: vi.fn(),
      pickAndAdd: vi.fn(),
      createDemo: vi.fn(),
      newNote: vi.fn(),
      promptForNewNote: vi.fn(),
      openSettings: vi.fn(),
      showSourceControl: vi.fn(),
      openGitGraph: vi.fn(),
      promptCreateBranch: vi.fn(async () => null),
      runGit: vi.fn(),
      gitService: fakeGitService(),
    });

    expect(actions.map((item) => item.id)).not.toContain('ws:docs');
    expect(actions.map((item) => item.id)).not.toContain('file:notes/today.md');
    expect(actions.map((item) => item.id)).toEqual(
      expect.arrayContaining(['action:add-folder', 'action:new-note', 'git:init']),
    );
  });

  it('declares quick access providers as descriptors with provider-owned capabilities', () => {
    expect(COMMAND_PALETTE_QUICK_ACCESS_PROVIDERS.map((provider) => provider.descriptor)).toEqual([
      {
        id: DEFAULT_COMMAND_PALETTE_QUICK_ACCESS_ID,
        prefix: '',
        placeholder: 'Switch workspace, open a file, run an action...',
        helpEntries: [
          {
            description: 'Switch workspace, open a file, or run an action',
            commandId: 'workbench.action.quickOpen',
          },
        ],
      },
      {
        id: COMMANDS_QUICK_ACCESS_ID,
        prefix: COMMANDS_QUICK_ACCESS_PREFIX,
        placeholder: 'Type the name of a command to run',
        helpEntries: [
          {
            prefix: COMMANDS_QUICK_ACCESS_PREFIX,
            description: 'Show and run commands',
            commandId: 'workbench.action.showCommands',
          },
        ],
      },
    ]);
    expect(commandPaletteProviderIncludesAdditionalPicks(undefined)).toBe(true);
    expect(
      commandPaletteProviderIncludesAdditionalPicks(DEFAULT_COMMAND_PALETTE_QUICK_ACCESS_ID),
    ).toBe(true);
    expect(commandPaletteProviderIncludesAdditionalPicks(COMMANDS_QUICK_ACCESS_ID)).toBe(false);
  });

  it('empty query returns recent file picks before falling back to non-file actions', () => {
    localStorage.setItem('bh:recent-files', JSON.stringify({ main: { 'b.md': 3, 'a.md': 5 } }));
    const actions = [
      action('file:a.md', 'a.md', 'File'),
      action('file:b.md', 'b.md', 'File'),
      action('file:c.md', 'c.md', 'File'),
      action('action:settings', 'Settings...'),
    ];

    expect(
      filterCommandPaletteActions({
        actions,
        query: '',
        current: 'main',
        recentFiles: ['a.md', 'b.md'],
      }).filtered.map((item) => item.id),
    ).toEqual(['file:a.md', 'file:b.md']);
  });

  it('typed query matches labels, paths, and hidden prompt text with label highlights', () => {
    const actions = [
      { ...action('file:deep/focus.md', 'focus.md', 'File'), hint: 'deep/focus.md' },
      { ...action('file:plan.md', 'plan.md', 'File'), searchAlso: 'daily planning' },
      action('action:settings', 'Settings...'),
    ];

    const result = filterCommandPaletteActions({ actions, query: 'daily', current: 'main' });

    expect(result.filtered.map((item) => item.id)).toEqual(['file:plan.md']);
    expect(
      filterCommandPaletteActions({ actions, query: 'focus', current: 'main' }).matchMap.get(
        'file:deep/focus.md',
      ),
    ).toEqual([{ start: 0, end: 5 }]);
  });

  it('wraps keyboard selection and keeps empty result navigation inert', () => {
    expect(moveCommandPaletteSelection(1, 2, 1)).toBe(0);
    expect(moveCommandPaletteSelection(0, 2, -1)).toBe(1);
    expect(moveCommandPaletteSelection(0, 0, 1)).toBe(0);
    expect(moveCommandPaletteSelection(-1, 3, 1)).toBe(0);
    expect(moveCommandPaletteSelection(99, 3, -1)).toBe(2);
  });

  it('preserves selected rows by id when async result sources change order', () => {
    const rows = [action('file:a.md', 'a.md', 'File'), action('file:b.md', 'b.md', 'File')];
    const mergedRows = [
      action('file:new.md', 'new.md', 'File'),
      action('file:a.md', 'a.md', 'File'),
      action('file:b.md', 'b.md', 'File'),
    ];

    expect(reconcileCommandPaletteSelection(mergedRows, 1, rows[1]?.id ?? null)).toBe(2);
    expect(reconcileCommandPaletteSelection(mergedRows, 9, 'missing')).toBe(2);
    expect(reconcileCommandPaletteSelection([], 9, rows[1]?.id ?? null)).toBe(0);
  });

  it('turns content search hits into deduped Search rows for the current query/workspace', () => {
    const openFile = vi.fn();
    const rows = buildContentSearchActions({
      contentHits: [
        { file: 'a.md', matches: [{ line: 1, column: 1, text: 'hello world' }] },
        { file: 'b.md', matches: [{ line: 2, column: 1, text: 'world here' }] },
      ],
      hitsQuery: 'world',
      hitsWorkspace: 'main',
      current: 'main',
      query: 'world',
      filtered: [action('file:a.md', 'a.md', 'File')],
      openFile,
    });

    expect(rows.map((item) => item.id)).toEqual(['search:b.md']);
    rows[0]?.run();
    expect(openFile).toHaveBeenCalledWith('b.md', { pinned: true, matchQuery: 'world' });
  });

  it('builds Git entity rows and checks out remote refs using VS Code-style tracking targets', () => {
    const checkout = vi.fn(async () => undefined);
    const gitService = fakeGitService({ checkout });
    const runGit = vi.fn((fn: () => Promise<unknown>) => void fn());
    const rows = buildGitEntityActions({
      query: 'origin/feature-x',
      current: 'main',
      git: {
        repo: true,
        workspace: 'main',
        branches: [remote('origin/feature-x'), branch('main')],
        commits: [commit('Add feature')],
      },
      gitService,
      runGit,
      revealCommit: vi.fn(),
    });

    expect(rows[0]).toMatchObject({ id: 'git:branch:origin/feature-x', hint: 'remote' });
    rows[0]?.run();
    expect(runGit).toHaveBeenCalledTimes(1);
    expect(checkout).toHaveBeenCalledWith('origin/feature-x', { track: true });
  });

  it('delegates branch checkout to the shared branch quick-pick recovery flow when provided', () => {
    const checkout = vi.fn(async () => undefined);
    const checkoutBranch = vi.fn();
    const gitService = fakeGitService({ checkout });
    const runGit = vi.fn((fn: () => Promise<unknown>) => void fn());
    const branches = [remote('origin/feature-x'), branch('main')];
    const rows = buildGitEntityActions({
      query: 'origin/feature-x',
      current: 'main',
      git: {
        repo: true,
        workspace: 'main',
        branches,
        commits: [],
      },
      gitService,
      runGit,
      checkoutBranch,
      revealCommit: vi.fn(),
    });

    rows[0]?.run();

    expect(checkoutBranch).toHaveBeenCalledWith(branches[0], branches);
    expect(runGit).not.toHaveBeenCalled();
    expect(checkout).not.toHaveBeenCalled();
  });

  it('resolves remote branch checkout targets without importing SCM browser internals', () => {
    const tracked = branch('feature-x', { upstream: 'origin/feature-x' });

    expect(checkoutTargetForQuickAccessRef(remote('origin/feature-x'), [tracked])).toEqual({
      branch: 'feature-x',
    });
    expect(checkoutTargetForQuickAccessRef(remote('origin/new-branch'), [tracked])).toEqual({
      branch: 'origin/new-branch',
      track: true,
    });
  });
});
