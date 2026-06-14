import { type JSX, type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { color, font, radius, shadow, space, transition } from '../design.js';
import {
  type FocusDir,
  type TermNode,
  dropEdge,
  leafRects,
  splitDividers,
} from '../lib/terminalTree.js';
import { TERMINAL_MIN_WIDTH, useLayoutStore } from '../store/layout.js';
import { useTerminalStore } from '../store/terminal.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { TERMINAL_BG, TERMINAL_CHROME_BG, TerminalView } from './Terminal.js';

/**
 * The RIGHT-most region: a fixed home for the embedded terminal — TABS, each
 * holding a recursive SPLIT TREE of panes (one pty each). Splits are first-class
 * (⌘D right, ⌘⇧D down), with ⌘[ ⌘] / ⌘⌥arrows to move focus, ⌘⌃arrows to resize,
 * ⌘⇧↵ to zoom, ⌘T new tab, ⌘⇧[ ⌘⇧] to switch tabs, ⌘W to close the focused
 * split. The keymap only fires while focus is in the dock (so it never steals
 * the app's shortcuts).
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
  const closeOtherTabs = useTerminalStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useTerminalStore((s) => s.closeTabsToRight);
  const setFocused = useTerminalStore((s) => s.setFocused);
  const titles = useTerminalStore((s) => s.titles);
  const activity = useTerminalStore((s) => s.activity);
  const closing = useTerminalStore((s) => s.closing);
  const zoomed = useTerminalStore((s) => s.zoomedLeafId != null);
  const toggleZoom = useTerminalStore((s) => s.toggleZoom);
  const reorderTab = useTerminalStore((s) => s.reorderTab);
  const setTabTitle = useTerminalStore((s) => s.setTabTitle);

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

  const liveIds = new Set(tabs.map((t) => t.id));

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
        activity={activity}
        zoomed={zoomed}
        onSelect={setActiveTab}
        onClose={closeTab}
        onCloseOthers={closeOtherTabs}
        onCloseToRight={closeTabsToRight}
        onAdd={newTab}
        onReorder={reorderTab}
        onRename={setTabTitle}
        onResetZoom={toggleZoom}
      />
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {/* Live tabs + soft-closed ones (hidden) rendered in ONE keyed list, so
            moving a tab between the two never remounts it — that keeps its panes'
            ptys alive for undo (and kills them only on finalize). */}
        {[...tabs, ...closing.map((c) => c.tab)].map((tab) => {
          const visible = liveIds.has(tab.id) && tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              style={{ position: 'absolute', inset: 0, display: visible ? 'block' : 'none' }}
            >
              <TermPaneArea
                tab={tab}
                isActiveTab={visible}
                workspaceKey={workspaceKey}
                gens={gens}
                onRestart={restart}
              />
            </div>
          );
        })}
      </div>
      <TerminalCloseToasts />
    </aside>
  );
};

// ── One tab's split tree, absolutely positioned from the geometry ────────────
const DIVIDER_HIT = 6; // px grab strip over the 1px line
const MIN_PANE_PX = 48; // smallest a pane may be dragged to (absolute floor)

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
  const areaRef = useRef<HTMLDivElement | null>(null);
  const zoomed = isActiveTab ? zoomedLeafId : null;

  const rects = leafRects(tab.tree);
  const dividers = zoomed ? [] : splitDividers(tab.tree);
  const isSplit = tab.tree.type !== 'leaf';

  return (
    <div ref={areaRef} style={{ position: 'absolute', inset: 0 }}>
      {[...rects.entries()].map(([leafId, r]) => (
        <TermPane
          key={leafId}
          tab={tab}
          leafId={leafId}
          r={r}
          isActiveTab={isActiveTab}
          isSplit={isSplit}
          zoomed={zoomed}
          workspaceKey={workspaceKey}
          gen={gens[leafId] ?? 0}
          onRestart={onRestart}
        />
      ))}
      {dividers.map((d) => (
        <PaneDivider key={d.splitId} divider={d} areaRef={areaRef} />
      ))}
      {isActiveTab && isSplit && <ResizeHud focusedLeafId={tab.focusedLeafId} />}
    </div>
  );
};

