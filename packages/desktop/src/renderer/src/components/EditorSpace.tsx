import { type JSX, type MouseEvent as ReactMouseEvent, useEffect, useState } from 'react';
import { color, font, space, transition } from '../design.js';
import type { LeafPane, PaneNode, SplitPane } from '../lib/paneTree.js';
import { EDITOR_MIN_WIDTH, useLayoutStore } from '../store/layout.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { FilePreview } from './FilePreview.js';
import { TabStrip } from './TabStrip.js';

/**
 * The RIGHT region — the right panel: a VS-Code-style editor area. Renders the
 * pane TREE (split groups, each with its own tabs + active editor) docked to the
 * right edge; the canvas keeps the middle and reflows when this resizes / closes.
 * Drag the LEFT sash to rebalance canvas ⇄ panel (the "outer" divider); drag a
 * pane's inner dividers to resize splits.
 */
export const EditorSpace = (): JSX.Element | null => {
  const paneTree = useWorkspaceStore((s) => s.paneTree);
  const activePaneId = useWorkspaceStore((s) => s.activePaneId);
  const rightPanelOpen = useWorkspaceStore((s) => s.rightPanelOpen);
  const editorWidth = useLayoutStore((s) => s.editorWidth);

  // Global editor keys (read the store imperatively so they don't re-subscribe
  // per keystroke):
  //  - Esc / ⌘W  → close the active pane's active tab
  //  - ⌘\        → split the active pane right (the active file in a new pane)
  // Skip close when a form field has focus (those handle their own Escape).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      const s = useWorkspaceStore.getState();
      if (mod && e.key === '\\') {
        if (!s.rightPanelOpen || s.currentFile === null) return;
        e.preventDefault();
        s.splitPane(s.activePaneId, 'row', s.currentFile);
        return;
      }
      const isClose = e.key === 'Escape' || (e.key === 'w' && mod);
      if (!isClose) return;
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (!s.rightPanelOpen || s.currentFile === null) return;
      if (e.key === 'w') e.preventDefault();
      s.closeTab(s.activePaneId, s.currentFile);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Toggled closed → no region; the canvas takes the full middle.
  if (!rightPanelOpen) return null;

  return (
    <aside
      style={{
        position: 'relative',
        flexShrink: 0,
        width: editorWidth,
        height: '100%',
        borderLeft: `1px solid ${color.border}`,
        background: color.surface,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <EditorSash />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <PaneTreeView
          node={paneTree}
          activePaneId={activePaneId}
          singlePane={paneTree.type === 'leaf'}
        />
      </div>
    </aside>
  );
};

// Recursively render the tree: leaves → a Pane, splits → a flexed pair with a
// draggable divider.
const PaneTreeView = ({
  node,
  activePaneId,
  singlePane,
}: { node: PaneNode; activePaneId: string; singlePane: boolean }): JSX.Element => {
  if (node.type === 'leaf') {
    return <Pane leaf={node} isActive={node.id === activePaneId} singlePane={singlePane} />;
  }
  return <PaneSplitView split={node} activePaneId={activePaneId} />;
};

const PaneSplitView = ({
  split,
  activePaneId,
}: { split: SplitPane; activePaneId: string }): JSX.Element => {
  const row = split.direction === 'row';
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: row ? 'row' : 'column',
      }}
    >
      <div
        style={{
          flexGrow: split.fraction,
          flexBasis: 0,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
        }}
      >
        <PaneTreeView node={split.a} activePaneId={activePaneId} singlePane={false} />
      </div>
      <PaneDivider split={split} row={row} />
      <div
        style={{
          flexGrow: 1 - split.fraction,
          flexBasis: 0,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
        }}
      >
        <PaneTreeView node={split.b} activePaneId={activePaneId} singlePane={false} />
      </div>
    </div>
  );
};

