import type { JSX } from 'react';
import { color, font, space } from '../../design.js';
import { Codicon } from '../Codicon.js';
import { Menu } from '../primitives/Menu.js';
import { scm } from './styles.js';
import type { CommitActionOptions } from './types.js';

export const CommitActionButton = ({
  canCommit,
  canCommitAmend,
  onAction,
}: {
  canCommit: boolean;
  canCommitAmend: boolean;
  onAction: (options?: CommitActionOptions) => void;
}): JSX.Element => {
  const canOpenCommitMenu = canCommit || canCommitAmend;
  return (
    <div style={{ display: 'flex', marginTop: space[2], height: 28 }}>
      <button
        type="button"
        disabled={!canCommit}
        onClick={() => onAction()}
        style={{
          flex: 1,
          minWidth: 0,
          padding: `0 ${space[2]}px`,
          background: canCommit ? color.accent : 'transparent',
          color: canCommit ? color.onAccent : scm.disabledFg,
          border: `1px solid ${canCommit ? '#ffffff1a' : 'transparent'}`,
          borderRight: 'none',
          borderRadius: `${scm.editorRadius}px 0 0 ${scm.editorRadius}px`,
          fontFamily: font.sans,
          fontSize: font.size.ui,
          fontWeight: font.weight.medium,
          cursor: canCommit ? 'pointer' : 'default',
          lineHeight: '26px',
        }}
      >
        <Codicon name="check" size={14} style={{ marginRight: 6 }} />
        Commit
      </button>
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          background: canOpenCommitMenu ? color.accent : 'transparent',
          border: `1px solid ${canOpenCommitMenu ? '#ffffff1a' : 'transparent'}`,
          borderRadius: `0 ${scm.editorRadius}px ${scm.editorRadius}px 0`,
          borderLeft: `1px solid ${canOpenCommitMenu ? '#ffffff33' : color.divider}`,
        }}
      >
        <Menu
          align="right"
          disabled={!canOpenCommitMenu}
          label={
            <Codicon
              name="chevron-down"
              size={14}
              color={canOpenCommitMenu ? color.onAccent : color.textGhost}
            />
          }
          actions={[
            {
              label: 'Commit (Amend)',
              disabled: !canCommitAmend,
              onClick: () => onAction({ amend: true }),
            },
            {
              label: 'Commit & Push',
              disabled: !canCommit,
              onClick: () => onAction({ after: 'push' }),
            },
            {
              label: 'Commit & Sync',
              disabled: !canCommit,
              onClick: () => onAction({ after: 'sync' }),
            },
          ]}
        />
      </div>
    </div>
  );
};
