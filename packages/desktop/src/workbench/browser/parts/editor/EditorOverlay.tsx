import { type JSX, useCallback, useEffect } from 'react';
import { nativeHostService } from '../../../../platform/native/browser/nativeHostService.js';
import { PullRequestView } from '../../../contrib/githubPullRequests/browser/PullRequestView.js';
import { MergeEditor } from '../../../contrib/multiDiffEditor/browser/MergeEditor.js';
import { UnifiedDiffView } from '../../../contrib/multiDiffEditor/browser/UnifiedDiffView.js';
import { GitGraphView } from '../../../contrib/scm/browser/GitGraphView.js';
import { useTerminalStore } from '../../../contrib/terminal/browser/terminalStore.js';
import {
  WORKSPACE_DIFF_EDITOR_INPUT_TYPE_ID,
  WORKSPACE_GIT_GRAPH_EDITOR_INPUT_TYPE_ID,
  WORKSPACE_MERGE_EDITOR_INPUT_TYPE_ID,
  WORKSPACE_PULL_REQUEST_EDITOR_INPUT_TYPE_ID,
  WORKSPACE_RESOURCE_EDITOR_INPUT_TYPE_ID,
  isWorkspaceEditorOverlayOpen,
  workspaceEditorInputFromSnapshot,
  workspaceEditorOverlayKind,
} from '../../../services/workspace/browser/workspaceModel.js';
import {
  EDITOR_OVERLAY_PANE_ID,
  useWorkspaceStore,
} from '../../../services/workspace/browser/workspaceStore.js';
import { useLayoutStore } from '../../layout/layoutStore.js';
import { color, font, transition } from '../../style/design.js';
import { isImeComposing } from '../../ui/imeGuard.js';
import { Breadcrumb } from './Breadcrumb.js';
import { FilePreview } from './FilePreview.js';

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
 * Renders `null` when no editor input is open. There is no ✕ for file inputs:
 * you leave by clicking an ancestor crumb, or with Esc / ⌘W (both guarded
 * against IME composition + an editable surface that needs Esc for its own
 * dismiss).
 */
export const EditorOverlay = (): JSX.Element | null => {
  const activeEditor = useWorkspaceStore(workspaceEditorInputFromSnapshot);
  const closeGitDiff = useWorkspaceStore((s) => s.closeGitDiff);
  const closeGitGraph = useWorkspaceStore((s) => s.closeGitGraph);
  const closeMerge = useWorkspaceStore((s) => s.closeMerge);
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
    switch (workspaceEditorOverlayKind(st)) {
      case 'pullRequest':
        st.closePr();
        return;
      case 'merge':
        st.closeMerge();
        return;
      case 'gitGraph':
        st.closeGitGraph();
        return;
      case 'gitDiff':
        st.closeGitDiff();
        return;
      case 'file':
        st.closeEditor();
        return;
      case null:
        return;
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const st = useWorkspaceStore.getState();
      if (!isWorkspaceEditorOverlayOpen(st)) return;
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
      nativeHostService.onMenuCloseTab(() => {
        if (useTerminalStore.getState().focused) return;
        close();
      }),
    [close],
  );

  if (activeEditor === null) return null;

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
      {activeEditor.typeId === WORKSPACE_PULL_REQUEST_EDITOR_INPUT_TYPE_ID ? (
        <PullRequestView
          key={`${activeEditor.remoteUrl}#${activeEditor.number}`}
          number={activeEditor.number}
          title={activeEditor.title}
          remoteUrl={activeEditor.remoteUrl}
          url={activeEditor.url}
          onClose={closePr}
        />
      ) : activeEditor.typeId === WORKSPACE_MERGE_EDITOR_INPUT_TYPE_ID ? (
        <MergeEditor
          key={activeEditor.resource}
          path={activeEditor.resource}
          onClose={closeMerge}
        />
      ) : activeEditor.typeId === WORKSPACE_GIT_GRAPH_EDITOR_INPUT_TYPE_ID ? (
        <GitGraphView onClose={closeGitGraph} />
      ) : activeEditor.typeId === WORKSPACE_DIFF_EDITOR_INPUT_TYPE_ID ? (
        <UnifiedDiffView
          key={`${activeEditor.path}:${activeEditor.staged}:${activeEditor.rightRef ?? ''}`}
          path={activeEditor.path}
          staged={activeEditor.staged}
          leftRef={activeEditor.leftRef}
          rightRef={activeEditor.rightRef}
          title={activeEditor.title}
          onClose={closeGitDiff}
        />
      ) : activeEditor.typeId === WORKSPACE_RESOURCE_EDITOR_INPUT_TYPE_ID ? (
        <>
          <Breadcrumb />
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            {/* A stable synthetic paneId keys this file's flusher in the editorFlush
                registry; FilePreview itself keys the editor by workspace-root + path,
                so a switch remounts cleanly. */}
            <FilePreview file={activeEditor.resource} paneId={EDITOR_OVERLAY_PANE_ID} isActive />
          </div>
        </>
      ) : null}
    </div>
  );
};
