import { type JSX, type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react';
import { color, font, radius, space, transition } from '../design.js';
import { TERMINAL_MIN_WIDTH, useLayoutStore } from '../store/layout.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { TERMINAL_BG, TERMINAL_CHROME_BG, TerminalView } from './Terminal.js';

interface Session {
  /** Stable id — tracks which tab is active across add/close, independent of
   *  array position. (The TerminalView's React *key* is a composite that also
   *  folds in the workspace + restart generation, so a re-root or a Restart
   *  remounts the view — the idiomatic way to reset it — while this id stays put.) */
  key: string;
  label: string;
  /** Bumped by Restart to remount this session's TerminalView (fresh pty). */
  gen: number;
}

/**
 * The RIGHT-most region: a fixed home for the embedded terminal — where TUI
 * agents (Claude Code, Codex) run. Always present (unlike the editor, which
 * comes and goes); drag its left sash to rebalance against the canvas.
 *
 * Tabs let several shells run side by side (one agent each). Every session stays
 * mounted so a background agent keeps running while you look at another tab —
 * only the active one is visible (an inactive xterm is display:none, where it
 * can't measure itself; TerminalView refits on re-show).
 */
export const TerminalDock = (): JSX.Element => {
  const width = useLayoutStore((s) => s.terminalWidth);
  // The active workspace name. Folding it into each TerminalView's key remounts
  // the shells when the workspace switches, so they re-root at the new
  // workspace's path (main resolves cwd from workspace.current at spawn time).
  const workspaceKey = useWorkspaceStore((s) => s.current);

  const seq = useRef(1);
  const [sessions, setSessions] = useState<Session[]>(() => [
    { key: 't1', label: 'Terminal', gen: 0 },
  ]);
  const [activeKey, setActiveKey] = useState('t1');

  const addSession = (): void => {
    seq.current += 1;
    const key = `t${seq.current}`;
    setSessions((prev) => [...prev, { key, label: 'Terminal', gen: 0 }]);
    setActiveKey(key);
  };

  const restartSession = (key: string): void => {
    setSessions((prev) => prev.map((s) => (s.key === key ? { ...s, gen: s.gen + 1 } : s)));
  };

  const closeSession = (key: string): void => {
    setSessions((prev) => {
      if (prev.length <= 1) return prev; // keep at least one terminal
      const idx = prev.findIndex((s) => s.key === key);
      const next = prev.filter((s) => s.key !== key);
      // If the closed tab was active, fall to its neighbour.
      if (key === activeKey) {
        const fallback = next[Math.max(0, idx - 1)];
        if (fallback) setActiveKey(fallback.key);
      }
      return next;
    });
  };

  return (
    <aside
      style={{
        position: 'relative',
        flexShrink: 0,
        width,
        height: '100%',
        borderLeft: `1px solid ${color.border}`,
        background: TERMINAL_BG,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <TerminalSash />
      <TerminalTabs
        sessions={sessions}
        activeKey={activeKey}
        onSelect={setActiveKey}
        onClose={closeSession}
        onAdd={addSession}
      />
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
        {sessions.map((s) => (
          // The composite key (id + workspace + restart gen) makes a workspace
          // switch or a Restart remount the view → fresh pty at the right root.
          <div
            key={`${s.key}:${workspaceKey ?? 'none'}:${s.gen}`}
            style={{
              position: 'absolute',
              inset: 0,
              display: s.key === activeKey ? 'flex' : 'none',
            }}
          >
            <TerminalView active={s.key === activeKey} onRestart={() => restartSession(s.key)} />
          </div>
        ))}
      </div>
    </aside>
  );
};

const TerminalTabs = ({
  sessions,
  activeKey,
  onSelect,
  onClose,
  onAdd,
}: {
  sessions: Session[];
  activeKey: string;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onAdd: () => void;
}): JSX.Element => {
  const multiple = sessions.length > 1;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: 34,
        flexShrink: 0,
        background: TERMINAL_CHROME_BG,
        borderBottom: `1px solid ${color.border}`,
        paddingLeft: space[1],
        gap: 2,
        overflow: 'hidden',
      }}
    >
      {sessions.map((s, i) => {
        const isActive = s.key === activeKey;
        return (
          <div
            key={s.key}
            onMouseDown={() => onSelect(s.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: space[1],
              padding: `0 ${space[2]}px`,
              maxWidth: 160,
              cursor: 'default',
              userSelect: 'none',
              fontFamily: font.sans,
              fontSize: font.size.caption,
              color: isActive ? '#ffffff' : color.textTertiary,
              background: isActive ? TERMINAL_BG : 'transparent',
              borderTop: `2px solid ${isActive ? color.accent : 'transparent'}`,
              transition: transition(['color', 'background']),
            }}
          >
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.label}
              {multiple ? ` ${i + 1}` : ''}
            </span>
            {multiple && (
              <button
                type="button"
                title="Close terminal"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  onClose(s.key);
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                  fontSize: 13,
                  lineHeight: 1,
                  padding: 0,
                  width: 16,
                  height: 16,
                  borderRadius: radius.sm,
                  opacity: 0.7,
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        title="New terminal"
        onClick={onAdd}
        style={{
          border: 'none',
          background: 'transparent',
          color: color.textTertiary,
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          padding: `0 ${space[2]}px`,
        }}
      >
        +
      </button>
    </div>
  );
};

// The terminal dock's left-edge grab strip: drag left to widen (narrower
// canvas), right to narrow. Mirrors EditorSash — a 6px hit area over a 2px
// accent line that lights on hover / drag.
const TerminalSash = (): JSX.Element => {
  const terminalWidth = useLayoutStore((s) => s.terminalWidth);
  const setTerminalWidth = useLayoutStore((s) => s.setTerminalWidth);
  const [active, setActive] = useState(false);
  const [hover, setHover] = useState(false);

  const onMouseDown = (e: ReactMouseEvent): void => {
    e.preventDefault();
    setActive(true);
    const startX = e.clientX;
    const startWidth = terminalWidth;
    const onMove = (ev: MouseEvent): void => {
      // Dock is on the right: pointer moving LEFT (clientX decreases) widens it.
      setTerminalWidth(Math.max(TERMINAL_MIN_WIDTH, startWidth - (ev.clientX - startX)));
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

  return (
    <div
      onMouseDown={onMouseDown}
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
        zIndex: 5,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 2,
          height: '100%',
          background: active ? color.accent : hover ? color.borderStrong : 'transparent',
          transition: active ? 'none' : transition(['background']),
        }}
      />
    </div>
  );
};
