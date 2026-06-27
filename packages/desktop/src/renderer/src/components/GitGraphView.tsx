import type {
  GitBranchesResult,
  GitCommit,
  GitCommitFilesResult,
  GitLogResult,
  GitStashListResult,
  GitStatusResult,
} from '@basehalf/core';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';
import { color, font, radius, space, transition } from '../design.js';
import { layoutGraph } from '../lib/gitGraph.js';
import { type ContextMenuItem, openContextMenu } from '../store/contextMenu.js';
import { useGitStatusStore } from '../store/gitStatus.js';
import { useLayoutStore } from '../store/layout.js';
import { toast } from '../store/toast.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { confirm, prompt } from './Dialog.js';
import { RebasePlanner } from './RebasePlanner.js';
import { Menu } from './primitives/Menu.js';

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

const ROW = 24; // row height
const GX = 14; // lane column spacing
const OFF_X = 12; // left offset of the first lane
const PAGE = 200;

// Git Graph's default branch palette (vivid, cycled by lane).
const PALETTE = [
  '#0085d9',
  '#d9008c',
  '#00d90a',
  '#d98500',
  '#a300d9',
  '#00d9cc',
  '#e138e8',
  '#85d900',
  '#dc5b23',
  '#6f24d6',
];
const laneColor = (lane: number): string =>
  PALETTE[((lane % PALETTE.length) + PALETTE.length) % PALETTE.length] ?? PALETTE[0] ?? '#888';
const laneX = (lane: number): number => OFF_X + lane * GX;

/** One curve/line segment path. Vertical → straight; column change → bezier. */
function segPath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const d = (y2 - y1) * 0.8;
  return `M ${x1} ${y1} C ${x1} ${y1 + d} ${x2} ${y2 - d} ${x2} ${y2}`;
}

