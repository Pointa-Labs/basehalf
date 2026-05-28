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
