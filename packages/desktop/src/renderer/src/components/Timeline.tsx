import type { GitLogResult } from '@basehalf/core';
import { type JSX, useEffect, useState } from 'react';
import { color, font, space, transition } from '../design.js';
import { useGitStatusStore } from '../store/gitStatus.js';
import { useWorkspaceStore } from '../store/workspace.js';

/**
 * Timeline — the active file's git history, shown at the bottom of the Explorer
 * (VS Code's Timeline view). Each entry is a commit that touched the open file;
 * clicking one opens that commit's diff OF THIS FILE (commit ↔ parent). Reuses
 * `git.log({ path })` + the shared commit-diff overlay; read-only.
 *
 * Refreshes when the open file changes and when that file's git status changes
 * (so a fresh commit lands in the list right after you commit).
 */
export const Timeline = (): JSX.Element | null => {
  const openFile = useWorkspaceStore((s) => s.openFile);
  const openCommitDiff = useWorkspaceStore((s) => s.openCommitDiff);
  const [commits, setCommits] = useState<GitLogResult['commits'] | null>(null);
  const [open, setOpen] = useState(true);
  // A cheap "did this file's git state change" signal (same trick the blame
  // annotation uses) so committing refreshes the timeline.
  const fileSig = useGitStatusStore((s) => {
    if (openFile === null) return '';
    const f = s.byPath.get(openFile);
    return `${s.status?.branch ?? ''}:${f ? `${f.x}${f.y}` : ''}`;
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: fileSig re-triggers a refresh after this file's git status changes (commit/stage); it's a trigger, not read in the body.
  useEffect(() => {
    if (openFile === null) {
      setCommits(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = (await window.bh.run('git.log', {
          path: openFile,
          maxCount: 50,
        })) as GitLogResult;
        if (!cancelled) setCommits(r.commits);
      } catch {
        if (!cancelled) setCommits([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openFile, fileSig]);

  if (openFile === null) return null;

  return (
    <div
      data-testid="timeline"
      style={{
        flexShrink: 0,
        borderTop: `1px solid ${color.border}`,
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '40%',
        minHeight: 26,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[1],
          height: 24,
          padding: `0 ${space[2]}px`,
          flexShrink: 0,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: color.textTertiary,
          fontFamily: font.sans,
          fontSize: font.size.micro,
          fontWeight: font.weight.semibold,
          letterSpacing: font.trackedCaps,
          textTransform: 'uppercase',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 10,
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: transition(['transform']),
          }}
        >
          ▸
        </span>
        Timeline
        <span style={{ marginLeft: 'auto', textTransform: 'none', color: color.textGhost }}>
          {openFile.slice(openFile.lastIndexOf('/') + 1)}
        </span>
      </button>
      {open && (
        <div style={{ overflowY: 'auto', minHeight: 0 }}>
          {commits === null ? (
            <Row muted>Loading history…</Row>
          ) : commits.length === 0 ? (
            <Row muted>No commit history for this file yet.</Row>
          ) : (
            commits.map((c) => (
              <button
                key={c.hash}
                type="button"
                data-testid="timeline-entry"
                title={`${c.shortHash} · ${c.subject}`}
                onClick={() => openCommitDiff(openFile, c.hash)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  width: '100%',
                  padding: `${space[1]}px ${space[2]}px ${space[1]}px ${space[4]}px`,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
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
                    color: color.textSecondary,
                    fontFamily: font.sans,
                    fontSize: font.size.micro,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    width: '100%',
                  }}
                >
                  {c.subject}
                </span>
                <span
                  style={{
                    color: color.textGhost,
                    fontFamily: font.mono,
                    fontSize: font.size.micro,
                  }}
                >
                  {c.shortHash} · {c.author.name} · {c.author.date.slice(0, 10)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const Row = ({ children, muted }: { children: string; muted?: boolean }): JSX.Element => (
  <div
    style={{
      padding: `${space[1]}px ${space[4]}px`,
      color: muted ? color.textGhost : color.textSecondary,
      fontFamily: font.sans,
      fontSize: font.size.micro,
    }}
  >
    {children}
  </div>
);