export const GitGraphView = ({ onClose }: { onClose: () => void }): JSX.Element => {
  const openCommitDiff = useWorkspaceStore((s) => s.openCommitDiff);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Controls: a branch filter (null = all branches), a remote-branch toggle, and
  // a find query — the Git Graph extension's top toolbar.
  const [branchFilter, setBranchFilter] = useState<string | null>(null);
  const [showRemote, setShowRemote] = useState(false);
  const [find, setFind] = useState('');
  const [branches, setBranches] = useState<GitBranchesResult['branches']>([]);
  const [uncommitted, setUncommitted] = useState(0);
  // The interactive-rebase planner, opened (base = a commit) from the commit menu.
  const [rebaseBase, setRebaseBase] = useState<string | null>(null);
  const [stashes, setStashes] = useState<GitStashListResult['entries']>([]);
  // Date column format — Git Graph's "Date Format" setting (absolute ↔ relative).
  const [dateMode, setDateMode] = useState<'absolute' | 'relative'>('absolute');

  const loadPage = useCallback(
    async (skip: number): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        // All branches by default; a filter scopes to one ref's history.
        const logArgs =
          branchFilter !== null
            ? { ref: branchFilter, maxCount: PAGE, skip }
            : { all: true, maxCount: PAGE, skip };
        const r = (await window.bh.run('git.log', logArgs)) as GitLogResult;
        setCommits((prev) => (skip === 0 ? [...r.commits] : [...prev, ...r.commits]));
        if (r.commits.length < PAGE) setDone(true);
        else setDone(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [branchFilter],
  );

  useEffect(() => {
    void loadPage(0);
  }, [loadPage]);

  // Side data the graph overlays onto the commits: branch list (filter dropdown),
  // uncommitted-changes count, and the stash list (drawn as nodes). Refreshed on
  // mount and after every graph mutation (see runGit) so stash nodes stay current.
  const loadAux = useCallback(async (): Promise<void> => {
    try {
      const b = (await window.bh.run('git.branches', {
        includeRemote: showRemote,
      })) as GitBranchesResult;
      setBranches(b.branches);
    } catch {
      /* ignore */
    }
    try {
      const s = (await window.bh.run('git.status', {})) as GitStatusResult;
      setUncommitted(s.isRepo ? s.files.length : 0);
    } catch {
      /* ignore */
    }
    try {
      const st = (await window.bh.run('git.stashList', {})) as GitStashListResult;
      setStashes(st.entries);
    } catch {
      /* ignore */
    }
  }, [showRemote]);

  useEffect(() => {
    void loadAux();
  }, [loadAux]);

  // Run a graph mutation, then reload the graph (HEAD/refs moved) + side data + SCM.
  const runGit = useCallback(
    (fn: () => Promise<unknown>): void => {
      void (async () => {
        try {
          await fn();
          await loadPage(0);
          await loadAux();
          await useGitStatusStore.getState().refresh();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      })();
    },
    [loadPage, loadAux],
  );

  // The Git Graph commit context menu (right-click a row).
  const commitMenu = useCallback(
    (c: GitCommit): ContextMenuItem[] => {
      const sha = c.hash;
      const short = c.shortHash;
      return [
        {
          id: 'checkout',
          label: 'Checkout Commit…',
          run: () =>
            void confirm({
              title: `Checkout ${short}?`,
              body: 'This enters a detached HEAD state.',
              confirmText: 'Checkout',
            }).then((ok) => {
              if (ok) runGit(() => window.bh.run('git.checkout', { branch: sha }));
            }),
        },
        {
          id: 'branch',
          label: 'Create Branch from Commit…',
          run: () =>
            void prompt({
              title: `Create branch from ${short}`,
              label: 'Branch name',
              placeholder: 'feature/x',
            }).then((n) => {
              const name = n?.trim();
              if (name) runGit(() => window.bh.run('git.createBranch', { name, ref: sha }));
            }),
        },
        {
          id: 'tag',
          label: 'Create Tag at Commit…',
          run: () =>
            void prompt({
              title: `Create tag at ${short}`,
              label: 'Tag name',
              placeholder: 'v1.0',
            }).then((n) => {
              const name = n?.trim();
              if (name) runGit(() => window.bh.run('git.tag', { name, ref: sha }));
            }),
        },
        { separator: true },
        {
          id: 'cherrypick',
          label: 'Cherry-Pick onto Current Branch',
          run: () =>
            runGit(async () => {
              const r = (await window.bh.run('git.cherryPick', { ref: sha })) as {
                conflicts: boolean;
              };
              if (r.conflicts)
                toast.error('The cherry-pick hit conflicts — resolve them in Merge Changes.');
            }),
        },
        {
          id: 'revert',
          label: 'Revert Commit',
          run: () =>
            runGit(async () => {
              const r = (await window.bh.run('git.revert', { ref: sha })) as { conflicts: boolean };
              if (r.conflicts)
                toast.error('The revert hit conflicts — resolve them in Merge Changes.');
            }),
        },
        {
          id: 'merge',
          label: 'Merge into Current Branch',
          run: () =>
            runGit(async () => {
              const r = (await window.bh.run('git.merge', { branch: sha })) as {
                conflicts: boolean;
              };
              if (r.conflicts)
                toast.error('The merge hit conflicts — resolve them in Merge Changes.');
            }),
        },
        { separator: true },
        {
          id: 'reset-mixed',
          label: 'Reset Current Branch to Here (Keep Changes)',
          run: () => runGit(() => window.bh.run('git.reset', { ref: sha, mode: 'mixed' })),
        },
        {
          id: 'reset-hard',
          label: 'Reset Current Branch to Here (Discard Changes)',
          danger: true,
          run: () =>
            void confirm({
              title: `Hard-reset to ${short}?`,
              body: 'All changes after this commit on the current branch are permanently discarded. This is IRREVERSIBLE.',
              confirmText: 'Hard Reset',
              destructive: true,
            }).then((ok) => {
              if (ok) runGit(() => window.bh.run('git.reset', { ref: sha, mode: 'hard' }));
            }),
        },
        { separator: true },
        {
          id: 'rebase',
          label: 'Rebase Commits After This…',
          run: () => setRebaseBase(sha),
        },
        { separator: true },
        {
          id: 'copy-sha',
          label: 'Copy Commit Hash',
          run: () =>
            void navigator.clipboard.writeText(sha).then(() => toast.success(`Copied ${short}`)),
        },
        {
          id: 'copy-subject',
          label: 'Copy Commit Message',
          run: () =>
            void navigator.clipboard.writeText(c.subject).then(() => toast.success('Copied')),
        },
      ];
    },
    [runGit],
  );

  // Right-click a ref pill → branch/tag actions (Git Graph's ref context menu).
  const refMenu = useCallback(
    (name: string, kind: 'branch' | 'remote' | 'tag'): ContextMenuItem[] => {
      if (kind === 'tag') {
        return [
          {
            id: 'checkout',
            label: `Checkout tag ${name}`,
            run: () => runGit(() => window.bh.run('git.checkout', { branch: name })),
          },
          {
            id: 'delete',
            label: 'Delete Tag',
            danger: true,
            run: () =>
              void confirm({
                title: `Delete tag ${name}?`,
                confirmText: 'Delete',
                destructive: true,
              }).then((ok) => {
                if (ok) runGit(() => window.bh.run('git.tagDelete', { name }));
              }),
          },
        ];
      }
      // A remote-tracking ref → checkout its short name (DWIM tracking branch).
      const checkoutTarget = kind === 'remote' ? name.slice(name.indexOf('/') + 1) : name;
      const items: ContextMenuItem[] = [
        {
          id: 'checkout',
          label: `Checkout ${checkoutTarget}`,
          run: () => runGit(() => window.bh.run('git.checkout', { branch: checkoutTarget })),
        },
        {
          id: 'merge',
          label: 'Merge into Current Branch',
          run: () =>
            runGit(async () => {
              const r = (await window.bh.run('git.merge', { branch: name })) as {
                conflicts: boolean;
              };
              if (r.conflicts)
                toast.error('The merge hit conflicts — resolve them in Merge Changes.');
            }),
        },
      ];
      if (kind === 'branch') {
        items.push(
          {
            id: 'rename',
            label: 'Rename Branch…',
            run: () =>
              void prompt({ title: `Rename ${name}`, label: 'New name', defaultValue: name }).then(
                (n) => {
                  const to = n?.trim();
                  if (to && to !== name)
                    runGit(() => window.bh.run('git.renameBranch', { from: name, to }));
                },
              ),
          },
          { separator: true },
          {
            id: 'delete',
            label: 'Delete Branch',
            danger: true,
            run: () =>
              void confirm({
                title: `Delete branch ${name}?`,
                confirmText: 'Delete',
                destructive: true,
              }).then((ok) => {
                if (!ok) return;
                runGit(async () => {
                  try {
                    await window.bh.run('git.deleteBranch', { name });
                  } catch {
                    if (
                      await confirm({
                        title: `Branch ${name} is not fully merged. Force delete?`,
                        confirmText: 'Force Delete',
                        destructive: true,
                      })
                    )
                      await window.bh.run('git.deleteBranch', { name, force: true });
                  }
                });
              }),
          },
        );
      }
      return items;
    },
    [runGit],
  );

  // Local-branch names — used to tell a local branch ref (rename/delete-able, even
  // when it contains a "/" like feature/x) from a remote-tracking ref. A plain
  // `name.includes('/')` test is wrong: local branches can carry slashes.
  const localBranches = useMemo(
    () => new Set(branches.filter((b) => !b.remote).map((b) => b.name)),
    [branches],
  );

  // Stash nodes — Git Graph draws each stash as a node hanging off its base commit.
  // Inject a synthetic commit (parent = the stash's base) right before that base in
  // the list, so the lane layout connects it and topo order stays valid. Keep a
  // hash→ref map so the row can show a stash pill + a stash-specific menu.
  const { graphCommits, stashByHash } = useMemo(() => {
    const byHash = new Map<string, (typeof stashes)[number]>();
    const stashCommitsByBase = new Map<string, GitCommit[]>();
    for (const s of stashes) {
      if (s.hash === '') continue;
      byHash.set(s.hash, s);
      const base = s.parents[0] ?? '';
      const synthetic: GitCommit = {
        hash: s.hash,
        shortHash: s.hash.slice(0, 7),
        parents: base === '' ? [] : [base],
        author: { name: s.authorName, email: s.authorEmail, date: s.date },
        committer: { name: s.authorName, email: s.authorEmail, date: s.date },
        subject: s.message,
        body: '',
        refs: [],
        tags: [],
        head: false,
      };
      const list = stashCommitsByBase.get(base);
      if (list) list.push(synthetic);
      else stashCommitsByBase.set(base, [synthetic]);
    }
    if (byHash.size === 0) return { graphCommits: commits, stashByHash: byHash };
    const merged: GitCommit[] = [];
    const placed = new Set<string>();
    for (const c of commits) {
      const attached = stashCommitsByBase.get(c.hash);
      if (attached) {
        merged.push(...attached);
        placed.add(c.hash);
      }
      merged.push(c);
    }
    // Stashes whose base isn't in the loaded page → surface them at the top so they
    // aren't silently dropped (they'll have a dangling base edge, as Git Graph's do).
    for (const [base, list] of stashCommitsByBase) {
      if (!placed.has(base)) merged.unshift(...list);
    }
    return { graphCommits: merged, stashByHash: byHash };
  }, [commits, stashes]);

  const stashMenu = useCallback(
    (ref: string): ContextMenuItem[] => [
      {
        id: 'apply',
        label: 'Apply Stash',
        // Apply/pop can conflict; that surfaces in the refreshed SCM status, not here.
        run: () => runGit(() => window.bh.run('git.stashApply', { ref })),
      },
      {
        id: 'pop',
        label: 'Pop Stash',
        run: () => runGit(() => window.bh.run('git.stashPop', { ref })),
      },
      { separator: true },
      {
        id: 'drop',
        label: 'Drop Stash',
        danger: true,
        run: () =>
          void confirm({ title: `Delete ${ref}?`, confirmText: 'Delete', destructive: true }).then(
            (ok) => {
              if (ok) runGit(() => window.bh.run('git.stashDrop', { ref }));
            },
          ),
      },
    ],
    [runGit],
  );

  const { rows, width } = useMemo(() => layoutGraph(graphCommits), [graphCommits]);
  const graphW = OFF_X * 2 + Math.max(1, width) * GX;
  const gridCols = `${graphW}px minmax(120px, 1fr) 150px 130px 70px`;
  // A leading "Uncommitted Changes" row (Git Graph's signature) shifts the commit
  // rows down one when the working tree is dirty.
  const hasUncommitted = uncommitted > 0 && branchFilter === null;
  const vOff = hasUncommitted ? 1 : 0;
  const findLower = find.trim().toLowerCase();
  const matches = (c: GitCommit): boolean =>
    findLower !== '' &&
    (c.subject.toLowerCase().includes(findLower) || c.shortHash.toLowerCase().includes(findLower));

  // The whole DAG as one SVG over the graph column.
  const paths = useMemo(() => {
    const out: Array<{ d: string; c: string }> = [];
    rows.forEach((row, i) => {
      const cy = (i + vOff) * ROW + ROW / 2;
      const node = row.lane;
      row.lanesBefore.forEach((h, k) => {
        if (h == null) return;
        const toLane = h === row.commit.hash ? node : k;
        out.push({ d: segPath(laneX(k), cy - ROW / 2, laneX(toLane), cy), c: laneColor(toLane) });
      });
      row.lanesAfter.forEach((h, k) => {
        if (h != null && row.lanesBefore[k] === h && k !== node) {
          out.push({ d: segPath(laneX(k), cy, laneX(k), cy + ROW / 2), c: laneColor(k) });
        }
      });
      for (const k of row.outgoing) {
        out.push({ d: segPath(laneX(node), cy, laneX(k), cy + ROW / 2), c: laneColor(k) });
      }
    });
    // Connector from the uncommitted node (top) down to the HEAD commit.
    if (hasUncommitted) {
      const headRow = rows.findIndex((r) => r.commit.head);
      if (headRow !== -1) {
        const lane = rows[headRow]?.lane ?? 0;
        out.push({
          d: segPath(laneX(lane), ROW / 2, laneX(lane), (headRow + vOff) * ROW + ROW / 2),
          c: '#808080',
        });
      }
    }
    return out;
  }, [rows, vOff, hasUncommitted]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Header
        onClose={onClose}
        count={commits.length}
        loading={loading}
        branches={branches}
        branchFilter={branchFilter}
        onBranchFilter={setBranchFilter}
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
              height: ROW,
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
                height={(rows.length + vOff) * ROW}
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
                        cx={laneX(lane)}
                        cy={ROW / 2}
                        r={4}
                        fill={color.bg}
                        stroke="#808080"
                        strokeWidth={2}
                        strokeDasharray="2 1.5"
                      />
                    );
                  })()}
                {rows.map((row, i) => {
                  const cy = (i + vOff) * ROW + ROW / 2;
                  const cx = laneX(row.lane);
                  const c = laneColor(row.lane);
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
                    height: ROW,
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
                    ● Uncommitted Changes ({uncommitted}）
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
                  <CommitRow
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
                        stashRef !== undefined ? stashMenu(stashRef) : commitMenu(row.commit),
                      );
                    }}
                    onRefMenu={(e, name, kind) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openContextMenu(e.clientX, e.clientY, refMenu(name, kind));
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
          <CommitDetails
            commit={commits.find((c) => c.hash === selected) ?? null}
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
          onClose={() => setRebaseBase(null)}
          onApplied={() => {
            void loadPage(0);
            void useGitStatusStore.getState().refresh();
          }}
        />
      )}
    </div>
  );
};

