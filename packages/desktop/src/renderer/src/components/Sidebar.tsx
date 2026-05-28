import type { JSX } from 'react';
import { useWorkspaceStore } from '../store/workspace.js';
import { NavTree } from './NavTree.js';
import { WorkspaceUnreachable } from './WorkspaceUnreachable.js';

export const Sidebar = (): JSX.Element => {
  const current = useWorkspaceStore((s) => s.current);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const currentReachable = useWorkspaceStore((s) => s.currentReachable);
  const currentWs = workspaces.find((w) => w.name === current);

  return (
    <aside
      style={{
        width: 260,
        borderRight: '1px solid #e0e0e0',
        background: '#fcfcfc',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        overflow: 'auto',
      }}
    >
      {currentWs ? (
        <>
          <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #eee' }}>
            <div style={{ fontWeight: 600, color: '#222' }}>{currentWs.name}</div>
            <div
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: 10,
                color: '#888',
                marginTop: 2,
              }}
            >
              {currentWs.path}
            </div>
          </div>
          {currentReachable === false ? (
            <WorkspaceUnreachable name={currentWs.name} missingPath={currentWs.path} />
          ) : (
            <NavTree rootPath={currentWs.path} />
          )}
        </>
      ) : (
        <div style={{ padding: 12, color: '#999' }}>Pick a workspace folder above to begin.</div>
      )}
    </aside>
  );
};