// One pane: its terminal, the unfocused dim, the drag-to-split grab handle, and
// the drop-zone preview. Single mount keyed by leafId so moving the pane in the
// tree (drag-to-split) never remounts it (which would kill its pty).
const TermPane = ({
  tab,
  leafId,
  r,
  isActiveTab,
  isSplit,
  zoomed,
  workspaceKey,
  gen,
  onRestart,
}: {
  tab: { id: string; focusedLeafId: string };
  leafId: string;
  r: { x: number; y: number; w: number; h: number };
  isActiveTab: boolean;
  isSplit: boolean;
  zoomed: string | null;
  workspaceKey: string | null;
  gen: number;
  onRestart: (leafId: string) => void;
}): JSX.Element => {
  const focusLeaf = useTerminalStore((s) => s.focusLeaf);
  const setTitle = useTerminalStore((s) => s.setTitle);
  const setDims = useTerminalStore((s) => s.setDims);
  const markActivity = useTerminalStore((s) => s.markActivity);
  const dragLeafId = useTerminalStore((s) => s.dragLeafId);
  const setDragLeaf = useTerminalStore((s) => s.setDragLeaf);
  const moveLeafBeside = useTerminalStore((s) => s.moveLeafBeside);
  const ref = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState(false);
  const [dropZone, setDropZone] = useState<FocusDir | null>(null);

  const isFocused = isActiveTab && leafId === tab.focusedLeafId;
  const full = zoomed === leafId;
  const hidden = zoomed != null && !full;
  // Dim every UNFOCUSED split (no focus border — the dim is the cue).
  const dimmed = isActiveTab && isSplit && !isFocused && !full && !hidden;
  const isDragSource = dragLeafId === leafId;
  const isDropCandidate = isActiveTab && dragLeafId != null && dragLeafId !== leafId && !hidden;

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
      onMouseDownCapture={() => {
        if (!isFocused) focusLeaf(tab.id, leafId);
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragOver={
        isDropCandidate
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const box = ref.current?.getBoundingClientRect();
              if (!box || box.width === 0 || box.height === 0) return;
              setDropZone(
                dropEdge((e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height),
              );
            }
          : undefined
      }
      onDragLeave={
        isDropCandidate
          ? (e) => {
              // Only clear when leaving the pane entirely (not crossing a child).
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropZone(null);
            }
          : undefined
      }
      onDrop={
        isDropCandidate
          ? (e) => {
              e.preventDefault();
              if (dropZone && dragLeafId) moveLeafBeside(dragLeafId, leafId, dropZone);
              setDropZone(null);
            }
          : undefined
      }
      style={{
        position: 'absolute',
        ...pos,
        display: hidden ? 'none' : 'flex',
        padding: 3,
        boxSizing: 'border-box',
        opacity: isDragSource ? 0.4 : 1,
      }}
    >
      <div
        ref={ref}
        style={{
          position: 'relative',
          // display:flex so the child TerminalView's flex:1 fills this box —
          // without it the terminal collapses to a 1-row sliver.
          display: 'flex',
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          borderRadius: radius.sm,
          overflow: 'hidden',
        }}
      >
        <TerminalView
          key={`${leafId}:${workspaceKey ?? 'none'}:${gen}`}
          active={isFocused}
          onRestart={() => onRestart(leafId)}
          onTitle={(t) => setTitle(leafId, t)}
          onDims={(c, rr) => setDims(leafId, c, rr)}
          onActivity={() => markActivity(leafId)}
        />
        {dimmed && (
          // unfocused-split-opacity 0.7 (bg over the pane); pointerEvents:none so
          // the click that focuses it still lands.
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              background: TERMINAL_BG,
              opacity: 0.7,
              pointerEvents: 'none',
            }}
          />
        )}
        {isSplit && isActiveTab && !hidden && (
          <GrabHandle
            leafId={leafId}
            visible={hover && dragLeafId == null}
            onStart={() => setDragLeaf(leafId)}
            onEnd={() => setDragLeaf(null)}
          />
        )}
        {dropZone && <DropZoneOverlay edge={dropZone} />}
      </div>
    </div>
  );
};

