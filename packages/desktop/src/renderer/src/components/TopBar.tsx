import type { CSSProperties, JSX } from 'react';
import { useWorkspaceStore } from '../store/workspace.js';

const divider = (
  <span
    aria-hidden
    style={{ width: 1, height: 22, background: '#e0e0e0', display: 'inline-block' }}
  />
);

const btnStyle = (variant: 'default' | 'subtle' | 'primary' = 'default'): CSSProperties => ({
  padding: '4px 10px',
  fontSize: 13,
  fontFamily: 'system-ui, sans-serif',
  borderRadius: 4,
  cursor: 'pointer',
  // Prevent multi-word labels ("+ Add folder", "+ New note") from wrapping
  // onto two lines when the header gets cramped.
  whiteSpace: 'nowrap',
  flexShrink: 0,
  border:
    variant === 'primary'
      ? '1px solid #4a90e2'
      : variant === 'subtle'
        ? '1px solid transparent'
        : '1px solid #d0d0d0',
  background: variant === 'primary' ? '#4a90e2' : variant === 'subtle' ? 'transparent' : '#fff',
  color: variant === 'primary' ? '#fff' : variant === 'subtle' ? '#666' : '#222',
});

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
  const deleteView = useWorkspaceStore((s) => s.deleteView);
  const createNote = useWorkspaceStore((s) => s.createNote);

  const handleRemove = (): void => {
    if (!current) return;
    const ok = window.confirm(
      `Remove workspace "${current}" from BaseHalf?\n\nThe folder and its files stay on disk; only the registration is removed.`,
    );
    if (ok) void remove(current);
  };

  const handleCreateView = (): void => {
    const name = window.prompt('Name this view:');
    if (name?.trim()) void createView(name.trim());
  };

  const handleNewNote = (): void => {
    const raw = window.prompt(
      'New note path (workspace-relative; folders auto-created):',
      'untitled.md',
    );
    if (!raw?.trim()) return;
    let name = raw.trim();
    if (!/\.[a-z0-9]+$/i.test(name)) name += '.md';
    void createNote(name);
  };

  const handleDeleteView = (): void => {
    if (!currentView) return;
    const view = views.find((v) => v.id === currentView);
    if (!view) return;
    const ok = window.confirm(
      `Delete view "${view.name}"?\n\nThe badges and files in it are untouched — only this saved grouping is removed.`,
    );
    if (ok) void deleteView(currentView);
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
      <span style={{ fontWeight: 700, color: '#222', letterSpacing: 0.2 }}>BaseHalf</span>
      {divider}
      <select
        value={current ?? ''}
        onChange={(e) => {
          if (e.target.value) void use(e.target.value);
        }}
        disabled={busy || workspaces.length === 0}
        title={workspaces.length === 0 ? 'Add a workspace to begin' : 'Switch active workspace'}
        style={{
          padding: '4px 8px',
          fontSize: 13,
          minWidth: 160,
          borderRadius: 4,
          border: '1px solid #d0d0d0',
          background: '#fff',
        }}
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
        style={btnStyle('default')}
      >
        {busy ? '…' : '+ Add folder'}
      </button>
      {current && (
        <button
          type="button"
          onClick={handleRemove}
          disabled={busy}
          title={`Unregister "${current}" (files stay on disk)`}
          style={btnStyle('subtle')}
        >
          Remove
        </button>
      )}
      {current && (
        <>
          {divider}
          <button
            type="button"
            onClick={handleNewNote}
            title="Create a new note in this workspace"
            style={btnStyle('default')}
          >
            + New note
          </button>
        </>
      )}
      <div style={{ flex: 1 }} />
      {current && (
        <>
          {folderScope && (
            <>
              <button
                type="button"
                onClick={() => setFolderScope(null)}
                title="Exit this folder sub-canvas"
                style={btnStyle('default')}
              >
                ← /{folderScope}
              </button>
              {divider}
            </>
          )}
          <span style={{ color: '#888', fontSize: 12 }}>View</span>
          <select
            value={currentView ?? '__main__'}
            onChange={(e) => handleViewChange(e.target.value)}
            style={{
              padding: '4px 8px',
              fontSize: 13,
              minWidth: 160,
              borderRadius: 4,
              border: '1px solid #d0d0d0',
              background: '#fff',
            }}
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
            style={btnStyle('default')}
          >
            + New view
          </button>
          {currentView && (
            <button
              type="button"
              onClick={handleDeleteView}
              title="Delete this saved view (badges + files untouched)"
              style={btnStyle('subtle')}
            >
              Delete view
            </button>
          )}
        </>
      )}
    </header>
  );
};
