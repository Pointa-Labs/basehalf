import { type JSX, type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { color, font, radius, space, transition } from '../../../browser/style/design.js';
import { Codicon } from '../../../browser/ui/Codicon.js';
import { gitScmService } from '../../scm/browser/gitScmService.js';
import { useGitStatusStore } from '../../scm/browser/gitStatusStore.js';
import { SplitDiff } from './SplitDiff.js';
import { UnifiedDiff } from './UnifiedDiff.js';
import { extractHunkPatch } from './hunkPatch.js';
import { diffStat, hunkOldRanges } from './unifiedDiffModel.js';
import { useFileDiff } from './useFileDiff.js';

/**
 * The single-file git diff — a GitHub-style read-only UNIFIED view (red/green/±)
 * opened by clicking a changed file in the Source Control panel:
 *   staged row   → HEAD  vs the staged (index) version  → per-hunk Unstage
 *   unstaged row → index vs the working-tree file        → per-hunk Stage / Revert
 *   commit file  → parent ↔ commit (refs set)            → read-only
 * Sides + rows come from the shared useFileDiff hook; <UnifiedDiff> paints them.
 * The header offers prev/next-change navigation and an ignore-whitespace toggle.
 */

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const UnifiedDiffView = ({
  path,
  staged,
  leftRef,
  rightRef,
  title,
  onClose,
}: {
  path: string;
  staged: boolean;
  /** A commit-file diff sets both refs (parent ↔ commit); omit for working-tree diffs. */
  leftRef?: string;
  rightRef?: string;
  title?: string;
  onClose: () => void;
}): JSX.Element => {
  const isCommitDiff = rightRef !== undefined;
  const [ignoreWs, setIgnoreWs] = useState(false);
  // VS Code's diff editor offers inline (unified) and side-by-side (split) views.
  const [view, setView] = useState<'inline' | 'split'>('inline');
  const [rev, setRev] = useState(0); // bump → refetch after a hunk apply
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const diff = useFileDiff(
    path,
    {
      leftRef: isCommitDiff ? (leftRef ?? '') : staged ? 'HEAD' : '',
      rightWorktree: isCommitDiff ? false : !staged,
      rightRef,
      ignoreWhitespace: ignoreWs,
    },
    rev,
  );
  const name = path.slice(path.lastIndexOf('/') + 1);
  const stat = useMemo(() => (diff.status === 'ready' ? diffStat(diff.rows) : null), [diff]);
  const ranges = useMemo(() => (diff.status === 'ready' ? hunkOldRanges(diff.rows) : []), [diff]);

  // Prev/next change: scroll between the hunk anchors UnifiedDiff marked.
  const navigate = useCallback((dir: 1 | -1): void => {
    const host = scrollRef.current;
    if (!host) return;
    const anchors = Array.from(host.querySelectorAll<HTMLElement>('[data-hunk-anchor]'));
    if (anchors.length === 0) return;
    const top = host.scrollTop;
    const tops = anchors.map((a) => a.offsetTop);
    let target: number | undefined;
    if (dir === 1) target = tops.find((t) => t > top + 4);
    else target = [...tops].reverse().find((t) => t < top - 4);
    if (target === undefined) target = dir === 1 ? tops[0] : tops[tops.length - 1];
    if (target !== undefined) host.scrollTo({ top: Math.max(0, target - 8), behavior: 'smooth' });
  }, []);

  // Apply one hunk: pull git's raw diff, slice out the matching hunk's exact bytes,
  // and git.apply it. mode → which index/tree side and direction.
  const applyHunk = useCallback(
    async (hunkIndex: number, mode: 'stage' | 'unstage' | 'revert'): Promise<void> => {
      const range = ranges[hunkIndex];
      if (!range || range.oldFrom === Number.POSITIVE_INFINITY) return;
      setErr(null);
      try {
        const raw = await gitScmService.diff(path, { staged });
        const patch = extractHunkPatch(raw, range.oldFrom, range.oldTo);
        if (patch === null) {
          setErr('Could not find the matching hunk.');
          return;
        }
        const cached = mode !== 'revert';
        const reverse = mode !== 'stage';
        await gitScmService.apply({ patch, cached, reverse });
        await useGitStatusStore.getState().refresh();
        setRev((r) => r + 1);
      } catch (e) {
        setErr(msg(e));
      }
    },
    [path, staged, ranges],
  );

  // The per-hunk control (Stage/Revert for unstaged, Unstage for staged; none for
  // a commit/read-only diff).
  const renderHunkAction = isCommitDiff
    ? undefined
    : (hunkIndex: number): JSX.Element | null =>
        staged ? (
          <HunkBtn label="Unstage Changes" onClick={() => void applyHunk(hunkIndex, 'unstage')} />
        ) : (
          <>
            <HunkBtn label="Stage Changes" onClick={() => void applyHunk(hunkIndex, 'stage')} />
            <HunkBtn label="Discard" danger onClick={() => void applyHunk(hunkIndex, 'revert')} />
          </>
        );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
          padding: `${space[2]}px ${space[3]}px`,
          borderBottom: `1px solid ${color.divider}`,
          fontFamily: font.sans,
          fontSize: font.size.caption,
          color: color.textSecondary,
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: font.weight.medium, color: color.textPrimary }}>{name}</span>
        <span style={{ color: color.textTertiary }}>
          {isCommitDiff
            ? (title ?? 'Commit ↔ Parent')
            : staged
              ? 'Staged ↔ HEAD'
              : 'Working Tree ↔ Index'}
        </span>
        {stat && (stat.added > 0 || stat.removed > 0) && (
          <span style={{ fontFamily: font.mono, fontSize: font.size.micro }}>
            {stat.added > 0 && <span style={{ color: color.success }}>+{stat.added}</span>}
            {stat.added > 0 && stat.removed > 0 && ' '}
            {stat.removed > 0 && <span style={{ color: color.danger }}>−{stat.removed}</span>}
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: space[1] }}>
          <IconBtn title="Previous Change" onClick={() => navigate(-1)}>
            <Codicon name="arrow-up" size={14} />
          </IconBtn>
          <IconBtn title="Next Change" onClick={() => navigate(1)}>
            <Codicon name="arrow-down" size={14} />
          </IconBtn>
          <IconBtn
            title={ignoreWs ? 'Show whitespace' : 'Ignore whitespace'}
            active={ignoreWs}
            onClick={() => setIgnoreWs((v) => !v)}
          >
            <Codicon name="whitespace" size={14} />
          </IconBtn>
          <IconBtn
            title={view === 'split' ? 'Switch to inline view' : 'Switch to side-by-side view'}
            active={view === 'split'}
            onClick={() => setView((v) => (v === 'split' ? 'inline' : 'split'))}
          >
            <Codicon name="split-horizontal" size={14} />
          </IconBtn>
          <IconBtn title="Close Diff" onClick={onClose}>
            <Codicon name="close" size={14} />
          </IconBtn>
        </span>
      </div>
      {err !== null && (
        <div
          style={{
            padding: `${space[1]}px ${space[3]}px`,
            color: color.danger,
            fontFamily: font.sans,
            fontSize: font.size.micro,
            flexShrink: 0,
          }}
        >
          {err}
        </div>
      )}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {diff.status === 'error' ? (
          <Centered color={color.danger}>{diff.message}</Centered>
        ) : diff.status === 'loading' ? (
          <Centered color={color.textTertiary}>…</Centered>
        ) : diff.rows.length === 0 ? (
          <Centered color={color.textTertiary}>No changes.</Centered>
        ) : view === 'split' ? (
          <SplitDiff
            rows={diff.rows}
            oldHtml={diff.oldHtml}
            newHtml={diff.newHtml}
            renderHunkAction={renderHunkAction}
          />
        ) : (
          <UnifiedDiff
            rows={diff.rows}
            oldHtml={diff.oldHtml}
            newHtml={diff.newHtml}
            renderHunkAction={renderHunkAction}
          />
        )}
      </div>
    </div>
  );
};

