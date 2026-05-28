import { type JSX, useEffect, useState } from 'react';
import { useWorkspaceStore } from '../store/workspace.js';

const STORAGE_KEY = 'bh:fda-tip-dismissed';

// macOS TCC-protected user dirs. Apple doesn't expose a programmatic FDA
// prompt, so the best we can do is suggest the System Settings path when
// the user registers a workspace under one of these.
const MAC_PROTECTED_PATTERN =
  /^\/Users\/[^/]+\/(Documents|Desktop|Downloads|Pictures|Music|Movies)(\/|$)/;

const isMacOSProtectedPath = (path: string): boolean => MAC_PROTECTED_PATTERN.test(path);

export const FdaTip = (): JSX.Element | null => {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [trigger, setTrigger] = useState<string | null>(null);

  useEffect(() => {
    if (dismissed) return;
    if (window.bh.platform !== 'darwin') return;
    const hit = workspaces.find((w) => isMacOSProtectedPath(w.path));
    setTrigger(hit ? hit.path : null);
  }, [workspaces, dismissed]);

  if (dismissed || !trigger) return null;

  const dismiss = (): void => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // localStorage unavailable — accept; the tip will reappear next session.
    }
    setDismissed(true);
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        padding: '8px 12px',
        background: '#fff8dc',
        borderBottom: '1px solid #e8d77a',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        color: '#665500',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        zIndex: 10,
      }}
    >
      <span style={{ flex: 1 }}>
        Heads up: <strong>{trigger}</strong> is under a macOS protected folder. If files don't show
        up in the sidebar, grant <strong>Full Disk Access</strong> in System Settings → Privacy
        &amp; Security.
      </span>
      <button
        type="button"
        onClick={dismiss}
        style={{
          background: 'transparent',
          border: '1px solid #e8d77a',
          color: '#665500',
          padding: '2px 8px',
          cursor: 'pointer',
          fontSize: 12,
          borderRadius: 3,
        }}
      >
        got it
      </button>
    </div>
  );
};
