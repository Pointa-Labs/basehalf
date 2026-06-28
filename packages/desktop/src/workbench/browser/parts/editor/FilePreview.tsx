import { type JSX, useEffect, useRef } from 'react';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import { color, font } from '../../style/design.js';
import { CodeEditor } from './CodeEditor.js';
import {
  AudioEditorPane,
  ImageEditorPane,
  PdfEditorPane,
  UnsupportedFileEditorPane,
  VideoEditorPane,
} from './FilePreviewPanes.js';
import { MdEditor } from './MdEditor.js';
import { filePreviewInput } from './filePreviewModel.js';
import { scrollToFirstMatch } from './scrollToMatch.js';
import { modeOf } from './viewerMode.js';

/** The editor body for the open file. The full-canvas editor overlay
 *  (EditorOverlay) supplies `file`, a stable synthetic `paneId` (for the flush
 *  registry), and `isActive` (it consumes the search jump-to-match). */
export const FilePreview = ({
  file,
  paneId,
  isActive,
}: { file: string; paneId: string; isActive: boolean }): JSX.Element => {
  const openMatchQuery = useWorkspaceStore((s) => s.openMatchQuery);
  const clearOpenMatchQuery = useWorkspaceStore((s) => s.clearOpenMatchQuery);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const current = useWorkspaceStore((s) => s.current);
  const wsPath = workspaces.find((w) => w.name === current)?.path ?? '';
  // The scrollable content area; jump-to-match (below) searches its rendered
  // text for a content-search hit.
  const contentRef = useRef<HTMLDivElement>(null);

  // Jump-to-match: when a file is opened FROM a content-search hit, land on the
  // passage. Only the ACTIVE pane consumes it (the search-open targets the active
  // pane). Scoped to the MD editor — its block-per-element layout makes a matched
  // text node resolve to a single block (a clean scroll target); anything else
  // (the single-<pre> text viewer, media) just opens at the top, so we consume
  // the target without scrolling. We search ONLY the BlockNote editable body
  // (`[contenteditable]`), never the editor chrome. The editable renders async,
  // so we retry on a short cadence until it appears + the match is found.
  useEffect(() => {
    if (!isActive || openMatchQuery === null) return;
    if (modeOf(file) !== 'md') {
      clearOpenMatchQuery();
      return;
    }
    let cancelled = false;
    let attempts = 0;
    let timer = 0;
    const tick = (): void => {
      if (cancelled) return;
      const body = contentRef.current?.querySelector<HTMLElement>('[contenteditable="true"]');
      if (body != null && scrollToFirstMatch(body, openMatchQuery)) {
        clearOpenMatchQuery();
        return;
      }
      if (++attempts >= 20) {
        clearOpenMatchQuery();
        return;
      }
      timer = window.setTimeout(tick, 150);
    };
    timer = window.setTimeout(tick, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isActive, file, openMatchQuery, clearOpenMatchQuery]);

  const previewInput = filePreviewInput(wsPath, file);
  // Key the text/MD views by the workspace ROOT PATH + relative path: a workspace
  // switch (or a repath to a new folder) whose layout has the same relative file in
  // the same pane would otherwise keep the component mounted, leaving the editor
  // bound to the previous folder's Yjs doc while reads/writes use the new one. The
  // path-scoped key forces a clean remount + a fresh shared doc.
  const { absPath, basename, mode, viewKey } = previewInput;

  return (
    // The editor body — fills the full-canvas editor overlay. The top bar (file
    // identity + ✕ close) lives in EditorOverlay; the canvas sits underneath,
    // preserved, so closing the overlay reveals it unchanged.
    <div
      style={{
        // flex:1 + minWidth:0 so we FILL the pane / float (both are flex-row
        // parents). Without this the editor shrink-wraps to its content width,
        // leaving the text in a small left block with big empty space.
        flex: 1,
        minWidth: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: color.surface,
        fontFamily: font.sans,
      }}
    >
      <div ref={contentRef} style={{ flex: 1, overflow: 'auto' }}>
        {mode === 'md' && <MdEditor key={viewKey} file={file} paneId={paneId} docKey={viewKey} />}
        {mode === 'code' && <CodeEditor key={viewKey} file={file} paneId={paneId} />}
        {mode === 'pdf' && <PdfEditorPane absPath={absPath} />}
        {mode === 'image' && <ImageEditorPane absPath={absPath} />}
        {mode === 'audio' && <AudioEditorPane absPath={absPath} basename={basename} />}
        {mode === 'video' && <VideoEditorPane absPath={absPath} />}
        {mode === 'other' && <UnsupportedFileEditorPane file={file} absPath={absPath} />}
      </div>
    </div>
  );
};
