import { type JSX, useState } from 'react';

export const App = (): JSX.Element => {
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const runWorkspaceList = async (): Promise<void> => {
    setLoading(true);
    setError('');
    setResult('');
    try {
      const value = await window.bh.run('workspace.list');
      setResult(JSON.stringify(value, null, 2));
    } catch (err) {
      setError(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <h1>BaseHalf</h1>
      <p>PR 9 scaffold — IPC bridge sanity check.</p>
      <button
        type="button"
        onClick={runWorkspaceList}
        disabled={loading}
        style={{ padding: '8px 16px', fontSize: 14 }}
      >
        {loading ? 'running…' : 'window.bh.run("workspace.list")'}
      </button>
      {result && (
        <pre
          style={{
            marginTop: 16,
            padding: 12,
            background: '#f4f4f4',
            border: '1px solid #ddd',
            borderRadius: 4,
            overflow: 'auto',
          }}
        >
          {result}
        </pre>
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
