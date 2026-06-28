import { useMemo } from 'react';
import {
  type CommandPaletteAction as Action,
  type IMatch,
  filterCommandPaletteActions,
} from '../../common/quickaccess/commandPaletteModel.js';
import {
  useCommandPaletteContentSearch,
  useCommandPaletteFiles,
  useCommandPaletteGitState,
} from './commandPaletteData.js';
import {
  buildCommandPaletteActions,
  buildContentSearchActions,
  buildGitEntityActions,
  combineCommandPaletteRows,
  commandPaletteProviderIncludesAdditionalPicks,
} from './commandPaletteProviders.js';
import { useCommandPaletteWorkbenchContext } from './commandPaletteWorkbenchContext.js';

export interface CommandPaletteRowsResult {
  readonly rows: readonly Action[];
  readonly matchMap: Map<string, IMatch[]>;
}

export function useCommandPaletteRows(args: {
  readonly open: boolean;
  readonly providerId?: string;
  readonly query: string;
}): CommandPaletteRowsResult {
  const workbench = useCommandPaletteWorkbenchContext();
  const includeAdditionalPicks = commandPaletteProviderIncludesAdditionalPicks(args.providerId);

  const { files, filesWorkspace } = useCommandPaletteFiles(args.open, workbench.current);
  const { contentHits, hitsQuery, hitsWorkspace } = useCommandPaletteContentSearch(
    args.open && includeAdditionalPicks,
    workbench.current,
    args.query,
  );
  const { gitRepo, gitBranches, gitCommits, gitWorkspace } = useCommandPaletteGitState(
    args.open,
    workbench.current,
  );

  const actions = useMemo<Action[]>(
    () =>
      buildCommandPaletteActions({
        workspaces: workbench.workspaces,
        current: workbench.current,
        providerId: args.providerId,
        files,
        filesWorkspace,
        recentFiles: workbench.recentFiles,
        git: {
          repo: gitRepo,
          workspace: gitWorkspace,
          branches: gitBranches,
          commits: gitCommits,
        },
        modifierLabel: workbench.modifierLabel,
        tildifyPath: workbench.tildifyPath,
        useWorkspace: workbench.useWorkspace,
        openFile: workbench.openFile,
        pickAndAdd: workbench.pickAndAdd,
        createDemo: workbench.createDemo,
        newNote: workbench.newNote,
        promptForNewNote: workbench.promptForNewNote,
        openSettings: workbench.openSettings,
        showSourceControl: workbench.showSourceControl,
        openGitGraph: workbench.openGitGraph,
        promptCreateBranch: workbench.promptCreateBranch,
        runGit: workbench.runGit,
        gitService: workbench.gitService,
      }),
    [
      workbench,
      files,
      filesWorkspace,
      gitRepo,
      gitWorkspace,
      gitBranches,
      gitCommits,
      args.providerId,
    ],
  );

  const { filtered, matchMap } = useMemo<{
    filtered: Action[];
    matchMap: Map<string, IMatch[]>;
  }>(
    () =>
      filterCommandPaletteActions({
        actions,
        query: args.query,
        current: workbench.current,
        recentFiles: workbench.recentFiles,
      }),
    [actions, args.query, workbench.current, workbench.recentFiles],
  );

  const contentActions = useMemo<Action[]>(
    () =>
      includeAdditionalPicks
        ? buildContentSearchActions({
            contentHits,
            hitsQuery,
            hitsWorkspace,
            current: workbench.current,
            query: args.query,
            filtered,
            openFile: workbench.openFile,
          })
        : [],
    [
      includeAdditionalPicks,
      contentHits,
      hitsQuery,
      hitsWorkspace,
      workbench.current,
      args.query,
      filtered,
      workbench.openFile,
    ],
  );

  const gitMatches = useMemo<Action[]>(
    () =>
      includeAdditionalPicks
        ? buildGitEntityActions({
            query: args.query,
            current: workbench.current,
            git: {
              repo: gitRepo,
              workspace: gitWorkspace,
              branches: gitBranches,
              commits: gitCommits,
            },
            gitService: workbench.gitService,
            runGit: workbench.runGit,
            checkoutBranch: workbench.checkoutBranch,
            revealCommit: workbench.revealCommit,
          })
        : [],
    [
      includeAdditionalPicks,
      args.query,
      workbench.current,
      gitRepo,
      gitWorkspace,
      gitBranches,
      gitCommits,
      workbench.gitService,
      workbench.runGit,
      workbench.checkoutBranch,
      workbench.revealCommit,
    ],
  );

  const rows = useMemo(
    () => combineCommandPaletteRows(filtered, contentActions, gitMatches),
    [filtered, contentActions, gitMatches],
  );

  return { rows, matchMap };
}
