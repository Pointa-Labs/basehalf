import { type JSX, useCallback, useEffect } from 'react';
import { color, font, transition } from '../design.js';
import { isImeComposing } from '../lib/imeGuard.js';
import { useLayoutStore } from '../store/layout.js';
import { useTerminalStore } from '../store/terminal.js';
import { EDITOR_OVERLAY_PANE_ID, useWorkspaceStore } from '../store/workspace.js';
import { Breadcrumb } from './Breadcrumb.js';
import { FilePreview } from './FilePreview.js';
import { GitGraphView } from './GitGraphView.js';
import { MergeEditor } from './MergeEditor.js';
import { PullRequestView } from './PullRequestView.js';
import { UnifiedDiffView } from './UnifiedDiffView.js';

/**
 * The full-canvas editor overlay. When a file is open it covers the canvas
 * region like opening a full-page document: a breadcrumb header
 * (`workspace / folder / … / filename` — see {@link Breadcrumb}) over
 * `FilePreview` filling the rest. It is NOT a draggable/resizable window —
 * `position:absolute; inset:0` fills the canvas region and reflows with it. The
 * canvas (react-flow) stays mounted UNDERNEATH with its pan/zoom/scope intact,
 * so leaving reveals it unchanged.
 *
 * Z-order: a sibling of `<Canvas/>` and `<Sidebar/>` inside `<main>`. The
 * overlay sits ABOVE the canvas + its chrome (it is opaque and fills the region)
 * but BELOW the Sidebar (z-index 6) so the nav stays clickable — you can click
 * another file there to switch the open file without first closing.
 *
 * Renders `null` when no file is open. There is no ✕: you leave by clicking an
 * ancestor crumb, or with Esc / ⌘W (both guarded against IME composition + an
 * editable surface that needs Esc for its own dismiss).
 */
export const EditorOverlay = (): JSX.Element | null => {
  const openFile = useWorkspaceStore((s) => s.openFile);
  const gitDiff = useWorkspaceStore((s) => s.gitDiff);
  const closeGitDiff = useWorkspaceStore((s) => s.closeGitDiff);
  const gitGraphOpen = useWorkspaceStore((s) => s.gitGraphOpen);
  const closeGitGraph = useWorkspaceStore((s) => s.closeGitGraph);
  const mergeFile = useWorkspaceStore((s) => s.mergeFile);
  const closeMerge = useWorkspaceStore((s) => s.closeMerge);
  const prView = useWorkspaceStore((s) => s.prView);
  const closePr = useWorkspaceStore((s) => s.closePr);
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
    const st = useWorkspaceStore.getState();
    if (st.prView !== null) {
      st.closePr();
      return;
    }
    if (st.mergeFile !== null) {
      st.closeMerge();
      return;
    }
    if (st.gitGraphOpen) {
      st.closeGitGraph();
      return;
    }
    if (st.gitDiff !== null) {
      st.closeGitDiff();
      return;
    }
    if (st.openFile === null) return;
    st.closeEditor();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const st = useWorkspaceStore.getState();
      if (
        st.openFile === null &&
        st.gitDiff === null &&
        !st.gitGraphOpen &&
        st.mergeFile === null &&
        st.prView === null
      )
        return;
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
  // can't close the window; we run the same close path as Esc / the ✕. But when
  // the terminal dock has focus, ⌘W belongs to it (close the focused split) —
  // yield so a single ⌘W never closes both the split AND the document behind it.
  useEffect(
    () =>
      window.bh.onMenuCloseTab(() => {
        if (useTerminalStore.getState().focused) return;
        close();
      }),
    [close],
  );

  if (
    openFile === null &&
    gitDiff === null &&
    !gitGraphOpen &&
    mergeFile === null &&
    prView === null
  )
    return null;

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
      {prView !== null ? (
        <PullRequestView
          key={`${prView.remoteUrl}#${prView.number}`}
          number={prView.number}
          title={prView.title}
          remoteUrl={prView.remoteUrl}
          url={prView.url}
          onClose={closePr}
        />
      ) : mergeFile !== null ? (
        <MergeEditor key={mergeFile} path={mergeFile} onClose={closeMerge} />
      ) : gitGraphOpen ? (
        <GitGraphView onClose={closeGitGraph} />
      ) : gitDiff !== null ? (
        <UnifiedDiffView
          key={`${gitDiff.path}:${gitDiff.staged}:${gitDiff.rightRef ?? ''}`}
          path={gitDiff.path}
          staged={gitDiff.staged}
          leftRef={gitDiff.leftRef}
          rightRef={gitDiff.rightRef}
          title={gitDiff.title}
          onClose={closeGitDiff}
        />
      ) : openFile !== null ? (
        <>
          <Breadcrumb />
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            {/* A stable synthetic paneId keys this file's flusher in the editorFlush
                registry; FilePreview itself keys the editor by workspace-root + path,
                so a switch remounts cleanly. */}
            <FilePreview file={openFile} paneId={EDITOR_OVERLAY_PANE_ID} isActive />
          </div>
        </>
      ) : null}
    </div>
  );
};
