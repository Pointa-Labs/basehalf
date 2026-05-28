import type { JSX } from 'react';
import { useWorkspaceStore } from '../store/workspace.js';

export const Sidebar = (): JSX.Element => {
  const current = useWorkspaceStore((s) => s.current);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const currentWs = workspaces.find((w) => w.name === current);

  return (
    <aside
      style={{
        width: 240,
        borderRight: '1px solid #e0e0e0',
        background: '#fcfcfc',
        padding: 12,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        color: '#666',
        overflow: 'auto',
      }}
    >
      {currentWs ? (
        <>
          <div style={{ fontWeight: 600, color: '#222', marginBottom: 4 }}>{currentWs.name}</div>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, marginBottom: 16 }}>
            {currentWs.path}
          </div>
          <div style={{ color: '#999' }}>NavTree lands in PR 10-3.</div>
        </>
      ) : (
        <div>Pick a workspace folder above to begin.</div>
      )}
    </aside>
  );
};
