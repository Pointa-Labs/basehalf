import { type JSX, useId, useState } from 'react';
import { color, font, motion, space } from '../../../browser/style/design.js';
import { welcomeCopy } from './copy.js';

const codeStyle = {
  fontFamily: font.mono,
  fontSize: '0.92em',
  background: color.surfaceMuted,
  padding: '1px 5px',
  borderRadius: 3,
  border: `1px solid ${color.divider}`,
} as const;

/**
 * A quiet, collapsed-by-default disclosure for the careful user: opening a folder
 * is non-destructive but not zero-touch (it adds a hidden `.bh/` and appends to
 * CLAUDE.md / AGENTS.md). Our user opens code folders too, so "what did it add to
 * my repo?" is a real reaction we preempt here — available, not in your face.
 */
export const FolderDisclosure = (): JSX.Element => {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[1.5],
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontFamily: font.sans,
          fontSize: font.size.caption,
          color: color.textTertiary,
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: `transform ${motion.fast}`,
            fontSize: 9,
            color: color.textGhost,
          }}
        >
          ▶
        </span>
        {welcomeCopy.disclosureSummary}
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-label={welcomeCopy.disclosureSummary}
          style={{
            marginTop: space[2],
            paddingLeft: space[3],
            fontSize: font.size.caption,
            color: color.textSecondary,
            lineHeight: 1.6,
          }}
        >
          A hidden <code style={codeStyle}>.bh/</code> folder — your canvas layout and notes, kept
          in the folder so it travels in git. And a short section appended to{' '}
          <code style={codeStyle}>CLAUDE.md</code> / <code style={codeStyle}>AGENTS.md</code>, so
          any AI agent finds your notes. Your own files are never moved or changed.
        </div>
      )}
    </div>
  );
};
