import { useEffect, useState } from 'react';
import { workspaceService } from '../../../platform/workspaces/browser/workspaceService.js';
import { gitScmService } from '../../contrib/scm/browser/gitScmService.js';
import { badgeService } from '../../services/mirror/browser/badgeService.js';
import { searchService } from '../../services/search/browser/searchService.js';
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
} from './commandPaletteDataProvider.js';

export function useCommandPaletteFiles(
  open: boolean,
  current: string | null,
): CommandPaletteFilesProviderResult {
  const [state, setState] = useState<CommandPaletteFilesProviderResult>(emptyCommandPaletteFiles);

  useEffect(() => {
    if (!open) return;
    setState(emptyCommandPaletteFiles());
    if (current === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await provideCommandPaletteFiles({
          current,
          workspace: workspaceService,
          badges: badgeService,
        });
        if (cancelled) return;
        setState(next);
      } catch {
        // Palette should still show workspaces / chrome actions on transient IO errors.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, current]);

  return state;
}

export function useCommandPaletteContentSearch(
  open: boolean,
  current: string | null,
  query: string,
): CommandPaletteContentSearchProviderResult {
  const [state, setState] = useState<CommandPaletteContentSearchProviderResult>(
    emptyCommandPaletteContentSearch,
  );

  useEffect(() => {
    if (!open) return;
    if (current === null || query.trim().length < COMMAND_PALETTE_CONTENT_QUERY_MIN_LENGTH) {
      setState(emptyCommandPaletteContentSearch());
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const next = await provideCommandPaletteContentSearch({
            current,
            query,
            search: searchService,
          });
          if (cancelled) return;
          setState(next);
        } catch {
          if (!cancelled) {
            setState(emptyCommandPaletteContentSearch());
          }
        }
      })();
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, query, current]);

  return state;
}

export function useCommandPaletteGitState(
  open: boolean,
  current: string | null,
): CommandPaletteGitProviderResult {
  const [state, setState] = useState<CommandPaletteGitProviderResult>(emptyCommandPaletteGitState);

  useEffect(() => {
    if (!open) return;
    setState(emptyCommandPaletteGitState());
    if (current === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await provideCommandPaletteGitState({ current, git: gitScmService });
        if (cancelled) return;
        setState(next);
      } catch {
        // A non-repo / transient git error just leaves the Git rows empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, current]);

  return state;
}
