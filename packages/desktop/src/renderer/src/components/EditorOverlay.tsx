import { type JSX, useCallback, useEffect } from 'react';
import { color, font, radius, space, transition } from '../design.js';
import { isImeComposing } from '../lib/imeGuard.js';
import { useLayoutStore } from '../store/layout.js';
import { EDITOR_OVERLAY_PANE_ID, useWorkspaceStore } from '../store/workspace.js';
import { FilePreview } from './FilePreview.js';

function splitPath(rel: string): { dirname: string; basename: string } {
  const i = rel.lastIndexOf('/');
  return i === -1
    ? { dirname: '', basename: rel }
    : { dirname: rel.slice(0, i), basename: rel.slice(i + 1) };
}

/**
 * The full-canvas editor overlay. When a file is open it covers the canvas
 * region like opening a full-page document: a thin top bar (✕ close + the file
 * name / relative path) over `FilePreview` filling the rest. It is NOT a
 * draggable/resizable window — `position:absolute; inset:0` fills the canvas
 * region and reflows with it. The canvas (react-flow) stays mounted UNDERNEATH
 * with its pan/zoom/scope intact, so closing reveals it unchanged.
 *
 * Z-order: a sibling of `<Canvas/>` and `<Sidebar/>` inside `<main>`. The
 * overlay sits ABOVE the canvas + its chrome (it is opaque and fills the region)
 * but BELOW the Sidebar (z-index 6) so the nav stays clickable — you can click
 * another file there to switch the open file without first closing.
 *
 * Renders `null` when no file is open. Esc / the ✕ / ⌘W close it back to the
 * canvas (Esc is guarded against IME composition + an editable surface that
 * needs Esc for its own dismiss).
 */
export const EditorOverlay = (): JSX.Element | null => {
  const openFile = useWorkspaceStore((s) => s.openFile);
  const closeEditor = useWorkspaceStore((s) => s.closeEditor);
  // The Sidebar floats over the canvas's left at z-index 6 (opaque). If the
  // overlay started at left:0 it would tuck its top bar (✕ + filename) UNDER the
  // sidebar. Inset the overlay's left by the sidebar width when it's open, so the
  // document sits BESIDE the nav — a nav + page layout — and the sidebar stays
  // usable to switch files. When the sidebar is closed the overlay fills fully.
  const sidebarOpen = useLayoutStore((s) => s.sidebarOpen);
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth);
  const leftInset = sidebarOpen ? sidebarWidth : 0;

  // Esc / ⌘W close the overlay. Read the store imperatively so the listener
  // isn't rebound per open-file change. Skip Esc when an editable surface has
  // focus or an IME is composing — those press Esc to dismiss candidates / blur
  // their own field, not to close the document under the user.
  const close = useCallback((): void => {
    if (useWorkspaceStore.getState().openFile === null) return;
    useWorkspaceStore.getState().closeEditor();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (useWorkspaceStore.getState().openFile === null) return;
      if (isImeComposing(e)) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true
      ) {
        return;
      }
      e.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  // ⌘W (File ▸ Close Tab) → close the overlay. Main owns the accelerator so it
  // can't close the window; we run the same close path as Esc / the ✕.
  useEffect(() => window.bh.onMenuCloseTab(close), [close]);

  if (openFile === null) return null;

  const { dirname, basename } = splitPath(openFile);

  return (
    <div
      data-testid="editor-overlay"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        // Sit beside the floating Sidebar (see leftInset) rather than under it.
        left: leftInset,
        transition: transition(['left']),
        // Above the canvas + its chrome, below the Sidebar (z-index 6) so the nav
        // stays clickable while a file is open.
        zIndex: 5,
        background: color.bg,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: font.sans,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
          padding: `${space[1.5]}px ${space[3]}px`,
          background: color.surfaceMuted,
          borderBottom: `1px solid ${color.border}`,
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={close}
          title="Close (Esc)"
          aria-label="Close editor"
          data-testid="editor-overlay-close"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            flexShrink: 0,
            padding: 0,
            border: `1px solid ${color.border}`,
            borderRadius: radius.md,
            background: 'transparent',
            color: color.textTertiary,
            cursor: 'pointer',
            transition: transition(['color', 'border-color', 'background']),
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = color.textPrimary;
            e.currentTarget.style.borderColor = color.borderStrong;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = color.textTertiary;
            e.currentTarget.style.borderColor = color.border;
          }}
        >
          <svg width={13} height={13} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth={1.4}
              strokeLinecap="round"
            />
          </svg>
        </button>
        <span
          style={{
            fontSize: font.size.ui,
            fontWeight: font.weight.semibold,
            color: color.textPrimary,
            letterSpacing: -0.1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            maxWidth: '60%',
          }}
        >
          {basename}
        </span>
        {dirname && (
          <span
            style={{
              fontFamily: font.mono,
              fontSize: font.size.micro,
              color: color.textTertiary,
              letterSpacing: -0.2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {dirname}/
          </span>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* A stable synthetic paneId keys this file's flusher in the editorFlush
            registry; FilePreview itself keys the editor by workspace-root + path,
            so a switch remounts cleanly. */}
        <FilePreview file={openFile} paneId={EDITOR_OVERLAY_PANE_ID} isActive />
      </div>
    </div>
  );
};
