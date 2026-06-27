import { type JSX, useState } from 'react';
import { color, font, radius, space, transition } from '../design.js';
import { useGitStatusStore } from '../store/gitStatus.js';
import { useLayoutStore } from '../store/layout.js';
import { toast } from '../store/toast.js';
import { useWorkspaceStore } from '../store/workspace.js';

/**
 * StatusBar — the always-visible bottom chrome bar, modeled on VS Code's. Its left
 * segment shows the current git branch + sync state (ahead/behind) the way VS
 * Code's bottom-left does: click the branch to jump to Source Control, click the
 * sync segment to pull-then-push. The right shows the active workspace. Only
 * mounted in the canvas region (a reachable workspace).
 */

const BAR_HEIGHT = 22;

export const StatusBar = (): JSX.Element => {
  const status = useGitStatusStore((s) => s.status);
  const refresh = useGitStatusStore((s) => s.refresh);
  const workspace = useWorkspaceStore((s) => s.current);
  const [syncing, setSyncing] = useState(false);

  const openScm = (): void => {
    useLayoutStore.getState().setSidebarView('scm');
    useLayoutStore.getState().setSidebarOpen(true);
  };

  const sync = (): void => {
    if (syncing) return;
    setSyncing(true);
    void (async () => {
      try {
        await window.bh.run('git.pull', {});
        await window.bh.run('git.push', {});
        toast.success('Synced');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        await refresh();
        setSyncing(false);
      }
    })();
  };

  const isRepo = status?.isRepo === true;
  const branch = status?.detached ? 'detached' : (status?.branch ?? '');
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;

  return (
    <div
      style={{
        height: BAR_HEIGHT,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: space[1],
        padding: `0 ${space[2]}px`,
        background: color.surfaceMuted,
        borderTop: `1px solid ${color.border}`,
        fontFamily: font.sans,
        fontSize: font.size.micro,
        color: color.textSecondary,
        userSelect: 'none',
      }}
    >
      {isRepo && branch !== '' && (
        <>
          <Segment title="Switch to Source Control" onClick={openScm}>
            <BranchGlyph />
            <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {branch}
            </span>
          </Segment>
          <Segment
            title={status?.upstream === null ? 'Publish Branch' : `Sync ↑${ahead} ↓${behind}`}
            onClick={sync}
          >
            <span
              style={{
                display: 'inline-block',
                animation: syncing ? 'bh-spin 0.8s linear infinite' : undefined,
              }}
            >
              ↻
            </span>
            {(ahead > 0 || behind > 0) && (
              <span style={{ fontFamily: font.mono }}>
                {ahead > 0 ? `↑${ahead}` : ''}
                {behind > 0 ? `↓${behind}` : ''}
              </span>
            )}
          </Segment>
        </>
      )}
      <span style={{ marginLeft: 'auto', color: color.textTertiary }}>{workspace ?? ''}</span>
    </div>
  );
};

const Segment = ({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: space[1],
      height: BAR_HEIGHT - 4,
      padding: `0 ${space[1]}px`,
      background: 'none',
      border: 'none',
      borderRadius: radius.sm,
      color: color.textSecondary,
      fontFamily: font.sans,
      fontSize: font.size.micro,
      cursor: 'pointer',
      transition: transition(['background', 'color']),
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = color.divider;
      e.currentTarget.style.color = color.textPrimary;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = 'none';
      e.currentTarget.style.color = color.textSecondary;
    }}
  >
    {children}
  </button>
);

const BranchGlyph = (): JSX.Element => (
  <svg
    width={11}
    height={11}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.4}
    aria-hidden
    style={{ flexShrink: 0 }}
  >
    <circle cx={4} cy={3.5} r={1.8} />
    <circle cx={4} cy={12.5} r={1.8} />
    <circle cx={12} cy={3.5} r={1.8} />
    <path d="M4 5.3v5.4M12 5.3c0 3-2.5 3.2-5 3.7" strokeLinecap="round" />
  </svg>
);
