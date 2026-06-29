/**
 * Menu — a small popover of actions, modeled on Select.
 *
 * A trigger button (default: the VS Code ellipsis codicon) opens an absolutely-
 * positioned list of action items. Click-outside / Esc close. This exists
 * to fold low-frequency chrome actions (rename / remove / delete) out of
 * the always-visible toolbar so it reads as a calm tool, not a cockpit of
 * a dozen text buttons.
 *
 * Mirrors Select's positioning + dismissal, with VS Code-style arrow-key
 * navigation for the action list.
 */

import {
  type CSSProperties,
  type JSX,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { color, font, radius, space, transition } from '../../style/design.js';
import { Codicon } from '../Codicon.js';
import { PopoverSurface, usePopover } from './Popover.js';

export interface MenuAction {
  readonly label: string;
  readonly onClick: () => void;
  /** Destructive actions render in the danger tone. */
  readonly danger?: boolean;
  readonly disabled?: boolean;
}

export interface MenuSeparator {
  readonly separator: true;
}

export type MenuItem = MenuAction | MenuSeparator;

interface MenuProps {
  readonly actions: readonly MenuItem[];
  readonly title?: string;
  /** Test hook for the Playwright driver — becomes `data-testid` on the trigger. */
  readonly testId?: string;
  /** Trigger content; defaults to the VS Code ellipsis codicon. */
  readonly label?: ReactNode;
  /** Anchor edge. `right` keeps the menu on-screen near a toolbar's right edge. */
  readonly align?: 'left' | 'right';
  readonly disabled?: boolean;
}

const overflowGlyph = <Codicon name="ellipsis" size={16} style={{ flexShrink: 0 }} />;

const isSeparator = (item: MenuItem): item is MenuSeparator => 'separator' in item;

const normalizeMenuItems = (items: readonly MenuItem[]): MenuItem[] => {
  const normalized: MenuItem[] = [];
  for (const item of items) {
    if (isSeparator(item)) {
      const previous = normalized[normalized.length - 1];
      if (previous === undefined || isSeparator(previous)) continue;
      normalized.push(item);
      continue;
    }
    normalized.push(item);
  }
  const last = normalized[normalized.length - 1];
  if (last !== undefined && isSeparator(last)) normalized.pop();
  return normalized;
};

const nearestLabel = (
  items: readonly MenuItem[],
  separatorIndex: number,
  direction: 1 | -1,
): string => {
  for (
    let index = separatorIndex + direction;
    index >= 0 && index < items.length;
    index += direction
  ) {
    const item = items[index];
    if (item !== undefined && !isSeparator(item)) return item.label;
  }
  return direction === -1 ? 'start' : 'end';
};

const menuItemKey = (items: readonly MenuItem[], item: MenuItem, index: number): string =>
  isSeparator(item)
    ? `separator-${nearestLabel(items, index, -1)}-${nearestLabel(items, index, 1)}`
    : `action-${item.label}`;

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
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const items = useMemo(() => normalizeMenuItems(actions), [actions]);
  const enabledIndexes = useMemo(
    () =>
      items
        .map((item, index) => (isSeparator(item) || item.disabled ? -1 : index))
        .filter((index) => index >= 0),
    [items],
  );

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      const first = enabledIndexes[0];
      if (first !== undefined) itemRefs.current[first]?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [enabledIndexes, open]);

  const focusMenuItem = (direction: 1 | -1 | 'first' | 'last'): void => {
    if (enabledIndexes.length === 0) return;
    const active = document.activeElement;
    const current = itemRefs.current.findIndex((node) => node === active);
    let next: number | undefined;
    if (direction === 'first') next = enabledIndexes[0];
    else if (direction === 'last') next = enabledIndexes[enabledIndexes.length - 1];
    else {
      const enabledPos = Math.max(0, enabledIndexes.indexOf(current));
      const wrapped = (enabledPos + direction + enabledIndexes.length) % enabledIndexes.length;
      next = enabledIndexes[wrapped];
    }
    if (next !== undefined) itemRefs.current[next]?.focus();
  };

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
        aria-label={title}
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
          {items.map((item, index) =>
            isSeparator(item) ? (
              <div
                key={menuItemKey(items, item, index)}
                role="separator"
                style={{
                  height: 1,
                  margin: `${space[1]}px ${space[1]}px`,
                  background: color.divider,
                }}
              />
            ) : (
              <button
                key={menuItemKey(items, item, index)}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    focusMenuItem(1);
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    focusMenuItem(-1);
                  } else if (e.key === 'Home') {
                    e.preventDefault();
                    focusMenuItem('first');
                  } else if (e.key === 'End') {
                    e.preventDefault();
                    focusMenuItem('last');
                  } else if (e.key === 'Tab') {
                    e.preventDefault();
                    focusMenuItem(e.shiftKey ? -1 : 1);
                  }
                }}
                onClick={() => {
                  close({ restoreFocus: true });
                  item.onClick();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  background: 'transparent',
                  color: item.disabled
                    ? color.textGhost
                    : item.danger
                      ? color.danger
                      : color.textPrimary,
                  padding: `${space[1.5]}px ${space[2]}px`,
                  fontSize: font.size.ui,
                  fontFamily: font.sans,
                  borderRadius: radius.sm,
                  cursor: item.disabled ? 'not-allowed' : 'pointer',
                  outline: 'none',
                  whiteSpace: 'nowrap',
                  transition: transition(['background']),
                }}
                onMouseEnter={(e) => {
                  if (!item.disabled)
                    e.currentTarget.style.background = item.danger
                      ? color.dangerSoft
                      : color.accentSofter;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </PopoverSurface>
      )}
    </div>
  );
};
