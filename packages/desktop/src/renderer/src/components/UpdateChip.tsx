/**
 * The update indicator — a small title-bar chip that projects the self-update
 * state machine into chrome (the VS Code model: the update STATE lives in a chip
 * + menu, never in Settings). It is the single home for the update verbs.
 *
 * Visibility:
 *  - idle → nothing (the resting case; the chip is invisible until it has news).
 *  - actionable (available / downloading / staged) → persists until resolved.
 *  - transient (checking / upToDate / error) → feedback from an explicit check;
 *    auto-hides after a few seconds.
 *
 * The "Restart to Update" verb routes through the editor flush gate so it can
 * never strand unsaved work (the same gate the quit handshake uses).
 */

import { type JSX, useEffect, useState } from 'react';
import { color, font, radius, space, transition } from '../design.js';
import { flushAll } from '../lib/editorFlush.js';
import { useUpdateStore } from '../store/updates.js';

const TRANSIENT = new Set(['checking', 'upToDate', 'error']);

async function restart(): Promise<void> {
  // Flush first: a conflict / failed write returns false and KEEPS the editor
  // open so the user resolves it — never relaunch over unsaved work.
  const ok = await flushAll();
  if (ok) void window.bh.updateInstall();
}

export const UpdateChip = (): JSX.Element | null => {
  const state = useUpdateStore((s) => s.state);
  const [hidden, setHidden] = useState(false);

  // Auto-hide the transient phases; actionable phases persist (no timer).
  useEffect(() => {
    setHidden(false);
    if (!TRANSIENT.has(state.phase)) return;
    const ms = state.phase === 'error' ? 8000 : 4000;
    const t = setTimeout(() => setHidden(true), ms);
    return () => clearTimeout(t);
  }, [state]);

  if (state.phase === 'idle' || hidden) return null;

  // Each phase → { text, tone, onClick? }. A phase with onClick renders as a
  // button (the verb); a passive phase renders as a static pill.
  let text: string;
  let tone: 'neutral' | 'accent' | 'success' | 'danger' = 'neutral';
  let onClick: (() => void) | undefined;
  switch (state.phase) {
    case 'checking':
      text = 'Checking for updates…';
      break;
    case 'available':
      text = `↓ Update ${state.version}`;
      tone = 'accent';
      onClick = () => void window.bh.updateDownload();
      break;
    case 'downloading': {
      const pct = state.total > 0 ? Math.floor((state.received / state.total) * 100) : 0;
      text = `Downloading… ${pct}%`;
      break;
    }
    case 'staged':
      text = '↻ Restart to update';
      tone = 'accent';
      onClick = () => void restart();
      break;
    case 'upToDate':
      text = '✓ Up to date';
      tone = 'success';
      break;
    case 'error':
      text = '⚠ Update failed — Retry';
      tone = 'danger';
      onClick = () => void window.bh.updateCheck();
      break;
  }

  const palette = {
    neutral: { fg: color.textSecondary, bg: color.surface, border: color.border },
    accent: { fg: '#fff', bg: color.accent, border: color.accent },
    success: { fg: color.success, bg: color.successSoft, border: 'transparent' },
    danger: { fg: color.danger, bg: color.dangerSoft, border: 'transparent' },
  }[tone];

  const style = {
    WebkitAppRegion: 'no-drag',
    display: 'inline-flex',
    alignItems: 'center',
    height: 22,
    padding: `0 ${space[2]}px`,
    border: `1px solid ${palette.border}`,
    borderRadius: radius.pill,
    background: palette.bg,
    color: palette.fg,
    fontFamily: font.sans,
    fontSize: font.size.caption,
    fontWeight: tone === 'accent' ? font.weight.medium : font.weight.regular,
    whiteSpace: 'nowrap' as const,
    cursor: onClick ? 'pointer' : 'default',
    transition: transition(['background', 'border-color']),
  };

  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={text} style={style}>
        {text}
      </button>
    );
  }
  return (
    <div style={style} title={text}>
      {text}
    </div>
  );
};
