import {
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useState,
} from 'react';
import { TERMINAL_MIN_WIDTH, useLayoutStore } from '../../../browser/layout/layoutStore.js';
import { color, transition } from '../../../browser/style/design.js';

export const TerminalSash = (): JSX.Element => {
  const terminalWidth = useLayoutStore((s) => s.terminalWidth);
  const setTerminalWidth = useLayoutStore((s) => s.setTerminalWidth);
  const [active, setActive] = useState(false);
  const [hover, setHover] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);

  const onMouseDown = (event: ReactMouseEvent): void => {
    event.preventDefault();
    setActive(true);
    const startX = event.clientX;
    const startWidth = terminalWidth;
    const onMove = (moveEvent: MouseEvent): void => {
      setTerminalWidth(Math.max(TERMINAL_MIN_WIDTH, startWidth - (moveEvent.clientX - startX)));
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
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onKeyDown = (event: ReactKeyboardEvent): void => {
    const step = event.shiftKey ? 40 : 16;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = terminalWidth + step;
    else if (event.key === 'ArrowRight') next = terminalWidth - step;
    else if (event.key === 'Home') next = TERMINAL_MIN_WIDTH;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    setTerminalWidth(next);
  };

  return (
    <div
      role="separator"
      aria-label="Resize terminal dock"
      aria-orientation="vertical"
      aria-valuemin={TERMINAL_MIN_WIDTH}
      aria-valuenow={terminalWidth}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
      onFocus={() => setKeyboardFocus(true)}
      onBlur={() => setKeyboardFocus(false)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Drag to resize"
      data-testid="terminal-sash"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: 6,
        height: '100%',
        cursor: 'col-resize',
        zIndex: 10,
        transform: 'translateX(-3px)',
        background: active || hover || keyboardFocus ? color.accent : 'transparent',
        transition: active ? 'none' : transition(['background']),
      }}
    />
  );
};
