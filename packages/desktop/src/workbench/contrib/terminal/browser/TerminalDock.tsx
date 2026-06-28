import { type JSX, useEffect, useRef, useState } from 'react';
import { nativeHostService } from '../../../../platform/native/browser/nativeHostService.js';
import { useLayoutStore } from '../../../browser/layout/layoutStore.js';
import { openContextMenu } from '../../../browser/parts/contextmenu/contextMenuStore.js';
import { color } from '../../../browser/style/design.js';
import { TerminalView } from './Terminal.js';
import { TerminalCloseToasts } from './TerminalCloseToasts.js';
import {
  TerminalPaneDivider,
  TerminalResizeHud,
  TerminalUnfocusedOverlay,
  TerminalZoomBadge,
} from './TerminalPaneChrome.js';
import { TerminalPaneDropZones, TerminalPaneGrabHandle } from './TerminalPaneDragDrop.js';
import { TerminalSash } from './TerminalSash.js';
import { TerminalTabBar } from './TerminalTabs.js';
import { terminalActiveLayout, terminalPaneMounts } from './terminalDockModel.js';
import { buildTerminalMenu } from './terminalMenus.js';
import { useTerminalStore } from './terminalStore.js';
import { TERMINAL_BG } from './terminalTheme.js';
import { useTerminalKeymap } from './useTerminalKeymap.js';

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
      nativeHostService.onMenuCloseTab(() => {
        if (useTerminalStore.getState().focused) useTerminalStore.getState().closeActivePane();
      }),
    [],
  );

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const { activeRects, zoomedPaneId, dividers, dimUnfocused } = terminalActiveLayout(activeTab);
  const mounts = terminalPaneMounts(tabs, closing);

  return (
    <aside
      data-terminal-dock
      aria-label="Terminal"
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
              // Right-click → the terminal's own menu (Copy/Paste/Clear/Split/
              // Close). preventDefault suppresses xterm's default menu; focus the
              // clicked pane first so Split/Close target it.
              onContextMenu={(e) => {
                e.preventDefault();
                if (tab) focusPane(tab.id, paneId);
                openContextMenu(e.clientX, e.clientY, buildTerminalMenu(paneId));
              }}
              style={{ position: 'absolute', ...pos, display: visible ? 'flex' : 'none' }}
            >
              <TerminalView
                key={`${paneId}:${gens[paneId] ?? 0}`}
                paneId={paneId}
                active={visible && paneId === activeTab?.activePaneId}
                onRestart={() => restart(paneId)}
                onTitle={(t) => setTitle(paneId, t)}
                onDims={(c, rr) => setDims(paneId, c, rr)}
                onActivity={() => markActivity(paneId)}
              />
              {visible && dimUnfocused && paneId !== activeTab?.activePaneId && (
                <TerminalUnfocusedOverlay />
              )}
              {/* Grab handle (the ⋯) to drag a pane to a new spot — only when split. */}
              {visible && dimUnfocused && <TerminalPaneGrabHandle paneId={paneId} />}
              {/* Drop zones over the OTHER panes while a pane is being dragged. */}
              {visible && paneDrag && paneDrag.paneId !== paneId && (
                <TerminalPaneDropZones destPaneId={paneId} />
              )}
            </div>
          );
        })}

        {/* Layer 1: dividers between panes of the active tab. */}
        {dividers.map((d) => (
          <TerminalPaneDivider key={d.splitId} divider={d} areaRef={bodyRef} />
        ))}

        {/* Layer 2: resize HUD + zoom badge for the active tab. */}
        {activeTab && activeTab.tree.type === 'split' && (
          <TerminalResizeHud
            paneId={activeTab.activePaneId}
            rect={activeRects.get(activeTab.activePaneId)}
            dims={dims}
          />
        )}
        {zoomedPaneId && <TerminalZoomBadge />}
      </div>
      <TerminalCloseToasts />
    </aside>
  );
};
