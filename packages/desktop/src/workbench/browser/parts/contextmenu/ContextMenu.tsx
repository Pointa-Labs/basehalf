/**
 * ContextMenuHost — the one floating menu the whole app shares.
 *
 * Generalizes the point-anchored pattern TerminalDock pioneered (TabContextMenu):
 * a portal to <body>, a full-viewport backdrop that dismisses on mousedown /
 * right-click, and a fixed-position menu clamped to stay on-screen. Driven by
 * the global context-menu store, so every surface opens it the same way and the
 * styling/dismissal lives in ONE place. Mounted once at the Workbench root.
 *
 * z-index sits ABOVE popovers (50) and BELOW dialogs (100): a right-click menu
 * should cover an open Select/Menu, but a confirm dialog it spawns covers it.
 */

import {
  type CSSProperties,
  type JSX,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  contextMenuService,
  useContextMenuStore,
} from '../../../../platform/contextview/browser/contextMenuService.js';
import {
  type ContextMenuItem,
  isContextMenuSeparator,
} from '../../../../platform/contextview/common/contextMenu.js';
import { clampContextMenuPosition } from '../../../../platform/contextview/common/contextMenuPosition.js';
import { color, font, radius, shadow, space, transition } from '../../style/design.js';

const MENU_MIN_WIDTH = 200;

export const ContextMenuHost = (): JSX.Element | null => {
  const open = useContextMenuStore((s) => s.open);
  const x = useContextMenuStore((s) => s.x);
  const y = useContextMenuStore((s) => s.y);
  const items = useContextMenuStore((s) => s.items);

  const menuRef = useRef<HTMLDivElement>(null);
  // Start at the cursor; a layout effect nudges it inward if it would overflow.
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  // Re-seed to the new cursor point each time the menu (re)opens.
  useLayoutEffect(() => {
    if (!open) return;
    setPos({ left: x, top: y });
  }, [open, x, y]);

  // After the menu paints, measure it and clamp so it never spills off-screen
  // (open near the right/bottom edge → flip inward), mirroring TabContextMenu's
  // clamp but measured rather than estimated so any menu height works. Keyed on
  // (open, x, y): every right-click closes any prior menu and re-opens at a new
  // point, so this re-runs and re-measures with the current items.
  useLayoutEffect(() => {
    if (!open) return;
    const el = menuRef.current;
    if (!el) return;
    const { left, top } = clampContextMenuPosition(
      x,
      y,
      el.offsetWidth,
      el.offsetHeight,
      window.innerWidth,
      window.innerHeight,
    );
    setPos((prev) => (prev.left === left && prev.top === top ? prev : { left, top }));
  }, [open, x, y]);

  const closeMenu = useCallback(
    (options?: { readonly didCancel?: boolean; readonly restoreFocus?: boolean }): void => {
      contextMenuService.closeContextMenu({
        didCancel: options?.didCancel ?? true,
        restoreFocus: options?.restoreFocus,
      });
    },
    [],
  );

  // Esc closes (capture phase + stopPropagation so it doesn't also close an
  // editor tab underneath — same reasoning as usePopover).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.isComposing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeMenu({ didCancel: true, restoreFocus: true });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [closeMenu, open]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const focusMenuItem = (direction: 1 | -1 | 'first' | 'last'): void => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    );
    if (buttons.length === 0) return;
    const current = buttons.findIndex((button) => button === document.activeElement);
    const next =
      direction === 'first'
        ? 0
        : direction === 'last'
          ? buttons.length - 1
          : (Math.max(0, current) + direction + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  if (!open) return null;

  return createPortal(
    <>
      {/* Backdrop: catches an outside click (and a second right-click) to dismiss. */}
      <div
        onMouseDown={() => closeMenu()}
        onContextMenu={(e) => {
          e.preventDefault();
          closeMenu();
        }}
        style={{ position: 'fixed', inset: 0, zIndex: 90 }}
      />
      <div
        ref={menuRef}
        role="menu"
        data-testid="context-menu"
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
        style={{
          position: 'fixed',
          left: pos.left,
          top: pos.top,
          zIndex: 91,
          minWidth: MENU_MIN_WIDTH,
          maxWidth: 320,
          background: color.surface,
          border: `1px solid ${color.borderStrong}`,
          borderRadius: radius.md,
          padding: space[1],
          boxShadow: shadow.floating,
          animation: 'bh-menu-in 120ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {items.map((item, idx) => (
          <MenuRow
            // separators have no id; index is stable for the lifetime of one open menu
            key={isContextMenuSeparator(item) ? `sep-${idx}` : item.id}
            item={item}
            onRun={() => closeMenu({ didCancel: false, restoreFocus: true })}
          />
        ))}
      </div>
    </>,
    document.body,
  );
};

const MenuRow = ({
  item,
  onRun,
}: {
  item: ContextMenuItem;
  onRun: () => void;
}): JSX.Element => {
  if (isContextMenuSeparator(item)) {
    return (
      <div
        role="separator"
        style={{ height: 1, background: color.border, margin: `${space[1]}px 0` }}
      />
    );
  }
  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: space[2],
    width: '100%',
    textAlign: 'left',
    border: 'none',
    background: 'transparent',
    color: item.disabled ? color.textGhost : item.danger ? color.danger : color.textPrimary,
    padding: `${space[1.5]}px ${space[2]}px`,
    fontSize: font.size.ui,
    fontFamily: font.sans,
    borderRadius: radius.sm,
    cursor: item.disabled ? 'not-allowed' : 'pointer',
    outline: 'none',
    whiteSpace: 'nowrap',
    transition: transition(['background']),
  };
  return (
    <button
      type="button"
      role="menuitem"
      disabled={item.disabled}
      data-testid={`context-menu-item-${item.id}`}
      // mousedown is what the backdrop listens on; stop it so clicking an item
      // runs the action instead of being eaten as an outside-click dismiss.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => {
        if (item.disabled) return;
        onRun();
        item.run();
      }}
      onMouseEnter={(e) => {
        if (!item.disabled)
          e.currentTarget.style.background = item.danger ? color.dangerSoft : color.divider;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
      style={rowStyle}
    >
      {item.icon !== undefined && (
        <span style={{ display: 'inline-flex', flexShrink: 0 }}>{item.icon as ReactNode}</span>
      )}
      <span style={{ flex: 1 }}>{item.label}</span>
    </button>
  );
};
