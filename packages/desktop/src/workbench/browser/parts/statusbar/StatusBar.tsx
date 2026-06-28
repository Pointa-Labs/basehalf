import { type JSX, useState } from 'react';
import { toast } from '../../../../platform/notification/browser/notificationService.js';
import { BranchQuickPick } from '../../../contrib/scm/browser/BranchQuickPick.js';
import { gitScmService } from '../../../contrib/scm/browser/gitScmService.js';
import { useGitStatusStore } from '../../../contrib/scm/browser/gitStatusStore.js';
import { choosePublishRemote } from '../../../contrib/scm/browser/useScmRemoteCommands.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import { color, font, radius, space, transition } from '../../style/design.js';
import { Codicon } from '../../ui/Codicon.js';

/**
 * StatusBar — the always-visible bottom chrome bar, modeled on VS Code's. Its left
 * segment shows the current git branch + sync state (ahead/behind) the way VS
 * Code's bottom-left does: click the branch to pick a branch, click the remote
 * segment to publish or sync. The right shows the active workspace. Only
 * mounted in the canvas region (a reachable workspace).
 */

const BAR_HEIGHT = 22;

export const StatusBar = (): JSX.Element => {
  const status = useGitStatusStore((s) => s.status);
  const refresh = useGitStatusStore((s) => s.refresh);
  const workspace = useWorkspaceStore((s) => s.current);
  const [syncing, setSyncing] = useState(false);

  const sync = (): void => {
    if (syncing) return;
    setSyncing(true);
    void (async () => {
      const publishing =
        status?.detached !== true && status?.branch !== null && status?.upstream === null;
      try {
        if (publishing) {
          const remote = await choosePublishRemote(gitScmService);
          if (remote === null) return;
          await gitScmService.publish({ remote });
        } else {
          await gitScmService.sync();
        }
        toast.success(publishing ? 'Published Branch' : 'Synced');
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
  const canPublish =
    isRepo && status?.detached !== true && status?.branch !== null && status?.upstream === null;

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
          <BranchQuickPick
            status={status}
            disabled={syncing}
            onAfter={refresh}
            variant="statusBar"
          />
          <Segment
            title={canPublish ? 'Publish Branch' : `Sync ↑${ahead} ↓${behind}`}
            onClick={sync}
          >
            <Codicon
              name={canPublish ? 'cloud-upload' : 'sync'}
              size={14}
              style={{
                display: 'inline-block',
                animation: syncing && !canPublish ? 'bh-spin 0.8s linear infinite' : undefined,
              }}
            />
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
