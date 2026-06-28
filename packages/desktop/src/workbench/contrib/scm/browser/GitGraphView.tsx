import { type JSX, useMemo, useState } from 'react';
import { useLayoutStore } from '../../../browser/layout/layoutStore.js';
import { openContextMenu } from '../../../browser/parts/contextmenu/contextMenuStore.js';
import { confirm, prompt } from '../../../browser/parts/dialogs/Dialog.js';
import { toast } from '../../../browser/parts/notifications/toastStore.js';
import { color, font, space } from '../../../browser/style/design.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import type { GitCommit } from '../common/git.js';
import { FullGraphCommitDetails } from './FullGraphCommitDetails.js';
import { FullGraphCommitRow } from './FullGraphCommitRow.js';
import { FullGraphHeader } from './FullGraphHeader.js';
import { RebasePlanner } from './RebasePlanner.js';
import {
  type GitGraphActionDeps,
  fullGraphCommitMenu,
  fullGraphRefMenu,
  fullGraphStashMenu,
} from './gitGraphActions.js';
import { layoutGraph } from './gitGraphLayout.js';
import {
  FULL_GRAPH_LANE_GAP,
  FULL_GRAPH_LEFT_OFFSET,
  FULL_GRAPH_ROW_HEIGHT,
  type FullGraphDateMode,
  fullGraphCommitMatches,
  fullGraphInjectStashes,
  fullGraphLaneColor,
  fullGraphLaneX,
  fullGraphLocalBranches,
  fullGraphPaths,
} from './gitGraphViewModel.js';
import { type GitScmService, gitScmService } from './gitScmService.js';
import { useGitStatusStore } from './gitStatusStore.js';
import type { ScmHistoryFilter } from './scmViewStore.js';
import { useFullGitGraphHistory } from './useFullGitGraphHistory.js';

/**
 * GitGraphView — a full-page commit graph modeled 1:1 on the Git Graph VS Code
 * extension (mhutchie/vscode-git-graph): a table with Graph / Description / Date
 * / Author / Commit columns, the DAG drawn as smooth bezier curves (grounded in
 * Git Graph's web/graph.ts: `C x1,y1+d x2,y2-d x2,y2`, d = rowHeight·0.8, r=4
 * vertices, HEAD stroked), ref labels as pills, and a commit-details panel.
 *
 * Opens as a full-canvas overlay (workspace.openGitGraph). Lane data comes from
 * the shared, unit-tested layoutGraph; commits from git.log({all}).
 */