// One editor group: its tab strip + the active file's editor (or the empty state
// when it's the only pane and has no tabs). Clicking anywhere in it focuses the
// pane (so the next sidebar/palette open lands here). The active pane wears a
// subtle inset accent frame when more than one pane is open.
const Pane = ({
  leaf,
  isActive,
  singlePane,
}: { leaf: LeafPane; isActive: boolean; singlePane: boolean }): JSX.Element => {
  const setActivePane = useWorkspaceStore((s) => s.setActivePane);
  const hasTabs = leaf.tabs.length > 0;
  return (
    <div
      // Capture-phase mousedown so focusing the pane wins even when the inner
      // editor stops propagation.
      onMouseDownCapture={() => {
        if (!isActive) setActivePane(leaf.id);
      }}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: color.surface,
        // Active-pane accent frame — only meaningful with >1 pane.
        boxShadow: !singlePane && isActive ? `inset 0 0 0 1px ${color.accentSoft}` : 'none',
      }}
    >
      {hasTabs ? (
        <>
          <TabStrip pane={leaf} />
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            {leaf.activeFile !== null && (
              <FilePreview file={leaf.activeFile} paneId={leaf.id} isActive={isActive} />
            )}
          </div>
        </>
      ) : (
        <EmptyPanel />
      )}
    </div>
  );
};

// The split divider — drag to change the parent split's fraction. A 6px hit area
// over a 1px line that lights on hover / drag (mirrors the sidebar/editor sash).
const PaneDivider = ({ split, row }: { split: SplitPane; row: boolean }): JSX.Element => {
  const setPaneFraction = useWorkspaceStore((s) => s.setPaneFraction);
  const [active, setActive] = useState(false);
  const [hover, setHover] = useState(false);

  const onMouseDown = (e: ReactMouseEvent): void => {
    e.preventDefault();
    const container = (e.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    setActive(true);
    const onMove = (ev: MouseEvent): void => {
      const rect = container.getBoundingClientRect();
      const f = row ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
      setPaneFraction(split.id, f);
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

  const lit = active ? color.accent : hover ? color.borderStrong : color.border;
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-testid="pane-divider"
      style={{
        flexShrink: 0,
        position: 'relative',
        cursor: row ? 'col-resize' : 'row-resize',
        ...(row ? { width: 6, height: '100%' } : { height: 6, width: '100%' }),
      }}
    >
      <div
        style={{
          position: 'absolute',
          background: lit,
          transition: active ? 'none' : transition(['background']),
          ...(row
            ? { top: 0, bottom: 0, left: '50%', width: 1, transform: 'translateX(-0.5px)' }
            : { left: 0, right: 0, top: '50%', height: 1, transform: 'translateY(-0.5px)' }),
        }}
      />
    </div>
  );
};

// Shown when the (only) pane is open but has no tabs — so the toggle always
// yields a visible panel and there's a quiet home. The wordmark stays
// (BaseHalf's identity); one line points at how files land here.
const EmptyPanel = (): JSX.Element => (
  <div
    style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space[2],
      padding: space[6],
      textAlign: 'center',
      userSelect: 'none',
    }}
  >
    <div
      style={{
        fontFamily: font.sans,
        fontSize: 22,
        fontWeight: font.weight.semibold,
        letterSpacing: -0.5,
        color: color.textTertiary,
      }}
    >
      BaseHalf
    </div>
    <div
      style={{
        fontFamily: font.sans,
        fontSize: font.size.caption,
        color: color.textGhost,
        lineHeight: 1.5,
        maxWidth: 280,
      }}
    >
      Open a file from the sidebar to edit it here — or drag a card in from the canvas.
    </div>
  </div>
);

// The outer divider's grab strip, on the editor's LEFT edge: drag left to widen
// the editor (narrower canvas), drag right to narrow it. Mirrors SidebarSash —
// a 6px hit area over a 2px accent line that lights on hover / drag.
const EditorSash = (): JSX.Element => {
  const editorWidth = useLayoutStore((s) => s.editorWidth);
  const setEditorWidth = useLayoutStore((s) => s.setEditorWidth);
  const [active, setActive] = useState(false);
  const [hover, setHover] = useState(false);

  const onMouseDown = (e: ReactMouseEvent): void => {
    e.preventDefault();
    setActive(true);
    const startX = e.clientX;
    const startWidth = editorWidth;
    const onMove = (ev: MouseEvent): void => {
      // Editor is on the right, so moving the pointer LEFT (clientX decreases)
      // WIDENS it: width grows by the negative delta. setEditorWidth clamps to
      // [min, viewport − reserve] so the canvas can never be squeezed to zero.
      const proposed = startWidth - (ev.clientX - startX);
      setEditorWidth(Math.max(EDITOR_MIN_WIDTH, proposed));
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
      data-testid="editor-sash"
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
