import { type JSX, type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react';
import { color, font, radius, space, transition } from '../design.js';
import { type TermNode, leafRects, splitDividers } from '../lib/terminalTree.js';
import { TERMINAL_MIN_WIDTH, useLayoutStore } from '../store/layout.js';
import { useTerminalStore } from '../store/terminal.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { TERMINAL_BG, TERMINAL_CHROME_BG, TerminalView } from './Terminal.js';

/**
 * The RIGHT-most region: a fixed home for the embedded terminal, modelled on
 * Ghostty — TABS, each holding a recursive SPLIT TREE of panes (one pty each).
 * Not the VS-Code tab strip: splits are first-class (⌘D right, ⌘⇧D down), with
 * ⌘[ ⌘] / ⌘⌥arrows to move focus, ⌘⌃arrows to resize, ⌘⇧↵ to zoom, ⌘T new tab,
 * ⌘⇧[ ⌘⇧] to switch tabs, ⌘W to close the focused split. The keymap only fires
 * while focus is in the dock (so it never steals the app's shortcuts).
 *
 * Every pane in every tab stays mounted (an inactive tab / unfocused split keeps
 * its agent running); visibility is CSS. Panes are absolutely positioned from
 * the tree geometry so a single mount per pane supports splits, zoom, and
 * draggable dividers without ever remounting (which would kill the pty).
 */
export const TerminalDock = (): JSX.Element => {
  const width = useLayoutStore((s) => s.terminalWidth);
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const setActiveTab = useTerminalStore((s) => s.setActiveTab);
  const newTab = useTerminalStore((s) => s.newTab);
  const closeTab = useTerminalStore((s) => s.closeTab);
  const setFocused = useTerminalStore((s) => s.setFocused);
  const titles = useTerminalStore((s) => s.titles);

  // Folding the workspace name into each pane's React key re-roots every shell
  // when the workspace switches (main resolves cwd from workspace.current at
  // spawn). Restart bumps a per-pane generation, also folded into the key.
  const workspaceKey = useWorkspaceStore((s) => s.current);
  const [gens, setGens] = useState<Record<string, number>>({});
  const restart = (leafId: string): void =>
    setGens((g) => ({ ...g, [leafId]: (g[leafId] ?? 0) + 1 }));

  useTerminalKeymap();

  // ⌘W (File ▸ Close Tab, owned by the main-process accelerator) closes the
  // focused split when the terminal is focused. The editor overlay yields via a
  // matching `focused` guard, so ⌘W never closes both.
  useEffect(
    () =>
      window.bh.onMenuCloseTab(() => {
        if (useTerminalStore.getState().focused) useTerminalStore.getState().closeFocusedLeaf();
      }),
    [],
  );

  return (
    <aside
      data-terminal-dock
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(e) => {
        // Focus left the dock entirely (not just moved between panes).
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
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
      <TermTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        titles={titles}
        onSelect={setActiveTab}
        onClose={closeTab}
        onAdd={newTab}
      />
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            style={{
              position: 'absolute',
              inset: 0,
              display: tab.id === activeTabId ? 'block' : 'none',
            }}
          >
            <TermPaneArea
              tab={tab}
              isActiveTab={tab.id === activeTabId}
              workspaceKey={workspaceKey}
              gens={gens}
              onRestart={restart}
            />
          </div>
        ))}
      </div>
    </aside>
  );
};

// ── One tab's split tree, absolutely positioned from the geometry ────────────
const DIVIDER_HIT = 6; // px grab strip over the 1px line

