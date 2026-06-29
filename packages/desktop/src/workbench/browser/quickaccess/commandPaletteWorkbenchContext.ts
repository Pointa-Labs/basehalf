import { useCallback, useMemo } from 'react';
import { prompt } from '../../../platform/dialogs/browser/dialogService.js';
import { toast } from '../../../platform/notification/browser/notificationService.js';
import type { BuildCommandPaletteActionsBaseArgs } from '../../common/quickaccess/commandPaletteProviders.js';
import { openSettings } from '../../contrib/preferences/browser/Settings.js';
import { createBranchGitAdapter } from '../../contrib/scm/browser/branchGitAdapter.js';
import { checkoutBranchWithRecovery } from '../../contrib/scm/browser/branchQuickPickCommands.js';
import {
  type GitQuickAccessService,
  createGitQuickAccessContribution,
} from '../../contrib/scm/browser/gitQuickAccessContribution.js';
import { gitScmService } from '../../contrib/scm/browser/gitScmService.js';
import { useGitStatusStore } from '../../contrib/scm/browser/gitStatusStore.js';
import { scmErrorMessage } from '../../contrib/scm/browser/scmCommandModel.js';
import { useScmViewStore } from '../../contrib/scm/browser/scmViewStore.js';
import type { GitRefInfo } from '../../contrib/scm/common/git.js';
import { historyService } from '../../services/history/browser/historyService.js';
import { useWorkspaceStore } from '../../services/workspace/browser/workspaceStore.js';
import { createDemoAtDefault, promptForNewNote, tildifyPath } from '../actions/workbenchActions.js';
import { useLayoutStore } from '../layout/layoutStore.js';

export interface CommandPaletteWorkbenchContext
  extends Omit<
    BuildCommandPaletteActionsBaseArgs,
    'files' | 'filesWorkspace' | 'quickAccessContributions'
  > {
  readonly current: string | null;
  readonly recentFiles: readonly string[];
  readonly gitService: GitQuickAccessService;
  readonly promptCreateBranch: () => Promise<string | null | undefined>;
  readonly showSourceControl: (section: 'changes' | 'graph') => void;
  readonly openGitGraph: () => void;
  readonly runGit: (fn: () => Promise<unknown>) => void;
  readonly checkoutBranch: (branch: GitRefInfo, refs: readonly GitRefInfo[]) => void;
  readonly revealCommit: (hash: string) => void;
}

// Mac uses ⌘ / ⇧; everything else uses Ctrl / Shift to match what
// Workbench contributions actually listen for.
const MOD = typeof navigator !== 'undefined' && navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+';

export function createCommandsQuickAccessContextSnapshot(): BuildCommandPaletteActionsBaseArgs {
  const workspaceState = useWorkspaceStore.getState();
  const current = workspaceState.current;
  const recentFiles = current === null ? [] : historyService.recentFilesFor(current);
  const gitStatus = useGitStatusStore.getState().status;
  const promptCreateBranch = createPromptCreateBranch;
  const runGitAction = (fn: () => Promise<unknown>) => void runGit(fn);
  const git = {
    repo: gitStatus?.isRepo ?? false,
    workspace: current,
    branches: [],
    commits: [],
  };

  return {
    workspaces: workspaceState.workspaces,
    current,
    files: [],
    filesWorkspace: current,
    recentFiles,
    modifierLabel: MOD,
    tildifyPath,
    useWorkspace: (name: string) => void useWorkspaceStore.getState().use(name),
    openFile: (file, opts) => useWorkspaceStore.getState().openInPanel(file, opts),
    pickAndAdd: () => void useWorkspaceStore.getState().pickAndAdd(),
    createDemo: () => void createDemoAtDefault(),
    newNote: () => void useWorkspaceStore.getState().newNote(),
    promptForNewNote: () => void promptForNewNote(),
    openSettings,
    quickAccessContributions: [
      createGitQuickAccessContribution({
        current,
        git,
        gitService: gitScmService,
        promptCreateBranch,
        showSourceControl,
        openGitGraph: () => useWorkspaceStore.getState().openGitGraph(),
        runGit: runGitAction,
        revealCommit: revealCommitInGraph,
      }),
    ],
  };
}

export function useCommandPaletteWorkbenchContext(): CommandPaletteWorkbenchContext {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const current = useWorkspaceStore((s) => s.current);
  const use = useWorkspaceStore((s) => s.use);
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const pickAndAdd = useWorkspaceStore((s) => s.pickAndAdd);
  const recentFiles = useWorkspaceStore((s) =>
    s.current === null ? [] : historyService.recentFilesFor(s.current),
  );
  const checkoutBranch = useCallback(checkoutBranchWithRecoveryToast, []);

  return useMemo(
    () => ({
      workspaces,
      current,
      recentFiles,
      modifierLabel: MOD,
      tildifyPath,
      useWorkspace: (name: string) => void use(name),
      openFile: openInPanel,
      pickAndAdd: () => void pickAndAdd(),
      createDemo: () => void createDemoAtDefault(),
      newNote: () => void useWorkspaceStore.getState().newNote(),
      promptForNewNote: () => void promptForNewNote(),
      openSettings,
      showSourceControl,
      openGitGraph: () => useWorkspaceStore.getState().openGitGraph(),
      promptCreateBranch: createPromptCreateBranch,
      runGit: (fn: () => Promise<unknown>) => void runGit(fn),
      gitService: gitScmService,
      checkoutBranch,
      revealCommit: revealCommitInGraph,
    }),
    [workspaces, current, recentFiles, use, openInPanel, pickAndAdd, checkoutBranch],
  );
}

function createPromptCreateBranch(): Promise<string | null | undefined> {
  return prompt({
    title: 'Create Branch',
    label: 'Branch name',
    placeholder: 'feature/x',
  });
}

function checkoutBranchWithRecoveryToast(branch: GitRefInfo, refs: readonly GitRefInfo[]): void {
  void checkoutBranchWithRecovery(createBranchGitAdapter(gitScmService), branch, refs, () =>
    useGitStatusStore.getState().refresh(),
  ).catch((err) => toast.error(scmErrorMessage(err)));
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
