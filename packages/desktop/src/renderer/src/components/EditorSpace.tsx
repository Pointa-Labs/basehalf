import { type JSX, type MouseEvent as ReactMouseEvent, useState } from 'react';
import { color, transition } from '../design.js';
import { EDITOR_MIN_WIDTH, useLayoutStore } from '../store/layout.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { FilePreview } from './FilePreview.js';
import { TabStrip } from './TabStrip.js';

/**
 * The RIGHT region — the right panel: a VS-Code-style tabbed editor docked to
 * the right edge. The canvas keeps the middle and reflows when this resizes /
 * closes. Shown when there are open tabs AND the top-right toggle hasn't hidden
 * it (tabs persist while hidden). Drag the LEFT sash to rebalance canvas ⇄ panel
 * (the "outer" divider); the tab strip switches files; only the active tab's
 * editor is mounted.
 */
export const EditorSpace = (): JSX.Element | null => {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const rightPanelOpen = useWorkspaceStore((s) => s.rightPanelOpen);
  const editorWidth = useLayoutStore((s) => s.editorWidth);

  // No tabs, or toggled closed → no region; the canvas takes the full middle.
  if (tabs.length === 0 || !rightPanelOpen) return null;

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
      <TabStrip />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <FilePreview />
      </div>
    </aside>
  );
};

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
