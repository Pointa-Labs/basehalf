import type { JSX } from 'react';
import { color, font, space } from '../../../browser/style/design.js';
import { Menu } from '../../../browser/ui/primitives/Menu.js';
import type { GitStatusResult } from '../common/git.js';
import { BranchQuickPick } from './BranchQuickPick.js';
import { ScmIconButton as IconBtn } from './ScmIconButton.js';
import type { ScmHeaderActionModel } from './scmHeaderActions.js';
import { scm } from './styles.js';

export const RepoHeader = ({
  status,
  busy,
  onAfterBranch,
  actions,
}: {
  status: GitStatusResult;
  busy: boolean;
  onAfterBranch: () => void | Promise<void>;
  actions: ScmHeaderActionModel;
}): JSX.Element => {
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
      <BranchQuickPick
        status={status}
        busyReason={busy ? 'operation' : undefined}
        onAfter={onAfterBranch}
      />
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <IconBtn
          title={actions.remoteAction.title}
          onClick={actions.remoteAction.onClick}
          disabled={actions.remoteAction.disabled}
          glyph={actions.remoteAction.glyph}
        />
        {actions.remoteAction.id === 'sync' && actions.remoteCounts !== '' && (
          <span
            style={{
              color: color.textTertiary,
              fontFamily: font.mono,
              fontSize: font.size.micro,
              marginRight: space[1],
            }}
          >
            {actions.remoteCounts}
          </span>
        )}
        <IconBtn
          title={actions.refreshAction.title}
          onClick={actions.refreshAction.onClick}
          disabled={actions.refreshAction.disabled}
          glyph={actions.refreshAction.glyph}
        />
        <Menu
          actions={actions.overflowActions}
          title="More Actions…"
          align="right"
          disabled={busy}
        />
      </span>
    </div>
  );
};
