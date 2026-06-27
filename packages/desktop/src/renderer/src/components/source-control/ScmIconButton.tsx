import type { JSX } from 'react';
import { color, transition } from '../../design.js';
import { Codicon } from '../Codicon.js';
import { scm } from './styles.js';

export const ScmIconButton = ({
  glyph,
  title,
  onClick,
  disabled,
  danger,
  tabIndex,
}: {
  glyph: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  tabIndex?: number;
}): JSX.Element => (
  <button
    type="button"
    title={title}
    aria-label={title}
    disabled={disabled}
    tabIndex={tabIndex}
    onClick={(e) => {
      e.stopPropagation(); // don't let a row-action click also open the row's diff
      onClick();
    }}
    style={{
      width: scm.iconButtonSize,
      height: scm.iconButtonSize,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'none',
      border: 'none',
      borderRadius: 3,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      color: danger ? color.danger : color.textTertiary,
      transition: transition(['background', 'color']),
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = scm.buttonHoverBg;
      e.currentTarget.style.color = danger ? color.danger : color.textPrimary;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = 'none';
      e.currentTarget.style.color = danger ? color.danger : color.textTertiary;
    }}
  >
    <Codicon name={glyph} size={16} />
  </button>
);