const Header = ({
  onClose,
  count,
  loading,
  branches,
  branchFilter,
  onBranchFilter,
  showRemote,
  onToggleRemote,
  find,
  onFind,
  matchCount,
}: {
  onClose: () => void;
  count: number;
  loading: boolean;
  branches: GitBranchesResult['branches'];
  branchFilter: string | null;
  onBranchFilter: (b: string | null) => void;
  showRemote: boolean;
  onToggleRemote: () => void;
  find: string;
  onFind: (s: string) => void;
  matchCount: number | null;
}): JSX.Element => (
  <div
    style={{
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: space[2],
      height: 36,
      padding: `0 ${space[3]}px`,
      background: color.surfaceMuted,
      borderBottom: `1px solid ${color.border}`,
      fontFamily: font.sans,
    }}
  >
    <span style={{ fontWeight: font.weight.semibold, color: color.textPrimary }}>Git Graph</span>
    <span style={{ color: color.textTertiary, fontSize: font.size.micro }}>
      {loading ? 'Loading…' : `${count} commits`}
    </span>

    {/* Branch filter (Git Graph's "branches" dropdown). */}
    <Menu
      align="left"
      label={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: space[1] }}>
          ⎇ {branchFilter ?? 'All Branches'} ▾
        </span>
      }
      actions={[
        { label: 'All Branches', onClick: () => onBranchFilter(null) },
        ...branches.map((b) => ({
          label: b.name,
          onClick: () => onBranchFilter(b.name),
        })),
      ]}
    />
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: space[1],
        color: color.textTertiary,
        fontSize: font.size.micro,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <input type="checkbox" checked={showRemote} onChange={onToggleRemote} />
      Remote branches
    </label>

    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: space[1] }}>
      <input
        value={find}
        onChange={(e) => onFind(e.target.value)}
        placeholder="Find commit…"
        aria-label="Find Commit"
        data-testid="graph-find"
        style={{
          width: 150,
          height: 24,
          boxSizing: 'border-box',
          background: color.bg,
          border: `1px solid ${color.border}`,
          borderRadius: radius.sm,
          color: color.textPrimary,
          fontFamily: font.sans,
          fontSize: font.size.micro,
          padding: `0 ${space[2]}px`,
          outline: 'none',
        }}
      />
      {matchCount !== null && (
        <span style={{ color: color.textTertiary, fontSize: font.size.micro, minWidth: 36 }}>
          {matchCount} matches
        </span>
      )}
      <button
        type="button"
        title="Close (Esc)"
        aria-label="Close Git Graph"
        onClick={onClose}
        style={{
          width: 24,
          height: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'none',
          border: 'none',
          borderRadius: radius.sm,
          cursor: 'pointer',
          color: color.textTertiary,
          fontSize: font.size.body,
        }}
      >
        ✕
      </button>
    </span>
  </div>
);

