import type { GitCommit, GitCommitFilesResult, GitLogResult } from '@basehalf/core';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { color, font, radius, space, transition } from '../design.js';
import { type GraphRow, laneColor, layoutGraph } from '../lib/gitGraph.js';
import { useScmViewStore } from '../store/scmView.js';
import { useWorkspaceStore } from '../store/workspace.js';

/**
 * GitGraph — the commit-graph (DAG) view inside the Source Control container,
 * modeled on `git log --graph` / VS Code's Source Control Graph. The left gutter
 * draws the branch/merge topology (lanes from the pure layoutGraph algorithm) and
 * each row shows the commit's refs, subject, author, and relative time. Clicking a
 * commit expands its changed-files list; clicking a file opens that commit's diff
 * (parent ↔ commit) in the shared diff overlay.
 *
 * History comes from `git.log({ all: true })` (paginated with skip/maxCount). Pure
 * lane bookkeeping lives in lib/gitGraph (unit-tested); this file is the painting.
 */

const PAGE = 80;
const ROW_H = 44;
const COL = 14; // lane column width in the gutter
const PAD = 10;
// Lane palette — distinct, calm hues for the branch lines (cycled by lane index).
const LANE_COLORS = ['#4c8dff', '#33b074', '#d98c3f', '#b066d9', '#d95f7f', '#3fb6c4', '#9aa45c'];

const laneX = (lane: number): number => PAD + lane * COL + COL / 2;
const colorFor = (lane: number): string =>
  LANE_COLORS[laneColor(lane, LANE_COLORS.length)] ?? LANE_COLORS[0] ?? '#888';

