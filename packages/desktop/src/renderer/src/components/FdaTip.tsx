import { type JSX, useEffect, useState } from 'react';
import { color, font, motion, space, transition } from '../design.js';
import { useWorkspaceStore } from '../store/workspace.js';

const STORAGE_KEY = 'bh:fda-tip-dismissed';

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
        padding: `${space[2]}px ${space[4]}px`,
        background: color.warningSoft,
        borderBottom: `1px solid ${color.warning}33`,
        fontFamily: font.sans,
        fontSize: font.size.caption,
        color: color.warning,
        display: 'flex',
        alignItems: 'center',
        gap: space[3],
        flexShrink: 0,
        animation: `bh-banner-in ${motion.normal}`,
      }}
    >
      <span aria-hidden style={{ fontSize: font.size.body }}>
        ⚠
      </span>
      <span style={{ flex: 1, lineHeight: 1.5 }}>
        <strong style={{ fontFamily: font.mono, letterSpacing: -0.2 }}>{trigger}</strong> is under a
        macOS-protected folder. If files don’t show up, grant <strong>Full Disk Access</strong> in
        System Settings → Privacy & Security.
      </span>
      <button
        type="button"
        onClick={dismiss}
        style={{
          background: 'transparent',
          border: 'none',
          color: color.warning,
          padding: `${space[1]}px ${space[2]}px`,
          cursor: 'pointer',
          fontSize: font.size.caption,
          borderRadius: 4,
          fontFamily: font.sans,
          fontWeight: font.weight.medium,
          transition: transition(['background']),
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = `${color.warning}1a`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        Got it
      </button>
    </div>
  );
};
