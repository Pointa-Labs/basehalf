/**
 * Popover — the shared anchored-popover engine behind Select and Menu.
 *
 * It owns the one thing those two got wrong independently: a dropdown anchored
 * to a trigger that lives inside the toolbar's `overflow:hidden` row gets
 * *clipped* when it's positioned `absolute` (the panel extends below the 48px
 * header, which hides the overflow). Menu had patched around this with a
 * hand-rolled `position:fixed`; Select never did, so its menu was clipped to a
 * sliver. Rather than copy the patch a third time, the escape lives here ONCE:
 *
 *   - measure the trigger in viewport coords (`getBoundingClientRect`), and
 *   - render the panel `position:fixed` in a portal to <body>,
 *
 * so no ancestor's overflow / stacking context can clip it — now or in any
 * future container. The panel re-measures on scroll (the toolbar scrolls
 * horizontally) and on resize so it stays glued to its trigger.
 *
 * Shared concerns only: open-state, positioning, and dismissal (outside-click
 * + Esc). Component-specific behaviour (Select's arrow-key roving, Menu's
 * hover tones) stays in the components.
 */

import {
  type CSSProperties,
  type JSX,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { color, radius, shadow, space } from '../../design.js';

export type PopoverAlign = 'left' | 'right';

export interface PopoverCoords {
  readonly top: number;
  /** Set when anchored to the trigger's left edge (`align: 'left'`). */
  readonly left?: number;
  /** Set when anchored to the trigger's right edge (`align: 'right'`). */
  readonly right?: number;
  /** The trigger's width, so callers can match the panel's min-width to it. */
  readonly width: number;
}

export interface PopoverController {
  readonly open: boolean;
  readonly openPopover: () => void;
  readonly close: () => void;
  readonly toggle: () => void;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly floatingRef: RefObject<HTMLDivElement | null>;
  readonly coords: PopoverCoords | null;
}

interface UsePopoverOptions {
  readonly align?: PopoverAlign;
  /** Gap in px between the trigger's bottom and the panel's top. */
  readonly gap?: number;
  readonly disabled?: boolean;
}

export const usePopover = ({
  align = 'left',
  gap = 4,
  disabled = false,
}: UsePopoverOptions = {}): PopoverController => {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<PopoverCoords | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const floatingRef = useRef<HTMLDivElement | null>(null);

  const reposition = useCallback((): void => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    setCoords(
      align === 'right'
        ? { top: r.bottom + gap, right: Math.max(0, window.innerWidth - r.right), width: r.width }
        : { top: r.bottom + gap, left: r.left, width: r.width },
    );
  }, [align, gap]);

  const openPopover = useCallback((): void => {
    if (disabled) return;
    // Measure synchronously so coords land in the SAME render as open=true
    // (React batches both setstates) — the panel never paints at (0,0) first.
    reposition();
    setOpen(true);
  }, [disabled, reposition]);

  const close = useCallback((): void => setOpen(false), []);

  const toggle = useCallback((): void => {
    if (open) setOpen(false);
    else openPopover();
  }, [open, openPopover]);

  // While open: dismiss on outside-click / Esc, and stay glued to the trigger
  // on scroll / resize.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || floatingRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    // capture:true — scroll events don't bubble, so we catch the toolbar's
    // own horizontal scroll (overflow-x:auto) in the capture phase and follow.
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition]);

  return { open, openPopover, close, toggle, triggerRef, floatingRef, coords };
};

interface PopoverSurfaceProps {
  readonly coords: PopoverCoords | null;
  readonly floatingRef: RefObject<HTMLDivElement | null>;
  readonly role: 'listbox' | 'menu';
  /** Panel-specific style (min-width, max-height, overflow). */
  readonly style?: CSSProperties;
  readonly children: ReactNode;
}

/**
 * PopoverSurface — the floating panel itself: a fixed-position box portaled to
 * <body>, carrying the shared chrome (surface, border, shadow, enter
 * animation). Callers pass the role + any sizing style and the panel body.
 * Renders nothing until `coords` exist (set the instant the popover opens).
 */
export const PopoverSurface = ({
  coords,
  floatingRef,
  role,
  style,
  children,
}: PopoverSurfaceProps): JSX.Element | null => {
  if (!coords) return null;
  const positioned: CSSProperties = {
    position: 'fixed',
    top: coords.top,
    ...(coords.left !== undefined ? { left: coords.left } : { right: coords.right ?? 0 }),
    background: color.surface,
    border: `1px solid ${color.borderStrong}`,
    borderRadius: radius.lg,
    boxShadow: shadow.raised,
    padding: space[1],
    zIndex: 50,
    animation: 'bh-menu-in 120ms cubic-bezier(0.16, 1, 0.3, 1)',
    ...style,
  };
  return createPortal(
    <div ref={floatingRef} role={role} style={positioned}>
      {children}
    </div>,
    document.body,
  );
};
