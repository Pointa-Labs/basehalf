import { type JSX, type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { color, font, radius, shadow, space, transition } from '../design.js';
import {
  type FocusDir,
  type Rect,
  dropEdge,
  leafRects,
  orderedLeafIds,
  splitDividers,
} from '../lib/terminalTree.js';
import { TERMINAL_MIN_WIDTH, useLayoutStore } from '../store/layout.js';
import { type TermTab, useTerminalStore } from '../store/terminal.js';
import { TERMINAL_BG, TERMINAL_CHROME_BG, TerminalView } from './Terminal.js';

/**
 * The RIGHT-most region: a tabbed terminal. The dock holds a list of TABS shown
 * in one strip across the top, always visible (with a + to add a tab). This is a
 * deliberate fit for an embedded side panel: unlike a full-window terminal, a lone
 * terminal here gives no hint that tabs exist, so we keep the bar + the + visible
 * for discoverability (matches the reference terminal's "always show tab bar"
 * mode rather than its auto-hide default). Each tab owns its own pane SPLIT TREE
 * (one pty per pane): ⌘D / ⌘⇧D split the focused
 * pane, ⌘⌥arrows move focus between panes, ⌘⌃arrows resize, ⌘⇧↵ zooms a pane,
 * ⌘[ ⌘] cycle panes, ⌘⇧[ ⌘⇧] switch tabs, ⌘T new tab, ⌘W close pane (closes the
 * tab on its last pane), ⌘⌥W close tab. The keymap only fires while focus is in
 * the dock (so it never steals the app's shortcuts).
 *
 * Pty survival: every pane of every tab (plus soft-closed ones) is mounted EXACTLY
 * ONCE in a flat list keyed by pane id, positioned by its tab's pane rect; the
 * inactive tabs' panes are hidden, not unmounted, so switching tabs — or
 * restructuring a split — never remounts a terminal (which would kill its pty).
 * The chrome (tab strip, dividers) is drawn separately.
 */
const TAB_BAR_HEIGHT = 32;

export const TerminalDock = (): JSX.Element => {
  const width = useLayoutStore((s) => s.terminalWidth);
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const closing = useTerminalStore((s) => s.closing);
  const titles = useTerminalStore((s) => s.titles);
  const activity = useTerminalStore((s) => s.activity);
  const dims = useTerminalStore((s) => s.dims);
  const focused = useTerminalStore((s) => s.focused);
  const paneDrag = useTerminalStore((s) => s.paneDrag);
  const setFocused = useTerminalStore((s) => s.setFocused);
  const focusPane = useTerminalStore((s) => s.focusPane);
  const setTitle = useTerminalStore((s) => s.setTitle);
  const setDims = useTerminalStore((s) => s.setDims);
  const markActivity = useTerminalStore((s) => s.markActivity);

  // A pane's pty is spawned once and lives in main for the pane's whole life, so
  // its React key must stay stable. Main resolves each new pty's cwd from the
  // current workspace AT SPAWN TIME, so a terminal is independent of the workspace
  // pointer afterward — we deliberately do NOT fold the workspace into the key:
  // doing so killed every running shell (agents and all) whenever the active
  // workspace changed or was removed. Restart bumps a per-pane generation to
  // remount a single pane on demand.
  const [gens, setGens] = useState<Record<string, number>>({});
  const restart = (paneId: string): void =>
    setGens((g) => ({ ...g, [paneId]: (g[paneId] ?? 0) + 1 }));

  const bodyRef = useRef<HTMLDivElement | null>(null);

  useTerminalKeymap();

  // The app menu's ⌘W (File ▸ Close) closes the focused PANE when the terminal is
  // focused (closing the tab when it's the pane's last). ⌘⌥W (close tab) lives in
  // the dock keymap.
  useEffect(
    () =>
      window.bh.onMenuCloseTab(() => {
        if (useTerminalStore.getState().focused) useTerminalStore.getState().closeActivePane();
      }),
    [],
  );

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeRects: Map<string, Rect> = activeTab ? leafRects(activeTab.tree) : new Map();
  const zoomedPaneId = activeTab?.zoomedPaneId ?? null;
  const dividers = activeTab && !zoomedPaneId ? splitDividers(activeTab.tree) : [];
  // Dim the non-focused panes of a multi-pane tab so the active one stands out
  // (mirrors the reference terminal's unfocused-split-opacity).
  const dimUnfocused = !!activeTab && activeTab.tree.type === 'split' && !zoomedPaneId;

  // Flat mount list: every pane of every tab, plus soft-closed tabs'/panes' panes.
  const mounts: Array<{ paneId: string; tab: TermTab | null }> = [];
  for (const t of tabs)
    for (const paneId of orderedLeafIds(t.tree)) mounts.push({ paneId, tab: t });
  for (const c of closing) {
    if (c.kind === 'tab')
      for (const paneId of orderedLeafIds(c.tab.tree)) mounts.push({ paneId, tab: c.tab });
    else mounts.push({ paneId: c.paneId, tab: null });
  }

  return (
    <aside
      data-terminal-dock
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      style={{
        position: 'relative',
        flexShrink: 0,
        width,
        height: '100%',
        borderLeft: `1px solid ${color.border}`,
        // An accent bar on the left edge when the terminal owns keyboard focus —
        // so the precondition for its shortcuts (⌘D, ⌘W, arrows…) is visible.
        boxShadow: focused ? `inset 2px 0 0 0 ${color.accent}` : 'none',
        background: TERMINAL_BG,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <TerminalSash />
      <TerminalTabBar tabs={tabs} activeTabId={activeTabId} titles={titles} activity={activity} />
      <div ref={bodyRef} style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {/* Layer 0: terminals — one mount per pane, positioned at its tab's rect. */}
        {mounts.map(({ paneId, tab }) => {
          const isActiveTab = !!tab && tab.id === activeTabId;
          const rect = isActiveTab ? activeRects.get(paneId) : undefined;
          const zoomedHere = isActiveTab && zoomedPaneId === paneId;
          const visible = isActiveTab && (!zoomedPaneId || zoomedHere) && (!!rect || zoomedHere);
          const pos =
            zoomedHere || !rect
              ? { left: 0, top: 0, width: '100%', height: '100%' }
              : {
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                };
          return (
            <div
              key={paneId}
              onMouseDownCapture={() => tab && focusPane(tab.id, paneId)}
              style={{ position: 'absolute', ...pos, display: visible ? 'flex' : 'none' }}
            >
              <TerminalView
                key={`${paneId}:${gens[paneId] ?? 0}`}
                active={visible && paneId === activeTab?.activePaneId}
                onRestart={() => restart(paneId)}
                onTitle={(t) => setTitle(paneId, t)}
                onDims={(c, rr) => setDims(paneId, c, rr)}
                onActivity={() => markActivity(paneId)}
              />
              {visible && dimUnfocused && paneId !== activeTab?.activePaneId && (
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
              )}
              {/* Grab handle (the ⋯) to drag a pane to a new spot — only when split. */}
              {visible && dimUnfocused && <PaneGrabHandle paneId={paneId} />}
              {/* Drop zones over the OTHER panes while a pane is being dragged. */}
              {visible && paneDrag && paneDrag.paneId !== paneId && (
                <PaneDropZones destPaneId={paneId} />
              )}
            </div>
          );
        })}

        {/* Layer 1: dividers between panes of the active tab. */}
        {dividers.map((d) => (
          <PaneDivider key={d.splitId} divider={d} areaRef={bodyRef} />
        ))}

        {/* Layer 2: resize HUD + zoom badge for the active tab. */}
        {activeTab && activeTab.tree.type === 'split' && (
          <ResizeHud
            paneId={activeTab.activePaneId}
            rect={activeRects.get(activeTab.activePaneId)}
            dims={dims}
          />
        )}
        {zoomedPaneId && <ZoomBadge />}
      </div>
      <TerminalCloseToasts />
    </aside>
  );
};

// ── The single tab strip across the top of the dock ───────────────────────────
const TAB_MIN_WIDTH = 56;

const TerminalTabBar = ({
  tabs,
  activeTabId,
  titles,
  activity,
}: {
  tabs: TermTab[];
  activeTabId: string;
  titles: Record<string, string>;
  activity: Record<string, boolean>;
}): JSX.Element => {
  const selectTab = useTerminalStore((s) => s.selectTab);
  const closeTab = useTerminalStore((s) => s.closeTab);
  const closeOtherTabs = useTerminalStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useTerminalStore((s) => s.closeTabsToRight);
  const newTab = useTerminalStore((s) => s.newTab);
  const setTabTitle = useTerminalStore((s) => s.setTabTitle);
  const reorderTab = useTerminalStore((s) => s.reorderTab);
  const splitPane = useTerminalStore((s) => s.splitPane);
  const setDrag = useTerminalStore((s) => s.setDrag);
  const toggleZoom = useTerminalStore((s) => s.toggleZoom);
  const zoomed = useTerminalStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.zoomedPaneId != null,
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const menuIdx = menu ? tabs.findIndex((t) => t.id === menu.tabId) : -1;

  const dropAt = (toIndex: number): void => {
    const d = useTerminalStore.getState().drag;
    if (d) reorderTab(d.tabId, toIndex);
    setDropIndex(null);
  };
  // Split a tab's active pane from its menu (select it first so the split lands there).
  const splitTab = (tabId: string, dir: 'right' | 'down'): void => {
    selectTab(tabId);
    splitPane(dir);
  };

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
      <div
        data-term-tabs
        role="tablist"
        aria-label="Terminal tabs"
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget) newTab();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (e.target === e.currentTarget) setDropIndex(tabs.length);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropIndex(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (e.target === e.currentTarget) dropAt(tabs.length);
        }}
        style={{
          display: 'flex',
          alignItems: 'stretch',
          flex: 1,
          minWidth: 0,
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollbarWidth: 'thin',
        }}
      >
        {tabs.map((t, i) => (
          <TermTabView
            key={t.id}
            index={i + 1}
            title={t.titleOverride ?? titles[t.activePaneId] ?? ''}
            hasOverride={t.titleOverride != null}
            active={t.id === activeTabId}
            first={i === 0}
            activity={!!activity[t.id]}
            editing={editingId === t.id}
            dropBefore={dropIndex === i}
            dropAfter={dropIndex === tabs.length && i === tabs.length - 1}
            onSelect={() => selectTab(t.id)}
            onClose={() => closeTab(t.id)}
            onContextMenu={(x, y) => setMenu({ tabId: t.id, x, y })}
            onEditStart={() => setEditingId(t.id)}
            onEditCommit={(title) => {
              setEditingId(null);
              setTabTitle(t.id, title);
            }}
            onEditCancel={() => setEditingId(null)}
            onDragStart={() => setDrag({ tabId: t.id })}
            onDragEnd={() => {
              setDrag(null);
              setDropIndex(null);
            }}
            onDragOverHere={(side) => setDropIndex(i + (side === 'after' ? 1 : 0))}
            onDropHere={(side) => dropAt(i + (side === 'after' ? 1 : 0))}
          />
        ))}
      </div>
      {zoomed && (
        <button
          type="button"
          title="Reset zoom (⌘⇧↵)"
          aria-label="Reset zoom"
          onClick={toggleZoom}
          style={iconBtn(color.accent)}
        >
          ⤢
        </button>
      )}
      <button
        type="button"
        title="New terminal tab (⌘T)"
        aria-label="New terminal tab"
        onClick={() => newTab()}
        style={iconBtn(color.textTertiary)}
      >
        +
      </button>
      {menu && (
        <TabContextMenu
          x={menu.x}
          y={menu.y}
          canCloseOthers={tabs.length > 1}
          canCloseToRight={menuIdx >= 0 && menuIdx < tabs.length - 1}
          onRename={() => {
            setEditingId(menu.tabId);
            setMenu(null);
          }}
          onClose={() => {
            closeTab(menu.tabId);
            setMenu(null);
          }}
          onCloseOthers={() => {
            closeOtherTabs(menu.tabId);
            setMenu(null);
          }}
          onCloseToRight={() => {
            closeTabsToRight(menu.tabId);
            setMenu(null);
          }}
          onSplitRight={() => {
            splitTab(menu.tabId, 'right');
            setMenu(null);
          }}
          onSplitDown={() => {
            splitTab(menu.tabId, 'down');
            setMenu(null);
          }}
          onNewTab={() => {
            newTab();
            setMenu(null);
          }}
          onDismiss={() => setMenu(null)}
        />
      )}
    </div>
  );
};

