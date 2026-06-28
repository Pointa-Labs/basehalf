import type { JSX } from 'react';
import { color, font, space } from '../../../browser/style/design.js';
import { Codicon } from '../../../browser/ui/Codicon.js';
import { Menu } from '../../../browser/ui/primitives/Menu.js';
import { scm } from './styles.js';
import type { CommitActionOptions } from './types.js';

export const CommitActionButton = ({
  canPrimaryAction,
  canCommit,
  canCommitAmend,
  primaryLabel = 'Commit',
  primaryGlyph = 'check',
  onAction,
  onPrimaryAction,
}: {
  canPrimaryAction: boolean;
  canCommit: boolean;
  canCommitAmend: boolean;
  primaryLabel?: string;
  primaryGlyph?: string;
  onAction: (options?: CommitActionOptions) => void;
  onPrimaryAction?: () => void;
}): JSX.Element => {
  const canOpenCommitMenu = canCommit || canCommitAmend;
  return (
    <div style={{ display: 'flex', marginTop: space[2], height: 28 }}>
      <button
        type="button"
        disabled={!canPrimaryAction}
        onClick={() => (onPrimaryAction ?? (() => onAction()))()}
        style={{
          flex: 1,
          minWidth: 0,
          padding: `0 ${space[2]}px`,
          background: canPrimaryAction ? color.accent : 'transparent',
          color: canPrimaryAction ? color.onAccent : scm.disabledFg,
          border: `1px solid ${canPrimaryAction ? '#ffffff1a' : 'transparent'}`,
          borderRight: 'none',
          borderRadius: `${scm.editorRadius}px 0 0 ${scm.editorRadius}px`,
          fontFamily: font.sans,
          fontSize: font.size.ui,
          fontWeight: font.weight.medium,
          cursor: canPrimaryAction ? 'pointer' : 'default',
          lineHeight: '26px',
        }}
      >
        <Codicon name={primaryGlyph} size={14} style={{ marginRight: 6 }} />
        {primaryLabel}
      </button>
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          background: canPrimaryAction ? color.accent : 'transparent',
          border: `1px solid ${canOpenCommitMenu ? '#ffffff1a' : 'transparent'}`,
          borderRadius: `0 ${scm.editorRadius}px ${scm.editorRadius}px 0`,
          borderLeft: `1px solid ${canOpenCommitMenu ? '#ffffff33' : color.divider}`,
        }}
      >
        <Menu
          align="right"
          disabled={!canOpenCommitMenu}
          title="Commit Options…"
          label={
            <Codicon
              name="chevron-down"
              size={14}
              color={canPrimaryAction ? color.onAccent : color.textGhost}
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
