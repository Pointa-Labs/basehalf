import type { JSX } from 'react';
import { color, font, space } from '../../../browser/style/design.js';
import { Codicon } from '../../../browser/ui/Codicon.js';
import { Menu } from '../../../browser/ui/primitives/Menu.js';
import type { CommitActionOptions } from '../common/commitTypes.js';
import type { SourceControlActionButtonModel } from './sourceControlActionButtonModel.js';
import { scm } from './styles.js';

export const CommitActionButton = ({
  model,
  onAction,
  onPrimaryAction,
}: {
  model: SourceControlActionButtonModel;
  onAction: (options?: CommitActionOptions) => void;
  onPrimaryAction?: () => void;
}): JSX.Element => {
  const hasSecondaryActions = model.secondaryActions.length > 0;
  return (
    <div style={{ display: 'flex', marginTop: space[2], height: 28 }}>
      <button
        type="button"
        disabled={!model.primaryEnabled}
        onClick={() => (onPrimaryAction ?? (() => onAction()))()}
        style={{
          flex: 1,
          minWidth: 0,
          padding: `0 ${space[2]}px`,
          background: model.primaryEnabled ? color.accent : 'transparent',
          color: model.primaryEnabled ? color.onAccent : scm.disabledFg,
          border: `1px solid ${model.primaryEnabled ? '#ffffff1a' : 'transparent'}`,
          borderRight: hasSecondaryActions ? 'none' : undefined,
          borderRadius: hasSecondaryActions
            ? `${scm.editorRadius}px 0 0 ${scm.editorRadius}px`
            : scm.editorRadius,
          fontFamily: font.sans,
          fontSize: font.size.ui,
          fontWeight: font.weight.medium,
          cursor: model.primaryEnabled ? 'pointer' : 'default',
          lineHeight: '26px',
        }}
      >
        <Codicon name={model.primaryGlyph} size={14} style={{ marginRight: 6 }} />
        {model.primaryLabel}
      </button>
      {hasSecondaryActions && (
        <div
          style={{
            display: 'flex',
            alignItems: 'stretch',
            background: model.primaryEnabled ? color.accent : 'transparent',
            border: `1px solid ${model.commitMenuEnabled ? '#ffffff1a' : 'transparent'}`,
            borderRadius: `0 ${scm.editorRadius}px ${scm.editorRadius}px 0`,
            borderLeft: `1px solid ${model.commitMenuEnabled ? '#ffffff33' : color.divider}`,
          }}
        >
          <Menu
            align="right"
            disabled={!model.commitMenuEnabled}
            title="Commit Options…"
            label={
              <Codicon
                name="chevron-down"
                size={14}
                color={model.primaryEnabled ? color.onAccent : color.textGhost}
              />
            }
            actions={model.secondaryActions.map((action) => ({
              label: action.label,
              disabled: action.disabled,
              onClick: () => onAction(action.options),
            }))}
          />
        </div>
      )}
    </div>
  );
};
