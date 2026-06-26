import { type JSX, useMemo } from 'react';
import { color, font, radius, space, transition } from '../design.js';
import { diffStat } from '../lib/unifiedDiff.js';
import { useFileDiff } from '../lib/useFileDiff.js';
import { UnifiedDiff } from './UnifiedDiff.js';

/**
 * The single-file git diff — a GitHub-style read-only UNIFIED view (red/green/±)
 * opened by clicking a changed file in the Source Control panel:
 *   staged row   → HEAD  vs the staged (index) version
 *   unstaged row → index vs the working-tree file
 * Sides + rows come from the shared useFileDiff hook; <UnifiedDiff> paints them.
 */
export const UnifiedDiffView = ({
  path,
  staged,
  onClose,
}: {
  path: string;
  staged: boolean;
  onClose: () => void;
}): JSX.Element => {
  const diff = useFileDiff(path, { leftRef: staged ? 'HEAD' : '', rightWorktree: !staged });
  const name = path.slice(path.lastIndexOf('/') + 1);
  const stat = useMemo(() => (diff.status === 'ready' ? diffStat(diff.rows) : null), [diff]);

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
          {staged ? 'Staged ↔ HEAD' : 'Working Tree ↔ Index'}
        </span>
        {stat && (stat.added > 0 || stat.removed > 0) && (
          <span style={{ fontFamily: font.mono, fontSize: font.size.micro }}>
            {stat.added > 0 && <span style={{ color: color.success }}>+{stat.added}</span>}
            {stat.added > 0 && stat.removed > 0 && ' '}
            {stat.removed > 0 && <span style={{ color: color.danger }}>−{stat.removed}</span>}
          </span>
        )}
        <button
          type="button"
          title="Close diff"
          aria-label="Close diff"
          onClick={onClose}
          style={{
            marginLeft: 'auto',
            width: 22,
            height: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            borderRadius: radius.sm,
            cursor: 'pointer',
            color: color.textTertiary,
            fontSize: font.size.body,
            transition: transition(['background', 'color']),
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = color.divider;
            e.currentTarget.style.color = color.textPrimary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'none';
            e.currentTarget.style.color = color.textTertiary;
          }}
        >
          ✕
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {diff.status === 'error' ? (
          <Centered color={color.danger}>{diff.message}</Centered>
        ) : diff.status === 'loading' ? (
          <Centered color={color.textTertiary}>…</Centered>
        ) : diff.rows.length === 0 ? (
          <Centered color={color.textTertiary}>No changes.</Centered>
        ) : (
          <UnifiedDiff rows={diff.rows} oldHtml={diff.oldHtml} newHtml={diff.newHtml} />
        )}
      </div>
    </div>
  );
};

const Centered = ({ children, color: c }: { children: string; color: string }): JSX.Element => (
  <div style={{ padding: space[4], color: c, fontFamily: font.sans, fontSize: font.size.caption }}>
    {children}
  </div>
);