export const GitGraphView = ({
  onClose,
  gitService: git = gitScmService,
}: {
  onClose: () => void;
  gitService?: GitScmService;
}): JSX.Element => {
  const openCommitDiff = useWorkspaceStore((s) => s.openCommitDiff);
  const [selected, setSelected] = useState<string | null>(null);
  // Controls: a VS Code-style history ref filter, a remote-branch toggle, and a
  // find query.
  const [historyFilter, setHistoryFilter] = useState<ScmHistoryFilter>({ kind: 'all' });
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

  const actionDeps = useMemo<GitGraphActionDeps>(
    () => ({
      git,
      runGit,
      confirm,
      prompt,
      setRebaseBase,
      writeClipboard: (text) => navigator.clipboard.writeText(text),
      toastError: toast.error,
      toastSuccess: toast.success,
    }),
    [git, runGit],
  );

  // Local-branch names — used to tell a local branch ref (rename/delete-able, even
  // when it contains a "/" like feature/x) from a remote-tracking ref. A plain
  // `name.includes('/')` test is wrong: local branches can carry slashes.
  const localBranches = useMemo(() => fullGraphLocalBranches(branches), [branches]);

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

  // The whole DAG as one SVG over the graph column.
  const paths = useMemo(
    () => fullGraphPaths(rows, { rowOffset: vOff, hasUncommitted }),
    [rows, vOff, hasUncommitted],
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
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {/* Column header (sticky). */}
          <div
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 2,
              display: 'grid',
              gridTemplateColumns: gridCols,
              alignItems: 'center',
              height: FULL_GRAPH_ROW_HEIGHT,
              padding: `0 ${space[2]}px`,
              background: color.surfaceMuted,
              borderBottom: `1px solid ${color.border}`,
              color: color.textTertiary,
              fontFamily: font.sans,
              fontSize: font.size.micro,
              fontWeight: font.weight.semibold,
              letterSpacing: font.trackedCaps,
              textTransform: 'uppercase',
              userSelect: 'none',
            }}
          >
            <span>Graph</span>
            <span>Description</span>
            <button
              type="button"
              onClick={() => setDateMode((m) => (m === 'absolute' ? 'relative' : 'absolute'))}
              title={
                dateMode === 'absolute' ? 'Switch to relative time' : 'Switch to absolute date'
              }
              style={{
                all: 'unset',
                cursor: 'pointer',
                color: 'inherit',
                font: 'inherit',
                letterSpacing: 'inherit',
                textTransform: 'inherit',
              }}
            >
              Date{dateMode === 'relative' ? ' ▾' : ''}
            </button>
            <span>Author</span>
            <span>Commit</span>
          </div>

          {error !== null ? (
            <div style={{ padding: space[4], color: color.danger }}>{error}</div>
          ) : commits.length === 0 ? (
            <div style={{ padding: space[4], color: color.textTertiary }}>
              {loading ? 'Loading commit history…' : 'No commits yet.'}
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              {/* The DAG, drawn once over the graph column. */}
              <svg
                width={graphW}
                height={(rows.length + vOff) * FULL_GRAPH_ROW_HEIGHT}
                style={{ position: 'absolute', top: 0, left: space[2], pointerEvents: 'none' }}
                aria-hidden
              >
                <title>commit graph</title>
                {paths.map((p) => (
                  <path key={p.d} d={p.d} fill="none" stroke={p.c} strokeWidth={2} />
                ))}
                {hasUncommitted &&
                  (() => {
                    const headRow = rows.findIndex((r) => r.commit.head);
                    const lane = headRow !== -1 ? (rows[headRow]?.lane ?? 0) : 0;
                    return (
                      <circle
                        cx={fullGraphLaneX(lane)}
                        cy={FULL_GRAPH_ROW_HEIGHT / 2}
                        r={4}
                        fill={color.bg}
                        stroke="#808080"
                        strokeWidth={2}
                        strokeDasharray="2 1.5"
                      />
                    );
                  })()}
                {rows.map((row, i) => {
                  const cy = (i + vOff) * FULL_GRAPH_ROW_HEIGHT + FULL_GRAPH_ROW_HEIGHT / 2;
                  const cx = fullGraphLaneX(row.lane);
                  const c = fullGraphLaneColor(row.lane);
                  // A stash node is drawn as a diamond in a neutral stash hue, so it
                  // reads differently from a real commit (Git Graph does the same).
                  if (stashByHash.has(row.commit.hash)) {
                    const s = 4;
                    return (
                      <rect
                        key={row.commit.hash}
                        x={cx - s}
                        y={cy - s}
                        width={s * 2}
                        height={s * 2}
                        transform={`rotate(45 ${cx} ${cy})`}
                        fill={color.bg}
                        stroke={color.warning}
                        strokeWidth={2}
                      />
                    );
                  }
                  return (
                    <circle
                      key={row.commit.hash}
                      cx={cx}
                      cy={cy}
                      r={4}
                      fill={row.commit.head ? color.bg : c}
                      stroke={c}
                      strokeWidth={row.commit.head ? 2 : 0}
                    />
                  );
                })}
              </svg>

              {hasUncommitted && (
                <button
                  type="button"
                  onClick={() => {
                    useLayoutStore.getState().setSidebarView('scm');
                    useLayoutStore.getState().setSidebarOpen(true);
                    onClose();
                  }}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: gridCols,
                    alignItems: 'center',
                    width: '100%',
                    height: FULL_GRAPH_ROW_HEIGHT,
                    padding: `0 ${space[2]}px`,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: font.sans,
                    fontSize: font.size.caption,
                  }}
                >
                  <span />
                  <span style={{ color: color.warning, fontStyle: 'italic' }}>
                    ● Uncommitted Changes ({uncommitted})
                  </span>
                  <span />
                  <span />
                  <span
                    style={{
                      color: color.textGhost,
                      fontFamily: font.mono,
                      fontSize: font.size.micro,
                    }}
                  >
                    *
                  </span>
                </button>
              )}
              {rows.map((row) => {
                const stashRef = stashByHash.get(row.commit.hash)?.ref;
                return (
                  <FullGraphCommitRow
                    key={row.commit.hash}
                    commit={row.commit}
                    gridCols={gridCols}
                    localBranches={localBranches}
                    dateMode={dateMode}
                    stashRef={stashRef}
                    selected={selected === row.commit.hash}
                    highlighted={matches(row.commit)}
                    onSelect={() => setSelected(row.commit.hash)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openContextMenu(
                        e.clientX,
                        e.clientY,
                        stashRef !== undefined
                          ? fullGraphStashMenu(stashRef, actionDeps)
                          : fullGraphCommitMenu(row.commit, actionDeps),
                      );
                    }}
                    onRefMenu={(e, name, kind) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openContextMenu(
                        e.clientX,
                        e.clientY,
                        fullGraphRefMenu(name, kind, actionDeps),
                      );
                    }}
                  />
                );
              })}
            </div>
          )}

          {!done && commits.length > 0 && (
            <button
              type="button"
              disabled={loading}
              onClick={() => void loadPage(commits.length)}
              style={{
                width: '100%',
                padding: space[2],
                background: 'none',
                border: 'none',
                borderTop: `1px solid ${color.divider}`,
                color: color.textTertiary,
                fontFamily: font.sans,
                fontSize: font.size.caption,
                cursor: loading ? 'default' : 'pointer',
              }}
            >
              {loading ? 'Loading…' : 'Load More'}
            </button>
          )}
        </div>

        {selected !== null && (
          <FullGraphCommitDetails
            commit={commits.find((c) => c.hash === selected) ?? null}
            gitService={git}
            onClose={() => setSelected(null)}
            onOpenFile={(path, parent) =>
              openCommitDiff(path, selected, parent, `${selected.slice(0, 7)} ↔ parent`)
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