// The drag-to-split grab handle (a top-edge surface handle). Only the handle is
// draggable, so dragging never fights xterm's text selection.
const GrabHandle = ({
  leafId,
  visible,
  onStart,
  onEnd,
}: {
  leafId: string;
  visible: boolean;
  onStart: () => void;
  onEnd: () => void;
}): JSX.Element => (
  <div
    draggable
    title="Drag to move / split this pane"
    onDragStart={(e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-bh-term-leaf', leafId);
      onStart();
    }}
    onDragEnd={onEnd}
    style={{
      position: 'absolute',
      top: 0,
      left: '50%',
      transform: 'translateX(-50%)',
      width: 44,
      height: 14,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'grab',
      zIndex: 4,
      background: TERMINAL_CHROME_BG,
      color: color.textTertiary,
      borderRadius: `0 0 ${radius.sm}px ${radius.sm}px`,
      fontSize: 11,
      lineHeight: 1,
      letterSpacing: 1,
      opacity: visible ? 0.85 : 0,
      transition: transition(['opacity']),
    }}
  >
    ⋯
  </div>
);

// The half-pane accent preview shown on the target pane while dragging — tells
// you which side the dropped pane will land on.
const DropZoneOverlay = ({ edge }: { edge: FocusDir }): JSX.Element => {
  const half =
    edge === 'left'
      ? { left: 0, top: 0, width: '50%', height: '100%' }
      : edge === 'right'
        ? { right: 0, top: 0, width: '50%', height: '100%' }
        : edge === 'up'
          ? { left: 0, top: 0, width: '100%', height: '50%' }
          : { left: 0, bottom: 0, width: '100%', height: '50%' };
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        ...half,
        background: `${color.accent}33`,
        border: `1.5px solid ${color.accent}`,
        borderRadius: radius.sm,
        pointerEvents: 'none',
        zIndex: 5,
        transition: transition(['left', 'right', 'top', 'bottom', 'width', 'height']),
      }}
    />
  );
};

// The transient "cols × rows" HUD shown over the focused pane on resize —
// auto-hides after a beat.
const ResizeHud = ({ focusedLeafId }: { focusedLeafId: string }): JSX.Element | null => {
  const resizeTick = useTerminalStore((s) => s.resizeTick);
  const dims = useTerminalStore((s) => s.dims[focusedLeafId]);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (resizeTick === 0) return; // no resize yet — don't flash on mount
    setShow(true);
    const id = window.setTimeout(() => setShow(false), 750);
    return () => window.clearTimeout(id);
  }, [resizeTick]);

  if (!show || !dims) return null;
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
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
      {dims.cols} × {dims.rows}
    </div>
  );
};