const CommitRow = ({
  commit,
  gridCols,
  localBranches,
  dateMode,
  stashRef,
  selected,
  highlighted,
  onSelect,
  onContextMenu,
  onRefMenu,
}: {
  commit: GitCommit;
  gridCols: string;
  localBranches: ReadonlySet<string>;
  dateMode: 'absolute' | 'relative';
  stashRef: string | undefined;
  selected: boolean;
  highlighted: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRefMenu: (e: React.MouseEvent, name: string, kind: 'branch' | 'remote' | 'tag') => void;
}): JSX.Element => {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role="button"
      tabIndex={0}
      style={{
        display: 'grid',
        gridTemplateColumns: gridCols,
        alignItems: 'center',
        height: ROW,
        padding: `0 ${space[2]}px`,
        background: selected
          ? color.accentSofter
          : highlighted
            ? `${color.warning}26`
            : hover
              ? color.divider
              : 'transparent',
        cursor: 'pointer',
        fontFamily: font.sans,
        fontSize: font.size.caption,
      }}
    >
      {/* Graph column — empty; the SVG draws over it. */}
      <span />
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[1],
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {commit.head && <Pill text="HEAD" kind="head" />}
        {stashRef !== undefined && <Pill text={stashRef} kind="stash" />}
        {commit.refs.map((r) => {
          const kind = localBranches.has(r) ? 'branch' : 'remote';
          return <Pill key={r} text={r} kind={kind} onContextMenu={(e) => onRefMenu(e, r, kind)} />;
        })}
        {commit.tags.map((t) => (
          <Pill
            key={`tag:${t}`}
            text={t}
            kind="tag"
            onContextMenu={(e) => onRefMenu(e, t, 'tag')}
          />
        ))}
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: color.textPrimary,
          }}
        >
          {commit.subject}
        </span>
      </span>
      <span
        style={{ color: color.textTertiary, fontSize: font.size.micro }}
        title={dateMode === 'relative' ? fmtDate(commit.author.date) : undefined}
      >
        {fmtWhen(commit.author.date, dateMode)}
      </span>
      <span
        style={{
          color: color.textSecondary,
          fontSize: font.size.micro,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {commit.author.name}
      </span>
      <span style={{ color: color.textTertiary, fontFamily: font.mono, fontSize: font.size.micro }}>
        {commit.shortHash}
      </span>
    </div>
  );
};

