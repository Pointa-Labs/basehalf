import type { WorkspaceEntry, WorkspaceListResult } from '@basehalf/core';
import { type JSX, useCallback, useEffect, useState } from 'react';

export const App = (): JSX.Element => {
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceEntry[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const result = (await window.bh.run('workspace.list')) as WorkspaceListResult;
      setWorkspaces(result.workspaces);
      setCurrent(result.current);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pickAndAdd = async (): Promise<void> => {
    setBusy(true);
    try {
      const path = await window.bh.pickWorkspace();
      if (!path) return;
      await window.bh.run('workspace.add', { path });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <h1>BaseHalf</h1>
      <p style={{ color: '#666' }}>PR 10 — workspace picker + list.</p>
      <button
        type="button"
        onClick={pickAndAdd}
        disabled={busy}
        style={{ padding: '8px 16px', fontSize: 14 }}
      >
        {busy ? 'working…' : 'Pick a workspace folder'}
      </button>
      {workspaces.length === 0 ? (
        <p style={{ marginTop: 16, color: '#888' }}>
          No workspaces yet — pick a folder above to register one.
        </p>
      ) : (
        <ul style={{ marginTop: 16, paddingLeft: 0, listStyle: 'none' }}>
          {workspaces.map((ws) => (
            <li
              key={ws.name}
              style={{
                padding: '4px 0',
                fontWeight: ws.name === current ? 700 : 400,
              }}
            >
              <span style={{ display: 'inline-block', width: 16 }}>
                {ws.name === current ? '★' : ' '}
              </span>
              <span style={{ fontFamily: 'ui-monospace, monospace' }}>{ws.name}</span>
              <span style={{ color: '#666' }}> — {ws.path}</span>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <pre
          style={{
            marginTop: 16,
            padding: 12,
            background: '#fff0f0',
            border: '1px solid #fcc',
            borderRadius: 4,
            color: '#a00',
            overflow: 'auto',
          }}
        >
          {error}
        </pre>
      )}
    </div>
  );
};
