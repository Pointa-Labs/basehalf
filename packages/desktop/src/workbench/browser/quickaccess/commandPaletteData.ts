import { useCallback } from 'react';
import {
  COMMAND_PALETTE_CONTENT_QUERY_MIN_LENGTH,
  type CommandPaletteContentSearchProviderResult,
  type CommandPaletteFilesProviderResult,
  type CommandPaletteGitProviderResult,
  emptyCommandPaletteContentSearch,
  emptyCommandPaletteFiles,
  emptyCommandPaletteGitState,
  provideCommandPaletteContentSearch,
  provideCommandPaletteFiles,
  provideCommandPaletteGitState,
} from '../../common/quickaccess/commandPaletteDataProvider.js';
import { gitScmService } from '../../contrib/scm/browser/gitScmService.js';
import { badgeService } from '../../services/mirror/browser/badgeService.js';
import { searchService } from '../../services/search/browser/searchService.js';
import { workspaceContentService } from '../../services/workspace/browser/workspaceContentService.js';
import { useCommandPaletteAsyncProvider } from './commandPaletteAsyncProvider.js';

export function useCommandPaletteFiles(
  open: boolean,
  current: string | null,
): CommandPaletteFilesProviderResult {
  const load = useCallback(
    () =>
      provideCommandPaletteFiles({
        current,
        workspace: workspaceContentService,
        badges: badgeService,
      }),
    [current],
  );

  return useCommandPaletteAsyncProvider({
    open,
    ready: current !== null,
    empty: emptyCommandPaletteFiles,
    resetBeforeLoad: true,
    load,
  });
}

export function useCommandPaletteContentSearch(
  open: boolean,
  current: string | null,
  query: string,
): CommandPaletteContentSearchProviderResult {
  const ready = current !== null && query.trim().length >= COMMAND_PALETTE_CONTENT_QUERY_MIN_LENGTH;
  const load = useCallback(
    () =>
      provideCommandPaletteContentSearch({
        current,
        query,
        search: searchService,
      }),
    [current, query],
  );

  return useCommandPaletteAsyncProvider({
    open,
    ready,
    empty: emptyCommandPaletteContentSearch,
    delayMs: 180,
    emptyOnError: true,
    load,
  });
}

export function useCommandPaletteGitState(
  open: boolean,
  current: string | null,
): CommandPaletteGitProviderResult {
  const load = useCallback(
    () => provideCommandPaletteGitState({ current, git: gitScmService }),
    [current],
  );

  return useCommandPaletteAsyncProvider({
    open,
    ready: current !== null,
    empty: emptyCommandPaletteGitState,
    resetBeforeLoad: true,
    load,
  });
}
