import { type JSX, type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { color, font, radius, shadow, space, transition } from '../design.js';
import { type FocusDir, dropEdge, leafRects, splitDividers } from '../lib/terminalTree.js';
import { TERMINAL_MIN_WIDTH, useLayoutStore } from '../store/layout.js';
import { type TermGroup, useTerminalStore } from '../store/terminal.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { TERMINAL_BG, TERMINAL_CHROME_BG, TerminalView } from './Terminal.js';

/**
 * The RIGHT-most region: an editor-groups terminal. The dock is a GRID of GROUPS
 * (one split tree whose leaves are groups); each group has its own tab strip and
 * holds single-terminal tabs. Splits are first-class at the GROUP level: ⌘D / ⌘⇧D
 * split the active group, or drag a tab onto another group's edge. ⌘⌥arrows move
 * focus between groups, ⌘⌃arrows resize, ⌘⇧↵ zooms the active group, ⌘[ ⌘] switch
 * tabs in the group, ⌘⇧[ ⌘⇧] cycle groups, ⌘W closes the active tab. The keymap
 * only fires while focus is in the dock (so it never steals the app's shortcuts).
 *
 * Pty survival: every terminal is mounted exactly ONCE in a flat keyed list
 * (keyed by tab id) positioned by its group's rect, so moving a tab between
 * groups — or collapsing a group — never remounts it (which would kill the pty).
 * The group chrome (tab strips, dividers, drop zones) is drawn separately.
 */
const TAB_BAR_HEIGHT = 32;

export const TerminalDock = (): JSX.Element => {
  const width = useLayoutStore((s) => s.terminalWidth);
  const layout = useTerminalStore((s) => s.layout);
  const groups = useTerminalStore((s) => s.groups);
  const activeGroupId = useTerminalStore((s) => s.activeGroupId);
  const zoomedGroupId = useTerminalStore((s) => s.zoomedGroupId);
  const closing = useTerminalStore((s) => s.closing);
  const drag = useTerminalStore((s) => s.drag);
  const titles = useTerminalStore((s) => s.titles);
  const activity = useTerminalStore((s) => s.activity);
  const dims = useTerminalStore((s) => s.dims);
  const setFocused = useTerminalStore((s) => s.setFocused);
  const setActiveGroup = useTerminalStore((s) => s.setActiveGroup);
  const setTitle = useTerminalStore((s) => s.setTitle);
  const setDims = useTerminalStore((s) => s.setDims);
  const markActivity = useTerminalStore((s) => s.markActivity);

  // Folding the workspace name into each terminal's React key re-roots every
  // shell when the workspace switches (main resolves cwd at spawn). Restart
  // bumps a per-tab generation, also folded into the key.
  const workspaceKey = useWorkspaceStore((s) => s.current);
  const [gens, setGens] = useState<Record<string, number>>({});
  const restart = (tabId: string): void => setGens((g) => ({ ...g, [tabId]: (g[tabId] ?? 0) + 1 }));

  const bodyRef = useRef<HTMLDivElement | null>(null);

  useTerminalKeymap();

  // ⌘W (File ▸ Close Tab) closes the active tab when the terminal is focused.
  useEffect(
    () =>
      window.bh.onMenuCloseTab(() => {
        if (useTerminalStore.getState().focused) useTerminalStore.getState().closeActiveTab();
      }),
    [],
  );

  const rects = leafRects(layout);
  const dividers = zoomedGroupId ? [] : splitDividers(layout);
  const groupList = Object.values(groups);
  const multiGroup = groupList.length > 1;

  // Flat mount list: every tab in every group, plus soft-closed tabs (hidden).
  const mounts: Array<{ tab: { id: string }; group: TermGroup | undefined; closing: boolean }> = [];
  for (const g of groupList)
    for (const t of g.tabs) mounts.push({ tab: t, group: g, closing: false });
  for (const c of closing) mounts.push({ tab: c.tab, group: groups[c.groupId], closing: true });

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
        background: TERMINAL_BG,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <TerminalSash />
      <div ref={bodyRef} style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {/* Layer 0: terminals — one mount per tab, positioned at its group's rect. */}
        {mounts.map(({ tab, group, closing: isClosing }) => {
          const rect = group ? rects.get(group.id) : undefined;
          const zoomedHere = zoomedGroupId != null && group?.id === zoomedGroupId;
          const groupVisible = !zoomedGroupId || zoomedHere;
          const visible =
            !isClosing && !!group && group.activeTabId === tab.id && groupVisible && !!rect;
          const pos = zoomedHere
            ? { left: 0, top: 0, width: '100%', height: '100%' }
            : rect
              ? {
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                }
              : { left: 0, top: 0, width: '100%', height: '100%' };
          return (
            <div
              key={tab.id}
              onMouseDownCapture={() => group && setActiveGroup(group.id)}
              style={{
                position: 'absolute',
                ...pos,
                display: visible ? 'flex' : 'none',
                // Leave room for the group's tab strip (drawn above in layer 1).
                paddingTop: TAB_BAR_HEIGHT,
                boxSizing: 'border-box',
              }}
            >
              <TerminalView
                key={`${tab.id}:${workspaceKey ?? 'none'}:${gens[tab.id] ?? 0}`}
                active={visible && group?.id === activeGroupId}
                onRestart={() => restart(tab.id)}
                onTitle={(t) => setTitle(tab.id, t)}
                onDims={(c, rr) => setDims(tab.id, c, rr)}
                onActivity={() => markActivity(tab.id)}
              />
            </div>
          );
        })}

        {/* Layer 1: group chrome — tab strips, focus ring, drop zones. */}
        {groupList.map((g) => {
          const rect = rects.get(g.id);
          if (!rect) return null;
          const zoomedHere = zoomedGroupId === g.id;
          if (zoomedGroupId && !zoomedHere) return null;
          const pos = zoomedHere
            ? { left: 0, top: 0, width: '100%', height: '100%' }
            : {
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.w * 100}%`,
                height: `${rect.h * 100}%`,
              };
          return (
            <GroupChrome
              key={g.id}
              group={g}
              pos={pos}
              isActive={g.id === activeGroupId}
              multiGroup={multiGroup}
              dragging={drag != null}
              titles={titles}
              activity={activity}
            />
          );
        })}

        {/* Layer 2: dividers between groups. */}
        {dividers.map((d) => (
          <PaneDivider key={d.splitId} divider={d} areaRef={bodyRef} />
        ))}

        {/* Layer 3: resize HUD for the active group. */}
        {multiGroup && !zoomedGroupId && (
          <ResizeHud
            tabId={groups[activeGroupId]?.activeTabId}
            rect={rects.get(activeGroupId)}
            dims={dims}
          />
        )}

        {zoomedGroupId && <ZoomBadge />}
      </div>
      <TerminalCloseToasts />
    </aside>
  );
};

// ── One group's chrome: its tab strip on top + drop zones over its body ───────
const GroupChrome = ({
  group,
  pos,
  isActive,
  multiGroup,
  dragging,
  titles,
  activity,
}: {
  group: TermGroup;
  pos: {
    left: number | string;
    top: number | string;
    width: number | string;
    height: number | string;
  };
  isActive: boolean;
  multiGroup: boolean;
  dragging: boolean;
  titles: Record<string, string>;
  activity: Record<string, boolean>;
}): JSX.Element => {
  return (
    <div
      style={{
        position: 'absolute',
        ...pos,
        // Chrome sits above terminals; only the strip + (during a drag) the drop
        // zones are interactive, so terminal mouse/selection passes through.
        pointerEvents: 'none',
        // The focused group wears a subtle accent ring (only with >1 group).
        boxShadow: isActive && multiGroup ? `inset 0 0 0 1px ${color.accent}` : 'none',
        zIndex: 1,
      }}
    >
      <div style={{ pointerEvents: 'auto' }}>
        <GroupTabBar group={group} titles={titles} activity={activity} />
      </div>
      {dragging && <GroupDropZones group={group} />}
    </div>
  );
};

// ── Edge / center drop zones, shown over a group body during a tab drag ───────
// Edge → split this group in that direction (move the dragged tab into the new
// group). Center → move the dragged tab into this group. (Tab-bar drops, handled
// by the strip itself, reorder/insert.)
const GroupDropZones = ({ group }: { group: TermGroup }): JSX.Element => {
  const drag = useTerminalStore((s) => s.drag);
  const splitGroupWithTab = useTerminalStore((s) => s.splitGroupWithTab);
  const moveTab = useTerminalStore((s) => s.moveTab);
  const ref = useRef<HTMLDivElement | null>(null);
  const [target, setTarget] = useState<FocusDir | 'center' | null>(null);

  return (
    <div
      ref={ref}
      onDragOver={(e) => {
        if (!drag) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const box = ref.current?.getBoundingClientRect();
        if (!box || box.width === 0 || box.height === 0) return;
        setTarget(
          dropTarget((e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height),
        );
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setTarget(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const d = useTerminalStore.getState().drag;
        if (d && target) {
          if (target === 'center') moveTab(d.tabId, d.fromGroupId, group.id, group.tabs.length);
          else splitGroupWithTab(group.id, target, d.tabId, d.fromGroupId);
        }
        setTarget(null);
      }}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: TAB_BAR_HEIGHT,
        bottom: 0,
        pointerEvents: 'auto',
        zIndex: 2,
      }}
    >
      {target && <DropZonePreview target={target} />}
    </div>
  );
};

const DropZonePreview = ({ target }: { target: FocusDir | 'center' }): JSX.Element => {
  const box: React.CSSProperties =
    target === 'center'
      ? { left: 0, top: 0, right: 0, bottom: 0 }
      : target === 'left'
        ? { left: 0, top: 0, bottom: 0, width: '50%' }
        : target === 'right'
          ? { right: 0, top: 0, bottom: 0, width: '50%' }
          : target === 'up'
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

// Central region (the inner 50%) → move into the group; outer bands → split on
// the nearest edge.
function dropTarget(px: number, py: number): FocusDir | 'center' {
  const m = 0.25;
  if (px > m && px < 1 - m && py > m && py < 1 - m) return 'center';
  return dropEdge(px, py);
}

// ── A group's tab strip (editor-style: content-width, left-aligned, scrolls) ──
const TAB_MIN_WIDTH = 92;
const TAB_MAX_WIDTH = 180;

const GroupTabBar = ({
  group,
  titles,
  activity,
}: {
  group: TermGroup;
  titles: Record<string, string>;
  activity: Record<string, boolean>;
}): JSX.Element => {
  const focusTab = useTerminalStore((s) => s.focusTab);
  const closeTab = useTerminalStore((s) => s.closeTab);
  const closeOtherTabs = useTerminalStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useTerminalStore((s) => s.closeTabsToRight);
  const newTab = useTerminalStore((s) => s.newTab);
  const setActiveGroup = useTerminalStore((s) => s.setActiveGroup);
  const setTabTitle = useTerminalStore((s) => s.setTabTitle);
  const moveTab = useTerminalStore((s) => s.moveTab);
  const setDrag = useTerminalStore((s) => s.setDrag);
  const toggleZoom = useTerminalStore((s) => s.toggleZoom);
  const zoomedHere = useTerminalStore((s) => s.zoomedGroupId === group.id);

  const closable = group.tabs.length > 1;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const menuIdx = menu ? group.tabs.findIndex((t) => t.id === menu.tabId) : -1;

  const dropToGroup = (toIndex: number): void => {
    const d = useTerminalStore.getState().drag;
    if (d) moveTab(d.tabId, d.fromGroupId, group.id, toIndex);
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: TAB_BAR_HEIGHT,
        background: TERMINAL_CHROME_BG,
        borderBottom: `1px solid ${color.border}`,
        overflow: 'hidden',
      }}
    >
      <div
        data-term-tabs
        role="tablist"
        aria-label="Terminal tabs"
        onMouseDown={() => setActiveGroup(group.id)}
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget) {
            setActiveGroup(group.id);
            newTab();
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          dropToGroup(group.tabs.length); // dropped on empty strip area → append
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
        {group.tabs.map((t, i) => (
          <TermTab
            key={t.id}
            title={t.titleOverride ?? titles[t.id] ?? 'Terminal'}
            hasOverride={t.titleOverride != null}
            active={t.id === group.activeTabId}
            first={i === 0}
            closable={closable}
            activity={!!activity[t.id] && t.id !== group.activeTabId}
            editing={editingId === t.id}
            onSelect={() => focusTab(group.id, t.id)}
            onClose={() => closeTab(group.id, t.id)}
            onContextMenu={(x, y) => setMenu({ tabId: t.id, x, y })}
            onEditStart={() => setEditingId(t.id)}
            onEditCommit={(title) => {
              setEditingId(null);
              setTabTitle(group.id, t.id, title);
            }}
            onEditCancel={() => setEditingId(null)}
            onDragStart={() => setDrag({ tabId: t.id, fromGroupId: group.id })}
            onDragEnd={() => setDrag(null)}
            onDropHere={() => dropToGroup(i)}
          />
        ))}
      </div>
      {zoomedHere && (
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
        onClick={() => {
          setActiveGroup(group.id);
          newTab();
        }}
        style={iconBtn(color.textTertiary)}
      >
        +
      </button>
      {menu && (
        <TabContextMenu
          x={menu.x}
          y={menu.y}
          canClose={closable}
          canCloseOthers={group.tabs.length > 1}
          canCloseToRight={menuIdx >= 0 && menuIdx < group.tabs.length - 1}
          onRename={() => {
            setEditingId(menu.tabId);
            setMenu(null);
          }}
          onClose={() => {
            closeTab(group.id, menu.tabId);
            setMenu(null);
          }}
          onCloseOthers={() => {
            closeOtherTabs(group.id, menu.tabId);
            setMenu(null);
          }}
          onCloseToRight={() => {
            closeTabsToRight(group.id, menu.tabId);
            setMenu(null);
          }}
          onNewTab={() => {
            setActiveGroup(group.id);
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

const TermTab = ({
  title,
  hasOverride,
  active,
  first,
  closable,
  activity,
  editing,
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
  activity: boolean;
  editing: boolean;
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

  useEffect(() => {
    if (editing) setDraft(hasOverride ? title : '');
  }, [editing, hasOverride, title]);
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
        e.stopPropagation();
        onDropHere();
      }}
      style={{
        position: 'relative',
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
        fontFamily: font.sans,
        fontSize: font.size.caption,
        color: active ? '#ffffff' : color.textTertiary,
        background: active ? TERMINAL_BG : 'transparent',
        boxShadow: first || active ? 'none' : `inset 1px 0 0 ${color.border}`,
        transition: transition(['color', 'background']),
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

// ── Divider between groups (drag to resize; double-click to reset to 50/50) ───
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

// The transient "cols × rows" HUD over the active group on resize.
const ResizeHud = ({
  tabId,
  rect,
  dims,
}: {
  tabId: string | undefined;
  rect: { x: number; y: number; w: number; h: number } | undefined;
  dims: Record<string, { cols: number; rows: number }>;
}): JSX.Element | null => {
  const resizeTick = useTerminalStore((s) => s.resizeTick);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (resizeTick === 0) return;
    setShow(true);
    const id = window.setTimeout(() => setShow(false), 750);
    return () => window.clearTimeout(id);
  }, [resizeTick]);
  const dim = tabId ? dims[tabId] : undefined;
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
      {closing.map((c) => (
        <CloseToast
          key={c.key}
          entryKey={c.key}
          name={c.tab.titleOverride ?? titles[c.tab.id] ?? 'Terminal'}
        />
      ))}
    </div>
  );
};

const CloseToast = ({ entryKey, name }: { entryKey: string; name: string }): JSX.Element => {
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
        action = s.newTab; // ⌘T new tab in the active group
      } else if (k === 'd' && !e.altKey && !e.ctrlKey) {
        action = () => s.splitGroupWithNewTab(e.shiftKey ? 'down' : 'right'); // ⌘D / ⌘⇧D split group
      } else if (e.key === 'Enter' && e.shiftKey) {
        action = s.toggleZoom; // ⌘⇧↵ zoom group
      } else if (e.code === 'BracketLeft') {
        // ⌘[ switch tab in group; ⌘⇧[ cycle groups
        action = () => (e.shiftKey ? s.gotoGroupRing(-1) : s.switchTab(-1));
      } else if (e.code === 'BracketRight') {
        action = () => (e.shiftKey ? s.gotoGroupRing(1) : s.switchTab(1));
      } else if (dir && e.altKey && !e.ctrlKey) {
        action = () => s.gotoGroupDir(dir); // ⌘⌥arrow move focus between groups
      } else if (dir && e.ctrlKey && !e.altKey) {
        action = () => s.resizeFocusedGroup(dir); // ⌘⌃arrow resize groups
      } else if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === '=' || e.code === 'Equal')) {
        action = s.equalizeGroups; // ⌘⌃= equalize groups
      } else if (!e.shiftKey && !e.altKey && !e.ctrlKey && /^[1-9]$/.test(e.key)) {
        const n = Number(e.key); // ⌘1–8 select tab N in the active group; ⌘9 last tab
        action = n === 9 ? s.lastTab : () => s.gotoTab(n);
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