const PaneDivider = ({
  divider,
  areaRef,
}: {
  divider: {
    splitId: string;
    dir: 'row' | 'column';
    rect: { x: number; y: number };
    bounds: { x: number; y: number; w: number; h: number };
  };
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
      if (box.width === 0 || box.height === 0) return;
      const b = divider.bounds;
      // Cursor as a fraction of the WHOLE area, re-expressed as a fraction of the
      // split's OWN sub-rectangle — so a nested split resizes relative to its own
      // bounds, not the whole dock (otherwise the divider snaps/accelerates).
      const areaFrac = row
        ? (ev.clientX - box.left) / box.width
        : (ev.clientY - box.top) / box.height;
      const span = row ? b.w : b.h;
      const origin = row ? b.x : b.y;
      let local = span > 0 ? (areaFrac - origin) / span : 0.5;
      // Absolute min-pixel floor so a pane can't be dragged to an unusable
      // sliver, on top of setSplitFraction's [0.1,0.9] clamp.
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

  // A faint static divider, brightening on hover/drag.
  const lit = active ? color.accent : hover ? color.borderStrong : 'rgba(255,255,255,0.07)';
  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={() => setSplitFraction(divider.splitId, 0.5)} // reset this split to 50/50
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
// Editor-style tab logic on the terminal surface.
//   Logic (a code editor's tab model):
//   • Always visible, so the + button (new tab) is always reachable by mouse,
//     not only via ⌘T.
//   • Content-width tabs, left-aligned, in a horizontally-scrollable row — they
//     fit their title and overflow into a scroll rather than squashing equally.
//     The active tab scrolls into view on change.
//   • The + sits in a fixed slot at the right, never scrolling out of reach.
//   • Each tab is independently closable (✕ on hover / active, middle-click, or
//     the right-click menu); the lone tab hides its ✕ (the dock always keeps one
//     terminal). Double-click a tab to rename, the empty strip to add one.
//   Styling:
//   • Dark chrome; active vs inactive conveyed by ELEVATION, not a top accent
//     line — the active tab rises to the terminal background (bright text),
//     inactive tabs recede to the darker chrome tone (dimmed), separated by
//     hairline dividers.
//   • Each tab is named by its focused pane's live title (the running program),
//     falling back to "Terminal"; an inactive tab with unseen output shows a dot.
const TAB_BAR_HEIGHT = 32;
const TAB_MIN_WIDTH = 92;
const TAB_MAX_WIDTH = 180;

const TermTabBar = ({
  tabs,
  activeTabId,
  titles,
  activity,
  zoomed,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onAdd,
  onReorder,
  onRename,
  onResetZoom,
}: {
  tabs: { id: string; focusedLeafId: string; titleOverride?: string }[];
  activeTabId: string;
  titles: Record<string, string>;
  activity: Record<string, boolean>;
  zoomed: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseToRight: (id: string) => void;
  onAdd: () => void;
  onReorder: (tabId: string, toIndex: number) => void;
  onRename: (tabId: string, title: string) => void;
  onResetZoom: () => void;
}): JSX.Element => {
  const closable = tabs.length > 1;
  const [dragId, setDragId] = useState<string | null>(null);
  // Rename + context menu are lifted to the strip so the right-click menu can
  // trigger a rename on the right tab, and only one menu is ever open.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const menuIdx = menu ? tabs.findIndex((t) => t.id === menu.tabId) : -1;

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
      {/* Tabs scroll horizontally when they overflow; the + stays pinned right. */}
      <div
        data-term-tabs
        role="tablist"
        aria-label="Terminal tabs"
        onDoubleClick={(e) => {
          // Double-click the empty strip area (not a tab) → new tab.
          if (e.target === e.currentTarget) onAdd();
        }}
        style={{
          display: 'flex',
          alignItems: 'stretch',
          flex: 1,
          minWidth: 0,
          overflowX: 'auto',
          overflowY: 'hidden',
          // Thin, unobtrusive scrollbar (WebKit) — the row scrolls, not squashes.
          scrollbarWidth: 'thin',
        }}
      >
        {tabs.map((t, i) => (
          <TermTab
            key={t.id}
            title={t.titleOverride ?? titles[t.focusedLeafId] ?? 'Terminal'}
            hasOverride={t.titleOverride != null}
            active={t.id === activeTabId}
            first={i === 0}
            closable={closable}
            dragging={dragId === t.id}
            editing={editingId === t.id}
            activity={!!activity[t.id] && t.id !== activeTabId}
            onSelect={() => onSelect(t.id)}
            onClose={() => onClose(t.id)}
            onContextMenu={(x, y) => setMenu({ tabId: t.id, x, y })}
            onEditStart={() => setEditingId(t.id)}
            onEditCommit={(title) => {
              setEditingId(null);
              onRename(t.id, title);
            }}
            onEditCancel={() => setEditingId(null)}
            onDragStart={() => setDragId(t.id)}
            onDragEnd={() => setDragId(null)}
            onDropHere={() => {
              if (dragId && dragId !== t.id) onReorder(dragId, i);
              setDragId(null);
            }}
          />
        ))}
      </div>
      {zoomed && (
        <button
          type="button"
          title="Reset zoom (⌘⇧↵)"
          aria-label="Reset split zoom"
          onClick={onResetZoom}
          style={{
            flexShrink: 0,
            padding: `0 ${space[2]}px`,
            border: 'none',
            borderLeft: `1px solid ${color.border}`,
            background: 'transparent',
            color: color.accent,
            cursor: 'pointer',
            fontSize: 13,
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
            gap: space[1],
            fontFamily: font.sans,
          }}
        >
          ⤢
        </button>
      )}
      <button
        type="button"
        title="New terminal tab (⌘T)"
        aria-label="New terminal tab"
        onClick={onAdd}
        style={{
          flexShrink: 0,
          width: TAB_BAR_HEIGHT,
          border: 'none',
          borderLeft: `1px solid ${color.border}`,
          background: 'transparent',
          color: color.textTertiary,
          cursor: 'pointer',
          fontSize: 17,
          lineHeight: 1,
        }}
      >
        +
      </button>
      {menu && (
        <TabContextMenu
          x={menu.x}
          y={menu.y}
          canClose={closable}
          canCloseOthers={tabs.length > 1}
          canCloseToRight={menuIdx >= 0 && menuIdx < tabs.length - 1}
          onRename={() => {
            setEditingId(menu.tabId);
            setMenu(null);
          }}
          onClose={() => {
            onClose(menu.tabId);
            setMenu(null);
          }}
          onCloseOthers={() => {
            onCloseOthers(menu.tabId);
            setMenu(null);
          }}
          onCloseToRight={() => {
            onCloseToRight(menu.tabId);
            setMenu(null);
          }}
          onNewTab={() => {
            onAdd();
            setMenu(null);
          }}
          onDismiss={() => setMenu(null)}
        />
      )}
    </div>
  );
};

const TermTab = ({
  title,
  hasOverride,
  active,
  first,
  closable,
  dragging,
  editing,
  activity,
  onSelect,
  onClose,
  onContextMenu,
  onEditStart,
  onEditCommit,
  onEditCancel,
  onDragStart,
  onDragEnd,
  onDropHere,
}: {
  title: string;
  hasOverride: boolean;
  active: boolean;
  first: boolean;
  closable: boolean;
  dragging: boolean;
  editing: boolean;
  activity: boolean;
  onSelect: () => void;
  onClose: () => void;
  onContextMenu: (x: number, y: number) => void;
  onEditStart: () => void;
  onEditCommit: (title: string) => void;
  onEditCancel: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropHere: () => void;
}): JSX.Element => {
  const [hover, setHover] = useState(false);
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);

  // Seed the rename field when editing begins — blank if the title is the live
  // program name, so an empty commit clears back to it.
  useEffect(() => {
    if (editing) setDraft(hasOverride ? title : '');
  }, [editing, hasOverride, title]);

  // Reveal the active tab when it changes — keyboard tab nav (⌘1-9 / ⌘⇧[ ]) must
  // scroll it back into view once tabs overflow the strip.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [active]);

  const showX = closable && (hover || active);

  return (
    <div
      ref={ref}
      role="tab"
      aria-selected={active}
      draggable={!editing}
      onMouseDown={(e) => {
        if (editing) return;
        if (e.button === 1) {
          // Middle-click closes (the standard tab gesture); preventDefault stops
          // the OS auto-scroll/paste.
          e.preventDefault();
          if (closable) onClose();
          return;
        }
        if (e.button === 0) onSelect();
      }}
      onDoubleClick={onEditStart}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e.clientX, e.clientY);
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-bh-term-tab', '1');
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropHere();
      }}
      style={{
        position: 'relative',
        // Content-width, left-aligned — an editor-style tab sizing. Tabs fit
        // their title (bounded) and the row scrolls when they overflow.
        flexShrink: 0,
        minWidth: TAB_MIN_WIDTH,
        maxWidth: TAB_MAX_WIDTH,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[1],
        padding: `0 ${space[2]}px`,
        cursor: 'default',
        userSelect: 'none',
        opacity: dragging ? 0.4 : 1,
        fontFamily: font.sans,
        fontSize: font.size.caption,
        color: active ? '#ffffff' : color.textTertiary,
        // Elevation cue: active rises to the terminal surface; inactive recedes.
        background: active ? TERMINAL_BG : 'transparent',
        // A hairline divider before each tab but the first, so adjacent inactive
        // tabs read as distinct without a heavy border.
        boxShadow: first || active ? 'none' : `inset 1px 0 0 ${color.border}`,
        transition: transition(['color', 'background', 'opacity']),
      }}
    >
      {editing ? (
        <input
          // biome-ignore lint/a11y/noAutofocus: a rename field should take focus.
          autoFocus
          value={draft}
          placeholder="Terminal"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onEditCommit(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onEditCommit(draft);
            else if (e.key === 'Escape') onEditCancel();
            e.stopPropagation();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            minWidth: 0,
            border: `1px solid ${color.accent}`,
            borderRadius: radius.sm,
            background: TERMINAL_BG,
            color: '#fff',
            fontFamily: font.sans,
            fontSize: font.size.caption,
            padding: `1px ${space[1]}px`,
            outline: 'none',
          }}
        />
      ) : (
        <span
          style={{
            flex: 1,
            minWidth: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </span>
      )}
      {/* Trailing 16px slot: the ✕ (hover/active) stacked over the activity dot
          (inactive + unseen output) so neither shifts the layout. */}
      {!editing && (
        <span style={{ position: 'relative', flexShrink: 0, width: 16, height: 16 }}>
          {closable && (
            <button
              type="button"
              title="Close tab"
              aria-label="Close tab"
              onMouseDown={(e) => {
                e.stopPropagation();
                onClose();
              }}
              style={{
                position: 'absolute',
                inset: 0,
                border: 'none',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                fontSize: 13,
                lineHeight: 1,
                padding: 0,
                borderRadius: radius.sm,
                // Revealed on hover or for the active tab.
                opacity: showX ? 0.75 : 0,
                transition: transition(['opacity']),
              }}
            >
              ×
            </button>
          )}
          <span
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              // The dot yields to the ✕ on hover/active.
              opacity: activity && !showX ? 1 : 0,
              transition: transition(['opacity']),
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: color.accent }} />
          </span>
        </span>
      )}
    </div>
  );
};

