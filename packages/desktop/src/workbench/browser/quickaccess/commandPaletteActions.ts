import { useMemo } from 'react';
import type {
  CommandPaletteAction as Action,
  IMatch,
} from '../../common/quickaccess/commandPaletteModel.js';
import {
  buildCommandPaletteRows,
  commandPaletteQuickAccessProviderForState,
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
  readonly value: string;
  readonly query: string;
}): CommandPaletteRowsResult {
  const workbench = useCommandPaletteWorkbenchContext();
  const provider = useMemo(
    () =>
      commandPaletteQuickAccessProviderForState({
        value: args.value,
        ...(args.providerId !== undefined && { providerId: args.providerId }),
      }),
    [args.providerId, args.value],
  );
  const dataRequirements = provider.dataRequirements;

  const filesData = useCommandPaletteFiles(args.open && dataRequirements.files, workbench.current);
  const contentData = useCommandPaletteContentSearch(
    args.open && dataRequirements.contentSearch,
    workbench.current,
    args.query,
  );
  const gitData = useCommandPaletteGitState(
    args.open && dataRequirements.gitState,
    workbench.current,
  );
  const files = dataRequirements.files ? filesData.files : [];
  const filesWorkspace = dataRequirements.files ? filesData.filesWorkspace : null;
  const contentHits = dataRequirements.contentSearch ? contentData.contentHits : [];
  const hitsQuery = dataRequirements.contentSearch ? contentData.hitsQuery : '';
  const hitsWorkspace = dataRequirements.contentSearch ? contentData.hitsWorkspace : null;
  const gitRepo = dataRequirements.gitState ? gitData.gitRepo : false;
  const gitBranches = dataRequirements.gitState ? gitData.gitBranches : [];
  const gitCommits = dataRequirements.gitState ? gitData.gitCommits : [];
  const gitWorkspace = dataRequirements.gitState ? gitData.gitWorkspace : null;
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
        checkoutBranchPicker: workbench.checkoutBranchPicker,
        promptCreateBranch: workbench.promptCreateBranch,
        showSourceControl: workbench.showSourceControl,
        openGitGraph: workbench.openGitGraph,
        runGit: workbench.runGit,
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
      workbench.checkoutBranchPicker,
      workbench.promptCreateBranch,
      workbench.showSourceControl,
      workbench.openGitGraph,
      workbench.runGit,
      workbench.revealCommit,
    ],
  );

  const { rows, matchMap } = useMemo(
    () =>
      buildCommandPaletteRows({
        workspaces: workbench.workspaces,
        current: workbench.current,
        ...(provider.descriptor.id !== undefined && { providerId: provider.descriptor.id }),
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
        query: args.query,
        contentHits,
        hitsQuery,
        hitsWorkspace,
      }),
    [
      workbench,
      provider.descriptor.id,
      files,
      filesWorkspace,
      quickAccessContributions,
      args.query,
      contentHits,
      hitsQuery,
      hitsWorkspace,
    ],
  );

  return { rows, matchMap };
}
