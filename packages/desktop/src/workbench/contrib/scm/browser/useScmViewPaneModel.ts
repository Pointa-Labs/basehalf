import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GitStashEntry, GitStatusResult } from '../common/git.js';
import type { GitGroups } from '../common/gitStatusModel.js';
import {
  type GitRepositoryProviderModel,
  gitRepositoryGroups,
  gitRepositoryProviderModel,
} from './gitRepositoryProvider.js';
import { gitScmService } from './gitScmService.js';
import { useGitStatusStore } from './gitStatusStore.js';
import { useScmViewStore } from './scmViewStore.js';
import { type ScmCommands, useScmCommands } from './useScmCommands.js';

export interface ScmViewPaneModel {
  readonly status: GitStatusResult | null;
  readonly statusError: string | null;
  readonly refresh: () => Promise<void> | void;
  readonly message: string;
  readonly setMessage: (message: string) => void;
  readonly graphOpen: boolean;
  readonly setGraphOpen: (open: boolean) => void;
  readonly stashes: readonly GitStashEntry[];
  readonly stashesOpen: boolean;
  readonly setStashesOpen: (open: boolean) => void;
  readonly provider: GitRepositoryProviderModel;
  readonly groups: GitGroups;
  readonly commands: ScmCommands;
}

/**
 * SCM view-pane model, following VS Code's split where `scmViewPane` consumes a
 * repository/provider model instead of owning Git command details inline.
 */
export function useScmViewPaneModel(): ScmViewPaneModel {
  const status = useGitStatusStore((state) => state.status);
  const statusError = useGitStatusStore((state) => state.error);
  const refresh = useGitStatusStore((state) => state.refresh);
  const [message, setMessage] = useState('');
  const graphOpen = useScmViewStore((state) => state.graphOpen);
  const setGraphOpen = useScmViewStore((state) => state.setGraphOpen);
  const [stashes, setStashes] = useState<readonly GitStashEntry[]>([]);
  const [stashesOpen, setStashesOpen] = useState(true);
  const loadStashes = useCallback(async (): Promise<void> => {
    try {
      setStashes([...(await gitScmService.stashList())]);
    } catch {
      setStashes([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void loadStashes();
  }, [refresh, loadStashes]);

  const groups = useMemo(() => gitRepositoryGroups(status), [status]);
  const commands = useScmCommands({
    status,
    groups,
    message,
    setMessage,
    hasStaged: groups.staged.length > 0,
    refresh,
    loadStashes,
  });
  const repositoryModel = useMemo(
    () => gitRepositoryProviderModel(status, message, commands.busy, groups),
    [status, message, commands.busy, groups],
  );

  return {
    status,
    statusError,
    refresh,
    message,
    setMessage,
    graphOpen,
    setGraphOpen,
    stashes,
    stashesOpen,
    setStashesOpen,
    provider: repositoryModel,
    groups,
    commands,
  };
}
