import { type CSSProperties, type JSX, useEffect, useRef, useState } from 'react';
import { openContextMenu } from '../../../../platform/contextview/browser/contextMenuService.js';
import { color, font, layout, radius, space, transition } from '../../../browser/style/design.js';
import { buildTerminalTabMenu } from './terminalMenus.js';
import { type TermTab, useTerminalStore } from './terminalStore.js';
import { TERMINAL_BG, TERMINAL_CHROME_BG } from './terminalTheme.js';

// Matches VS Code's split between terminalView and terminalTabsList: the dock
// owns layout, while this component owns tab list rendering, editing, DnD, and
// the terminal-tab context menu.
export const TERMINAL_TAB_BAR_HEIGHT = layout.chromeBarHeight;
const TAB_MIN_WIDTH = 56;

export const TerminalTabBar = ({
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
    (s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.zoomedPaneId != null,
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const dropAt = (toIndex: number): void => {
    const drag = useTerminalStore.getState().drag;
    if (drag) reorderTab(drag.tabId, toIndex);
    setDropIndex(null);
  };

  const splitTab = (tabId: string, dir: 'right' | 'down'): void => {
    selectTab(tabId);
    splitPane(dir);
  };

  const openTabMenu = (tabId: string, x: number, y: number): void => {
    const idx = tabs.findIndex((tab) => tab.id === tabId);
    if (idx < 0) return;
    openContextMenu(
      x,
      y,
      buildTerminalTabMenu({
        canCloseOthers: tabs.length > 1,
        canCloseToRight: idx < tabs.length - 1,
        onRename: () => setEditingId(tabId),
        onClose: () => closeTab(tabId),
        onCloseOthers: () => closeOtherTabs(tabId),
        onCloseToRight: () => closeTabsToRight(tabId),
        onSplitRight: () => splitTab(tabId, 'right'),
        onSplitDown: () => splitTab(tabId, 'down'),
        onNewTab: newTab,
      }),
    );
  };

  const selectTabAt = (index: number, restoreFocus = false): void => {
    const normalized = (index + tabs.length) % tabs.length;
    const next = tabs[normalized];
    if (next) selectTab(next.id);
    if (next && restoreFocus) {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-terminal-tab-id="${next.id}"]`)?.focus();
      });
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: TERMINAL_TAB_BAR_HEIGHT,
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
        onDoubleClick={(event) => {
          if (event.target === event.currentTarget) newTab();
        }}
        onDragOver={(event) => {
          if (!useTerminalStore.getState().drag) return;
          event.preventDefault();
          if (event.target === event.currentTarget) setDropIndex(tabs.length);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDropIndex(null);
          }
        }}
        onDrop={(event) => {
          if (!useTerminalStore.getState().drag) return;
          event.preventDefault();
          if (event.target === event.currentTarget) dropAt(tabs.length);
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
        {tabs.map((tab, index) => (
          <TerminalTab
            key={tab.id}
            tabId={tab.id}
            index={index + 1}
            title={tab.titleOverride ?? titles[tab.activePaneId] ?? ''}
            hasOverride={tab.titleOverride != null}
            active={tab.id === activeTabId}
            first={index === 0}
            total={tabs.length}
            activity={!!activity[tab.id]}
            editing={editingId === tab.id}
            dropBefore={dropIndex === index}
            dropAfter={dropIndex === tabs.length && index === tabs.length - 1}
            onSelect={() => selectTab(tab.id)}
            onClose={() => closeTab(tab.id)}
            onContextMenu={(x, y) => openTabMenu(tab.id, x, y)}
            onEditStart={() => setEditingId(tab.id)}
            onEditCommit={(title) => {
              setEditingId(null);
              setTabTitle(tab.id, title);
            }}
            onEditCancel={() => setEditingId(null)}
            onSelectPrevious={() => selectTabAt(index - 1, true)}
            onSelectNext={() => selectTabAt(index + 1, true)}
            onSelectFirst={() => selectTabAt(0, true)}
            onSelectLast={() => selectTabAt(tabs.length - 1, true)}
            onDragStart={() => setDrag({ tabId: tab.id })}
            onDragEnd={() => {
              setDrag(null);
              setDropIndex(null);
            }}
            onDragOverHere={(side) => setDropIndex(index + (side === 'after' ? 1 : 0))}
            onDropHere={(side) => dropAt(index + (side === 'after' ? 1 : 0))}
          />
        ))}
      </div>
      {zoomed && (
        <button
          type="button"
          title="Reset zoom (⌘⇧↵)"
          aria-label="Reset zoom"
          onClick={toggleZoom}
          style={iconButton(color.accent)}
        >
          ⤢
        </button>
      )}
      <button
        type="button"
        title="New terminal tab (⌘T)"
        aria-label="New terminal tab"
        onClick={() => newTab()}
        style={iconButton(color.textTertiary)}
      >
        +
      </button>
    </div>
  );
};

const iconButton = (foreground: string): CSSProperties => ({
  flexShrink: 0,
  width: TERMINAL_TAB_BAR_HEIGHT,
  border: 'none',
  borderLeft: `1px solid ${color.border}`,
  background: 'transparent',
  color: foreground,
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
});

const TerminalTab = ({
  tabId,
  index,
  title,
  hasOverride,
  active,
  first,
  total,
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
  onSelectPrevious,
  onSelectNext,
  onSelectFirst,
  onSelectLast,
  onDragStart,
  onDragEnd,
  onDragOverHere,
  onDropHere,
}: {
  tabId: string;
  index: number;
  title: string;
  hasOverride: boolean;
  active: boolean;
  first: boolean;
  total: number;
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
  onSelectPrevious: () => void;
  onSelectNext: () => void;
  onSelectFirst: () => void;
  onSelectLast: () => void;
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

  const showClose = hover || active;
  const dragSide = (clientX: number): 'before' | 'after' => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return 'before';
    return clientX - box.left <= box.width / 2 ? 'before' : 'after';
  };

  return (
    <div
      ref={ref}
      data-terminal-tab-id={tabId}
      role="tab"
      aria-selected={active}
      aria-posinset={index}
      aria-setsize={total}
      aria-label={title ? `Tab ${index}: ${title}` : `Tab ${index}`}
      tabIndex={editing ? -1 : active ? 0 : -1}
      draggable={!editing}
      onMouseDown={(event) => {
        if (editing) return;
        if (event.button === 1) {
          event.preventDefault();
          onClose();
          return;
        }
        if (event.button === 0) onSelect();
      }}
      onKeyDown={(event) => {
        if (editing) return;
        const openKeyboardMenu = (): void => {
          const box = ref.current?.getBoundingClientRect();
          onContextMenu(box ? box.left + 8 : 0, box ? box.bottom : 0);
        };
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          onSelect();
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          event.stopPropagation();
          onSelectPrevious();
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          event.stopPropagation();
          onSelectNext();
        } else if (event.key === 'Home') {
          event.preventDefault();
          event.stopPropagation();
          onSelectFirst();
        } else if (event.key === 'End') {
          event.preventDefault();
          event.stopPropagation();
          onSelectLast();
        } else if (event.key === 'F10' && event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          openKeyboardMenu();
        } else if (event.key === 'ContextMenu') {
          event.preventDefault();
          event.stopPropagation();
          openKeyboardMenu();
        }
      }}
      onDoubleClick={onEditStart}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (editing) return;
        onContextMenu(event.clientX, event.clientY);
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-bh-term-tab', '1');
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (!useTerminalStore.getState().drag) return;
        event.preventDefault();
        onDragOverHere(dragSide(event.clientX));
      }}
      onDrop={(event) => {
        if (!useTerminalStore.getState().drag) return;
        event.preventDefault();
        event.stopPropagation();
        onDropHere(dragSide(event.clientX));
      }}
      style={{
        position: 'relative',
        flex: '1 1 0',
        minWidth: TAB_MIN_WIDTH,
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
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => onEditCommit(draft)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onEditCommit(draft);
            else if (event.key === 'Escape') onEditCancel();
            event.stopPropagation();
          }}
          onMouseDown={(event) => event.stopPropagation()}
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
            justifyContent: 'center',
            gap: space[1],
            overflow: 'hidden',
            paddingLeft: 16,
          }}
        >
          <span
            aria-hidden
            style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', opacity: 0.55 }}
          >
            ⌘{index}
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
            tabIndex={showClose ? 0 : -1}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
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
              opacity: showClose ? 0.75 : 0,
              visibility: showClose ? 'visible' : 'hidden',
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
              opacity: activity && !showClose ? 1 : 0,
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
