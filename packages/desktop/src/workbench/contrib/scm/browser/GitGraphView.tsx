import { type JSX, type MouseEvent, useCallback, useMemo, useState } from 'react';
import { openContextMenu } from '../../../../platform/contextview/browser/contextMenuService.js';
import { toast } from '../../../../platform/notification/browser/notificationService.js';
import { useLayoutStore } from '../../../browser/layout/layoutStore.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import type { GitCommit } from '../common/git.js';
import { layoutGraph } from '../common/gitGraphLayout.js';
import { type FullGraphRefModel, fullGraphRefIndex } from '../common/gitGraphRefIndex.js';
import { FullGraphCommitDetails } from './FullGraphCommitDetails.js';
import { FullGraphHeader } from './FullGraphHeader.js';
import { FullGraphHistoryTable } from './FullGraphHistoryTable.js';
import { RebasePlanner } from './RebasePlanner.js';
import { createGitGraphActionRunner } from './gitGraphActionTypes.js';
import { fullGraphCommitMenu, fullGraphRefMenu, fullGraphStashMenu } from './gitGraphActions.js';
import {
  FULL_GRAPH_LANE_GAP,
  FULL_GRAPH_LEFT_OFFSET,
  type FullGraphDateMode,
  fullGraphCommitMatches,
  fullGraphInjectStashes,
  fullGraphPaths,
} from './gitGraphViewModel.js';
import { type GitScmService, gitScmService } from './gitScmService.js';
import { useGitStatusStore } from './gitStatusStore.js';
import { useScmViewStore } from './scmViewStore.js';
import { useFullGitGraphHistory } from './useFullGitGraphHistory.js';

/**
 * GitGraphView — a full-page commit graph whose provider/action boundaries
 * follow VS Code's Source Control Graph (`ISCMHistoryProvider`,
 * `SCMHistoryViewPane`, Git extension history provider). The table/DAG remains
 * BaseHalf's richer full-graph surface: Graph / Description / Date / Author /
 * Commit columns, smooth bezier curves, ref labels, and a commit-details panel.
 *
 * Opens as a full-canvas overlay (workspace.openGitGraph). Lane data comes from
 * the shared, unit-tested layoutGraph; commits come through the history provider.
 */

