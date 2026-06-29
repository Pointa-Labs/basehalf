import { useMemo } from 'react';
import {
  type CommandPaletteAction as Action,
  type IMatch,
  filterCommandPaletteActions,
} from '../../common/quickaccess/commandPaletteModel.js';
import {
  buildCommandPaletteActions,
  buildCommandPaletteAdditionalActions,
  buildContentSearchActions,
  combineCommandPaletteRows,
  commandPaletteProviderIncludesAdditionalPicks,
} from '../../common/quickaccess/commandPaletteProviders.js';
import { createGitQuickAccessContribution } from '../../contrib/scm/browser/gitQuickAccessContribution.js';
import {
  useCommandPaletteContentSearch,
  useCommandPaletteFiles,
  useCommandPaletteGitState,
} from './commandPaletteData.js';
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
  const quickAccessContributions = useMemo(
    () => [
      createGitQuickAccessContribution({
        current: workbench.current,
        git: {
          repo: gitRepo,
          workspace: gitWorkspace,
          branches: gitBranches,
          commits: gitCommits,
        },
        gitService: workbench.gitService,
        promptCreateBranch: workbench.promptCreateBranch,
        showSourceControl: workbench.showSourceControl,
        openGitGraph: workbench.openGitGraph,
        runGit: workbench.runGit,
        checkoutBranch: workbench.checkoutBranch,
        revealCommit: workbench.revealCommit,
      }),
    ],
    [
      workbench.current,
      gitRepo,
      gitWorkspace,
      gitBranches,
      gitCommits,
      workbench.gitService,
      workbench.promptCreateBranch,
      workbench.showSourceControl,
      workbench.openGitGraph,
      workbench.runGit,
      workbench.checkoutBranch,
      workbench.revealCommit,
    ],
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
        modifierLabel: workbench.modifierLabel,
        tildifyPath: workbench.tildifyPath,
        useWorkspace: workbench.useWorkspace,
        openFile: workbench.openFile,
        pickAndAdd: workbench.pickAndAdd,
        createDemo: workbench.createDemo,
        newNote: workbench.newNote,
        promptForNewNote: workbench.promptForNewNote,
        openSettings: workbench.openSettings,
        quickAccessContributions,
      }),
    [workbench, files, filesWorkspace, quickAccessContributions, args.providerId],
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

  const contributedAdditionalActions = useMemo<Action[]>(
    () =>
      includeAdditionalPicks
        ? buildCommandPaletteAdditionalActions({
            query: args.query,
            filtered,
            quickAccessContributions,
          })
        : [],
    [includeAdditionalPicks, args.query, filtered, quickAccessContributions],
  );

  const rows = useMemo(
    () => combineCommandPaletteRows(filtered, contentActions, contributedAdditionalActions),
    [filtered, contentActions, contributedAdditionalActions],
  );

  return { rows, matchMap };
}
