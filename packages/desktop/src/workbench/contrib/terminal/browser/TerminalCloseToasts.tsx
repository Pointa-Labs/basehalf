import { type JSX, useEffect } from 'react';
import { color, font, radius, shadow, space } from '../../../browser/style/design.js';
import { useTerminalStore } from './terminalStore.js';

const CLOSE_GRACE_MS = 6000;

export const TerminalCloseToasts = (): JSX.Element | null => {
  const closing = useTerminalStore((s) => s.closing);
  const titles = useTerminalStore((s) => s.titles);
  if (closing.length === 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: space[3],
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: space[1],
        pointerEvents: 'none',
        zIndex: 8,
      }}
    >
      {closing.map((entry) => {
        const name =
          entry.kind === 'tab'
            ? (entry.tab.titleOverride ?? titles[entry.tab.activePaneId] ?? 'Terminal')
            : (titles[entry.paneId] ?? 'Terminal');
        return <CloseToast key={entry.key} entryKey={entry.key} kind={entry.kind} name={name} />;
      })}
    </div>
  );
};

const CloseToast = ({
  entryKey,
  kind,
  name,
}: {
  entryKey: string;
  kind: 'tab' | 'pane';
  name: string;
}): JSX.Element => {
  const undoClose = useTerminalStore((s) => s.undoClose);
  const finalizeClose = useTerminalStore((s) => s.finalizeClose);
  useEffect(() => {
    const id = window.setTimeout(() => finalizeClose(entryKey), CLOSE_GRACE_MS);
    return () => window.clearTimeout(id);
  }, [entryKey, finalizeClose]);
  return (
    <div
      style={{
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: space[2],
        maxWidth: '92%',
        background: 'rgba(0,0,0,0.82)',
        color: '#fff',
        borderRadius: radius.md,
        padding: `${space[1]}px ${space[1]}px ${space[1]}px ${space[3]}px`,
        boxShadow: shadow.floating,
        fontFamily: font.sans,
        fontSize: font.size.caption,
      }}
    >
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        Closed {kind === 'tab' ? 'tab' : 'pane'} “{name}”
      </span>
      <button
        type="button"
        onClick={() => undoClose(entryKey)}
        style={{
          flexShrink: 0,
          border: 'none',
          background: 'transparent',
          color: color.accentHover,
          cursor: 'pointer',
          fontFamily: font.sans,
          fontSize: font.size.caption,
          fontWeight: font.weight.semibold,
          padding: `2px ${space[1]}px`,
        }}
      >
        Undo
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => finalizeClose(entryKey)}
        style={{
          flexShrink: 0,
          border: 'none',
          background: 'transparent',
          color: color.textTertiary,
          cursor: 'pointer',
          fontSize: 13,
          lineHeight: 1,
          width: 18,
          height: 18,
          borderRadius: radius.sm,
        }}
      >
        ×
      </button>
    </div>
  );
};
