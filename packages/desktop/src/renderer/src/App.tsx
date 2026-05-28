import { type JSX, useEffect } from 'react';
import { Canvas } from './components/Canvas.js';
import { DialogHost } from './components/Dialog.js';
import { ErrorBanner } from './components/ErrorBanner.js';
import { FdaTip } from './components/FdaTip.js';
import { FilePreview } from './components/FilePreview.js';
import { Sidebar } from './components/Sidebar.js';
import { TopBar } from './components/TopBar.js';
import { color } from './design.js';
import { useWorkspaceStore } from './store/workspace.js';

export const App = (): JSX.Element => {
  const error = useWorkspaceStore((s) => s.error);
  const clearError = useWorkspaceStore((s) => s.clearError);
  const refresh = useWorkspaceStore((s) => s.refresh);

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
        state.setCurrentFile(event.toRelPath);
      }
    });
    return unsub;
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        margin: 0,
        background: color.bg,
      }}
    >
      <FdaTip />
      <TopBar />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar />
        <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <Canvas />
        </main>
        <FilePreview />
      </div>
      {error && <ErrorBanner message={error} onDismiss={clearError} />}
      <DialogHost />
    </div>
  );
};