const HunkBtn = ({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}): JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    style={{
      padding: `1px ${space[2]}px`,
      marginLeft: space[1],
      background: color.surface,
      border: `1px solid ${color.border}`,
      borderRadius: radius.sm,
      color: danger ? color.danger : color.accent,
      fontFamily: font.sans,
      fontSize: font.size.micro,
      cursor: 'pointer',
      boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
    }}
  >
    {label}
  </button>
);

const IconBtn = ({
  title,
  onClick,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}): JSX.Element => (
  <button
    type="button"
    title={title}
    aria-label={title}
    onClick={onClick}
    style={{
      width: 22,
      height: 22,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: active ? color.divider : 'none',
      border: 'none',
      borderRadius: radius.sm,
      cursor: 'pointer',
      color: active ? color.textPrimary : color.textTertiary,
      fontSize: font.size.body,
      transition: transition(['background', 'color']),
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = color.divider;
      e.currentTarget.style.color = color.textPrimary;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = active ? color.divider : 'none';
      e.currentTarget.style.color = active ? color.textPrimary : color.textTertiary;
    }}
  >
    {children}
  </button>
);

const Centered = ({ children, color: c }: { children: string; color: string }): JSX.Element => (
  <div style={{ padding: space[4], color: c, fontFamily: font.sans, fontSize: font.size.caption }}>
    {children}
  </div>
);
