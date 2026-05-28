import { type JSX, useState } from 'react';
import { useWorkspaceStore } from '../store/workspace.js';
import { NavTree } from './NavTree.js';
import { WorkspaceUnreachable } from './WorkspaceUnreachable.js';

export const Sidebar = (): JSX.Element => {
  const current = useWorkspaceStore((s) => s.current);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const currentReachable = useWorkspaceStore((s) => s.currentReachable);
  const currentWs = workspaces.find((w) => w.name === current);
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <aside
        style={{
          width: 22,
          borderRight: '1px solid #e0e0e0',
          background: '#fcfcfc',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '8px 0',
        }}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Show file tree"
          style={{
            width: 18,
            height: 18,
            padding: 0,
            border: '1px solid #d0d0d0',
            background: '#fff',
            borderRadius: 3,
            cursor: 'pointer',
            fontSize: 10,
            color: '#666',
          }}
        >
          ▸
        </button>
      </aside>
    );
  }

  return (
    <aside
      style={{
        width: 260,
        borderRight: '1px solid #e0e0e0',
        background: '#fcfcfc',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {currentWs ? (
        <>
          <div
            style={{
              padding: '10px 12px 8px',
              borderBottom: '1px solid #eee',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 6,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 600,
                  color: '#222',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={currentWs.name}
              >
                {currentWs.name}
              </div>
              <div
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: 10,
                  color: '#888',
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={currentWs.path}
              >
                {currentWs.path}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              title="Hide file tree"
              style={{
                width: 18,
                height: 18,
                padding: 0,
                border: '1px solid #d0d0d0',
                background: '#fff',
                borderRadius: 3,
                cursor: 'pointer',
                fontSize: 10,
                color: '#666',
                flexShrink: 0,
              }}
            >
              ◂
            </button>
          </div>
          {currentReachable === false ? (
            <WorkspaceUnreachable name={currentWs.name} missingPath={currentWs.path} />
          ) : (
            <NavTree rootPath={currentWs.path} />
          )}
        </>
      ) : (
        <div style={{ padding: 16, color: '#999', lineHeight: 1.5 }}>
          Pick a folder from the top bar to register it as a workspace.
        </div>
      )}
    </aside>
  );
};