export const GitGraphView = ({
  onClose,
  gitService: git = gitScmService,
}: {
  onClose: () => void;
  gitService?: GitScmService;
}): JSX.Element => {
  const openCommitDiff = useWorkspaceStore((s) => s.openCommitDiff);
  const selected = useScmViewStore((s) => s.selectedHistoryItemId);
  const setSelected = useScmViewStore((s) => s.selectHistoryItem);
  const historyFilter = useScmViewStore((s) => s.historyFilter);
  const setHistoryFilter = useScmViewStore((s) => s.setHistoryFilter);
  // Controls: a VS Code-style history ref filter, a remote-branch toggle, and a find query.
  const [showRemote, setShowRemote] = useState(false);
  const [find, setFind] = useState('');
  // The interactive-rebase planner, opened (base = a commit) from the commit menu.
  const [rebaseBase, setRebaseBase] = useState<string | null>(null);
  // Date column format — Git Graph's "Date Format" setting (absolute ↔ relative).
  const [dateMode, setDateMode] = useState<FullGraphDateMode>('absolute');

  const {
    commits,
    loading,
    done,
    error,
    branches,
    uncommitted,
    stashes,
    loadPage,
    loadAux,
    runGraphMutation: runGit,
  } = useFullGitGraphHistory({
    historyFilter,
    showRemote,
    gitService: git,
    refreshScmStatus: () => useGitStatusStore.getState().refresh(),
    onError: toast.error,
  });

  const actionRunner = useMemo(
    () =>
      createGitGraphActionRunner({
        git,
        runGit,
        setRebaseBase,
      }),
    [git, runGit],
  );

  // Structured ref metadata mirrors VS Code SCM History refs: renderers consume
  // ids/categories/tracking data instead of guessing from display names.
  const refIndex = useMemo(() => fullGraphRefIndex(branches), [branches]);

  // Stash nodes — Git Graph draws each stash as a node hanging off its base commit.
  // Inject a synthetic commit (parent = the stash's base) right before that base in
  // the list, so the lane layout connects it and topo order stays valid. Keep a
  // hash→ref map so the row can show a stash pill + a stash-specific menu.
  const { graphCommits, stashByHash } = useMemo(
    () => fullGraphInjectStashes(commits, stashes),
    [commits, stashes],
  );

  const { rows, width } = useMemo(() => layoutGraph(graphCommits), [graphCommits]);
  const graphW = FULL_GRAPH_LEFT_OFFSET * 2 + Math.max(1, width) * FULL_GRAPH_LANE_GAP;
  const gridCols = `${graphW}px minmax(120px, 1fr) 150px 130px 70px`;
  // A leading "Uncommitted Changes" row (Git Graph's signature) shifts the commit
  // rows down one when the working tree is dirty.
  const hasUncommitted = uncommitted > 0 && historyFilter.kind === 'all';
  const vOff = hasUncommitted ? 1 : 0;
  const findLower = find.trim().toLowerCase();
  const matches = (c: GitCommit): boolean => fullGraphCommitMatches(c, findLower);
  const selectedCommit =
    selected === null ? null : (graphCommits.find((commit) => commit.hash === selected) ?? null);

  // The whole DAG as one SVG over the graph column.
  const paths = useMemo(
    () => fullGraphPaths(rows, { rowOffset: vOff, hasUncommitted }),
    [rows, vOff, hasUncommitted],
  );

  const openUncommittedChanges = useCallback(() => {
    useLayoutStore.getState().setSidebarView('scm');
    useLayoutStore.getState().setSidebarOpen(true);
    onClose();
  }, [onClose]);

  const openCommitMenu = useCallback(
    (event: MouseEvent, commit: GitCommit, stashRef: string | undefined): void => {
      event.preventDefault();
      openContextMenu(
        event.clientX,
        event.clientY,
        stashRef !== undefined
          ? fullGraphStashMenu(stashRef, actionRunner)
          : fullGraphCommitMenu(commit, actionRunner),
      );
    },
    [actionRunner],
  );

  const openRefMenu = useCallback(
    (event: MouseEvent, ref: FullGraphRefModel): void => {
      event.preventDefault();
      event.stopPropagation();
      openContextMenu(event.clientX, event.clientY, fullGraphRefMenu(ref, actionRunner));
    },
    [actionRunner],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <FullGraphHeader
        onClose={onClose}
        count={commits.length}
        loading={loading}
        historyFilter={historyFilter}
        onHistoryFilter={setHistoryFilter}
        gitService={git}
        showRemote={showRemote}
        onToggleRemote={() => setShowRemote((v) => !v)}
        find={find}
        onFind={setFind}
        matchCount={findLower === '' ? null : commits.filter(matches).length}
      />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <FullGraphHistoryTable
          error={error}
          commits={commits}
          rows={rows}
          loading={loading}
          done={done}
          graphWidth={graphW}
          gridColumns={gridCols}
          dateMode={dateMode}
          onToggleDateMode={() => setDateMode((m) => (m === 'absolute' ? 'relative' : 'absolute'))}
          hasUncommitted={hasUncommitted}
          uncommitted={uncommitted}
          paths={paths}
          stashByHash={stashByHash}
          refIndex={refIndex}
          selected={selected}
          isHighlighted={matches}
          onOpenUncommitted={openUncommittedChanges}
          onSelectCommit={setSelected}
          onCommitContextMenu={openCommitMenu}
          onRefContextMenu={openRefMenu}
          onLoadMore={() => void loadPage(commits.length)}
        />

        {selectedCommit !== null && (
          <FullGraphCommitDetails
            commit={selectedCommit}
            gitService={git}
            onClose={() => setSelected(null)}
            onOpenFile={(path, parent) =>
              openCommitDiff(
                path,
                selectedCommit.hash,
                parent,
                `${selectedCommit.shortHash} ↔ parent`,
              )
            }
          />
        )}
      </div>
      {rebaseBase !== null && (
        <RebasePlanner
          base={rebaseBase}
          gitService={git}
          onClose={() => setRebaseBase(null)}
          onApplied={() => {
            void loadPage(0);
            void loadAux();
            void useGitStatusStore.getState().refresh();
          }}
        />
      )}
    </div>
  );
};