// Right-click tab menu — portalled to the body so an overflow:hidden / transformed
// ancestor can't clip it. An invisible backdrop catches the dismissing click.
const TAB_MENU_WIDTH = 188;
const TabContextMenu = ({
  x,
  y,
  canClose,
  canCloseOthers,
  canCloseToRight,
  onRename,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onNewTab,
  onDismiss,
}: {
  x: number;
  y: number;
  canClose: boolean;
  canCloseOthers: boolean;
  canCloseToRight: boolean;
  onRename: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseToRight: () => void;
  onNewTab: () => void;
  onDismiss: () => void;
}): JSX.Element => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onDismiss]);

  // Clamp x into [4, innerWidth - width - 4]; the outer max keeps it on-screen
  // even in a degenerate viewport narrower than the menu (overflow then pins left).
  const left = Math.min(Math.max(4, x), Math.max(4, window.innerWidth - TAB_MENU_WIDTH - 4));
  const top = Math.max(4, Math.min(y, window.innerHeight - 216));
  const items: Array<
    { key: string; label: string; on: () => void; enabled: boolean } | { key: string; sep: true }
  > = [
    { key: 'new', label: 'New Terminal Tab', on: onNewTab, enabled: true },
    { key: 'sep1', sep: true },
    { key: 'rename', label: 'Rename…', on: onRename, enabled: true },
    { key: 'sep2', sep: true },
    { key: 'close', label: 'Close', on: onClose, enabled: canClose },
    { key: 'others', label: 'Close Others', on: onCloseOthers, enabled: canCloseOthers },
    { key: 'right', label: 'Close to the Right', on: onCloseToRight, enabled: canCloseToRight },
  ];

  return createPortal(
    <>
      <div
        onMouseDown={onDismiss}
        onContextMenu={(e) => {
          e.preventDefault();
          onDismiss();
        }}
        style={{ position: 'fixed', inset: 0, zIndex: 40 }}
      />
      <div
        role="menu"
        style={{
          position: 'fixed',
          left,
          top,
          zIndex: 41,
          minWidth: TAB_MENU_WIDTH,
          background: color.surface,
          border: `1px solid ${color.borderStrong}`,
          borderRadius: radius.md,
          padding: space[1],
          boxShadow: shadow.floating,
        }}
      >
        {items.map((it) =>
          'sep' in it ? (
            <div
              key={it.key}
              style={{ height: 1, background: color.border, margin: `${space[1]}px 0` }}
            />
          ) : (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              disabled={!it.enabled}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                if (it.enabled) it.on();
              }}
              onMouseEnter={(e) => {
                if (it.enabled) e.currentTarget.style.background = color.divider;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                border: 'none',
                background: 'transparent',
                color: it.enabled ? color.textPrimary : color.textGhost,
                cursor: it.enabled ? 'pointer' : 'default',
                padding: `${space[1]}px ${space[2]}px`,
                borderRadius: radius.sm,
                fontFamily: font.sans,
                fontSize: font.size.ui,
              }}
            >
              {it.label}
            </button>
          ),
        )}
      </div>
    </>,
    document.body,
  );
};