const iconBtn = (col: string): React.CSSProperties => ({
  flexShrink: 0,
  width: TAB_BAR_HEIGHT,
  border: 'none',
  borderLeft: `1px solid ${color.border}`,
  background: 'transparent',
  color: col,
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
});

const TermTabView = ({
  index,
  title,
  hasOverride,
  active,
  first,
  activity,
  editing,
  dropBefore,
  dropAfter,
  onSelect,
  onClose,
  onContextMenu,
  onEditStart,
  onEditCommit,
  onEditCancel,
  onDragStart,
  onDragEnd,
  onDragOverHere,
  onDropHere,
}: {
  index: number;
  title: string;
  hasOverride: boolean;
  active: boolean;
  first: boolean;
  activity: boolean;
  editing: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  onSelect: () => void;
  onClose: () => void;
  onContextMenu: (x: number, y: number) => void;
  onEditStart: () => void;
  onEditCommit: (title: string) => void;
  onEditCancel: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverHere: (side: 'before' | 'after') => void;
  onDropHere: (side: 'before' | 'after') => void;
}): JSX.Element => {
  const [hover, setHover] = useState(false);
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (editing) setDraft(hasOverride ? title : '');
  }, [editing, hasOverride, title]);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [active]);

  const showX = hover || active;
  const dragSide = (clientX: number): 'before' | 'after' => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return 'before';
    return clientX - box.left <= box.width / 2 ? 'before' : 'after';
  };

  return (
    <div
      ref={ref}
      role="tab"
      aria-selected={active}
      aria-label={title ? `Tab ${index}: ${title}` : `Tab ${index}`}
      draggable={!editing}
      onMouseDown={(e) => {
        if (editing) return;
        if (e.button === 1) {
          e.preventDefault();
          onClose();
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
      onDragOver={(e) => {
        e.preventDefault();
        onDragOverHere(dragSide(e.clientX));
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDropHere(dragSide(e.clientX));
      }}
      style={{
        position: 'relative',
        flex: '1 1 0',
        minWidth: TAB_MIN_WIDTH,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[1],
        padding: `0 ${space[2]}px`,
        cursor: 'default',
        userSelect: 'none',
        fontFamily: font.sans,
        fontSize: font.size.caption,
        color: active ? '#ffffff' : color.textTertiary,
        background: active ? TERMINAL_BG : 'transparent',
        boxShadow: first || active ? 'none' : `inset 1px 0 0 ${color.border}`,
        transition: transition(['color', 'background']),
      }}
    >
      {dropBefore && <DropInsertLine side="before" />}
      {dropAfter && <DropInsertLine side="after" />}
      {editing ? (
        <input
          // biome-ignore lint/a11y/noAutofocus: a rename field should take focus.
          autoFocus
          value={draft}
          placeholder="Name this tab…"
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
            display: 'flex',
            alignItems: 'baseline',
            gap: space[1],
            overflow: 'hidden',
          }}
        >
          {/* Leading index = the ⌘N that selects this tab (always visible so the
              shortcut is discoverable and tabs stay distinct before a title lands). */}
          <span
            aria-hidden
            style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', opacity: 0.55 }}
          >
            {index}
          </span>
          {title && (
            <span
              style={{
                minWidth: 0,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {title}
            </span>
          )}
        </span>
      )}
      {!editing && (
        <span style={{ position: 'relative', flexShrink: 0, width: 16, height: 16 }}>
          <button
            type="button"
            title="Close tab"
            aria-label="Close tab"
            onMouseDown={(e) => {
              e.preventDefault();
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
              opacity: showX ? 0.75 : 0,
              transition: transition(['opacity']),
            }}
          >
            ×
          </button>
          <span
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
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

const DropInsertLine = ({ side }: { side: 'before' | 'after' }): JSX.Element => (
  <span
    aria-hidden
    style={{
      position: 'absolute',
      top: 0,
      bottom: 0,
      [side === 'before' ? 'left' : 'right']: -1,
      width: 2,
      background: color.accent,
      pointerEvents: 'none',
      zIndex: 2,
    }}
  />
);

// Right-click tab menu — portalled to the body so an overflow:hidden / transformed
// ancestor can't clip it. An invisible backdrop catches the dismissing click.
const TAB_MENU_WIDTH = 204;
const TabContextMenu = ({
  x,
  y,
  canCloseOthers,
  canCloseToRight,
  onRename,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onSplitRight,
  onSplitDown,
  onNewTab,
  onDismiss,
}: {
  x: number;
  y: number;
  canCloseOthers: boolean;
  canCloseToRight: boolean;
  onRename: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseToRight: () => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
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

  const left = Math.min(Math.max(4, x), Math.max(4, window.innerWidth - TAB_MENU_WIDTH - 4));
  const top = Math.max(4, Math.min(y, window.innerHeight - 260));
  const items: Array<
    { key: string; label: string; on: () => void; enabled: boolean } | { key: string; sep: true }
  > = [
    { key: 'new', label: 'New Terminal Tab', on: onNewTab, enabled: true },
    { key: 'split-right', label: 'Split Pane Right', on: onSplitRight, enabled: true },
    { key: 'split-down', label: 'Split Pane Down', on: onSplitDown, enabled: true },
    { key: 'sep1', sep: true },
    { key: 'rename', label: 'Rename…', on: onRename, enabled: true },
    { key: 'sep2', sep: true },
    { key: 'close', label: 'Close Tab', on: onClose, enabled: true },
    { key: 'others', label: 'Close Other Tabs', on: onCloseOthers, enabled: canCloseOthers },
    {
      key: 'right',
      label: 'Close Tabs to the Right',
      on: onCloseToRight,
      enabled: canCloseToRight,
    },
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

// ── Pane drag-to-rearrange: a grab handle (⋯) + edge drop zones ───────────────
// Mirrors the reference terminal: a handle appears at the top of a split pane;
// drag it onto another pane's edge to move it there (re-splitting on that edge).
const PaneGrabHandle = ({ paneId }: { paneId: string }): JSX.Element => {
  const setPaneDrag = useTerminalStore((s) => s.setPaneDrag);
  const [hover, setHover] = useState(false);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-bh-term-pane', paneId);
        setPaneDrag({ paneId });
      }}
      onDragEnd={() => setPaneDrag(null)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Drag to move this pane"
      aria-label="Move pane"
      style={{
        position: 'absolute',
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 88,
        height: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'grab',
        color: '#fff',
        // Faintly present so it's discoverable; brightens on hover.
        opacity: hover ? 0.85 : 0.25,
        transition: transition(['opacity']),
        zIndex: 4,
      }}
    >
      <span aria-hidden style={{ fontSize: 14, lineHeight: 1, letterSpacing: 2 }}>
        ⋯
      </span>
    </div>
  );
};

const PaneDropZones = ({ destPaneId }: { destPaneId: string }): JSX.Element => {
  const movePane = useTerminalStore((s) => s.movePane);
  const ref = useRef<HTMLDivElement | null>(null);
  const [edge, setEdge] = useState<FocusDir | null>(null);
  return (
    <div
      ref={ref}
      onDragOver={(e) => {
        if (!useTerminalStore.getState().paneDrag) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const box = ref.current?.getBoundingClientRect();
        if (!box || box.width === 0 || box.height === 0) return;
        setEdge(dropEdge((e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height));
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEdge(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const d = useTerminalStore.getState().paneDrag;
        if (d && edge) movePane(d.paneId, edge, destPaneId);
        setEdge(null);
      }}
      style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'auto' }}
    >
      {edge && <PaneDropPreview edge={edge} />}
    </div>
  );
};

const PaneDropPreview = ({ edge }: { edge: FocusDir }): JSX.Element => {
  const box: React.CSSProperties =
    edge === 'left'
      ? { left: 0, top: 0, bottom: 0, width: '50%' }
      : edge === 'right'
        ? { right: 0, top: 0, bottom: 0, width: '50%' }
        : edge === 'up'
          ? { left: 0, right: 0, top: 0, height: '50%' }
          : { left: 0, right: 0, bottom: 0, height: '50%' };
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        ...box,
        background: `${color.accent}33`,
        border: `1.5px solid ${color.accent}`,
        borderRadius: radius.sm,
        pointerEvents: 'none',
        transition: transition(['left', 'right', 'top', 'bottom', 'width', 'height']),
      }}
    />
  );
};

// ── Divider between panes (drag to resize; double-click to reset to 50/50) ────
const DIVIDER_HIT = 6;
const MIN_PANE_PX = 48;

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
  const row = divider.dir === 'row';

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
      const areaFrac = row
        ? (ev.clientX - box.left) / box.width
        : (ev.clientY - box.top) / box.height;
      const span = row ? b.w : b.h;
      const origin = row ? b.x : b.y;
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

  const lit = active ? color.accent : hover ? color.borderStrong : 'rgba(255,255,255,0.07)';
  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={() => setSplitFraction(divider.splitId, 0.5)}
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

// The transient "cols × rows" HUD over the active pane on resize.
const ResizeHud = ({
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
    if (resizeTick === prevTick.current) return; // only a genuine resize, not mount
    prevTick.current = resizeTick;
    setShow(true);
    const id = window.setTimeout(() => setShow(false), 750);
    return () => window.clearTimeout(id);
  }, [resizeTick]);
  // resizeTick is global; a tab switch must not let the HUD flash on the new tab.
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

const ZoomBadge = (): JSX.Element => (
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

// ── Soft-close undo toasts ───────────────────────────────────────────────────
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
      {closing.map((c) => {
        const name =
          c.kind === 'tab'
            ? (c.tab.titleOverride ?? titles[c.tab.activePaneId] ?? 'Terminal')
            : (titles[c.paneId] ?? 'Terminal');
        return <CloseToast key={c.key} entryKey={c.key} kind={c.kind} name={name} />;
      })}
    </div>
  );
};

const CloseToast = ({
  entryKey,
  kind,
  name,
}: {
  entryKey: string;
  kind: 'tab' | 'pane';
  name: string;
}): JSX.Element => {
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
        Closed {kind === 'tab' ? 'tab' : 'pane'} “{name}”
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
      // A focused text field / rich editor keeps its keys. xterm's own input is a
      // <textarea>, so terminal shortcuts still fire while the shell is focused.
      const ae = document.activeElement;
      const inField = ae instanceof HTMLElement && (ae.tagName === 'INPUT' || ae.isContentEditable);

      // ⌘1–9 switch tabs WINDOW-WIDE (not gated on dock focus): the terminal panel
      // is always visible and the app binds no ⌘-digit, mirroring the reference
      // terminal's window-level goto-tab key-equivalents. Match the PHYSICAL key
      // (e.code) so it works on layouts where the number row needs Shift.
      const digit =
        e.code.length === 6 && e.code.startsWith('Digit')
          ? Number(e.code.slice(5))
          : /^[1-9]$/.test(e.key)
            ? Number(e.key)
            : 0;
      if (digit >= 1 && digit <= 9 && !e.shiftKey && !e.altKey && !e.ctrlKey && !inField) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (digit === 9) s.lastTab();
        else s.gotoTab(digit); // ⌘1–8 select tab N; ⌘9 last tab
        return;
      }

      // Every other shortcut acts only when the dock owns focus.
      if (!s.focused || inField) return;
      const k = e.key.toLowerCase();
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
      // Letter shortcuts match the produced char OR the physical key (layout-safe).
      if ((k === 't' || e.code === 'KeyT') && !e.shiftKey && !e.altKey && !e.ctrlKey) {
        action = s.newTab; // ⌘T new tab
      } else if ((k === 'w' || e.code === 'KeyW') && e.altKey && !e.shiftKey && !e.ctrlKey) {
        action = () => s.closeTab(s.activeTabId); // ⌘⌥W close whole tab
      } else if ((k === 'd' || e.code === 'KeyD') && !e.altKey && !e.ctrlKey) {
        action = () => s.splitPane(e.shiftKey ? 'down' : 'right'); // ⌘D / ⌘⇧D split pane
      } else if (e.key === 'Enter' && e.shiftKey) {
        action = s.toggleZoom; // ⌘⇧↵ zoom pane
      } else if (e.code === 'BracketLeft') {
        // ⌘[ cycle panes; ⌘⇧[ previous tab
        action = () => (e.shiftKey ? s.switchTab(-1) : s.gotoPaneRing(-1));
      } else if (e.code === 'BracketRight') {
        action = () => (e.shiftKey ? s.switchTab(1) : s.gotoPaneRing(1));
      } else if (dir && e.altKey && !e.ctrlKey) {
        action = () => s.gotoPaneDir(dir); // ⌘⌥arrow move pane focus
      } else if (dir && e.ctrlKey && !e.altKey) {
        action = () => s.resizePane(dir); // ⌘⌃arrow resize panes
      } else if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === '=' || e.code === 'Equal')) {
        action = s.equalizePanes; // ⌘⌃= equalize panes
      }
      if (!action) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      action();
    };
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
        zIndex: 10,
        transform: 'translateX(-3px)',
        background: active || hover ? color.accent : 'transparent',
        transition: active ? 'none' : transition(['background']),
      }}
    />
  );
};
