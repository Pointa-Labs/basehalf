import { useCallback, useMemo } from 'react';
import { prompt } from '../../../platform/dialogs/browser/dialogService.js';
import { toast } from '../../../platform/notification/browser/notificationService.js';
import { openSettings } from '../../contrib/preferences/browser/Settings.js';
import { createBranchGitAdapter } from '../../contrib/scm/browser/branchGitAdapter.js';
import { checkoutBranchWithRecovery } from '../../contrib/scm/browser/branchQuickPickCommands.js';
import { gitScmService } from '../../contrib/scm/browser/gitScmService.js';
import { useGitStatusStore } from '../../contrib/scm/browser/gitStatusStore.js';
import { scmErrorMessage } from '../../contrib/scm/browser/scmCommandModel.js';
import { useScmViewStore } from '../../contrib/scm/browser/scmViewStore.js';
import type { GitRefInfo } from '../../contrib/scm/common/git.js';
import { historyService } from '../../services/history/browser/historyService.js';
import { useWorkspaceStore } from '../../services/workspace/browser/workspaceStore.js';
import { createDemoAtDefault, promptForNewNote, tildifyPath } from '../actions/workbenchActions.js';
import { useLayoutStore } from '../layout/layoutStore.js';
import {
  useCommandPaletteContentSearch,
  useCommandPaletteFiles,
  useCommandPaletteGitState,
} from './commandPaletteData.js';
import {
  type CommandPaletteAction as Action,
  type IMatch,
  filterCommandPaletteActions,
} from './commandPaletteModel.js';
import {
  buildCommandPaletteActions,
  buildContentSearchActions,
  buildGitEntityActions,
  combineCommandPaletteRows,
  commandPaletteProviderIncludesAdditionalPicks,
} from './commandPaletteProviders.js';

export interface CommandPaletteRowsResult {
  readonly rows: readonly Action[];
  readonly matchMap: Map<string, IMatch[]>;
}

// Mac uses ⌘ / ⇧; everything else uses Ctrl / Shift to match what
// Workbench contributions actually listen for.
const MOD = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+';

export function useCommandPaletteRows(args: {
  readonly open: boolean;
  readonly providerId?: string;
  readonly query: string;
}): CommandPaletteRowsResult {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const current = useWorkspaceStore((s) => s.current);
  const use = useWorkspaceStore((s) => s.use);
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const pickAndAdd = useWorkspaceStore((s) => s.pickAndAdd);
  const recentFiles = useWorkspaceStore((s) =>
    s.current === null ? [] : historyService.recentFilesFor(s.current),
  );
  const includeAdditionalPicks = commandPaletteProviderIncludesAdditionalPicks(args.providerId);

  const { files, filesWorkspace } = useCommandPaletteFiles(args.open, current);
  const { contentHits, hitsQuery, hitsWorkspace } = useCommandPaletteContentSearch(
    args.open && includeAdditionalPicks,
    current,
    args.query,
  );
  const { gitRepo, gitBranches, gitCommits, gitWorkspace } = useCommandPaletteGitState(
    args.open,
    current,
  );
  const checkoutPaletteBranch = useCallback(
    (branch: GitRefInfo, refs: readonly GitRefInfo[]): void => {
      void checkoutBranchWithRecovery(createBranchGitAdapter(gitScmService), branch, refs, () =>
        useGitStatusStore.getState().refresh(),
      ).catch((err) => toast.error(scmErrorMessage(err)));
    },
    [],
  );

  const actions = useMemo<Action[]>(
    () =>
      buildCommandPaletteActions({
        workspaces,
        current,
        providerId: args.providerId,
        files,
        filesWorkspace,
        recentFiles,
        git: {
          repo: gitRepo,
          workspace: gitWorkspace,
          branches: gitBranches,
          commits: gitCommits,
        },
        modifierLabel: MOD,
        tildifyPath,
        useWorkspace: (name) => void use(name),
        openFile: openInPanel,
        pickAndAdd: () => void pickAndAdd(),
        createDemo: () => void createDemoAtDefault(),
        newNote: () => void useWorkspaceStore.getState().newNote(),
        promptForNewNote: () => void promptForNewNote(),
        openSettings,
        showSourceControl,
        openGitGraph: () => useWorkspaceStore.getState().openGitGraph(),
        promptCreateBranch: () =>
          prompt({
            title: 'Create Branch',
            label: 'Branch name',
            placeholder: 'feature/x',
          }),
        runGit: (fn) => void runGit(fn),
        gitService: gitScmService,
      }),
    [
      workspaces,
      current,
      files,
      filesWorkspace,
      recentFiles,
      use,
      openInPanel,
      pickAndAdd,
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
        current,
        recentFiles,
      }),
    [actions, args.query, current, recentFiles],
  );

  const contentActions = useMemo<Action[]>(
    () =>
      includeAdditionalPicks
        ? buildContentSearchActions({
            contentHits,
            hitsQuery,
            hitsWorkspace,
            current,
            query: args.query,
            filtered,
            openFile: openInPanel,
          })
        : [],
    [
      includeAdditionalPicks,
      contentHits,
      hitsQuery,
      hitsWorkspace,
      current,
      args.query,
      filtered,
      openInPanel,
    ],
  );

  const gitMatches = useMemo<Action[]>(
    () =>
      includeAdditionalPicks
        ? buildGitEntityActions({
            query: args.query,
            current,
            git: {
              repo: gitRepo,
              workspace: gitWorkspace,
              branches: gitBranches,
              commits: gitCommits,
            },
            gitService: gitScmService,
            runGit: (fn) => void runGit(fn),
            checkoutBranch: checkoutPaletteBranch,
            revealCommit: revealCommitInGraph,
          })
        : [],
    [
      includeAdditionalPicks,
      args.query,
      current,
      gitRepo,
      gitWorkspace,
      gitBranches,
      gitCommits,
      checkoutPaletteBranch,
    ],
  );

  const rows = useMemo(
    () => combineCommandPaletteRows(filtered, contentActions, gitMatches),
    [filtered, contentActions, gitMatches],
  );

  return { rows, matchMap };
}

function showSourceControl(section: 'changes' | 'graph'): void {
  useLayoutStore.getState().setSidebarOpen(true);
  useLayoutStore.getState().setSidebarView('scm');
  if (section === 'graph') useScmViewStore.getState().setGraphOpen(true);
  else useScmViewStore.getState().setChangesOpen(true);
}

function revealCommitInGraph(hash: string): void {
  useLayoutStore.getState().setSidebarOpen(true);
  useLayoutStore.getState().setSidebarView('scm');
  useScmViewStore.getState().revealCommit(hash);
}

async function runGit(fn: () => Promise<unknown>): Promise<void> {
  await fn();
  await useGitStatusStore.getState().refresh();
}
