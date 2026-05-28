import { type JSX, useEffect } from 'react';
import { ErrorBanner } from './components/ErrorBanner.js';
import { Sidebar } from './components/Sidebar.js';
import { TopBar } from './components/TopBar.js';
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
        background: '#fff',
      }}
    >
      <TopBar />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar />
        <main
          style={{
            flex: 1,
            padding: 16,
            fontFamily: 'system-ui, sans-serif',
            fontSize: 13,
            color: '#888',
            overflow: 'auto',
          }}
        >
          Canvas lands in PR 11.
        </main>
      </div>
      {error && <ErrorBanner message={error} onDismiss={clearError} />}
    </div>
  );
};