const TermPaneArea = ({
  tab,
  isActiveTab,
  workspaceKey,
  gens,
  onRestart,
}: {
  tab: { id: string; tree: TermNode; focusedLeafId: string };
  isActiveTab: boolean;
  workspaceKey: string | null;
  gens: Record<string, number>;
  onRestart: (leafId: string) => void;
}): JSX.Element => {
  const zoomedLeafId = useTerminalStore((s) => s.zoomedLeafId);
  const focusLeaf = useTerminalStore((s) => s.focusLeaf);
  const setTitle = useTerminalStore((s) => s.setTitle);
  const areaRef = useRef<HTMLDivElement | null>(null);
  const zoomed = isActiveTab ? zoomedLeafId : null;

  const rects = leafRects(tab.tree);
  const dividers = zoomed ? [] : splitDividers(tab.tree);

  return (
    <div ref={areaRef} style={{ position: 'absolute', inset: 0 }}>
      {[...rects.entries()].map(([leafId, r]) => {
        const isFocused = isActiveTab && leafId === tab.focusedLeafId;
        // When zoomed, the zoomed pane fills the area; the rest stay mounted but
        // hidden (their ptys keep running).
        const full = zoomed === leafId;
        const hidden = zoomed != null && !full;
        const pos = full
          ? { left: 0, top: 0, width: '100%', height: '100%' }
          : {
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: `${r.w * 100}%`,
              height: `${r.h * 100}%`,
            };
        return (
          <div
            key={leafId}
            onMouseDownCapture={() => {
              if (!isFocused) focusLeaf(tab.id, leafId);
            }}
            style={{
              position: 'absolute',
              ...pos,
              display: hidden ? 'none' : 'flex',
              padding: 3,
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                position: 'relative',
                // display:flex so the child TerminalView's flex:1 actually fills
                // this box — without it the terminal collapses to a 1-row sliver.
                display: 'flex',
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                borderRadius: radius.sm,
                overflow: 'hidden',
                // The focused split wears a subtle accent ring (Ghostty's
                // split-focus cue) — only meaningful with more than one pane.
                boxShadow:
                  isFocused && tab.tree.type !== 'leaf'
                    ? `inset 0 0 0 1px ${color.accent}`
                    : 'none',
              }}
            >
              <TerminalView
                key={`${leafId}:${workspaceKey ?? 'none'}:${gens[leafId] ?? 0}`}
                active={isFocused}
                onRestart={() => onRestart(leafId)}
                onTitle={(t) => setTitle(leafId, t)}
              />
            </div>
          </div>
        );
      })}
      {dividers.map((d) => (
        <PaneDivider key={d.splitId} divider={d} areaRef={areaRef} />
      ))}
    </div>
  );
};