const CommitDetails = ({
  commit,
  onClose,
  onOpenFile,
}: {
  commit: GitCommit | null;
  onClose: () => void;
  onOpenFile: (path: string, parent: string | undefined) => void;
}): JSX.Element | null => {
  const [files, setFiles] = useState<GitCommitFilesResult['files'] | null>(null);
  useEffect(() => {
    if (commit === null) return;
    let cancelled = false;
    setFiles(null);
    void (async () => {
      try {
        const r = (await window.bh.run('git.commitFiles', {
          ref: commit.hash,
        })) as GitCommitFilesResult;
        if (!cancelled) setFiles(r.files);
      } catch {
        if (!cancelled) setFiles([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commit]);
  if (commit === null) return null;
  const parent = commit.parents[0];
  return (
    <div
      style={{
        flexShrink: 0,
        height: '38%',
        minHeight: 120,
        borderTop: `1px solid ${color.border}`,
        background: color.surface,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: font.sans,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
          padding: `${space[2]}px ${space[3]}px`,
          borderBottom: `1px solid ${color.divider}`,
        }}
      >
        <span style={{ fontFamily: font.mono, color: color.accent, fontSize: font.size.caption }}>
          {commit.shortHash}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: color.textPrimary,
            fontWeight: font.weight.medium,
            fontSize: font.size.caption,
          }}
        >
          {commit.subject}
        </span>
        <span style={{ color: color.textTertiary, fontSize: font.size.micro }}>
          {commit.author.name} · {fmtDate(commit.author.date)}
        </span>
        <button
          type="button"
          aria-label="Close Details"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: color.textTertiary,
            cursor: 'pointer',
            fontSize: font.size.body,
          }}
        >
          ✕
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: `${space[1]}px 0` }}>
        {commit.body.trim() !== '' && (
          <div
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: color.textSecondary,
              fontSize: font.size.micro,
              padding: `${space[1]}px ${space[3]}px ${space[2]}px`,
            }}
          >
            {commit.body.trim()}
          </div>
        )}
        {files === null ? (
          <div
            style={{
              padding: `0 ${space[3]}px`,
              color: color.textTertiary,
              fontSize: font.size.micro,
            }}
          >
            Loading changes…
          </div>
        ) : (
          files.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => onOpenFile(f.path, parent)}
              title={f.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: space[2],
                width: '100%',
                padding: `2px ${space[3]}px`,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                color: color.textSecondary,
                fontFamily: font.sans,
                fontSize: font.size.micro,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = color.divider;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'none';
              }}
            >
              <span
                style={{
                  width: 12,
                  flexShrink: 0,
                  textAlign: 'center',
                  fontFamily: font.mono,
                  fontWeight: font.weight.semibold,
                  color: statusTone(f.status),
                }}
              >
                {f.status}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.path}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
};

