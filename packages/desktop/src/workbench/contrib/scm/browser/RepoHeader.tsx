import type { JSX } from 'react';
import { color, font, space } from '../../../browser/style/design.js';
import { Menu, type MenuAction } from '../../../browser/ui/primitives/Menu.js';
import type { GitStatusResult } from '../common/git.js';
import { BranchQuickPick } from './BranchQuickPick.js';
import { ScmIconButton as IconBtn } from './ScmIconButton.js';
import { scm } from './styles.js';

export const RepoHeader = ({
  status,
  busy,
  onPublish,
  onSync,
  onAfterBranch,
  menuActions,
}: {
  status: GitStatusResult;
  busy: boolean;
  onPublish: () => void;
  onSync: () => void;
  onAfterBranch: () => void | Promise<void>;
  menuActions: MenuAction[];
}): JSX.Element => {
  // The remote action follows VS Code: a branch without upstream publishes;
  // otherwise it syncs and carries the ahead/behind counts.
  const counts =
    status.ahead > 0 || status.behind > 0
      ? `${status.ahead > 0 ? `↑${status.ahead}` : ''}${status.behind > 0 ? `↓${status.behind}` : ''}`
      : '';
  const canPublish = status.detached !== true && status.branch !== null && status.upstream === null;
  const syncTitle = canPublish
    ? 'Publish Branch'
    : counts !== ''
      ? `Sync Changes ${counts}`
      : 'Sync Changes (Pull, Push)';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: space[1],
        height: 35,
        padding: `0 ${space[2]}px 0 ${space[3]}px`,
        background: scm.panelBg,
        borderBottom: `1px solid ${color.divider}`,
        flexShrink: 0,
        fontFamily: font.sans,
        fontSize: font.size.ui,
        color: color.textSecondary,
        minWidth: 0,
      }}
    >
      <BranchQuickPick status={status} disabled={busy} onAfter={onAfterBranch} />
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <IconBtn
          title={syncTitle}
          onClick={canPublish ? onPublish : onSync}
          disabled={busy}
          glyph={canPublish ? 'cloud-upload' : 'sync'}
        />
        {!canPublish && counts !== '' && (
          <span
            style={{
              color: color.textTertiary,
              fontFamily: font.mono,
              fontSize: font.size.micro,
              marginRight: space[1],
            }}
          >
            {counts}
          </span>
        )}
        <Menu actions={menuActions} title="More Actions…" align="right" disabled={busy} />
      </span>
    </div>
  );
};