const PaneDivider = ({
  divider,
  areaRef,
}: {
  divider: { splitId: string; dir: 'row' | 'column'; rect: { x: number; y: number } };
  areaRef: React.RefObject<HTMLDivElement | null>;
}): JSX.Element => {
  const setSplitFraction = useTerminalStore((s) => s.setSplitFraction);
  const [active, setActive] = useState(false);
  const [hover, setHover] = useState(false);
  const row = divider.dir === 'row'; // vertical line, horizontal drag

  const onMouseDown = (e: ReactMouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setActive(true);
    const onMove = (ev: MouseEvent): void => {
      const area = areaRef.current;
      if (!area) return;
      const box = area.getBoundingClientRect();
      // Fraction of the WHOLE area; the split's fraction is of its own subrect,
      // but at the top level (the common case) they coincide. For nested splits
      // this is a close-enough drag — clamped by setFraction.
      const f = row ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height;
      setSplitFraction(divider.splitId, f);
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

  const lit = active ? color.accent : hover ? color.borderStrong : 'transparent';
  return (
    <div
      onMouseDown={onMouseDown}
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

// ── Tab strip ────────────────────────────────────────────────────────────────
// Modelled on Ghostty's tab bar (window-show-tab-bar = auto):
//   • Hidden entirely with a single tab — one terminal needs no strip (⌘T still
//     makes a new one). It appears only once there are 2+.
//   • WIDE tabs: each fills an equal share of the strip (gtk-wide-tabs = true),
//     rectangular, no rounded "browser tab" tops.
//   • Active vs inactive is conveyed by ELEVATION, not a top accent line — the
//     active tab sits at the terminal background (raised, bright text); inactive
//     tabs recede to the darker chrome tone with dimmed text.
//   • The close ✕ is revealed on hover or for the active tab, not always-on.
//   • Each tab is named by its focused pane's live title (the running program),
//     falling back to "Terminal".
const TAB_BAR_HEIGHT = 32;

const TermTabBar = ({
  tabs,
  activeTabId,
  titles,
  onSelect,
  onClose,
  onAdd,
}: {
  tabs: { id: string; focusedLeafId: string }[];
  activeTabId: string;
  titles: Record<string, string>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
}): JSX.Element | null => {
  // Ghostty's `auto`: no strip while there's a single terminal.
  if (tabs.length <= 1) return null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: TAB_BAR_HEIGHT,
        flexShrink: 0,
        background: TERMINAL_CHROME_BG,
        borderBottom: `1px solid ${color.border}`,
        overflow: 'hidden',
      }}
    >
      {tabs.map((t, i) => (
        <TermTab
          key={t.id}
          title={titles[t.focusedLeafId] ?? 'Terminal'}
          active={t.id === activeTabId}
          first={i === 0}
          onSelect={() => onSelect(t.id)}
          onClose={() => onClose(t.id)}
        />
      ))}
      <button
        type="button"
        title="New terminal tab (⌘T)"
        aria-label="New terminal tab"
        onClick={onAdd}
        style={{
          flexShrink: 0,
          width: TAB_BAR_HEIGHT,
          border: 'none',
          background: 'transparent',
          color: color.textTertiary,
          cursor: 'pointer',
          fontSize: 17,
          lineHeight: 1,
        }}
      >
        +
      </button>
    </div>
  );
};

const TermTab = ({
  title,
  active,
  first,
  onSelect,
  onClose,
}: {
  title: string;
  active: boolean;
  first: boolean;
  onSelect: () => void;
  onClose: () => void;
}): JSX.Element => {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseDown={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        // Equal share of the strip — Ghostty's wide tabs.
        flex: 1,
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space[1],
        padding: `0 ${space[2]}px`,
        cursor: 'default',
        userSelect: 'none',
        fontFamily: font.sans,
        fontSize: font.size.caption,
        color: active ? '#ffffff' : color.textTertiary,
        // Elevation cue: active rises to the terminal surface; inactive recedes.
        background: active ? TERMINAL_BG : 'transparent',
        // A hairline divider before each tab but the first, so adjacent inactive
        // tabs read as distinct without a heavy border.
        boxShadow: first || active ? 'none' : `inset 1px 0 0 ${color.border}`,
        transition: transition(['color', 'background']),
      }}
    >
      <span
        style={{
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {title}
      </span>
      <button
        type="button"
        title="Close tab"
        aria-label="Close tab"
        onMouseDown={(e) => {
          e.stopPropagation();
          onClose();
        }}
        style={{
          flexShrink: 0,
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
          // Revealed on hover or for the active tab (Ghostty/macOS behaviour).
          opacity: hover || active ? 0.75 : 0,
          transition: transition(['opacity']),
        }}
      >
        ×
      </button>
    </div>
  );
};

// ── Ghostty keymap, scoped to terminal focus ─────────────────────────────────
function useTerminalKeymap(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.metaKey) return;
      const s = useTerminalStore.getState();
      if (!s.focused) return; // only when the terminal owns focus
      const k = e.key.toLowerCase();
      // Pick the matching Ghostty action, if any.
      let action: (() => void) | null = null;
      const dir =
        e.key === 'ArrowLeft'
          ? 'left'
          : e.key === 'ArrowRight'
            ? 'right'
            : e.key === 'ArrowUp'
              ? 'up'
              : e.key === 'ArrowDown'
                ? 'down'
                : null;
      if (k === 't' && !e.shiftKey && !e.altKey && !e.ctrlKey) {
        action = s.newTab; // ⌘T new tab
      } else if (k === 'd' && !e.altKey && !e.ctrlKey) {
        action = () => s.splitFocused(e.shiftKey ? 'down' : 'right'); // ⌘D / ⌘⇧D
      } else if (e.key === 'Enter' && e.shiftKey) {
        action = s.toggleZoom; // ⌘⇧↵
      } else if (e.code === 'BracketLeft') {
        action = () => (e.shiftKey ? s.switchTab(-1) : s.gotoRing(-1)); // ⌘⇧[ / ⌘[
      } else if (e.code === 'BracketRight') {
        action = () => (e.shiftKey ? s.switchTab(1) : s.gotoRing(1)); // ⌘⇧] / ⌘]
      } else if (dir && e.altKey && !e.ctrlKey) {
        action = () => s.gotoDir(dir); // ⌘⌥arrow move focus
      } else if (dir && e.ctrlKey && !e.altKey) {
        action = () => s.resizeFocused(dir); // ⌘⌃arrow resize
      }
      if (!action) return;
      e.preventDefault();
      e.stopImmediatePropagation(); // beat xterm's own key handler
      action();
    };
    // Capture phase so we win before xterm's textarea handler sees the key.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

// ── The dock's left-edge resize sash ─────────────────────────────────────────
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
