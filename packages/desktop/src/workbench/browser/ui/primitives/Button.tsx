/**
 * Button — the one button. Replaces ad-hoc <button> + inline styles
 * scattered across TopBar / Sidebar / Dialog. Variants encode intent:
 *
 *   primary  — the one positive action per surface (the CTA)
 *   default  — neutral action (most buttons in chrome)
 *   ghost    — quiet action (less weight than default; e.g. dialog cancel)
 *   danger   — destructive confirmed action
 *
 * Size = sm | md (md is default).
 *
 * Borders + hover + focus + active all flow from design tokens; nobody
 * picks a #color or a `4px 10px` again.
 */

import { type ButtonHTMLAttributes, type JSX, useState } from 'react';
import { color, font, radius, shadow, space, transition } from '../../style/design.js';

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Override the default `type="button"` (e.g. for form submit buttons). */
  readonly type?: 'button' | 'submit' | 'reset';
}

interface Palette {
  bg: string;
  bgHover: string;
  bgActive: string;
  fg: string;
  border: string;
  borderHover: string;
}

function palette(variant: ButtonVariant): Palette {
  switch (variant) {
    case 'primary':
      return {
        bg: color.accent,
        bgHover: color.accentHover,
        bgActive: color.accentHover,
        fg: '#fff',
        border: color.accent,
        borderHover: color.accentHover,
      };
    case 'danger':
      return {
        bg: color.surface,
        bgHover: color.dangerSoft,
        bgActive: color.dangerSoft,
        fg: color.danger,
        border: color.borderStrong,
        borderHover: color.danger,
      };
    case 'ghost':
      return {
        bg: 'transparent',
        bgHover: color.divider,
        bgActive: color.border,
        fg: color.textSecondary,
        border: 'transparent',
        borderHover: 'transparent',
      };
    default:
      return {
        bg: color.surface,
        bgHover: color.surfaceMuted,
        bgActive: color.divider,
        fg: color.textPrimary,
        border: color.borderStrong,
        borderHover: color.textTertiary,
      };
  }
}

export const Button = ({
  variant = 'default',
  size = 'md',
  type = 'button',
  disabled,
  children,
  ...rest
}: ButtonProps): JSX.Element => {
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);
  const [focus, setFocus] = useState(false);
  const p = palette(variant);

  const padY = size === 'sm' ? space[1] : space[1.5];
  const padX = size === 'sm' ? space[2] : space[3];
  const fontSize = size === 'sm' ? font.size.micro : font.size.ui;

  const bg = disabled ? color.surfaceMuted : active ? p.bgActive : hover ? p.bgHover : p.bg;
  const fg = disabled ? color.textGhost : p.fg;
  const border = disabled ? color.border : hover || focus ? p.borderHover : p.border;

  return (
    <button
      type={type}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setActive(false);
      }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        padding: `${padY}px ${padX}px`,
        fontSize,
        fontFamily: font.sans,
        fontWeight: font.weight.medium,
        background: bg,
        color: fg,
        border: `1px solid ${border}`,
        borderRadius: radius.md,
        cursor: disabled ? 'not-allowed' : 'pointer',
        outline: 'none',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        boxShadow: focus && !disabled ? shadow.focus : 'none',
        transition: transition(['background', 'color', 'border-color', 'box-shadow']),
        lineHeight: 1.4,
        letterSpacing: 0,
      }}
      {...rest}
    >
      {children}
    </button>
  );
};
