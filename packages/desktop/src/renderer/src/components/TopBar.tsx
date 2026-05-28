import type { JSX } from 'react';
import { useWorkspaceStore } from '../store/workspace.js';

export const TopBar = (): JSX.Element => {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const current = useWorkspaceStore((s) => s.current);
  const busy = useWorkspaceStore((s) => s.busy);
  const pickAndAdd = useWorkspaceStore((s) => s.pickAndAdd);
  const use = useWorkspaceStore((s) => s.use);
  const remove = useWorkspaceStore((s) => s.remove);
  const views = useWorkspaceStore((s) => s.views);
  const currentView = useWorkspaceStore((s) => s.currentView);
  const setCurrentView = useWorkspaceStore((s) => s.setCurrentView);
  const folderScope = useWorkspaceStore((s) => s.folderScope);
  const setFolderScope = useWorkspaceStore((s) => s.setFolderScope);
  const createView = useWorkspaceStore((s) => s.createView);

  const handleRemove = (): void => {
    if (!current) return;
    const ok = window.confirm(
      `Remove workspace "${current}" from BaseHalf?\n\nThe folder and its files stay on disk; only the registration is removed.`,
    );
    if (ok) void remove(current);
  };

  const handleCreateView = (): void => {
    const name = window.prompt('View name?');
    if (name?.trim()) void createView(name.trim());
  };

  const handleViewChange = (value: string): void => {
    if (value === '__main__') {
      setCurrentView(null);
      setFolderScope(null);
    } else {
      setCurrentView(value);
      setFolderScope(null);
    }
  };

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderBottom: '1px solid #e0e0e0',
        background: '#fafafa',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
      }}
    >
      <span style={{ fontWeight: 600 }}>BaseHalf</span>
      <select
        value={current ?? ''}
        onChange={(e) => {
          if (e.target.value) void use(e.target.value);
        }}
        disabled={busy || workspaces.length === 0}
        style={{ padding: '4px 8px', fontSize: 13, minWidth: 160 }}
      >
        {workspaces.length === 0 && <option value="">— no workspaces —</option>}
        {workspaces.map((ws) => (
          <option key={ws.name} value={ws.name}>
            {ws.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => void pickAndAdd()}
        disabled={busy}
        style={{ padding: '4px 10px', fontSize: 13 }}
      >
        {busy ? '…' : '+ Pick folder'}
      </button>
      {current && (
        <button
          type="button"
          onClick={handleRemove}
          disabled={busy}
          title={`Unregister "${current}" (files stay on disk)`}
          style={{ padding: '4px 10px', fontSize: 13, color: '#a00', borderColor: '#fcc' }}
        >
          Remove
        </button>
      )}
      <div style={{ flex: 1 }} />
      {current && (
        <>
          {folderScope && (
            <button
              type="button"
              onClick={() => setFolderScope(null)}
              title={`Scoped to folder: ${folderScope}. Click to exit.`}
              style={{ padding: '4px 10px', fontSize: 13 }}
            >
              ← exit /{folderScope}
            </button>
          )}
          <span style={{ color: '#888' }}>view:</span>
          <select
            value={currentView ?? '__main__'}
            onChange={(e) => handleViewChange(e.target.value)}
            style={{ padding: '4px 8px', fontSize: 13, minWidth: 140 }}
          >
            <option value="__main__">main canvas</option>
            {views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.members.length})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleCreateView}
            title="Create a new saved view in this workspace"
            style={{ padding: '4px 10px', fontSize: 13 }}
          >
            + New view
          </button>
        </>
      )}
    </header>
  );
};
