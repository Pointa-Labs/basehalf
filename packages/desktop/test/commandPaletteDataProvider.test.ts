import { describe, expect, it, vi } from 'vitest';
import {
  COMMAND_PALETTE_CONTENT_SEARCH_MAX_FILES,
  COMMAND_PALETTE_CONTENT_SEARCH_MAX_MATCHES_PER_FILE,
  COMMAND_PALETTE_GIT_LOG_MAX_COUNT,
  emptyCommandPaletteContentSearch,
  provideCommandPaletteContentSearch,
  provideCommandPaletteFiles,
  provideCommandPaletteGitState,
} from '../src/workbench/browser/quickaccess/commandPaletteDataProvider.js';
import type {
  CommandPaletteGitCommit,
  CommandPaletteGitRefInfo,
} from '../src/workbench/common/quickaccess/commandPaletteModel.js';

const branch = (
  name: string,
  type: CommandPaletteGitRefInfo['type'] = 'head',
): CommandPaletteGitRefInfo => ({
  id: `refs/${type === 'remoteHead' ? 'remotes' : 'heads'}/${name}`,
  name,
  type,
  current: false,
});

const commit = (subject: string): CommandPaletteGitCommit => ({
  hash: 'abc1234abc1234',
  shortHash: 'abc1234',
  subject,
  author: { name: 'Ada' },
});

describe('commandPaletteDataProvider', () => {
  it('combines workspace files with badge descriptions for prompt search', async () => {
    const result = await provideCommandPaletteFiles({
      current: 'main',
      workspace: {
        listSupportedFiles: vi.fn(async () => ['notes/today.md', 'docs/spec.md']),
      },
      badges: {
        list: vi.fn(async () => [
          { path: 'notes/today.md', description: 'daily planning' },
          { path: 'missing.md', description: 'not listed' },
        ]),
      },
    });

    expect(result).toEqual({
      filesWorkspace: 'main',
      files: [{ file: 'notes/today.md', prompt: 'daily planning' }, { file: 'docs/spec.md' }],
    });
  });

  it('skips file provider work without an active workspace', async () => {
    const workspace = { listSupportedFiles: vi.fn(async () => ['notes/today.md']) };
    const badges = { list: vi.fn(async () => []) };

    await expect(provideCommandPaletteFiles({ current: null, workspace, badges })).resolves.toEqual(
      {
        files: [],
        filesWorkspace: null,
      },
    );
    expect(workspace.listSupportedFiles).not.toHaveBeenCalled();
    expect(badges.list).not.toHaveBeenCalled();
  });

  it('runs content search with the provider-owned quick access limits', async () => {
    const search = {
      query: vi.fn(async () => ({
        hits: [{ file: 'notes/today.md', matches: [{ text: 'hello world' }] }],
      })),
    };

    const result = await provideCommandPaletteContentSearch({
      current: 'main',
      query: '  world  ',
      search,
    });

    expect(search.query).toHaveBeenCalledWith({
      query: 'world',
      maxFiles: COMMAND_PALETTE_CONTENT_SEARCH_MAX_FILES,
      maxMatchesPerFile: COMMAND_PALETTE_CONTENT_SEARCH_MAX_MATCHES_PER_FILE,
    });
    expect(result).toEqual({
      contentHits: [{ file: 'notes/today.md', matches: [{ text: 'hello world' }] }],
      hitsQuery: 'world',
      hitsWorkspace: 'main',
    });
  });

  it('does not search content until there is enough typed input', async () => {
    const search = { query: vi.fn(async () => ({ hits: [] })) };

    await expect(
      provideCommandPaletteContentSearch({ current: 'main', query: 'ab', search }),
    ).resolves.toEqual(emptyCommandPaletteContentSearch());
    expect(search.query).not.toHaveBeenCalled();
  });

  it('loads git quick access refs and recent commits for repositories', async () => {
    const git = {
      status: vi.fn(async () => ({ isRepo: true })),
      refs: vi.fn(async () => ({
        refs: [branch('main'), branch('origin/main', 'remoteHead'), branch('v1', 'tag')],
      })),
      log: vi.fn(async () => ({ commits: [commit('Initial commit')] })),
    };

    const result = await provideCommandPaletteGitState({ current: 'main', git });

    expect(git.refs).toHaveBeenCalledWith({ includeRemote: true });
    expect(git.log).toHaveBeenCalledWith({ maxCount: COMMAND_PALETTE_GIT_LOG_MAX_COUNT });
    expect(result).toEqual({
      gitRepo: true,
      gitBranches: [branch('main'), branch('origin/main', 'remoteHead')],
      gitCommits: [commit('Initial commit')],
      gitWorkspace: 'main',
    });
  });

  it('marks the current workspace as checked even when git is not initialized', async () => {
    const git = {
      status: vi.fn(async () => ({ isRepo: false })),
      refs: vi.fn(async () => ({ refs: [] })),
      log: vi.fn(async () => ({ commits: [] })),
    };

    await expect(provideCommandPaletteGitState({ current: 'main', git })).resolves.toEqual({
      gitRepo: false,
      gitBranches: [],
      gitCommits: [],
      gitWorkspace: 'main',
    });
    expect(git.refs).not.toHaveBeenCalled();
    expect(git.log).not.toHaveBeenCalled();
  });
});