export const GitGraph = (): JSX.Element => {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const focusCommit = useScmViewStore((s) => s.focusCommit);
  const consumeFocus = useScmViewStore((s) => s.consumeFocus);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(0);
  }, [loadPage]);

  const { rows, width } = useMemo(() => layoutGraph(commits), [commits]);
  const gutterW = PAD * 2 + Math.max(1, width) * COL;

  // ⌘K "jump to commit": once the target commit is loaded, expand + scroll to it.
  useEffect(() => {
    if (focusCommit === null) return;
    if (!commits.some((c) => c.hash === focusCommit)) return; // not in a loaded page yet
    setSelected(focusCommit);
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-commit="${focusCommit}"]`);
    el?.scrollIntoView({ block: 'center' });
    consumeFocus();
  }, [focusCommit, commits, consumeFocus]);

  if (error !== null) {
    return <Hint color={color.danger}>{error}</Hint>;
  }
  if (commits.length === 0) {
    return <Hint color={color.textTertiary}>{loading ? '载入提交历史…' : '暂无提交。'}</Hint>;
  }

  return (
    <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      {rows.map((row) => (
        <CommitItem
          key={row.commit.hash}
          row={row}
          gutterW={gutterW}
          expanded={selected === row.commit.hash}
          onToggle={() => setSelected((s) => (s === row.commit.hash ? null : row.commit.hash))}
        />
      ))}
      {!done && (
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
  );
};

const CommitItem = ({
  row,
  gutterW,
  expanded,
  onToggle,
}: {
  row: GraphRow;
  gutterW: number;
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element => {
  const { commit } = row;
  const [hover, setHover] = useState(false);
  return (
    <div data-commit={commit.hash}>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: 'flex',
          alignItems: 'stretch',
          background: expanded ? color.surfaceMuted : hover ? color.divider : 'transparent',
          cursor: 'pointer',
        }}
      >
        <Gutter row={row} width={gutterW} />
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          title={commit.subject}
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 2,
            padding: `${space[1]}px ${space[2]}px ${space[1]}px 0`,
            background: 'none',
            border: 'none',
            textAlign: 'left',
            cursor: 'pointer',
            height: ROW_H,
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: space[1],
              overflow: 'hidden',
            }}
          >
            {commit.head && <RefPill text="HEAD" tone="head" />}
            {commit.refs.map((r) => (
              <RefPill key={r} text={r} tone={r.includes('/') ? 'remote' : 'branch'} />
            ))}
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: color.textPrimary,
                fontFamily: font.sans,
                fontSize: font.size.caption,
              }}
            >
              {commit.subject}
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              gap: space[2],
              color: color.textTertiary,
              fontFamily: font.sans,
              fontSize: font.size.micro,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ fontFamily: font.mono }}>{commit.shortHash}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {commit.author.name}
            </span>
            <span>{timeAgo(commit.author.date)}</span>
          </div>
        </button>
      </div>
      {expanded && <CommitDetail commit={commit} />}
    </div>
  );
};

const CommitDetail = ({ commit }: { commit: GitCommit }): JSX.Element => {
  const openCommitDiff = useWorkspaceStore((s) => s.openCommitDiff);
  const [files, setFiles] = useState<GitCommitFilesResult['files'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = (await window.bh.run('git.commitFiles', {
          ref: commit.hash,
        })) as GitCommitFilesResult;
        if (!cancelled) setFiles(r.files);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commit.hash]);

  const parent = commit.parents[0];
  return (
    <div
      style={{
        padding: `${space[1]}px ${space[3]}px ${space[2]}px ${PAD}px`,
        background: color.surfaceMuted,
        borderBottom: `1px solid ${color.divider}`,
      }}
    >
      {commit.body.trim() !== '' && (
        <div
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: color.textSecondary,
            fontFamily: font.sans,
            fontSize: font.size.micro,
            marginBottom: space[1],
            maxHeight: 120,
            overflow: 'auto',
          }}
        >
          {commit.body.trim()}
        </div>
      )}
      {error !== null ? (
        <div style={{ color: color.danger, fontSize: font.size.micro }}>{error}</div>
      ) : files === null ? (
        <div style={{ color: color.textTertiary, fontSize: font.size.micro }}>载入改动…</div>
      ) : files.length === 0 ? (
        <div style={{ color: color.textTertiary, fontSize: font.size.micro }}>无文件改动。</div>
      ) : (
        files.map((f) => (
          <button
            key={f.path}
            type="button"
            onClick={() =>
              openCommitDiff(f.path, commit.hash, parent, `${commit.shortHash} ↔ parent`)
            }
            title={f.path}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: space[2],
              width: '100%',
              padding: `2px ${space[1]}px`,
              background: 'none',
              border: 'none',
              borderRadius: radius.sm,
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
  );
};

// ── the DAG gutter for one row (SVG) ─────────────────────────────────────────
const Gutter = ({ row, width }: { row: GraphRow; width: number }): JSX.Element => {
  const mid = ROW_H / 2;
  const nodeLane = row.lane;
  const segs: Array<{ x1: number; y1: number; x2: number; y2: number; lane: number }> = [];

  // Top half: each top-edge lane descends to the node (if its edge ends here) or
  // continues straight down to its own mid-point.
  row.lanesBefore.forEach((h, k) => {
    if (h == null) return;
    const toLane = h === row.commit.hash ? nodeLane : k;
    segs.push({ x1: laneX(k), y1: 0, x2: laneX(toLane), y2: mid, lane: toLane });
  });
  // Bottom half: pass-through lanes continue straight; the node's outgoing edges
  // (to its parents) fan out from the node.
  row.lanesAfter.forEach((h, k) => {
    if (h == null) return;
    if (row.lanesBefore[k] === h && k !== nodeLane) {
      segs.push({ x1: laneX(k), y1: mid, x2: laneX(k), y2: ROW_H, lane: k });
    }
  });
  for (const k of row.outgoing) {
    segs.push({ x1: laneX(nodeLane), y1: mid, x2: laneX(k), y2: ROW_H, lane: k });
  }

  return (
    <svg width={width} height={ROW_H} style={{ flexShrink: 0, display: 'block' }} aria-hidden>
      <title>commit graph</title>
      {segs.map((s, i) => (
        <line
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional, no stable id.
          key={i}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke={colorFor(s.lane)}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      ))}
      <circle
        cx={laneX(nodeLane)}
        cy={mid}
        r={3.5}
        fill={colorFor(nodeLane)}
        stroke={color.bg}
        strokeWidth={1.5}
      />
    </svg>
  );
};

const RefPill = ({
  text,
  tone,
}: {
  text: string;
  tone: 'head' | 'branch' | 'remote';
}): JSX.Element => {
  const bg = tone === 'head' ? color.accent : color.surface;
  const fg =
    tone === 'head' ? color.onAccent : tone === 'remote' ? color.textTertiary : color.textSecondary;
  return (
    <span
      style={{
        flexShrink: 0,
        padding: `0 ${space[1]}px`,
        background: bg,
        color: fg,
        border: tone === 'head' ? 'none' : `1px solid ${color.border}`,
        borderRadius: radius.sm,
        fontFamily: font.mono,
        fontSize: font.size.micro,
        lineHeight: '15px',
        maxWidth: 120,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );
};

const Hint = ({ children, color: c }: { children: string; color: string }): JSX.Element => (
  <div style={{ padding: space[4], color: c, fontFamily: font.sans, fontSize: font.size.caption }}>
    {children}
  </div>
);

const statusTone = (status: string): string =>
  status === 'A'
    ? color.success
    : status === 'D'
      ? color.danger
      : status === 'R' || status === 'C'
        ? color.accent
        : color.warning;

/** Compact relative time (zh) from an ISO date — "3分钟前" / "2天前" / a date. */
function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return '刚刚';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}天前`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}个月前`;
  return `${Math.floor(mo / 12)}年前`;
}
