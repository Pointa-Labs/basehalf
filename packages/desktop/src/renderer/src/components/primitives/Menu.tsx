/**
 * Menu — a small popover of actions, modeled on Select.
 *
 * A trigger button (default: a "⋯" overflow icon) opens an absolutely-
 * positioned list of action items. Click-outside / Esc close. This exists
 * to fold low-frequency chrome actions (rename / remove / delete) out of
 * the always-visible toolbar so it reads as a calm tool, not a cockpit of
 * a dozen text buttons.
 *
 * Deliberately small: no arrow-key roving (these lists are 2–3 items). It
 * mirrors Select's positioning + dismissal so the two feel like one family.
 */

import { type CSSProperties, type JSX, type ReactNode, useState } from 'react';
import { color, font, radius, space, transition } from '../../design.js';
import { PopoverSurface, usePopover } from './Popover.js';

export interface MenuAction {
  readonly label: string;
  readonly onClick: () => void;
  /** Destructive actions render in the danger tone. */
  readonly danger?: boolean;
  readonly disabled?: boolean;
}

interface MenuProps {
  readonly actions: readonly MenuAction[];
  readonly title?: string;
  /** Test hook for the Playwright driver — becomes `data-testid` on the trigger. */
  readonly testId?: string;
  /** Trigger content; defaults to the ⋯ overflow glyph. */
  readonly label?: ReactNode;
  /** Anchor edge. `right` keeps the menu on-screen near a toolbar's right edge. */
  readonly align?: 'left' | 'right';
  readonly disabled?: boolean;
}

const overflowGlyph = (
  <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden style={{ flexShrink: 0 }}>
    <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
    <circle cx="8" cy="8" r="1.3" fill="currentColor" />
    <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
  </svg>
);

export const Menu = ({
  actions,
  title,
  testId,
  label,
  align = 'left',
  disabled = false,
}: MenuProps): JSX.Element => {
  // Positioning, outside-click / Esc dismissal, and the toolbar-overflow clip
  // escape all live in usePopover (shared with Select). This component owns
  // only the trigger's hover tone and the action list.
  const { open, toggle, close, triggerRef, floatingRef, coords } = usePopover({ align, disabled });
  const [hover, setHover] = useState(false);

  const triggerStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
    minWidth: label ? undefined : 28,
    height: 28,
    padding: label ? `0 ${space[2]}px` : 0,
    fontSize: font.size.ui,
    fontFamily: font.sans,
    color: disabled ? color.textGhost : color.textSecondary,
    background: open || hover ? color.divider : 'transparent',
    border: '1px solid transparent',
    borderRadius: radius.md,
    cursor: disabled ? 'not-allowed' : 'pointer',
    outline: 'none',
    transition: transition(['background', 'color']),
  };

  return (
    <div style={{ display: 'inline-block' }}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
        style={triggerStyle}
      >
        {label ?? overflowGlyph}
      </button>
      {open && (
        <PopoverSurface
          coords={coords}
          floatingRef={floatingRef}
          role="menu"
          style={{ minWidth: 168 }}
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              onClick={() => {
                close();
                action.onClick();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                textAlign: 'left',
                border: 'none',
                background: 'transparent',
                color: action.disabled
                  ? color.textGhost
                  : action.danger
                    ? color.danger
                    : color.textPrimary,
                padding: `${space[1.5]}px ${space[2]}px`,
                fontSize: font.size.ui,
                fontFamily: font.sans,
                borderRadius: radius.sm,
                cursor: action.disabled ? 'not-allowed' : 'pointer',
                outline: 'none',
                whiteSpace: 'nowrap',
                transition: transition(['background']),
              }}
              onMouseEnter={(e) => {
                if (!action.disabled)
                  e.currentTarget.style.background = action.danger
                    ? color.dangerSoft
                    : color.accentSofter;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              {action.label}
            </button>
          ))}
        </PopoverSurface>
      )}
    </div>
  );
};
