import {
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import { color, font, radius, space, transition } from '../../../browser/style/design.js';
import { useTerminalStore } from './terminalStore.js';
import { TERMINAL_BG } from './terminalTheme.js';

const DIVIDER_HIT = 6;
const MIN_PANE_PX = 48;

export const TerminalPaneDivider = ({
  divider,
  areaRef,
}: {
  divider: {
    splitId: string;
    dir: 'row' | 'column';
    rect: { x: number; y: number };
    bounds: { x: number; y: number; w: number; h: number };
  };
  areaRef: RefObject<HTMLDivElement | null>;
}): JSX.Element => {
  const setSplitFraction = useTerminalStore((s) => s.setSplitFraction);
  const [active, setActive] = useState(false);
  const [hover, setHover] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const row = divider.dir === 'row';
  const fraction =
    row && divider.bounds.w > 0
      ? (divider.rect.x - divider.bounds.x) / divider.bounds.w
      : !row && divider.bounds.h > 0
        ? (divider.rect.y - divider.bounds.y) / divider.bounds.h
        : 0.5;

  const onMouseDown = (event: ReactMouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    setActive(true);
    const onMove = (moveEvent: MouseEvent): void => {
      const area = areaRef.current;
      if (!area) return;
      const box = area.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      const bounds = divider.bounds;
      const areaFrac = row
        ? (moveEvent.clientX - box.left) / box.width
        : (moveEvent.clientY - box.top) / box.height;
      const span = row ? bounds.w : bounds.h;
      const origin = row ? bounds.x : bounds.y;
      let local = span > 0 ? (areaFrac - origin) / span : 0.5;
      const splitPx = span * (row ? box.width : box.height);
      const floor = splitPx > 0 ? Math.min(0.45, MIN_PANE_PX / splitPx) : 0.1;
      local = Math.max(floor, Math.min(1 - floor, local));
      setSplitFraction(divider.splitId, local);
    };
    const onUp = (): void => {
      setActive(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = row ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const onKeyDown = (event: ReactKeyboardEvent): void => {
    let next: number | null = null;
    if (row && event.key === 'ArrowLeft') next = fraction - 0.05;
    else if (row && event.key === 'ArrowRight') next = fraction + 0.05;
    else if (!row && event.key === 'ArrowUp') next = fraction - 0.05;
    else if (!row && event.key === 'ArrowDown') next = fraction + 0.05;
    else if (event.key === 'Home') next = 0.1;
    else if (event.key === 'End') next = 0.9;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    setSplitFraction(divider.splitId, next);
  };

  const lit =
    active || keyboardFocus ? color.accent : hover ? color.borderStrong : 'rgba(255,255,255,0.07)';
  return (
    <div
      role="separator"
      aria-label="Resize terminal panes"
      aria-orientation={row ? 'vertical' : 'horizontal'}
      aria-valuemin={10}
      aria-valuemax={90}
      aria-valuenow={Math.round(fraction * 100)}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => setSplitFraction(divider.splitId, 0.5)}
      onFocus={() => setKeyboardFocus(true)}
      onBlur={() => setKeyboardFocus(false)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'absolute',
        cursor: row ? 'col-resize' : 'row-resize',
        zIndex: 3,
        ...(row
          ? {
              left: `${divider.rect.x * 100}%`,
              top: 0,
              height: '100%',
              width: DIVIDER_HIT,
              transform: `translateX(-${DIVIDER_HIT / 2}px)`,
            }
          : {
              top: `${divider.rect.y * 100}%`,
              left: 0,
              width: '100%',
              height: DIVIDER_HIT,
              transform: `translateY(-${DIVIDER_HIT / 2}px)`,
            }),
      }}
    >
      <div
        style={{
          position: 'absolute',
          background: lit,
          transition: active ? 'none' : transition(['background']),
          ...(row
            ? { left: '50%', top: 0, bottom: 0, width: 1, transform: 'translateX(-0.5px)' }
            : { top: '50%', left: 0, right: 0, height: 1, transform: 'translateY(-0.5px)' }),
        }}
      />
    </div>
  );
};

export const TerminalResizeHud = ({
  paneId,
  rect,
  dims,
}: {
  paneId: string | undefined;
  rect: { x: number; y: number; w: number; h: number } | undefined;
  dims: Record<string, { cols: number; rows: number }>;
}): JSX.Element | null => {
  const resizeTick = useTerminalStore((s) => s.resizeTick);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const [show, setShow] = useState(false);
  const prevTick = useRef(resizeTick);
  useEffect(() => {
    if (resizeTick === prevTick.current) return;
    prevTick.current = resizeTick;
    setShow(true);
    const id = window.setTimeout(() => setShow(false), 750);
    return () => window.clearTimeout(id);
  }, [resizeTick]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: hide on tab change only
  useEffect(() => setShow(false), [activeTabId]);
  const dim = paneId ? dims[paneId] : undefined;
  if (!show || !dim || !rect) return null;
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: `${(rect.x + rect.w / 2) * 100}%`,
        top: `${(rect.y + rect.h / 2) * 100}%`,
        transform: 'translate(-50%, -50%)',
        padding: `${space[1]}px ${space[3]}px`,
        background: 'rgba(0,0,0,0.72)',
        color: '#fff',
        fontFamily: font.mono,
        fontSize: font.size.ui,
        borderRadius: radius.md,
        pointerEvents: 'none',
        zIndex: 6,
      }}
    >
      {dim.cols} × {dim.rows}
    </div>
  );
};

export const TerminalZoomBadge = (): JSX.Element => (
  <div
    aria-hidden
    style={{
      position: 'absolute',
      right: space[2],
      bottom: space[2],
      padding: `2px ${space[2]}px`,
      background: 'rgba(0,0,0,0.6)',
      color: color.textSecondary,
      fontFamily: font.sans,
      fontSize: font.size.micro,
      borderRadius: radius.sm,
      pointerEvents: 'none',
      zIndex: 6,
    }}
  >
    zoomed · ⌘⇧↵
  </div>
);

export const TerminalUnfocusedOverlay = (): JSX.Element => (
  <div
    aria-hidden
    style={{
      position: 'absolute',
      inset: 0,
      background: TERMINAL_BG,
      opacity: 0.32,
      pointerEvents: 'none',
      zIndex: 1,
    }}
  />
);