// ── Soft-close undo toasts ───────────────────────────────────────────────────
// A closed terminal tab isn't killed immediately — it lingers in `closing`
// (panes mounted + running) with an Undo toast. Undo restores it intact; the
// grace timer (or ✕) finalizes it, which unmounts the panes and kills the ptys.
const CLOSE_GRACE_MS = 6000;

const TerminalCloseToasts = (): JSX.Element | null => {
  const closing = useTerminalStore((s) => s.closing);
  const titles = useTerminalStore((s) => s.titles);
  if (closing.length === 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: space[3],
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: space[1],
        pointerEvents: 'none',
        zIndex: 8,
      }}
    >
      {closing.map((c) => (
        <CloseToast
          key={c.key}
          entryKey={c.key}
          name={c.tab.titleOverride ?? titles[c.tab.focusedLeafId] ?? 'Terminal'}
        />
      ))}
    </div>
  );
};

const CloseToast = ({ entryKey, name }: { entryKey: string; name: string }): JSX.Element => {
  // Store actions have stable identities, so this timer is set once per toast.
  const undoClose = useTerminalStore((s) => s.undoClose);
  const finalizeClose = useTerminalStore((s) => s.finalizeClose);
  useEffect(() => {
    const id = window.setTimeout(() => finalizeClose(entryKey), CLOSE_GRACE_MS);
    return () => window.clearTimeout(id);
  }, [entryKey, finalizeClose]);
  return (
    <div
      style={{
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: space[2],
        maxWidth: '92%',
        background: 'rgba(0,0,0,0.82)',
        color: '#fff',
        borderRadius: radius.md,
        padding: `${space[1]}px ${space[1]}px ${space[1]}px ${space[3]}px`,
        boxShadow: shadow.floating,
        fontFamily: font.sans,
        fontSize: font.size.caption,
      }}
    >
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        Closed “{name}”
      </span>
      <button
        type="button"
        onClick={() => undoClose(entryKey)}
        style={{
          flexShrink: 0,
          border: 'none',
          background: 'transparent',
          color: color.accentHover,
          cursor: 'pointer',
          fontFamily: font.sans,
          fontSize: font.size.caption,
          fontWeight: font.weight.semibold,
          padding: `2px ${space[1]}px`,
        }}
      >
        Undo
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => finalizeClose(entryKey)}
        style={{
          flexShrink: 0,
          border: 'none',
          background: 'transparent',
          color: color.textTertiary,
          cursor: 'pointer',
          fontSize: 13,
          lineHeight: 1,
          width: 18,
          height: 18,
          borderRadius: radius.sm,
        }}
      >
        ×
      </button>
    </div>
  );
};

// ── Dock keymap, scoped to terminal focus ────────────────────────────────────
function useTerminalKeymap(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.metaKey) return;
      const s = useTerminalStore.getState();
      if (!s.focused) return; // only when the terminal owns focus
      const k = e.key.toLowerCase();
      // Pick the matching action, if any.
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
      } else if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === '=' || e.code === 'Equal')) {
        action = s.equalizeSplits; // ⌘⌃= equalize splits
      } else if (!e.shiftKey && !e.altKey && !e.ctrlKey && /^[1-9]$/.test(e.key)) {
        // ⌘1–8 jump to tab N (clamped to last); ⌘9 jumps to the last tab.
        const n = Number(e.key);
        action = n === 9 ? s.lastTab : () => s.gotoTab(n);
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