const Pill = ({
  text,
  kind,
  onContextMenu,
}: {
  text: string;
  kind: 'head' | 'branch' | 'remote' | 'tag' | 'stash';
  onContextMenu?: (e: React.MouseEvent) => void;
}): JSX.Element => {
  const label = kind === 'tag' ? text.replace(/^tag:\s*/, '') : text;
  const bg =
    kind === 'head'
      ? color.accent
      : kind === 'tag'
        ? `${color.warning}33`
        : kind === 'stash'
          ? color.surfaceMuted
          : kind === 'remote'
            ? color.surface
            : color.accentSofter;
  const fg =
    kind === 'head'
      ? color.onAccent
      : kind === 'tag'
        ? color.warning
        : kind === 'stash'
          ? color.textSecondary
          : kind === 'remote'
            ? color.textTertiary
            : color.accent;
  return (
    <span
      onContextMenu={onContextMenu}
      style={{
        flexShrink: 0,
        padding: `0 ${space[1]}px`,
        background: bg,
        color: fg,
        border: kind === 'remote' || kind === 'stash' ? `1px solid ${color.border}` : 'none',
        borderRadius: radius.sm,
        fontFamily: font.mono,
        fontSize: font.size.micro,
        lineHeight: '16px',
        maxWidth: 160,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        cursor: onContextMenu && kind !== 'head' ? 'context-menu' : undefined,
      }}
    >
      {kind === 'tag' ? `🏷 ${label}` : kind === 'stash' ? `📦 ${label}` : label}
    </span>
  );
};

const statusTone = (status: string): string =>
  status === 'A'
    ? color.success
    : status === 'D'
      ? color.danger
      : status === 'R' || status === 'C'
        ? color.accent
        : color.warning;

/** Compact absolute date — Git Graph shows e.g. "15 Jan 2024 14:30". */
function fmtDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    d.getMonth()
  ];
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getDate())} ${mon} ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Relative time ("3 hours ago") — Git Graph's "Relative" date format option.
function fmtRelative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
  const units: [number, string][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.34524, 'week'],
    [12, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ];
  let n = secs;
  let unit = 'second';
  for (const [span, name] of units) {
    if (n < span) {
      unit = name;
      break;
    }
    n = Math.floor(n / span);
    unit = name;
  }
  if (unit === 'second' && n < 10) return 'just now';
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

function fmtWhen(iso: string, mode: 'absolute' | 'relative'): string {
  return mode === 'relative' ? fmtRelative(iso) : fmtDate(iso);
}
