/**
 * The update indicator — a small title-bar chip that projects the self-update
 * state machine into chrome (the editor's model: the update STATE lives in a chip
 * + menu, never in Settings). It is the single home for the update verbs.
 *
 * Visibility:
 *  - idle → nothing (the resting case; the chip is invisible until it has news).
 *  - actionable (available / downloading / staged / error) → persists until the
 *    user resolves it. An error carries a Retry verb, so it must NOT self-dismiss.
 *  - transient (checking / upToDate) → pure feedback from an explicit check;
 *    auto-hides after a few seconds.
 *
 * Tone is carried by color + plain copy, not decorative glyphs — the chrome is
 * restrained and Unicode symbols render inconsistently across the title bar.
 *
 * The "Restart to update" verb routes through the editor flush gate so it can
 * never strand unsaved work (the same gate the quit handshake uses).
 */

import { type JSX, useEffect, useState } from 'react';
import { color, font, radius, space, transition } from '../design.js';
import { flushAll } from '../lib/editorFlush.js';
import { useUpdateStore } from '../store/updates.js';

// Phases that are mere acknowledgement of an explicit check — they auto-hide.
// Everything else (available / downloading / staged / error) is actionable or
// in-flight and persists until resolved.
const TRANSIENT = new Set(['checking', 'upToDate']);

async function restart(): Promise<void> {
  // Flush first: a conflict / failed write returns false and KEEPS the editor
  // open so the user resolves it — never relaunch over unsaved work.
  const ok = await flushAll();
  if (ok) void window.bh.updateInstall();
}

export const UpdateChip = (): JSX.Element | null => {
  const state = useUpdateStore((s) => s.state);
  const [hidden, setHidden] = useState(false);
  // Optimistic acknowledgement: clicking "Update X" fires a download whose
  // first `downloading` phase may lag a beat — show "Starting…" immediately so
  // the click never feels dead. Cleared the moment any new state arrives.
  const [starting, setStarting] = useState(false);

  // Reset transient visibility + the optimistic flag on every state change, then
  // arm the auto-hide timer only for the transient phases.
  useEffect(() => {
    setHidden(false);
    setStarting(false);
    if (!TRANSIENT.has(state.phase)) return;
    const t = setTimeout(() => setHidden(true), 4000);
    return () => clearTimeout(t);
  }, [state]);

  if (state.phase === 'idle' || hidden) return null;

  // The download chip is its own variant: a determinate progress fill behind the
  // text so a moving percentage actually moves (a bare number reads as frozen).
  if (state.phase === 'downloading') {
    const known = state.total > 0;
    const pct = known ? Math.min(100, Math.floor((state.received / state.total) * 100)) : 0;
    return (
      <div style={{ ...baseStyle, ...progressShellStyle }} title={`Downloading… ${pct}%`}>
        <span
          aria-hidden
          style={{
            position: 'absolute',
            insetBlock: 0,
            insetInlineStart: 0,
            width: known ? `${pct}%` : '40%',
            background: color.accentSoft,
            transition: transition(['width'], 'normal'),
            ...(known ? {} : { animation: 'bh-chip-indeterminate 1.1s ease-in-out infinite' }),
          }}
        />
        <span style={{ position: 'relative' }}>
          {known ? `Downloading… ${pct}%` : 'Downloading…'}
        </span>
      </div>
    );
  }

  // Each remaining phase → { text, tone, onClick? }. A phase with onClick renders
  // as a button (the verb); a passive phase renders as a static pill.
  let text: string;
  let tone: 'neutral' | 'accent' | 'success' | 'danger' = 'neutral';
  let onClick: (() => void) | undefined;
  switch (state.phase) {
    case 'checking':
      text = 'Checking for updates…';
      break;
    case 'available':
      text = starting ? 'Starting…' : `Update ${state.version}`;
      tone = 'accent';
      onClick = starting
        ? undefined
        : () => {
            setStarting(true);
            void window.bh.updateDownload();
          };
      break;
    case 'staged':
      text = 'Restart to update';
      tone = 'accent';
      onClick = () => void restart();
      break;
    case 'upToDate':
      text = 'Up to date';
      tone = 'success';
      break;
    case 'error':
      text = 'Update failed — Retry';
      tone = 'danger';
      onClick = () => void window.bh.updateCheck();
      break;
  }

  const palette = {
    neutral: { fg: color.textSecondary, bg: color.surface, border: color.border },
    accent: { fg: color.onAccent, bg: color.accent, border: color.accent },
    success: { fg: color.success, bg: color.successSoft, border: 'transparent' },
    danger: { fg: color.danger, bg: color.dangerSoft, border: 'transparent' },
  }[tone];

  const style = {
    ...baseStyle,
    border: `1px solid ${palette.border}`,
    background: palette.bg,
    color: palette.fg,
    fontWeight: tone === 'accent' ? font.weight.medium : font.weight.regular,
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

// The shared chip shell — both the generic pill and the progress variant build
// on it so they sit identically in the title bar.
const baseStyle = {
  WebkitAppRegion: 'no-drag',
  display: 'inline-flex',
  alignItems: 'center',
  height: 22,
  padding: `0 ${space[2]}px`,
  borderRadius: radius.pill,
  fontFamily: font.sans,
  fontSize: font.size.caption,
  whiteSpace: 'nowrap',
} as const;

const progressShellStyle = {
  position: 'relative',
  overflow: 'hidden',
  border: `1px solid ${color.border}`,
  background: color.surface,
  color: color.textSecondary,
} as const;
