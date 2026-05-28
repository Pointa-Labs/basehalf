import type { JSX } from 'react';
import { useWorkspaceStore } from '../store/workspace.js';

interface WorkspaceUnreachableProps {
  name: string;
  missingPath: string;
}

export const WorkspaceUnreachable = ({
  name,
  missingPath,
}: WorkspaceUnreachableProps): JSX.Element => {
  const busy = useWorkspaceStore((s) => s.busy);
  const repath = useWorkspaceStore((s) => s.repath);
  const remove = useWorkspaceStore((s) => s.remove);

  const handleRemove = (): void => {
    const ok = window.confirm(
      `Unregister "${name}" from BaseHalf?\n\nThe folder is already gone from this location, so nothing on disk changes; only the registration is dropped.`,
    );
    if (ok) void remove(name);
  };

  return (
    <div
      style={{
        padding: 16,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        color: '#333',
      }}
    >
      <div style={{ fontWeight: 600, color: '#a00', marginBottom: 8 }}>
        Workspace folder not found
      </div>
      <div style={{ marginBottom: 8 }}>
        BaseHalf can't find <strong>{name}</strong> at:
      </div>
      <div
        style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 11,
          background: '#f4f4f4',
          padding: '6px 8px',
          borderRadius: 3,
          marginBottom: 12,
          wordBreak: 'break-all',
        }}
      >
        {missingPath}
      </div>
      <div style={{ color: '#666', fontSize: 12, marginBottom: 12 }}>
        The folder may have been moved, renamed, or deleted in a file manager.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => void repath(name)}
          disabled={busy}
          style={{ padding: '6px 12px', fontSize: 13 }}
        >
          {busy ? '…' : 'Re-select location'}
        </button>
        <button
          type="button"
          onClick={handleRemove}
          disabled={busy}
          style={{ padding: '6px 12px', fontSize: 13, color: '#a00', borderColor: '#fcc' }}
        >
          Unregister
        </button>
      </div>
    </div>
  );
};
