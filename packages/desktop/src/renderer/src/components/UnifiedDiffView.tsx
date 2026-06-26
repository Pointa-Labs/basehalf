import type { GitShowResult, WorkspaceReadFileResult } from '@basehalf/core';
import { type JSX, useEffect, useMemo, useState } from 'react';
import { color, font, radius, space, transition } from '../design.js';
import { type DiffRow, computeUnifiedDiff, diffStat } from '../lib/unifiedDiff.js';
import { UnifiedDiff } from './UnifiedDiff.js';

/**
 * The single-file git diff — a GitHub-style read-only UNIFIED view (red/green/±)
 * opened by clicking a changed file in the Source Control panel:
 *   staged row   → HEAD  vs the staged (index) version
 *   unstaged row → index vs the working-tree file
 * Sides come from core's `git.show` (`<ref>:./path`) + `workspace.readFile`; the
 * rows are computed by lib/unifiedDiff and painted by <UnifiedDiff>. Never writes.
 */

// Cap inputs ourselves (chars, a generous size proxy) — past this we skip the diff
// rather than diff two huge strings.
const MAX_DIFF_CHARS = 2 * 1024 * 1024;

type Loaded = { rows: DiffRow[] };

export const UnifiedDiffView = ({
  path,
  staged,
  onClose,
}: {
  path: string;
  staged: boolean;
  onClose: () => void;
}): JSX.Element => {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    void (async () => {
      try {
        const leftP = window.bh.run('git.show', {
          ref: staged ? 'HEAD' : '',
          path,
        }) as Promise<GitShowResult>;
        const rightP = staged
          ? (window.bh.run('git.show', { ref: '', path }) as Promise<GitShowResult>)
          : (
              window.bh.run('workspace.readFile', { path }) as Promise<WorkspaceReadFileResult>
            ).catch((err: unknown): WorkspaceReadFileResult => {
              // A deleted working-tree file → the right side is simply empty.
              if (err instanceof Error && err.message.startsWith('[PATH_NOT_FOUND]')) {
                return { content: '' } as WorkspaceReadFileResult;
              }
              throw err;
            });
        const [left, right] = await Promise.all([leftP, rightP]);
        if (cancelled) return;
        const original = left.content ?? '';
        const modified = right.content ?? '';
        if (original.length > MAX_DIFF_CHARS || modified.length > MAX_DIFF_CHARS) {
          setError('File is too large to show a diff.');
          return;
        }
        setLoaded({ rows: computeUnifiedDiff(original, modified) });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, staged]);

  const name = path.slice(path.lastIndexOf('/') + 1);
  const stat = useMemo(() => (loaded ? diffStat(loaded.rows) : null), [loaded]);

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
        {error !== null ? (
          <div
            style={{
              padding: space[4],
              color: color.danger,
              fontFamily: font.sans,
              fontSize: font.size.caption,
            }}
          >
            {error}
          </div>
        ) : loaded ? (
          loaded.rows.length === 0 ? (
            <div
              style={{
                padding: space[4],
                color: color.textTertiary,
                fontFamily: font.sans,
                fontSize: font.size.caption,
              }}
            >
              No changes.
            </div>
          ) : (
            <UnifiedDiff rows={loaded.rows} />
          )
        ) : (
          <div
            style={{ padding: space[4], color: color.textTertiary, fontSize: font.size.caption }}
          >
            …
          </div>
        )}
      </div>
    </div>
  );
};
