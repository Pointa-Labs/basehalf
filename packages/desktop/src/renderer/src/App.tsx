import { type JSX, useEffect, useState } from 'react';
import { Canvas } from './components/Canvas.js';
import { CommandPalette, openCommandPalette } from './components/CommandPalette.js';
import { DialogHost } from './components/Dialog.js';
import { ErrorBanner } from './components/ErrorBanner.js';
import { FdaTip } from './components/FdaTip.js';
import { FilePreview } from './components/FilePreview.js';
import { Sidebar } from './components/Sidebar.js';
import { TopBar } from './components/TopBar.js';
import { color, font, motion, radius, space } from './design.js';
import { promptForNewNote } from './lib/actions.js';
import { useWorkspaceStore } from './store/workspace.js';

export const App = (): JSX.Element => {
  const error = useWorkspaceStore((s) => s.error);
  const clearError = useWorkspaceStore((s) => s.clearError);
  const refresh = useWorkspaceStore((s) => s.refresh);
  // Drag-drop folder → add as workspace. Tracked at the App level so the
  // overlay covers everything (TopBar, Sidebar, Canvas, FilePreview).
  // Using a depth counter rather than a boolean — dragenter/dragleave fire
  // on every nested child, so a naive boolean flickers on/off as the
  // pointer moves between them.
  const [dragDepth, setDragDepth] = useState(0);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Global rename listener: when the watcher detects a rename of the
  // currently-open file, rebind currentFile to the new path so the user
  // doesn't have to manually re-click in the NavTree. Without this, the
  // editor stays on the OLD path (which the unlink just flagged as
  // deleted) until the user notices the new file in the sidebar.
  useEffect(() => {
    const unsub = window.bh.onFileEvent((event) => {
      if (event.type !== 'rename') return;
      const state = useWorkspaceStore.getState();
      if (state.currentFile === event.fromRelPath) {
        // bypassFlush: the open file was renamed/moved on disk, so its OLD path
        // is gone. Flushing to it would resurrect a deleted file, and the
        // conflict gate would trap the editor on a vanished path — so rebind
        // straight to the new path (fresh editor on the moved file's bytes).
        state.setCurrentFile(event.toRelPath, null, { bypassFlush: true });
      }
    });
    return unsub;
  }, []);

  // Global keyboard shortcuts:
  //  - Cmd/Ctrl+K  — open the command palette
  //  - Cmd/Ctrl+N  — new note prompt (no-op without a current workspace)
  // Esc / click-outside close the palette via the palette itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === 'k') {
        e.preventDefault();
        openCommandPalette();
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        void promptForNewNote();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // File ▸ Open Folder… (⌘O) and the right-click "Open Folder…" both fire this
  // from the main process. Route it through the same pickAndAdd the in-app
  // flows use so the folder-open UX is identical everywhere (one door).
  useEffect(
    () => window.bh.onMenuOpenFolder(() => void useWorkspaceStore.getState().pickAndAdd()),
    [],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        margin: 0,
        background: color.bg,
      }}
      onDragEnter={(e) => {
        // Only react to Finder-drag (or any external drag carrying files).
        // Internal drag-source events (text selections, react-flow node drags)
        // don't have the "Files" type and shouldn't show the overlay.
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragDepth((d) => d + 1);
      }}
      onDragLeave={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragDepth((d) => Math.max(0, d - 1));
      }}
      onDragOver={(e) => {
        // Required to allow drop. Without preventDefault here the browser
        // treats the drop area as inert and onDrop never fires.
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragDepth(0);
        // Electron exposes a non-standard `.path` on dropped File objects
        // (absolute path on disk). Iterate, ignore non-folder entries (the
        // store action surfaces "path is not a directory" if a file slips
        // through), call workspace.add with setup:true so the agent-protocol
        // hint lands the same as the "Add folder" picker flow.
        const paths: string[] = [];
        for (const file of Array.from(e.dataTransfer.files)) {
          const p = (file as File & { path?: string }).path;
          if (typeof p === 'string' && p.length > 0) paths.push(p);
        }
        void useWorkspaceStore.getState().addDroppedPaths(paths);
      }}
    >
      <FdaTip />
      <TopBar />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar />
        <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <Canvas />
          {/* The editor opens as a centered overlay scoped to the canvas
              area (position:absolute within this relative <main>), so the
              canvas dims behind it but the Sidebar + TopBar stay lit and
              interactive — you can switch files / workspaces without first
              closing the editor, the way every file-based editor works. */}
          <FilePreview />
        </main>
      </div>
      {error && <ErrorBanner message={error} onDismiss={clearError} />}
      <DialogHost />
      <CommandPalette />
      {dragDepth > 0 && (
        <div
          // The overlay covers everything but doesn't intercept events —
          // pointerEvents:none lets the drag continue to fire on the
          // underlying drop target (the App root div above).
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(40, 100, 200, 0.08)',
            border: `3px dashed ${color.accent}`,
            zIndex: 200,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: `bh-fade-in ${motion.fast}`,
          }}
        >
          <div
            style={{
              background: color.surface,
              borderRadius: radius.xl,
              padding: `${space[4]}px ${space[6]}px`,
              boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
              fontFamily: font.sans,
              fontSize: font.size.body,
              color: color.textPrimary,
              fontWeight: font.weight.medium,
              letterSpacing: -0.1,
            }}
          >
            Drop a folder to add as a workspace
          </div>
        </div>
      )}
    </div>
  );
};
