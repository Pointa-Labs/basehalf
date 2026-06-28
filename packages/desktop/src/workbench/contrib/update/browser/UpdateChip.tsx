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
import { updateService } from '../../../../platform/update/browser/updateService.js';
import { color, font, radius, space, transition } from '../../../browser/style/design.js';
import { flushAll } from '../../../services/editor/common/editorFlush.js';
import {
  type UpdateChipAction,
  isTransientUpdatePhase,
  updateChipViewModel,
} from './updateChipModel.js';
import { useUpdateStore } from './updateStore.js';

async function restart(): Promise<void> {
  // Flush first: a conflict / failed write returns false and KEEPS the editor
  // open so the user resolves it — never relaunch over unsaved work.
  const ok = await flushAll();
  if (ok) void updateService.install();
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
    if (!isTransientUpdatePhase(state.phase)) return;
    const t = setTimeout(() => setHidden(true), 4000);
    return () => clearTimeout(t);
  }, [state]);

  const model = updateChipViewModel(state, { hidden, starting });
  if (!model) return null;

  // The download chip is its own variant: a determinate progress fill behind the
  // text so a moving percentage actually moves (a bare number reads as frozen).
  if (model.kind === 'progress') {
    return (
      <div style={{ ...baseStyle, ...progressShellStyle }} title={model.title}>
        <span
          aria-hidden
          style={{
            position: 'absolute',
            insetBlock: 0,
            insetInlineStart: 0,
            width: model.progressKnown ? `${model.progressPercent}%` : '40%',
            background: color.accentSoft,
            transition: transition(['width'], 'normal'),
            ...(model.progressKnown
              ? {}
              : { animation: 'bh-chip-indeterminate 1.1s ease-in-out infinite' }),
          }}
        />
        <span style={{ position: 'relative' }}>{model.text}</span>
      </div>
    );
  }

  const onClick = model.action ? updateChipAction(setStarting, model.action) : undefined;

  const palette = {
    neutral: { fg: color.textSecondary, bg: color.surface, border: color.border },
    accent: { fg: color.onAccent, bg: color.accent, border: color.accent },
    success: { fg: color.success, bg: color.successSoft, border: 'transparent' },
    danger: { fg: color.danger, bg: color.dangerSoft, border: 'transparent' },
  }[model.tone];

  const style = {
    ...baseStyle,
    border: `1px solid ${palette.border}`,
    background: palette.bg,
    color: palette.fg,
    fontWeight: model.tone === 'accent' ? font.weight.medium : font.weight.regular,
    cursor: onClick ? 'pointer' : 'default',
    transition: transition(['background', 'border-color']),
  };

  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={model.title} style={style}>
        {model.text}
      </button>
    );
  }
  return (
    <div style={style} title={model.title}>
      {model.text}
    </div>
  );
};

function updateChipAction(
  setStarting: (starting: boolean) => void,
  action: UpdateChipAction,
): () => void {
  switch (action) {
    case 'download':
      return () => {
        setStarting(true);
        void updateService.download();
      };
    case 'install':
      return () => void restart();
    case 'check':
      return () => void updateService.check();
  }
}

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
