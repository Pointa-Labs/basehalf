import type { JSX } from 'react';
import { useWorkspaceStore } from '../store/workspace.js';

export const TopBar = (): JSX.Element => {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const current = useWorkspaceStore((s) => s.current);
  const busy = useWorkspaceStore((s) => s.busy);
  const pickAndAdd = useWorkspaceStore((s) => s.pickAndAdd);
  const use = useWorkspaceStore((s) => s.use);
  const remove = useWorkspaceStore((s) => s.remove);

  const handleRemove = (): void => {
    if (!current) return;
    const ok = window.confirm(
      `Remove workspace "${current}" from BaseHalf?\n\nThe folder and its files stay on disk; only the registration is removed.`,
    );
    if (ok) void remove(current);
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
        style={{ padding: '4px 8px', fontSize: 13, minWidth: 180 }}
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
          style={{
            padding: '4px 10px',
            fontSize: 13,
            color: '#a00',
            borderColor: '#fcc',
          }}
        >
          Remove current
        </button>
      )}
    </header>
  );
};
