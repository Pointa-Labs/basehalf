import { type JSX, type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react';
import { color, font, radius, space, transition } from '../design.js';
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
        zoomed={zoomed}
        onSelect={setActiveTab}
        onClose={closeTab}
        onAdd={newTab}
        onReorder={reorderTab}
        onRename={setTabTitle}
        onResetZoom={toggleZoom}
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
  const dragLeafId = useTerminalStore((s) => s.dragLeafId);
  const setDragLeaf = useTerminalStore((s) => s.setDragLeaf);
  const moveLeafBeside = useTerminalStore((s) => s.moveLeafBeside);
  const ref = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState(false);
  const [dropZone, setDropZone] = useState<FocusDir | null>(null);

  const isFocused = isActiveTab && leafId === tab.focusedLeafId;
  const full = zoomed === leafId;
  const hidden = zoomed != null && !full;
  // Ghostty dims every UNFOCUSED split (no focus border — the dim is the cue).
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

// The drag-to-split grab handle (Ghostty's top-edge surface handle). Only the
// handle is draggable, so dragging never fights xterm's text selection.
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

// The transient "cols × rows" HUD shown over the focused pane on resize
// (Ghostty's resize overlay) — auto-hides after a beat.
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
  divider: { splitId: string; dir: 'row' | 'column'; rect: { x: number; y: number } };
  areaRef: React.RefObject<HTMLDivElement | null>;
}): JSX.Element => {
  const setSplitFraction = useTerminalStore((s) => s.setSplitFraction);
  const equalizeSplits = useTerminalStore((s) => s.equalizeSplits);
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

  // Ghostty shows a faint static divider always; it brightens on hover/drag.
  const lit = active ? color.accent : hover ? color.borderStrong : 'rgba(255,255,255,0.07)';
  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={equalizeSplits} // Ghostty: double-click a divider → equalize
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
// VS-Code tab LOGIC, Ghostty STYLING.
//   Logic (the editor's tab model):
//   • Always visible, so the + button (new tab) is always reachable by mouse,
//     not only via ⌘T.
//   • Content-width tabs, left-aligned, in a horizontally-scrollable row — they
//     fit their title and overflow into a scroll rather than squashing equally.
//   • The + sits in a fixed slot at the right, never scrolling out of reach.
//   • Each tab is independently closable; the ✕ shows on hover or the active
//     tab. The lone tab hides its ✕ (the dock always keeps one terminal).
//   Styling (Ghostty's look):
//   • Dark One-Dark chrome; active vs inactive conveyed by ELEVATION, not a top
//     accent line — the active tab rises to the terminal background (bright
//     text), inactive tabs recede to the darker chrome tone (dimmed), separated
//     by hairline dividers.
//   • Each tab is named by its focused pane's live title (the running program),
//     falling back to "Terminal".
const TAB_BAR_HEIGHT = 32;
const TAB_MIN_WIDTH = 92;
const TAB_MAX_WIDTH = 180;

const TermTabBar = ({
  tabs,
  activeTabId,
  titles,
  zoomed,
  onSelect,
  onClose,
  onAdd,
  onReorder,
  onRename,
  onResetZoom,
}: {
  tabs: { id: string; focusedLeafId: string; titleOverride?: string }[];
  activeTabId: string;
  titles: Record<string, string>;
  zoomed: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
  onReorder: (tabId: string, toIndex: number) => void;
  onRename: (tabId: string, title: string) => void;
  onResetZoom: () => void;
}): JSX.Element => {
  const closable = tabs.length > 1;
  const [dragId, setDragId] = useState<string | null>(null);
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
            onSelect={() => onSelect(t.id)}
            onClose={() => onClose(t.id)}
            onRename={(title) => onRename(t.id, title)}
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
  onSelect,
  onClose,
  onRename,
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
  onSelect: () => void;
  onClose: () => void;
  onRename: (title: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropHere: () => void;
}): JSX.Element => {
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  const beginEdit = (): void => {
    // Seed the field with the current override (blank if it's a live title), so
    // an empty commit clears back to the running program's name.
    setDraft(hasOverride ? title : '');
    setEditing(true);
  };
  const commit = (): void => {
    setEditing(false);
    onRename(draft);
  };

  return (
    <div
      draggable={!editing}
      onMouseDown={editing ? undefined : onSelect}
      onDoubleClick={beginEdit}
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
        // Content-width, left-aligned — the editor's tab sizing. Tabs fit their
        // title (bounded) and the row scrolls when they overflow.
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
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') setEditing(false);
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
      {closable && !editing && (
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
      )}
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
