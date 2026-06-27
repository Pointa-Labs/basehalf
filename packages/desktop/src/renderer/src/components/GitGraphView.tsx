import type { GitCommit, GitCommitFilesResult, GitLogResult } from '@basehalf/core';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';
import { color, font, radius, space, transition } from '../design.js';
import { layoutGraph } from '../lib/gitGraph.js';
import { useWorkspaceStore } from '../store/workspace.js';

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

  const loadPage = useCallback(async (skip: number): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const r = (await window.bh.run('git.log', {
        all: true,
        maxCount: PAGE,
        skip,
      })) as GitLogResult;
      setCommits((prev) => (skip === 0 ? [...r.commits] : [...prev, ...r.commits]));
      if (r.commits.length < PAGE) setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(0);
  }, [loadPage]);

  const { rows, width } = useMemo(() => layoutGraph(commits), [commits]);
  const graphW = OFF_X * 2 + Math.max(1, width) * GX;
  const gridCols = `${graphW}px minmax(120px, 1fr) 150px 130px 70px`;

  // The whole DAG as one SVG over the graph column.
  const paths = useMemo(() => {
    const out: Array<{ d: string; c: string }> = [];
    rows.forEach((row, i) => {
      const cy = i * ROW + ROW / 2;
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
    return out;
  }, [rows]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Header onClose={onClose} count={commits.length} loading={loading} />
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
            <span>Date</span>
            <span>Author</span>
            <span>Commit</span>
          </div>

          {error !== null ? (
            <div style={{ padding: space[4], color: color.danger }}>{error}</div>
          ) : commits.length === 0 ? (
            <div style={{ padding: space[4], color: color.textTertiary }}>
              {loading ? '载入提交历史…' : '暂无提交。'}
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              {/* The DAG, drawn once over the graph column. */}
              <svg
                width={graphW}
                height={rows.length * ROW}
                style={{ position: 'absolute', top: 0, left: space[2], pointerEvents: 'none' }}
                aria-hidden
              >
                <title>commit graph</title>
                {paths.map((p) => (
                  <path key={p.d} d={p.d} fill="none" stroke={p.c} strokeWidth={2} />
                ))}
                {rows.map((row, i) => {
                  const cy = i * ROW + ROW / 2;
                  const cx = laneX(row.lane);
                  const c = laneColor(row.lane);
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

              {rows.map((row) => (
                <CommitRow
                  key={row.commit.hash}
                  commit={row.commit}
                  gridCols={gridCols}
                  selected={selected === row.commit.hash}
                  onSelect={() => setSelected(row.commit.hash)}
                />
              ))}
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
              {loading ? '载入中…' : '载入更多'}
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
    </div>
  );
};

const Header = ({
  onClose,
  count,
  loading,
}: {
  onClose: () => void;
  count: number;
  loading: boolean;
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
      {loading ? '载入中…' : `${count} 个提交`}
    </span>
    <button
      type="button"
      title="关闭（Esc）"
      aria-label="关闭 Git Graph"
      onClick={onClose}
      style={{
        marginLeft: 'auto',
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
  </div>
);

const CommitRow = ({
  commit,
  gridCols,
  selected,
  onSelect,
}: {
  commit: GitCommit;
  gridCols: string;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element => {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onSelect}
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
        background: selected ? color.accentSofter : hover ? color.divider : 'transparent',
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
        {commit.refs.map((r) => (
          <Pill
            key={r}
            text={r}
            kind={r.startsWith('tag:') ? 'tag' : r.includes('/') ? 'remote' : 'branch'}
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
      <span style={{ color: color.textTertiary, fontSize: font.size.micro }}>
        {fmtDate(commit.author.date)}
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
          aria-label="关闭详情"
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
            载入改动…
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
}: { text: string; kind: 'head' | 'branch' | 'remote' | 'tag' }): JSX.Element => {
  const label = kind === 'tag' ? text.replace(/^tag:\s*/, '') : text;
  const bg =
    kind === 'head'
      ? color.accent
      : kind === 'tag'
        ? `${color.warning}33`
        : kind === 'remote'
          ? color.surface
          : color.accentSofter;
  const fg =
    kind === 'head'
      ? color.onAccent
      : kind === 'tag'
        ? color.warning
        : kind === 'remote'
          ? color.textTertiary
          : color.accent;
  return (
    <span
      style={{
        flexShrink: 0,
        padding: `0 ${space[1]}px`,
        background: bg,
        color: fg,
        border: kind === 'remote' ? `1px solid ${color.border}` : 'none',
        borderRadius: radius.sm,
        fontFamily: font.mono,
        fontSize: font.size.micro,
        lineHeight: '16px',
        maxWidth: 160,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {kind === 'tag' ? `🏷 ${label}` : label}
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
